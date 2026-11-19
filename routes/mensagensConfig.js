const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../db/connection');
const emailService = require('../services/emailService');
const whatsappService = require('../services/whatsappService');
const notificationConfigService = require('../services/notificationConfigService');
const messageLogService = require('../services/messageLogService');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');

// Todas as rotas de configuração e disparo manual nesta página exigem perfil admin
router.use(authenticateToken, authorizeRoles('admin'));

// GET /api/mensagens-config - Carrega configurações atuais, catálogo de serviços e modelos prontos
router.get('/', async (req, res) => {
    try {
        const config = await notificationConfigService.getConfig();
        res.json({
            success: true,
            data: {
                config,
                catalog: notificationConfigService.getCatalog(),
                manualPresets: notificationConfigService.getManualPresets()
            }
        });
    } catch (err) {
        console.error('[MensagensConfig] Erro ao carregar configurações:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao carregar configurações de mensagens.' });
    }
});

// PUT /api/mensagens-config - Atualiza configurações gerais e regras por evento
router.put('/', async (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ success: false, error: 'Payload inválido.' });
        }

        const saved = await notificationConfigService.saveConfig(req.body);
        res.json({
            success: true,
            message: 'Configurações de mensagens salvas com sucesso!',
            data: saved
        });
    } catch (err) {
        console.error('[MensagensConfig] Erro ao salvar configurações:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao salvar configurações de mensagens.' });
    }
});

// POST /api/mensagens-config/restaurar-padrao - Restaura textos e marcações predefinidas
router.post('/restaurar-padrao', async (req, res) => {
    try {
        const eventKey = typeof req.body?.event_key === 'string' && req.body.event_key.trim()
            ? req.body.event_key.trim()
            : null;

        const updated = await notificationConfigService.resetConfig(eventKey);
        res.json({
            success: true,
            message: eventKey
                ? 'Texto padrão do serviço restaurado com sucesso!'
                : 'Todos os textos padrão foram restaurados com sucesso!',
            data: updated
        });
    } catch (err) {
        console.error('[MensagensConfig] Erro ao restaurar padrão:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao restaurar textos padrão.' });
    }
});

// Helper para enviar WhatsApp em lote respeitando pequenos batches
async function sendWhatsAppBatch(recipients, buildMessageFn) {
    let enviados = 0;
    let ignorados = 0;
    let falhas = 0;
    const BATCH_SIZE = 5;

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
        const batch = recipients.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
            batch.map(async (r) => {
                if (r.receber_whatsapp === 0 || r.receber_whatsapp === false) {
                    return { success: false, skipped: true };
                }
                const text = buildMessageFn(r);
                return whatsappService.sendTextMessage(r.telefone_whatsapp || r.telefone, text);
            })
        );

        for (const item of results) {
            if (item.status === 'fulfilled') {
                if (item.value?.success) enviados++;
                else if (item.value?.skipped) ignorados++;
                else falhas++;
            } else {
                falhas++;
            }
        }
    }

    return { enviados, ignorados, falhas };
}

