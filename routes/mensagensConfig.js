const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const emailService = require('../services/emailService');
const whatsappService = require('../services/whatsappService');
const notificationConfigService = require('../services/notificationConfigService');
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

module.exports = router;