// POST /api/mensagens-config/enviar-manual - Envio avulso (WhatsApp e/ou E-mail) com modelos e link do portal
router.post('/enviar-manual', async (req, res) => {
    try {
        const destinoTipo = typeof req.body?.destino_tipo === 'string' ? req.body.destino_tipo.trim() : '';
        const rawAlunoId = req.body?.aluno_id;
        const enviarWhatsapp = Boolean(req.body?.enviar_whatsapp);
        const enviarEmail = Boolean(req.body?.enviar_email);
        const incluirLink = req.body?.incluir_link !== false;
        const publicarNoPortal = Boolean(req.body?.publicar_no_portal);
        const titulo = typeof req.body?.titulo === 'string' ? req.body.titulo.trim() : '';
        const mensagem = typeof req.body?.mensagem === 'string' ? req.body.mensagem.trim() : '';

        if (!['todos_alunos', 'aluno', 'admin'].includes(destinoTipo)) {
            return res.status(400).json({ success: false, error: 'Tipo de destinatário inválido.' });
        }
        if (!enviarWhatsapp && !enviarEmail) {
            return res.status(400).json({ success: false, error: 'Selecione pelo menos um canal (WhatsApp ou E-mail).' });
        }
        if (!titulo || titulo.length > 120) {
            return res.status(400).json({ success: false, error: 'Informe um título válido (até 120 caracteres).' });
        }
        if (!mensagem || mensagem.length > 2500) {
            return res.status(400).json({ success: false, error: 'Informe uma mensagem válida (até 2500 caracteres).' });
        }

        const config = await notificationConfigService.getConfig();
        const portalUrl = config.portal_url || 'https://gestor.procombate.com';

        let waStats = { enviados: 0, ignorados: 0, falhas: 0 };
        let emailStats = { total_destinatarios: 0, enviados: 0, falhas: 0 };

        if (destinoTipo === 'admin') {
            const adminPhones = enviarWhatsapp ? notificationConfigService.parseRecipientList(config.admin_whatsapp) : [];
            const adminEmails = enviarEmail ? notificationConfigService.parseRecipientList(config.admin_email).filter(e => e.includes('@')) : [];

            if (enviarWhatsapp && adminPhones.length === 0 && !enviarEmail) {
                return res.status(400).json({ success: false, error: 'Configure ao menos um WhatsApp de Admin antes de enviar.' });
            }
            if (enviarEmail && adminEmails.length === 0 && !enviarWhatsapp) {
                return res.status(400).json({ success: false, error: 'Configure ao menos um E-mail de Admin antes de enviar.' });
            }
            if (enviarWhatsapp && enviarEmail && adminPhones.length === 0 && adminEmails.length === 0) {
                return res.status(400).json({ success: false, error: 'Configure um WhatsApp ou E-mail de Admin nas configurações gerais.' });
            }

            const adminText = notificationConfigService.renderTemplate(
                mensagem,
                { nome: 'Administrador', nome_completo: 'Administrador' },
                { includeLink, portalUrl }
            );

            if (enviarWhatsapp && adminPhones.length > 0) {
                waStats = await sendWhatsAppBatch(
                    adminPhones.map(p => ({ telefone: p, receber_whatsapp: 1 })),
                    () => adminText
                );
            }

            if (enviarEmail && adminEmails.length > 0) {
                emailStats = await emailService.sendBulkNotificationEmails(
                    adminEmails.map(e => ({ email: e, nome_completo: 'Administrador' })),
                    {
                        badgeText: 'COMUNICADO ADMIN',
                        titulo,
                        assunto: `[Admin] ${titulo} — PRO COMBATE`,
                        mensagem: notificationConfigService.stripWhatsAppFormatting(adminText),
                        ctaLabel: incluirLink ? 'Abrir Painel Admin' : '',
                        ctaUrl: incluirLink ? `${portalUrl.replace(/\/+$/, '')}/admin` : ''
                    }
                );
            }
        } else if (destinoTipo === 'aluno') {
            const alunoId = parseInt(rawAlunoId, 10);
            if (isNaN(alunoId) || alunoId <= 0) {
                return res.status(400).json({ success: false, error: 'Selecione um aluno válido.' });
            }

            await whatsappService.ensureWhatsAppColumn();
            const [rows] = await pool.query(
                'SELECT id, nome_completo, email, telefone_whatsapp, COALESCE(receber_whatsapp, 1) AS receber_whatsapp FROM alunos WHERE id = ? AND deleted_at IS NULL LIMIT 1',
                [alunoId]
            );
            if (rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
            }
            const aluno = rows[0];
            const primeiroNome = String(aluno.nome_completo || '').trim().split(/\s+/)[0] || 'Atleta';

            const renderedText = notificationConfigService.renderTemplate(
                mensagem,
                { nome: primeiroNome, nome_completo: aluno.nome_completo, email: aluno.email || '', telefone: aluno.telefone_whatsapp || '' },
                { includeLink, portalUrl }
            );

            if (enviarWhatsapp) {
                if (aluno.receber_whatsapp === 0) {
                    waStats.ignorados = 1;
                } else {
                    const waRes = await whatsappService.sendTextMessage(aluno.telefone_whatsapp, renderedText);
                    if (waRes.success) waStats.enviados = 1;
                    else if (waRes.skipped) waStats.ignorados = 1;
                    else waStats.falhas = 1;
                }
            }

            if (enviarEmail && aluno.email && String(aluno.email).includes('@')) {
                const mailRes = await emailService.sendNotificationEmail({
                    toEmail: aluno.email,
                    nomeDestinatario: aluno.nome_completo,
                    badgeText: 'COMUNICADO OFICIAL',
                    titulo,
                    assunto: `${titulo} — PRO COMBATE`,
                    mensagem: notificationConfigService.stripWhatsAppFormatting(renderedText),
                    ctaLabel: incluirLink ? 'Acessar gestor.procombate.com' : '',
                    ctaUrl: incluirLink ? portalUrl : ''
                });
                emailStats.total_destinatarios = 1;
                if (mailRes.success) emailStats.enviados = 1;
                else emailStats.falhas = 1;
            }
        } else {
            // todos_alunos
            await whatsappService.ensureWhatsAppColumn();
            const [alunos] = await pool.query(
                "SELECT id, nome_completo, email, telefone_whatsapp, COALESCE(receber_whatsapp, 1) AS receber_whatsapp FROM alunos WHERE status = 'ativo' AND deleted_at IS NULL"
            );

            if (publicarNoPortal) {
                try {
                    const portalDesc = notificationConfigService.stripWhatsAppFormatting(
                        notificationConfigService.renderTemplate(mensagem, { nome: 'Atleta' }, { includeLink, portalUrl })
                    );
                    await pool.query(
                        `INSERT INTO avisos_campanhas (titulo, tipo, descricao, tag_destaque, ativo)
                         VALUES (?, 'aviso', ?, 'COMUNICADO OFICIAL', 1)`,
                        [titulo, portalDesc]
                    );
                } catch (avisoErr) {
                    console.warn('[MensagensConfig] Falha ao salvar em avisos_campanhas:', avisoErr.message);
                }
            }

            if (enviarWhatsapp) {
                waStats = await sendWhatsAppBatch(alunos, (r) => {
                    const primeiroNome = String(r.nome_completo || '').trim().split(/\s+/)[0] || 'Atleta';
                    return notificationConfigService.renderTemplate(
                        mensagem,
                        { nome: primeiroNome, nome_completo: r.nome_completo, email: r.email || '', telefone: r.telefone_whatsapp || '' },
                        { includeLink, portalUrl }
                    );
                });
            }

            if (enviarEmail) {
                emailStats = await emailService.sendBulkNotificationEmails(alunos, (r) => {
                    const primeiroNome = String(r.nome_completo || '').trim().split(/\s+/)[0] || 'Atleta';
                    const textoEmail = notificationConfigService.stripWhatsAppFormatting(
                        notificationConfigService.renderTemplate(
                            mensagem,
                            { nome: primeiroNome, nome_completo: r.nome_completo, email: r.email || '', telefone: r.telefone_whatsapp || '' },
                            { includeLink, portalUrl }
                        )
                    );
                    return {
                        badgeText: 'COMUNICADO OFICIAL',
                        titulo,
                        assunto: `${titulo} — PRO COMBATE`,
                        mensagem: textoEmail,
                        ctaLabel: incluirLink ? 'Acessar gestor.procombate.com' : '',
                        ctaUrl: incluirLink ? portalUrl : ''
                    };
                });
            }
        }

        const partes = [];
        if (enviarWhatsapp) partes.push(`WhatsApp: ${waStats.enviados} enviado(s)`);
        if (enviarEmail) partes.push(`E-mail: ${emailStats.enviados} enviado(s)`);

        res.json({
            success: true,
            message: `Disparo concluído! ${partes.join(' | ')}`,
            data: { whatsapp: waStats, email: emailStats }
        });
    } catch (err) {
        console.error('[MensagensConfig] Erro no envio manual:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao processar envio manual.' });
    }
});

/**
 * Helper compartilhado para gerar código de verificação de 6 dígitos, salvar token e enviar e-mail.
 */
function buildVerificationTokenRecord(usuarioId) {
    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiraEm = new Date(Date.now() + 24 * 3600 * 1000);
    return { usuarioId, tokenHash, codigo, expiraEm };
}

async function dispatchVerificationSafe(email, nome, codigo) {
    try {
        await emailService.sendVerificationEmail(email, nome, codigo);
        return { enviado: true, erro_envio: null };
    } catch (mailErr) {
        return { enviado: false, erro_envio: mailErr.message || 'Falha no servidor SMTP.' };
    }
}

// GET /api/mensagens-config/logs - Lista histórico de envios (E-mail e WhatsApp)
router.get('/logs', async (req, res) => {
    try {
        const { canal = '', status = '', busca = '', limit = 100 } = req.query;
        const data = await messageLogService.listLogs({ canal, status, busca, limit });
        res.json({ success: true, data });
    } catch (err) {
        console.error('[MensagensConfig] Erro ao listar logs:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao listar histórico de envios.' });
    }
});

// GET /api/mensagens-config/pendentes - Lista alunos pendentes de confirmação de e-mail
router.get('/pendentes', async (req, res) => {
    try {
        const busca = typeof req.query?.busca === 'string' ? req.query.busca.trim() : '';
        let sql = `
            SELECT
                ua.id AS usuario_id,
                a.id AS aluno_id,
                a.nome_completo,
                ua.email,
                a.telefone_whatsapp,
                ua.status,
                ua.email_verificado,
                ua.created_at,
                (SELECT COUNT(*) FROM verificacoes_email ve WHERE ve.usuario_id = ua.id) AS tentativas_codigo,
                (SELECT MAX(ve.created_at) FROM verificacoes_email ve WHERE ve.usuario_id = ua.id) AS ultimo_envio_codigo
            FROM usuarios_alunos ua
            JOIN alunos a ON a.id = ua.aluno_id
            WHERE a.deleted_at IS NULL
              AND (ua.email_verificado = 0 OR ua.status = 'pendente_verificacao')
        `;
        const params = [];

        if (busca) {
            const like = `%${busca}%`;
            sql += ' AND (a.nome_completo LIKE ? OR ua.email LIKE ? OR a.telefone_whatsapp LIKE ?)';
            params.push(like, like, like);
        }

        sql += ' ORDER BY ua.created_at DESC LIMIT 100';

        const [pendentes] = await pool.query(sql, params);
        res.json({ success: true, data: pendentes });
    } catch (err) {
        console.error('[MensagensConfig] Erro ao listar cadastros pendentes:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao listar cadastros pendentes.' });
    }
});

// POST /api/mensagens-config/pendentes/:usuarioId/reenviar - Gera novo código e reenvia ao aluno pendente
router.post('/pendentes/:usuarioId/reenviar', async (req, res) => {
    try {
        const usuarioId = parseInt(req.params.usuarioId, 10);
        if (isNaN(usuarioId) || usuarioId <= 0) {
            return res.status(400).json({ success: false, error: 'ID de usuário inválido.' });
        }

        const [rows] = await pool.query(`
            SELECT ua.id, ua.email, ua.email_verificado, a.nome_completo
            FROM usuarios_alunos ua
            JOIN alunos a ON a.id = ua.aluno_id
            WHERE ua.id = ? AND a.deleted_at IS NULL
            LIMIT 1
        `, [usuarioId]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Cadastro pendente não encontrado.' });
        }

        const usuario = rows[0];
        if (usuario.email_verificado === 1) {
            return res.json({
                success: true,
                enviado: false,
                erro_envio: null,
                message: 'Este cadastro já possui o e-mail confirmado.'
            });
        }

        const rec = buildVerificationTokenRecord(usuarioId);
        await pool.query(
            `INSERT INTO verificacoes_email (usuario_id, token_hash, codigo_verificacao, expira_em, verificado)
             VALUES (?, ?, ?, ?, 0)`,
            [rec.usuarioId, rec.tokenHash, rec.codigo, rec.expiraEm]
        );

        const { enviado, erro_envio } = await dispatchVerificationSafe(usuario.email, usuario.nome_completo, rec.codigo);

        res.json({
            success: true,
            enviado,
            erro_envio,
            message: enviado
                ? `Novo código enviado com sucesso para ${usuario.email}!`
                : `Código gerado, mas o servidor SMTP falhou ao enviar para ${usuario.email}. Verifique o log de envios.`
        });
    } catch (err) {
        console.error('[MensagensConfig] Erro ao reenviar código:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao reenviar código de verificação.' });
    }
});

// POST /api/mensagens-config/pendentes/:usuarioId/corrigir-email - Corrige e-mail errado e reenvia código
router.post('/pendentes/:usuarioId/corrigir-email', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const usuarioId = parseInt(req.params.usuarioId, 10);
        if (isNaN(usuarioId) || usuarioId <= 0) {
            conn.release();
            return res.status(400).json({ success: false, error: 'ID de usuário inválido.' });
        }

        const rawEmail = typeof req.body?.novo_email === 'string' ? req.body.novo_email.trim().toLowerCase() : '';
        if (!rawEmail || rawEmail.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
            conn.release();
            return res.status(400).json({ success: false, error: 'Informe um novo e-mail válido (até 120 caracteres).' });
        }

        const reenviarCodigo = req.body?.reenviar_codigo !== false;

        await conn.beginTransaction();

        const [rows] = await conn.query(`
            SELECT ua.id, ua.aluno_id, a.nome_completo
            FROM usuarios_alunos ua
            JOIN alunos a ON a.id = ua.aluno_id
            WHERE ua.id = ? AND a.deleted_at IS NULL
            LIMIT 1
        `, [usuarioId]);

        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ success: false, error: 'Cadastro pendente não encontrado.' });
        }
        const usuario = rows[0];

        const [dupUsuario] = await conn.query(
            'SELECT id FROM usuarios_alunos WHERE email = ? AND id != ? LIMIT 1',
            [rawEmail, usuarioId]
        );
        const [dupAluno] = await conn.query(
            'SELECT id FROM alunos WHERE email = ? AND id != ? AND deleted_at IS NULL LIMIT 1',
            [rawEmail, usuario.aluno_id]
        );
        if (dupUsuario.length > 0 || dupAluno.length > 0) {
            await conn.rollback();
            return res.status(409).json({ success: false, error: 'Este e-mail já está em uso por outro aluno cadastrado.' });
        }

        await conn.query('UPDATE usuarios_alunos SET email = ? WHERE id = ?', [rawEmail, usuarioId]);
        await conn.query('UPDATE alunos SET email = ? WHERE id = ?', [rawEmail, usuario.aluno_id]);

        let rec = null;
        if (reenviarCodigo) {
            rec = buildVerificationTokenRecord(usuarioId);
            await conn.query(
                `INSERT INTO verificacoes_email (usuario_id, token_hash, codigo_verificacao, expira_em, verificado)
                 VALUES (?, ?, ?, ?, 0)`,
                [rec.usuarioId, rec.tokenHash, rec.codigo, rec.expiraEm]
            );
        }

        await conn.commit();

        let enviado = false;
        let erro_envio = null;
        if (rec) {
            const sendRes = await dispatchVerificationSafe(rawEmail, usuario.nome_completo, rec.codigo);
            enviado = sendRes.enviado;
            erro_envio = sendRes.erro_envio;
        }

        res.json({
            success: true,
            email_atualizado: rawEmail,
            enviado,
            erro_envio,
            message: reenviarCodigo
                ? (enviado
                    ? `E-mail atualizado para ${rawEmail} e novo código enviado!`
                    : `E-mail atualizado para ${rawEmail}, mas o envio falhou (${erro_envio || 'erro SMTP'}).`)
                : `E-mail atualizado para ${rawEmail} com sucesso!`
        });
    } catch (err) {
        await conn.rollback().catch(() => {});
        console.error('[MensagensConfig] Erro ao corrigir e-mail pendente:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, error: 'Este e-mail já está em uso por outro cadastro.' });
        }
        res.status(500).json({ success: false, error: 'Erro interno ao corrigir e-mail do cadastro.' });
    } finally {
        conn.release();
    }
});

// POST /api/mensagens-config/pendentes/:usuarioId/ativar - Ativa manualmente um cadastro sem esperar o código
router.post('/pendentes/:usuarioId/ativar', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const usuarioId = parseInt(req.params.usuarioId, 10);
        if (isNaN(usuarioId) || usuarioId <= 0) {
            conn.release();
            return res.status(400).json({ success: false, error: 'ID de usuário inválido.' });
        }

        await conn.beginTransaction();

        const [upd] = await conn.query(
            `UPDATE usuarios_alunos
             SET email_verificado = 1, status = 'ativo'
             WHERE id = ?`,
            [usuarioId]
        );
        if (upd.affectedRows === 0) {
            await conn.rollback();
            return res.status(404).json({ success: false, error: 'Cadastro de usuário não encontrado.' });
        }

        await conn.query(
            'UPDATE verificacoes_email SET verificado = 1 WHERE usuario_id = ? AND verificado = 0',
            [usuarioId]
        );

        await conn.commit();
        res.json({ success: true, message: 'Conta ativada e e-mail confirmado com sucesso!' });
    } catch (err) {
        await conn.rollback().catch(() => {});
        console.error('[MensagensConfig] Erro ao ativar cadastro:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao ativar cadastro.' });
    } finally {
        conn.release();
    }
});

module.exports = router;
