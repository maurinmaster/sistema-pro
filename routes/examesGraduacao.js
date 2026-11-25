/**
 * PRO COMBATE - Rotas de Exames de Graduação e Integração Asaas
 * Gestão de eventos de graduação, identificação de alunos aptos,
 * envio de convites e processamento de pagamentos via Gateway Asaas
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../db/connection');
const asaasService = require('../services/asaasService');
const notificationConfigService = require('../services/notificationConfigService');
const paymentReconciliationService = require('../services/paymentReconciliationService');
const examEligibilityService = require('../services/examEligibilityService');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');

const JWT_SECRET = process.env.JWT_SECRET;

let schemaEnsurePromise = null;

/**
 * Garante de forma idempotente as colunas necessárias para ciclo completo de exame
 * (método manual, resultado da banca e data/responsável pela promoção).
 */
async function ensureExamLifecycleSchema() {
    if (schemaEnsurePromise) return schemaEnsurePromise;

    schemaEnsurePromise = (async () => {
        try {
            const [tables] = await pool.query(`
                SELECT TABLE_NAME
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'evento_graduacao_convites'
                LIMIT 1
            `);
            if (tables.length === 0) return;

            const [cols] = await pool.query(`
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'evento_graduacao_convites'
            `);
            const existing = new Set(cols.map(c => String(c.COLUMN_NAME).toLowerCase()));

            const alterStatements = [];
            if (!existing.has('metodo_pagamento_manual')) {
                alterStatements.push("ADD COLUMN metodo_pagamento_manual VARCHAR(40) NULL AFTER data_pagamento");
            }
            if (!existing.has('resultado_exame')) {
                alterStatements.push("ADD COLUMN resultado_exame ENUM('pendente','aprovado','reprovado','ausente') NOT NULL DEFAULT 'pendente' AFTER metodo_pagamento_manual");
            }
            if (!existing.has('promovido_em')) {
                alterStatements.push("ADD COLUMN promovido_em DATETIME NULL AFTER resultado_exame");
            }
            if (!existing.has('promovido_por')) {
                alterStatements.push("ADD COLUMN promovido_por INT NULL AFTER promovido_em");
            }

            if (alterStatements.length > 0) {
                await pool.query(`ALTER TABLE evento_graduacao_convites ${alterStatements.join(', ')}`);
            }
        } catch (err) {
            console.warn('[Exames] Aviso ao verificar schema estendido de evento_graduacao_convites:', err.message);
        }
    })();

    return schemaEnsurePromise;
}

// Middleware de autenticação opcional (em produção o endpoint ainda exige identificação válida)
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    if (token && JWT_SECRET) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
            req.user = decoded;
        } catch {
            req.user = null;
        }
    }
    next();
}

/**
 * Resolve o ID do aluno autenticado com proteção contra spoofing.
 * Nunca utiliza fallback inseguro para aluno_id = 1.
 */
function resolveStudentContext(req) {
    if (req.user) {
        const cargo = String(req.user.cargo || '').toLowerCase();
        if (cargo === 'aluno') {
            const alunoId = parseInt(req.user.aluno_id || req.user.id, 10);
            if (!Number.isInteger(alunoId) || alunoId <= 0) {
                return { ok: false, status: 401, error: 'Sessão de aluno inválida.' };
            }
            return { ok: true, alunoId };
        }
        if (['admin', 'recepcao', 'professor'].includes(cargo)) {
            const rawId = req.body?.aluno_id ?? req.query?.aluno_id ?? req.user.aluno_id;
            const alunoId = parseInt(rawId, 10);
            if (!Number.isInteger(alunoId) || alunoId <= 0) {
                return { ok: false, status: 400, error: 'Informe um aluno_id válido.' };
            }
            return { ok: true, alunoId };
        }
        return { ok: false, status: 403, error: 'Perfil sem permissão para esta operação.' };
    }

    if (process.env.NODE_ENV === 'test') {
        const rawId = req.body?.aluno_id ?? req.query?.aluno_id;
        const alunoId = parseInt(rawId, 10);
        if (Number.isInteger(alunoId) && alunoId > 0) {
            return { ok: true, alunoId };
        }
    }

    return { ok: false, status: 401, error: 'Autenticação obrigatória para acessar seus exames.' };
}

function formatDateYmd(dateVal) {
    if (!dateVal) return new Date().toISOString().split('T')[0];
    if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
        return dateVal.toISOString().split('T')[0];
    }
    const match = String(dateVal).trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : new Date().toISOString().split('T')[0];
}

// ============================================================================
// 1. ROTAS ADMINISTRATIVAS - GESTÃO DE EVENTOS E CONVITES
// ============================================================================

/**
 * GET /api/exames/eventos
 * Lista todos os eventos de exame de graduação com contadores de participantes e origem financeira
 */
router.get('/eventos', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        await ensureExamLifecycleSchema();
        const { status, modalidade_id } = req.query;

        const manualCondition = `(
            c.asaas_payment_id IS NULL
            OR UPPER(COALESCE(c.asaas_status, '')) IN ('RECEIVED_MANUALLY', 'MANUAL', 'RECEIVED_IN_CASH')
            OR UPPER(COALESCE(c.asaas_billing_type, '')) = 'MANUAL'
            OR (UPPER(COALESCE(c.asaas_status, '')) = 'CONFIRMED' AND UPPER(COALESCE(c.asaas_billing_type, '')) != 'CREDIT_CARD')
        )`;

        let sql = `
            SELECT 
                eg.id,
                eg.titulo,
                eg.modalidade_id,
                m.nome AS modalidade_nome,
                eg.data_evento,
                eg.horario_inicio,
                eg.data_limite_inscricao,
                eg.local_evento,
                eg.taxa_inscricao,
                eg.descricao,
                eg.status,
                eg.created_at,
                COUNT(c.id) AS total_convidados,
                COALESCE(SUM(CASE WHEN c.status = 'convidado' THEN 1 ELSE 0 END), 0) AS total_convidados_pendentes,
                COALESCE(SUM(CASE WHEN c.status = 'pago' THEN 1 ELSE 0 END), 0) AS total_confirmados,
                COALESCE(SUM(CASE WHEN c.status = 'pago' THEN 1 ELSE 0 END), 0) AS total_pagos,
                COALESCE(SUM(CASE WHEN c.status = 'pago' AND NOT ${manualCondition} THEN 1 ELSE 0 END), 0) AS total_pagos_online,
                COALESCE(SUM(CASE WHEN c.status = 'pago' AND ${manualCondition} THEN 1 ELSE 0 END), 0) AS total_pagos_manual,
                COALESCE(SUM(CASE WHEN c.status = 'aceito' THEN 1 ELSE 0 END), 0) AS total_aguardando_pagamento,
                COALESCE(SUM(CASE WHEN c.status = 'recusado' THEN 1 ELSE 0 END), 0) AS total_recusados,
                COALESCE(SUM(CASE WHEN c.promovido_em IS NOT NULL THEN 1 ELSE 0 END), 0) AS total_promovidos,
                COALESCE(SUM(CASE WHEN c.status = 'pago' THEN c.valor ELSE 0 END), 0.00) AS total_arrecadado,
                COALESCE(SUM(CASE WHEN c.status = 'pago' AND NOT ${manualCondition} THEN c.valor ELSE 0 END), 0.00) AS valor_arrecadado_online,
                COALESCE(SUM(CASE WHEN c.status = 'pago' AND ${manualCondition} THEN c.valor ELSE 0 END), 0.00) AS valor_arrecadado_manual
            FROM eventos_graduacao eg
            LEFT JOIN modalidades m ON m.id = eg.modalidade_id
            LEFT JOIN evento_graduacao_convites c ON c.evento_id = eg.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            sql += ' AND eg.status = ?';
            params.push(status);
        }
        if (modalidade_id) {
            sql += ' AND eg.modalidade_id = ?';
            params.push(modalidade_id);
        }

        sql += ' GROUP BY eg.id ORDER BY eg.data_evento DESC, eg.id DESC';

        const [eventos] = await pool.query(sql, params);

        res.json({ success: true, data: eventos });
    } catch (err) {
        console.error('Erro ao listar eventos de exame:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar eventos de graduação.' });
    }
});

/**
 * GET /api/exames/eventos/:id
 * Retorna detalhes do evento e a lista enriquecida de alunos convidados (cores duplas, alertas de faixa/status, origem pgto)
 */
router.get('/eventos/:id', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        await ensureExamLifecycleSchema();

        const eventoId = parseInt(req.params.id, 10);
        if (isNaN(eventoId)) {
            return res.status(400).json({ success: false, error: 'ID do evento inválido.' });
        }

        const [eventos] = await pool.query(`
            SELECT eg.*, m.nome AS modalidade_nome
            FROM eventos_graduacao eg
            LEFT JOIN modalidades m ON m.id = eg.modalidade_id
            WHERE eg.id = ?
        `, [eventoId]);

        if (eventos.length === 0) {
            return res.status(404).json({ success: false, error: 'Evento de exame não encontrado.' });
        }

        const evento = eventos[0];

        let syncAtualizou = false;
        if (req.query.sync_asaas === '1') {
            try {
                const syncStats = await paymentReconciliationService.reconcileEventoConvites(eventoId);
                syncAtualizou = (syncStats.atualizados_online + syncStats.ajustados_manual) > 0;
            } catch (syncErr) {
                console.warn('[Exames] Falha não-bloqueante ao conciliar Asaas:', syncErr.message);
            }
        }

        const [convitesRows] = await pool.query(`
            SELECT 
                c.id AS convite_id,
                c.evento_id,
                c.aluno_id,
                a.nome_completo AS aluno_nome,
                a.foto_perfil_url AS aluno_foto,
                a.email AS aluno_email,
                a.telefone_whatsapp AS aluno_telefone,
                a.status AS aluno_status,
                a.deleted_at AS aluno_deleted_at,
                m.id AS modalidade_id,
                m.nome AS modalidade_nome,
                gn_atual.id AS graduacao_atual_id,
                gn_atual.nome AS graduacao_atual_nome,
                gn_atual.cor_hex_primaria AS atual_cor_primaria,
                gn_atual.cor_hex_secundaria AS atual_cor_secundaria,
                gn_atual.ordem_hierarquica AS atual_ordem,
                gn_pret.id AS graduacao_pretendida_id,
                gn_pret.nome AS graduacao_pretendida_nome,
                gn_pret.cor_hex_primaria AS pretendida_cor_primaria,
                gn_pret.cor_hex_secundaria AS pretendida_cor_secundaria,
                gn_pret.ordem_hierarquica AS pretendida_ordem,
                c.percentual_avaliacao,
                c.apto_motivo,
                c.valor,
                c.status AS convite_status,
                c.data_convite,
                c.data_resposta,
                c.motivo_recusa,
                c.asaas_payment_id,
                c.asaas_invoice_url,
                c.asaas_pix_copia_cola,
                c.asaas_billing_type,
                c.asaas_status,
                c.data_pagamento,
                c.metodo_pagamento_manual,
                c.resultado_exame,
                c.promovido_em,
                c.promovido_por
            FROM evento_graduacao_convites c
            JOIN alunos a ON a.id = c.aluno_id
            JOIN modalidades m ON m.id = c.modalidade_id
            JOIN graduacoes_niveis gn_atual ON gn_atual.id = c.graduacao_atual_id
            JOIN graduacoes_niveis gn_pret ON gn_pret.id = c.graduacao_pretendida_id
            WHERE c.evento_id = ?
            ORDER BY a.nome_completo ASC
        `, [eventoId]);

        // Carrega graduações reais atuais e tabela completa de níveis para detectar divergências sem N+1
        const realBeltMap = new Map();
        const levelsByModality = new Map();

        if (convitesRows.length > 0) {
            const alunoIds = [...new Set(convitesRows.map(c => Number(c.aluno_id)).filter(Boolean))];
            const modIds = [...new Set(convitesRows.map(c => Number(c.modalidade_id)).filter(Boolean))];

            if (modIds.length > 0) {
                const modPlaceholders = modIds.map(() => '?').join(', ');
                const [lvlRows] = await pool.query(`
                    SELECT id, modalidade_id, nome, ordem_hierarquica, cor_hex_primaria, cor_hex_secundaria
                    FROM graduacoes_niveis
                    WHERE modalidade_id IN (${modPlaceholders})
                    ORDER BY ordem_hierarquica ASC, id ASC
                `, modIds);
                for (const l of lvlRows) {
                    const mId = Number(l.modalidade_id);
                    if (!levelsByModality.has(mId)) levelsByModality.set(mId, []);
                    levelsByModality.get(mId).push(l);
                }
            }

            if (alunoIds.length > 0) {
                const alunoPlaceholders = alunoIds.map(() => '?').join(', ');
                const [agRows] = await pool.query(`
                    SELECT ag.aluno_id, ag.modalidade_id,
                           gn.id AS nivel_id, gn.nome, gn.ordem_hierarquica,
                           gn.cor_hex_primaria AS cor_primaria, gn.cor_hex_secundaria AS cor_secundaria
                    FROM aluno_graduacoes ag
                    JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
                    WHERE ag.aluno_id IN (${alunoPlaceholders}) AND ag.atual = 1
                    ORDER BY ag.id DESC
                `, alunoIds);

                for (const ag of agRows) {
                    const key = `${ag.aluno_id}::${ag.modalidade_id}`;
                    if (!realBeltMap.has(key)) {
                        realBeltMap.set(key, ag);
                    }
                }
            }
        }

        const convites = convitesRows.map((c) => {
            const origin = paymentReconciliationService.classifyConvitePaymentOrigin(c);
            const realBelt = realBeltMap.get(`${c.aluno_id}::${c.modalidade_id}`) || null;
            const modLevels = levelsByModality.get(Number(c.modalidade_id)) || [];
            const realNextBelt = realBelt
                ? examEligibilityService.findNextLevel(modLevels, realBelt.ordem_hierarquica)
                : null;

            const conflict = c.promovido_em
                ? { divergente: false, tipo: null, mensagem: null }
                : examEligibilityService.detectInviteBeltConflict({
                    inviteAtualId: c.graduacao_atual_id,
                    invitePretendidaId: c.graduacao_pretendida_id,
                    invitePretendidaOrdem: c.pretendida_ordem,
                    currentRealBelt: realBelt
                });

            const alunoExcluido = Boolean(c.aluno_deleted_at);
            const alunoInativo = Boolean(c.aluno_status && c.aluno_status !== 'ativo');

            return {
                ...c,
                pagamento_origem: c.convite_status === 'pago' ? origin.origem : null,
                origem_pagamento: origin.origem,
                origem_label: origin.label,
                aluno_excluido: alunoExcluido,
                aluno_inativo: alunoInativo,
                aluno_inativo_ou_excluido: alunoExcluido || alunoInativo,
                faixa_divergente: conflict.divergente,
                faixa_divergente_tipo: conflict.tipo,
                faixa_divergente_motivo: conflict.mensagem,
                grad_real_atual_id: realBelt ? Number(realBelt.nivel_id) : null,
                grad_real_atual_nome: realBelt ? realBelt.nome : null,
                grad_real_atual_cor: realBelt ? realBelt.cor_primaria : null,
                grad_real_atual_cor_secundaria: realBelt ? (realBelt.cor_secundaria || null) : null,
                grad_real_proxima_id: realNextBelt ? Number(realNextBelt.id) : null,
                grad_real_proxima_nome: realNextBelt ? realNextBelt.nome : null,
                grad_real_proxima_cor: realNextBelt ? realNextBelt.cor_hex_primaria : null,
                grad_real_proxima_cor_secundaria: realNextBelt ? (realNextBelt.cor_hex_secundaria || null) : null
            };
        });

        const pagos = convites.filter(c => c.convite_status === 'pago');
        const pagosOnline = pagos.filter(c => c.pagamento_origem === 'online');
        const pagosManual = pagos.filter(c => c.pagamento_origem === 'manual');
        const arrecadadoOnline = pagosOnline.reduce((acc, c) => acc + parseFloat(c.valor || 0), 0);
        const arrecadadoManual = pagosManual.reduce((acc, c) => acc + parseFloat(c.valor || 0), 0);

        evento.convites = convites;
        evento.sync_atualizou = syncAtualizou;
        evento.total_convidados = convites.length;
        evento.total_pagos = pagos.length;
        evento.total_aguardando_pagamento = convites.filter(c => c.convite_status === 'aceito').length;
        evento.total_confirmados = pagos.length;
        evento.total_arrecadado = arrecadadoOnline + arrecadadoManual;
        evento.resumo = {
            total_convidados: convites.length,
            sem_resposta: convites.filter(c => c.convite_status === 'convidado').length,
            aguardando_pagamento: convites.filter(c => c.convite_status === 'aceito').length,
            pagos: pagos.length,
            pagos_online: pagosOnline.length,
            pagos_manual: pagosManual.length,
            recusados: convites.filter(c => c.convite_status === 'recusado').length,
            arrecadado_total: arrecadadoOnline + arrecadadoManual,
            arrecadado_online: arrecadadoOnline,
            arrecadado_manual: arrecadadoManual,
            alertas_count: convites.filter(c => c.faixa_divergente || c.aluno_inativo_ou_excluido).length,
            promovidos: convites.filter(c => Boolean(c.promovido_em)).length
        };
        evento.contagem_faixas_compra = examEligibilityService.summarizeIntendedBeltsForPurchase(convites);

        res.json({ success: true, data: evento });
    } catch (err) {
        console.error('Erro ao consultar detalhes do evento:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar detalhes do evento.' });
    }
});

/**
 * POST /api/exames/eventos/:id/sincronizar-asaas
 * Sincroniza manualmente os convites do evento com a API do Asaas
 */
router.post('/eventos/:id/sincronizar-asaas', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        const eventoId = parseInt(req.params.id, 10);
        if (isNaN(eventoId)) {
            return res.status(400).json({ success: false, error: 'ID do evento inválido.' });
        }

        const stats = await paymentReconciliationService.reconcileEventoConvites(eventoId);
        const totalMudancas = stats.atualizados_online + stats.ajustados_manual;
        res.json({
            success: true,
            ...stats,
            message: totalMudancas > 0
                ? `${totalMudancas} inscrição(ões) atualizada(s) após conciliação com o Gateway Asaas.`
                : 'Conciliação concluída. Nenhuma divergência encontrada.'
        });
    } catch (err) {
        console.error('Erro ao sincronizar exame com Asaas:', err);
        res.status(500).json({ success: false, error: 'Erro ao sincronizar inscrições com o gateway.' });
    }
});

/**
 * POST /api/exames/eventos
 * Cria um novo evento de exame de graduação
 */
router.post('/eventos', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        const {
            titulo,
            modalidade_id,
            data_evento,
            horario_inicio,
            data_limite_inscricao,
            local_evento,
            taxa_inscricao,
            descricao,
            status
        } = req.body;

        if (!titulo || typeof titulo !== 'string' || titulo.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'O título do evento de exame é obrigatório.' });
        }

        if (!data_evento || !/^\d{4}-\d{2}-\d{2}$/.test(data_evento)) {
            return res.status(400).json({ success: false, error: 'A data do evento é obrigatória no formato AAAA-MM-DD.' });
        }

        const taxaNum = parseFloat(taxa_inscricao);
        if (isNaN(taxaNum) || taxaNum < 0) {
            return res.status(400).json({ success: false, error: 'A taxa de inscrição deve ser um valor numérico válido.' });
        }

        const cleanTitulo = titulo.trim().substring(0, 150);
        const cleanLocal = (local_evento && typeof local_evento === 'string') 
            ? local_evento.trim().substring(0, 200) 
            : 'Dojo Central - Pro Combate';
        const cleanHorario = (horario_inicio && /^\d{2}:\d{2}(:\d{2})?$/.test(horario_inicio)) 
            ? horario_inicio 
            : '09:00:00';
        const cleanDataLimite = (data_limite_inscricao && /^\d{4}-\d{2}-\d{2}$/.test(data_limite_inscricao)) 
            ? data_limite_inscricao 
            : null;
        const cleanStatus = ['rascunho', 'aberto', 'em_andamento', 'concluido', 'cancelado'].includes(status) 
            ? status 
            : 'aberto';
        const cleanModalidadeId = modalidade_id ? parseInt(modalidade_id, 10) : null;
        const usuarioId = req.user ? req.user.id : null;

        const [result] = await pool.query(`
            INSERT INTO eventos_graduacao (
                titulo, modalidade_id, data_evento, horario_inicio,
                data_limite_inscricao, local_evento, taxa_inscricao,
                descricao, status, criado_por_usuario_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            cleanTitulo, cleanModalidadeId, data_evento, cleanHorario,
            cleanDataLimite, cleanLocal, taxaNum,
            descricao || null, cleanStatus, usuarioId
        ]);

        const novoEventoId = result.insertId;

        // Cria aviso automático no mural da academia para divulgar o exame
        try {
            await pool.query(`
                INSERT INTO avisos_campanhas (titulo, tipo, descricao, data_evento, tag_destaque, ativo)
                VALUES (?, 'evento', ?, ?, 'Exame Oficial', 1)
            `, [
                cleanTitulo,
                descricao || `Novo Exame de Graduação agendado para ${data_evento} às ${cleanHorario}. Verifique sua aptidão técnica e confirme sua participação!`,
                data_evento
            ]);
        } catch (avisoErr) {
            console.warn('[Exames] Falha ao publicar aviso automático:', avisoErr.message);
        }

        res.status(201).json({
            success: true,
            message: 'Evento de exame de graduação iniciado com sucesso!',
            evento_id: novoEventoId,
            data: { id: novoEventoId }
        });
    } catch (err) {
        console.error('Erro ao criar evento de exame:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao criar evento de graduação.' });
    }
});

/**
 * PUT /api/exames/eventos/:id
 * Atualiza um evento existente
 */
router.put('/eventos/:id', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        const eventoId = parseInt(req.params.id, 10);
        if (isNaN(eventoId)) {
            return res.status(400).json({ success: false, error: 'ID do evento inválido.' });
        }

        const {
            titulo,
            modalidade_id,
            data_evento,
            horario_inicio,
            data_limite_inscricao,
            local_evento,
            taxa_inscricao,
            descricao,
            status
        } = req.body;

        const [existente] = await pool.query('SELECT id FROM eventos_graduacao WHERE id = ?', [eventoId]);
        if (existente.length === 0) {
            return res.status(404).json({ success: false, error: 'Evento não encontrado.' });
        }

        const updates = [];
        const params = [];

        if (titulo !== undefined) {
            updates.push('titulo = ?');
            params.push(String(titulo).trim().substring(0, 150));
        }
        if (modalidade_id !== undefined) {
            updates.push('modalidade_id = ?');
            params.push(modalidade_id ? parseInt(modalidade_id, 10) : null);
        }
        if (data_evento !== undefined) {
            updates.push('data_evento = ?');
            params.push(data_evento);
        }
        if (horario_inicio !== undefined) {
            updates.push('horario_inicio = ?');
            params.push(horario_inicio);
        }
        if (data_limite_inscricao !== undefined) {
            updates.push('data_limite_inscricao = ?');
            params.push(data_limite_inscricao || null);
        }
        if (local_evento !== undefined) {
            updates.push('local_evento = ?');
            params.push(String(local_evento).trim().substring(0, 200));
        }
        if (taxa_inscricao !== undefined) {
            const t = parseFloat(taxa_inscricao);
            updates.push('taxa_inscricao = ?');
            params.push(isNaN(t) ? 150.00 : t);
        }
        if (descricao !== undefined) {
            updates.push('descricao = ?');
            params.push(descricao || null);
        }
        if (status !== undefined) {
            if (['rascunho', 'aberto', 'em_andamento', 'concluido', 'cancelado'].includes(status)) {
                updates.push('status = ?');
                params.push(status);
            }
        }

        if (updates.length > 0) {
            params.push(eventoId);
            await pool.query(`UPDATE eventos_graduacao SET ${updates.join(', ')} WHERE id = ?`, params);
        }

        res.json({ success: true, message: 'Evento atualizado com sucesso.' });
    } catch (err) {
        console.error('Erro ao atualizar evento:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao atualizar evento.' });
    }
});

/**
 * DELETE /api/exames/eventos/:id
 * Remove um evento de graduação
 */
router.delete('/eventos/:id', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        const eventoId = parseInt(req.params.id, 10);
        if (isNaN(eventoId)) {
            return res.status(400).json({ success: false, error: 'ID inválido.' });
        }

        const [result] = await pool.query('DELETE FROM eventos_graduacao WHERE id = ?', [eventoId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Evento não encontrado.' });
        }

        res.json({ success: true, message: 'Evento de exame removido com sucesso.' });
    } catch (err) {
        console.error('Erro ao excluir evento:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao excluir evento.' });
    }
});

/**
 * GET /api/exames/alunos-aptos
 * Varre todos os alunos ativos com graduação e avalia aptidão técnica unificada
 * (RPG, Avaliação Formal de Graduação e Wiki de Golpes), além de listar inelegíveis quando solicitado.
 */
router.get('/alunos-aptos', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        const eventoId = req.query.evento_id ? parseInt(req.query.evento_id, 10) : null;
        const modalidadeId = req.query.modalidade_id ? parseInt(req.query.modalidade_id, 10) : null;
        const incluirInelegiveis = req.query.incluir_inelegiveis === '1';

        const allEvaluated = await examEligibilityService.loadExamEligibilityBatch(pool, {
            modalidadeId: Number.isInteger(modalidadeId) && modalidadeId > 0 ? modalidadeId : null
        });

        const convitesMap = new Map();
        if (eventoId && Number.isInteger(eventoId)) {
            const [conviteRows] = await pool.query(`
                SELECT id, aluno_id, status
                FROM evento_graduacao_convites
                WHERE evento_id = ?
            `, [eventoId]);
            for (const c of conviteRows) {
                convitesMap.set(Number(c.aluno_id), { convite_id: c.id, convite_status: c.status });
            }
        }

        const enrichWithInvite = (item) => {
            const conv = convitesMap.get(Number(item.aluno_id)) || null;
            return {
                ...item,
                ja_convidado: Boolean(conv),
                convite_id: conv ? conv.convite_id : null,
                convite_status: conv ? conv.convite_status : null,
                status_convite: conv ? conv.convite_status : null
            };
        };

        const aptos = [];
        const inelegiveis = [];

        for (const item of allEvaluated) {
            const enriched = enrichWithInvite(item);
            if (enriched.apto) {
                aptos.push(enriched);
            } else {
                inelegiveis.push(enriched);
            }
        }

        const jaConvidadosCount = aptos.filter(a => a.ja_convidado).length;
        const pendentesConviteCount = aptos.length - jaConvidadosCount;

        const payload = {
            success: true,
            total_aptos: aptos.length,
            resumo: {
                total_aptos: aptos.length,
                pendentes_convite: pendentesConviteCount,
                ja_convidados: jaConvidadosCount,
                total_inelegiveis: inelegiveis.length
            },
            data: aptos
        };

        if (incluirInelegiveis) {
            payload.inelegiveis = inelegiveis;
        }

        res.json(payload);
    } catch (err) {
        console.error('Erro ao consultar alunos aptos:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar alunos aptos para graduação.' });
    }
});

/**
 * POST /api/exames/eventos/:id/convidar
 * Insere alunos aptos na lista de convite do evento e dispara notificações (WhatsApp/E-mail)
 */
router.post('/eventos/:id/convidar', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        const eventoId = parseInt(req.params.id, 10);
        if (isNaN(eventoId)) {
            return res.status(400).json({ success: false, error: 'ID do evento inválido.' });
        }

        const [eventos] = await pool.query('SELECT * FROM eventos_graduacao WHERE id = ?', [eventoId]);
        if (eventos.length === 0) {
            return res.status(404).json({ success: false, error: 'Evento de exame não encontrado.' });
        }
        const evento = eventos[0];

        const { alunos } = req.body;
        if (!Array.isArray(alunos) || alunos.length === 0) {
            return res.status(400).json({ success: false, error: 'Selecione ao menos um aluno apto para convidar.' });
        }

        let convidadosCount = 0;
        const taxaPadrao = parseFloat(evento.taxa_inscricao) || 150.00;
        const invitedAlunoIds = [];

        const reqAlunoIds = [...new Set(alunos.map(a => parseInt(a?.aluno_id, 10)).filter(id => Number.isInteger(id) && id > 0))];
        const validAlunosSet = new Set();
        const eligByAlunoMod = new Map();

        if (reqAlunoIds.length > 0) {
            const ph = reqAlunoIds.map(() => '?').join(', ');
            const [activeRows] = await pool.query(
                `SELECT id FROM alunos WHERE id IN (${ph}) AND deleted_at IS NULL AND status != 'inativo'`,
                reqAlunoIds
            );
            activeRows.forEach(r => validAlunosSet.add(Number(r.id)));

            const eligRows = await examEligibilityService.loadExamEligibilityBatch(pool, { alunoIds: reqAlunoIds });
            eligRows.forEach(e => eligByAlunoMod.set(`${e.aluno_id}::${e.modalidade_id}`, e));
        }

        for (const al of alunos) {
            const alunoId = parseInt(al?.aluno_id, 10);
            if (!Number.isInteger(alunoId) || !validAlunosSet.has(alunoId)) {
                continue;
            }

            let modId = parseInt(al.modalidade_id, 10);
            let gradAtualId = parseInt(al.graduacao_atual_id, 10);
            let gradPretId = parseInt(al.graduacao_pretendida_id, 10);

            const elig = (Number.isInteger(modId) && eligByAlunoMod.get(`${alunoId}::${modId}`))
                || Array.from(eligByAlunoMod.values()).find(e => e.aluno_id === alunoId)
                || null;

            if (elig) {
                if (!modId) modId = elig.modalidade_id;
                if (!gradAtualId) gradAtualId = elig.graduacao_atual_id;
                if (!gradPretId || gradPretId === gradAtualId) gradPretId = elig.graduacao_pretendida_id;
            }

            if (!modId || !gradAtualId || !gradPretId || gradAtualId === gradPretId) {
                continue;
            }

            const pct = al.percentual_avaliacao !== undefined && al.percentual_avaliacao !== null
                ? parseFloat(al.percentual_avaliacao)
                : (elig ? elig.percentual_avaliacao : null);
            const motivo = al.apto_motivo || (elig ? elig.apto_motivo : 'Aluno apto com base nas avaliações e fundamentos da faixa');
            const val = al.valor ? parseFloat(al.valor) : taxaPadrao;

            const [result] = await pool.query(`
                INSERT INTO evento_graduacao_convites (
                    evento_id, aluno_id, modalidade_id,
                    graduacao_atual_id, graduacao_pretendida_id,
                    percentual_avaliacao, apto_motivo, valor,
                    status, data_convite
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'convidado', NOW())
                ON DUPLICATE KEY UPDATE
                    graduacao_atual_id = VALUES(graduacao_atual_id),
                    graduacao_pretendida_id = VALUES(graduacao_pretendida_id),
                    valor = VALUES(valor),
                    percentual_avaliacao = VALUES(percentual_avaliacao),
                    apto_motivo = VALUES(apto_motivo)
            `, [
                eventoId, alunoId, modId, gradAtualId, gradPretId, pct, motivo, val
            ]);

            if (result.affectedRows > 0) {
                convidadosCount++;
                invitedAlunoIds.push(alunoId);
            }
        }

        if (convidadosCount > 0) {
            try {
                const dataFmt = new Date(evento.data_evento).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
                await pool.query(`
                    INSERT INTO avisos_campanhas (titulo, tipo, descricao, data_evento, tag_destaque, ativo)
                    VALUES (?, 'campanha', ?, ?, 'Convite Oficial', 1)
                `, [
                    `Convites Enviados: ${evento.titulo}`,
                    `Os atletas qualificados para o Exame de Graduação de ${dataFmt} já receberam o convite em seu portal. Acesse a área de exames para confirmar presença e taxa.`,
                    evento.data_evento
                ]);
            } catch (avisoErr) {
                console.warn('[Exames] Falha ao registrar aviso:', avisoErr.message);
            }
        }

        // Envia notificações configuradas (WhatsApp e/ou E-mail) usando os alunos realmente convidados
        const uniqueInvitedIds = [...new Set(invitedAlunoIds)];
        try {
            if (uniqueInvitedIds.length > 0) {
                const dataFmt = evento.data_evento
                    ? new Date(evento.data_evento).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
                    : 'A definir';
                const horarioFmt = evento.horario_inicio
                    ? String(evento.horario_inicio).substring(0, 5)
                    : 'A definir';
                Promise.allSettled(
                    uniqueInvitedIds.map(id => notificationConfigService.dispatchEvent('convite_exame', {
                        alunoId: id,
                        variables: {
                            evento: evento.titulo,
                            data: dataFmt,
                            horario: horarioFmt,
                            local: evento.local_evento || 'PRO COMBATE'
                        },
                        detalhes: [
                            { label: 'Exame', value: evento.titulo },
                            { label: 'Data', value: dataFmt },
                            { label: 'Horário', value: horarioFmt },
                            { label: 'Local', value: evento.local_evento || 'PRO COMBATE' }
                        ]
                    }))
                ).catch(() => {});
            }
        } catch (emailErr) {
            console.warn('[Exames] Erro ao preparar notificações de convite:', emailErr.message);
        }

        res.status(201).json({
            success: true,
            message: `${convidadosCount} convite(s) gerado(s) com sucesso para o exame!`,
            total_convidados: convidadosCount,
            convites_enviados: convidadosCount,
            notificacoes_disparadas: uniqueInvitedIds.length
        });

    } catch (err) {
        console.error('Erro ao convidar alunos para o exame:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao processar convites para o exame.' });
    }
});

const METODOS_BAIXA_MANUAL = {
    dinheiro: 'Dinheiro (Balcão)',
    pix_direto: 'Pix Direto (Academia)',
    cartao_maquininha: 'Cartão (Maquininha)',
    outro: 'Outro (Manual)'
};

/**
 * POST /api/exames/convites/:conviteId/confirmar-manual
 * Permite ao gestor marcar como pago manualmente (dinheiro, Pix direto ou maquininha)
 */
router.post('/convites/:conviteId/confirmar-manual', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        await ensureExamLifecycleSchema();

        const conviteId = parseInt(req.params.conviteId, 10);
        if (isNaN(conviteId)) {
            return res.status(400).json({ success: false, error: 'ID do convite inválido.' });
        }

        const metodoRaw = String(req.body?.metodo_manual || 'dinheiro').trim().toLowerCase();
        const metodoManual = Object.prototype.hasOwnProperty.call(METODOS_BAIXA_MANUAL, metodoRaw)
            ? metodoRaw
            : 'dinheiro';
        const metodoLabel = METODOS_BAIXA_MANUAL[metodoManual];

        const [convRows] = await pool.query(`
            SELECT c.id, c.aluno_id, c.status, c.valor, c.asaas_payment_id, c.asaas_billing_type, c.asaas_status,
                   eg.titulo AS evento_titulo
            FROM evento_graduacao_convites c
            JOIN eventos_graduacao eg ON eg.id = c.evento_id
            WHERE c.id = ?
            LIMIT 1
        `, [conviteId]);

        if (convRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Convite não encontrado.' });
        }

        const convite = convRows[0];
        const wasPaid = convite.status === 'pago';
        let settlement = { alreadyPaidOnline: false, asaasClosedInCash: false };

        if (convite.asaas_payment_id) {
            settlement = await paymentReconciliationService.notifyAsaasManualSettlement(convite.asaas_payment_id, {
                valor: convite.valor,
                context: {
                    alunoId: convite.aluno_id,
                    referenciaTipo: 'convite_exame',
                    referenciaId: convite.id,
                    origemRota: '/api/exames/convites/:conviteId/confirmar-manual'
                }
            });
        }

        if (settlement.alreadyPaidOnline) {
            const billingUpper = String(settlement.cobranca?.billingType || 'PIX').trim().toUpperCase();
            const nextBilling = ['PIX', 'BOLETO', 'CREDIT_CARD', 'DEBIT_CARD'].includes(billingUpper) ? billingUpper : 'PIX';
            const nextStatus = (String(settlement.cobranca?.status || '').toUpperCase() === 'CONFIRMED' && nextBilling === 'CREDIT_CARD')
                ? 'CONFIRMED'
                : 'RECEIVED';

            await pool.query(`
                UPDATE evento_graduacao_convites
                SET status = 'pago',
                    data_pagamento = COALESCE(data_pagamento, NOW()),
                    data_resposta = COALESCE(data_resposta, NOW()),
                    asaas_billing_type = ?,
                    asaas_status = ?
                WHERE id = ?
            `, [nextBilling, nextStatus, conviteId]);

            if (!wasPaid) {
                const valorFmt = Number(convite.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                notificationConfigService.dispatchEvent('pagamento_exame', {
                    alunoId: convite.aluno_id,
                    variables: { evento: convite.evento_titulo, valor: valorFmt, metodo: `${nextBilling} (Asaas)` },
                    detalhes: [
                        { label: 'Exame', value: convite.evento_titulo },
                        { label: 'Valor', value: valorFmt },
                        { label: 'Método', value: `${nextBilling} (Asaas)` }
                    ]
                });
            }

            return res.json({
                success: true,
                origem_pagamento: 'online',
                message: 'Este exame já constava como pago no gateway Asaas! Status sincronizado como Pago (Online).'
            });
        }

        const manualAsaasStatus = settlement.asaasClosedInCash ? 'RECEIVED_IN_CASH' : 'RECEIVED_MANUALLY';
        await pool.query(`
            UPDATE evento_graduacao_convites
            SET status = 'pago',
                data_pagamento = NOW(),
                data_resposta = COALESCE(data_resposta, NOW()),
                asaas_billing_type = 'MANUAL',
                asaas_status = ?,
                metodo_pagamento_manual = ?
            WHERE id = ?
        `, [manualAsaasStatus, metodoManual, conviteId]);

        if (!wasPaid) {
            try {
                const valorFmt = Number(convite.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                notificationConfigService.dispatchEvent('pagamento_exame', {
                    alunoId: convite.aluno_id,
                    variables: { evento: convite.evento_titulo, valor: valorFmt, metodo: metodoLabel },
                    detalhes: [
                        { label: 'Exame', value: convite.evento_titulo },
                        { label: 'Valor', value: valorFmt },
                        { label: 'Método', value: metodoLabel }
                    ]
                });
            } catch (wErr) {
                console.warn('[Exames] Falha ao notificar WhatsApp:', wErr.message);
            }
        }

        res.json({
            success: true,
            origem_pagamento: 'manual',
            metodo_pagamento_manual: metodoManual,
            asaas_baixa_dinheiro: Boolean(settlement.asaasClosedInCash),
            message: `Inscrição confirmada manualmente (${metodoLabel}) com sucesso!`
        });
    } catch (err) {
        console.error('Erro ao confirmar pagamento manual:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao confirmar inscrição.' });
    }
});

/**
 * POST /api/exames/convites/:conviteId/estornar-manual
 * Reverte uma baixa manual (somente pagamentos manuais ainda não promovidos)
 */
router.post('/convites/:conviteId/estornar-manual', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        await ensureExamLifecycleSchema();

        const conviteId = parseInt(req.params.conviteId, 10);
        if (isNaN(conviteId)) {
            return res.status(400).json({ success: false, error: 'ID do convite inválido.' });
        }

        const [rows] = await pool.query(`
            SELECT id, status, asaas_payment_id, asaas_invoice_url, asaas_billing_type, asaas_status, promovido_em
            FROM evento_graduacao_convites
            WHERE id = ?
            LIMIT 1
        `, [conviteId]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Convite não encontrado.' });
        }

        const convite = rows[0];
        if (convite.status !== 'pago') {
            return res.status(400).json({ success: false, error: 'Apenas inscrições pagas podem ser estornadas.' });
        }
        if (convite.promovido_em) {
            return res.status(400).json({ success: false, error: 'Este atleta já foi promovido neste exame. Ajuste a graduação manualmente antes de estornar.' });
        }

        const origin = paymentReconciliationService.classifyConvitePaymentOrigin(convite);
        if (origin.origem === 'online') {
            return res.status(400).json({
                success: false,
                error: 'Pagamentos realizados via Gateway Online devem ser estornados diretamente no painel Asaas.'
            });
        }

        const nextStatus = convite.asaas_payment_id ? 'aceito' : 'convidado';
        const nextAsaasStatus = convite.asaas_payment_id ? 'PENDING' : null;
        const nextBilling = convite.asaas_payment_id && String(convite.asaas_billing_type || '').toUpperCase() === 'MANUAL'
            ? 'PIX'
            : (convite.asaas_payment_id ? convite.asaas_billing_type : null);

        await pool.query(`
            UPDATE evento_graduacao_convites
            SET status = ?,
                data_pagamento = NULL,
                metodo_pagamento_manual = NULL,
                asaas_status = ?,
                asaas_billing_type = ?,
                resultado_exame = 'pendente'
            WHERE id = ?
        `, [nextStatus, nextAsaasStatus, nextBilling, conviteId]);

        res.json({
            success: true,
            novo_status: nextStatus,
            message: 'Baixa manual estornada com sucesso. A inscrição voltou para o status pendente.'
        });
    } catch (err) {
        console.error('Erro ao estornar pagamento manual:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao estornar pagamento manual.' });
    }
});

/**
 * POST /api/exames/convites/:conviteId/atualizar-faixa
 * Sincroniza a faixa atual e pretendida do convite com a graduação real atual do aluno
 */
router.post('/convites/:conviteId/atualizar-faixa', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        const conviteId = parseInt(req.params.conviteId, 10);
        if (isNaN(conviteId)) {
            return res.status(400).json({ success: false, error: 'ID do convite inválido.' });
        }

        const [rows] = await pool.query(`
            SELECT c.id, c.aluno_id, c.modalidade_id
            FROM evento_graduacao_convites c
            WHERE c.id = ?
            LIMIT 1
        `, [conviteId]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Convite não encontrado.' });
        }

        const convite = rows[0];

        const [realRows] = await pool.query(`
            SELECT ag.graduacao_nivel_id, gn.nome, gn.ordem_hierarquica
            FROM aluno_graduacoes ag
            JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
            WHERE ag.aluno_id = ? AND ag.modalidade_id = ? AND ag.atual = 1
            ORDER BY ag.id DESC
            LIMIT 1
        `, [convite.aluno_id, convite.modalidade_id]);

        if (realRows.length === 0) {
            return res.status(400).json({ success: false, error: 'Aluno não possui graduação ativa nesta modalidade.' });
        }

        const realAtual = realRows[0];
        const [modLevels] = await pool.query(`
            SELECT id, nome, ordem_hierarquica
            FROM graduacoes_niveis
            WHERE modalidade_id = ?
            ORDER BY ordem_hierarquica ASC, id ASC
        `, [convite.modalidade_id]);

        const nextLevel = examEligibilityService.findNextLevel(modLevels, realAtual.ordem_hierarquica);
        if (!nextLevel) {
            return res.status(400).json({
                success: false,
                error: 'O aluno já atingiu a graduação máxima cadastrada nesta modalidade.'
            });
        }

        await pool.query(`
            UPDATE evento_graduacao_convites
            SET graduacao_atual_id = ?,
                graduacao_pretendida_id = ?
            WHERE id = ?
        `, [realAtual.graduacao_nivel_id, nextLevel.id, conviteId]);

        res.json({
            success: true,
            message: `Faixa sincronizada: ${realAtual.nome} → ${nextLevel.nome}`
        });
    } catch (err) {
        console.error('Erro ao atualizar faixa do convite:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao sincronizar faixa do convite.' });
    }
});

/**
 * POST /api/exames/convites/:conviteId/reenviar
 * Reenvia notificação de convite de exame (WhatsApp / E-mail) para um atleta ainda não pago
 */
router.post('/convites/:conviteId/reenviar', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        const conviteId = parseInt(req.params.conviteId, 10);
        if (isNaN(conviteId)) {
            return res.status(400).json({ success: false, error: 'ID do convite inválido.' });
        }

        const [rows] = await pool.query(`
            SELECT c.id, c.aluno_id, c.status, a.deleted_at,
                   eg.titulo, eg.data_evento, eg.horario_inicio, eg.local_evento
            FROM evento_graduacao_convites c
            JOIN alunos a ON a.id = c.aluno_id
            JOIN eventos_graduacao eg ON eg.id = c.evento_id
            WHERE c.id = ?
            LIMIT 1
        `, [conviteId]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Convite não encontrado.' });
        }

        const conv = rows[0];
        if (conv.deleted_at) {
            return res.status(400).json({ success: false, error: 'Não é possível reenviar convite para um cadastro na lixeira.' });
        }
        if (conv.status === 'pago') {
            return res.status(400).json({ success: false, error: 'Este convite já está quitado.' });
        }

        const dataFmt = conv.data_evento
            ? new Date(conv.data_evento).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
            : 'A definir';
        const horarioFmt = conv.horario_inicio
            ? String(conv.horario_inicio).substring(0, 5)
            : 'A definir';

        const dispatchRes = await notificationConfigService.dispatchEvent('convite_exame', {
            alunoId: conv.aluno_id,
            variables: {
                evento: conv.titulo,
                data: dataFmt,
                horario: horarioFmt,
                local: conv.local_evento || 'PRO COMBATE'
            },
            detalhes: [
                { label: 'Exame', value: conv.titulo },
                { label: 'Data', value: dataFmt },
                { label: 'Horário', value: horarioFmt },
                { label: 'Local', value: conv.local_evento || 'PRO COMBATE' }
            ]
        });

        res.json({
            success: true,
            dispatch: dispatchRes || null,
            message: 'Notificação do convite reenviada para a fila de disparo!'
        });
    } catch (err) {
        console.error('Erro ao reenviar notificação de convite:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao reenviar notificação do convite.' });
    }
});

/**
 * DELETE /api/exames/convites/:conviteId
 * Remove um convite não pago do evento e cancela cobrança Asaas em aberto, se existir
 */
router.delete('/convites/:conviteId', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        const conviteId = parseInt(req.params.conviteId, 10);
        if (isNaN(conviteId)) {
            return res.status(400).json({ success: false, error: 'ID do convite inválido.' });
        }

        const [rows] = await pool.query(`
            SELECT id, aluno_id, status, asaas_payment_id
            FROM evento_graduacao_convites
            WHERE id = ?
            LIMIT 1
        `, [conviteId]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Convite não encontrado.' });
        }

        const convite = rows[0];
        if (convite.status === 'pago') {
            return res.status(400).json({
                success: false,
                error: 'Não é possível cancelar um convite já pago. Realize o estorno antes de cancelar.'
            });
        }

        if (convite.asaas_payment_id) {
            try {
                await asaasService.cancelarCobranca(convite.asaas_payment_id, {
                    alunoId: convite.aluno_id,
                    referenciaTipo: 'convite_exame',
                    referenciaId: convite.id,
                    origemRota: 'DELETE /api/exames/convites/:conviteId'
                });
            } catch (cancelErr) {
                console.warn('[Exames] Aviso ao cancelar cobrança Asaas no cancelamento do convite:', cancelErr.message);
            }
        }

        await pool.query('DELETE FROM evento_graduacao_convites WHERE id = ?', [conviteId]);

        res.json({ success: true, message: 'Convite cancelado e removido do evento com sucesso.' });
    } catch (err) {
        console.error('Erro ao cancelar convite:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao cancelar convite.' });
    }
});

/**
 * POST /api/exames/convites/:conviteId/reativar
 * Permite ao gestor reativar um convite que havia sido recusado pelo atleta caso ele mude de ideia
 */
router.post('/convites/:conviteId/reativar', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        const conviteId = parseInt(req.params.conviteId, 10);
        if (isNaN(conviteId)) {
            return res.status(400).json({ success: false, error: 'ID do convite inválido.' });
        }

        const [result] = await pool.query(`
            UPDATE evento_graduacao_convites
            SET status = 'convidado',
                motivo_recusa = NULL,
                data_resposta = NULL
            WHERE id = ?
        `, [conviteId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Convite não encontrado.' });
        }

        res.json({ success: true, message: 'Inscrição reativada com sucesso! O atleta poderá confirmar participação novamente.' });
    } catch (err) {
        console.error('Erro ao reativar convite:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao reativar inscrição.' });
    }
});

/**
 * POST /api/exames/convites/:conviteId/aceitar-manual
 * Permite que professor/admin/recepção aprove manualmente o convite em nome de um aluno
 * sem acesso à plataforma, com geração opcional da fatura digital Asaas.
 */
router.post('/convites/:conviteId/aceitar-manual', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        const conviteId = parseInt(req.params.conviteId, 10);
        if (isNaN(conviteId)) {
            return res.status(400).json({ success: false, error: 'ID do convite inválido.' });
        }

        const gerarCobranca = req.body?.gerar_cobranca !== false;
        const billingType = examEligibilityService.normalizeExamBillingType(req.body?.billing_type);

        const [rows] = await pool.query(`
            SELECT c.id, c.aluno_id, c.status, c.valor, c.asaas_payment_id, c.asaas_invoice_url,
                   a.deleted_at AS aluno_deleted_at,
                   eg.titulo AS evento_titulo
            FROM evento_graduacao_convites c
            JOIN alunos a ON a.id = c.aluno_id
            JOIN eventos_graduacao eg ON eg.id = c.evento_id
            WHERE c.id = ?
            LIMIT 1
        `, [conviteId]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Convite não encontrado.' });
        }

        const conv = rows[0];
        const validation = examEligibilityService.validateManualInviteAcceptance(conv, { gerarCobranca });
        if (!validation.allowed) {
            return res.status(400).json({ success: false, error: validation.error });
        }

        if (gerarCobranca) {
            try {
                const result = await executarAceiteConvite({
                    conviteId,
                    alunoId: conv.aluno_id,
                    billingType
                });
                const customMessage = validation.mode === 'generate_invoice'
                    ? 'Fatura digital gerada com sucesso!'
                    : 'Convite aprovado manualmente e cobrança digital gerada com sucesso!';
                return res.status(result.status || 200).json({
                    ...result,
                    message: customMessage
                });
            } catch (asaasErr) {
                console.error('Erro ao gerar cobrança Asaas no aceite manual do convite:', asaasErr);
                return res.status(400).json({
                    success: false,
                    error: 'Não foi possível gerar a cobrança digital no Asaas (verifique se o aluno possui CPF e e-mail válidos). Se preferir, desmarque "Gerar Fatura Digital" para aprovar apenas para pagamento no balcão.'
                });
            }
        }

        await pool.query(`
            UPDATE evento_graduacao_convites
            SET status = 'aceito',
                data_resposta = NOW(),
                motivo_recusa = NULL
            WHERE id = ?
        `, [conviteId]);

        const valorTaxaFmt = Number(conv.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        Promise.resolve(
            notificationConfigService.dispatchEvent('inscricao_exame', {
                alunoId: conv.aluno_id,
                variables: { evento: conv.evento_titulo || 'Exame de Graduação', valor: valorTaxaFmt },
                detalhes: [
                    { label: 'Exame', value: conv.evento_titulo || 'Exame de Graduação' },
                    { label: 'Taxa', value: valorTaxaFmt }
                ]
            })
        ).catch((notifErr) => {
            console.warn('[Exames] Aviso ao notificar aceite manual sem cobrança:', notifErr.message);
        });

        res.json({
            success: true,
            convite_id: conviteId,
            cobranca: null,
            message: 'Convite aprovado manualmente! Inscrição marcada como Aceita (Aguardando Pgto).'
        });
    } catch (err) {
        console.error('Erro ao aprovar convite manualmente:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao aprovar convite manualmente.' });
    }
});

/**
 * POST /api/exames/eventos/:id/concluir-promocoes
 * Etapa 3: Registra aprovação/reprovação/ausência dos inscritos pagos e promove a faixa dos aprovados em lote.
 */
router.post('/eventos/:id/concluir-promocoes', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    let conn;
    try {
        await ensureExamLifecycleSchema();

        const eventoId = parseInt(req.params.id, 10);
        if (isNaN(eventoId)) {
            return res.status(400).json({ success: false, error: 'ID do evento inválido.' });
        }

        const { resultados, concluir_evento = false } = req.body || {};
        if (!Array.isArray(resultados) || resultados.length === 0) {
            return res.status(400).json({ success: false, error: 'Informe ao menos um resultado de participante para processar.' });
        }

        const [evRows] = await pool.query('SELECT id, titulo, data_evento, status FROM eventos_graduacao WHERE id = ? LIMIT 1', [eventoId]);
        if (evRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Evento de exame não encontrado.' });
        }
        const evento = evRows[0];
        const dataGraduacao = formatDateYmd(evento.data_evento);
        const usuarioId = req.user ? req.user.id : null;

        conn = await pool.getConnection();
        await conn.beginTransaction();

        let promovidos = 0;
        let reprovados = 0;
        let ausentes = 0;

        for (const item of resultados) {
            const conviteId = parseInt(item?.convite_id, 10);
            const resultado = String(item?.resultado || '').trim().toLowerCase();
            if (!Number.isInteger(conviteId) || !['aprovado', 'reprovado', 'ausente'].includes(resultado)) {
                continue;
            }

            const [convRows] = await conn.query(`
                SELECT c.id, c.aluno_id, c.modalidade_id, c.graduacao_atual_id, c.graduacao_pretendida_id,
                       c.status, c.promovido_em, a.deleted_at
                FROM evento_graduacao_convites c
                JOIN alunos a ON a.id = c.aluno_id
                WHERE c.id = ? AND c.evento_id = ?
                FOR UPDATE
            `, [conviteId, eventoId]);

            if (convRows.length === 0) continue;
            const conv = convRows[0];
            if (conv.status !== 'pago') continue;

            await conn.query(
                'UPDATE evento_graduacao_convites SET resultado_exame = ? WHERE id = ?',
                [resultado, conviteId]
            );

            if (resultado === 'reprovado') {
                reprovados++;
                continue;
            }
            if (resultado === 'ausente') {
                ausentes++;
                continue;
            }

            // Aprovado: promove se ainda não promovido e aluno não estiver na lixeira
            if (!conv.promovido_em && !conv.deleted_at) {
                await conn.query(
                    'UPDATE aluno_graduacoes SET atual = 0 WHERE aluno_id = ? AND modalidade_id = ? AND atual = 1',
                    [conv.aluno_id, conv.modalidade_id]
                );

                await conn.query(`
                    INSERT INTO aluno_graduacoes (
                        aluno_id, modalidade_id, graduacao_nivel_id, data_graduacao, professor_avaliador_id, observacoes, atual
                    ) VALUES (?, ?, ?, ?, ?, ?, 1)
                `, [
                    conv.aluno_id,
                    conv.modalidade_id,
                    conv.graduacao_pretendida_id,
                    dataGraduacao,
                    usuarioId,
                    `Promovido no exame: ${evento.titulo}`
                ]);

                await conn.query(
                    'UPDATE evento_graduacao_convites SET promovido_em = NOW(), promovido_por = ? WHERE id = ?',
                    [usuarioId, conviteId]
                );
                promovidos++;
            }
        }

        let eventoConcluido = false;
        if (Boolean(concluir_evento)) {
            await conn.query("UPDATE eventos_graduacao SET status = 'concluido' WHERE id = ?", [eventoId]);
            eventoConcluido = true;
        }

        await conn.commit();

        res.json({
            success: true,
            promovidos,
            reprovados,
            ausentes,
            evento_concluido: eventoConcluido,
            message: `${promovidos} atleta(s) promovido(s) de faixa com sucesso!`
        });
    } catch (err) {
        if (conn) {
            await conn.rollback().catch(() => {});
        }
        console.error('Erro ao concluir promoções do exame:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao processar resultados e promoções.' });
    } finally {
        if (conn) conn.release();
    }
});

// ============================================================================
// 2. ROTAS DO PORTAL DO ALUNO - ACEITE E PAGAMENTO VIA GATEWAY ASAAS
// ============================================================================

/**
 * GET /api/aluno/meus-exames
 * Retorna todos os convites de exames de graduação do aluno autenticado
 */
router.get('/meus-exames', optionalAuth, async (req, res) => {
    try {
        const ctx = resolveStudentContext(req);
        if (!ctx.ok) {
            return res.status(ctx.status).json({ success: false, error: ctx.error });
        }
        const alunoId = ctx.alunoId;

        const [convites] = await pool.query(`
            SELECT 
                c.id AS convite_id,
                c.evento_id,
                eg.titulo AS evento_titulo,
                eg.data_evento,
                eg.horario_inicio,
                eg.data_limite_inscricao,
                eg.local_evento,
                eg.descricao AS evento_descricao,
                eg.status AS evento_status,
                c.valor,
                c.status AS convite_status,
                c.data_convite,
                c.data_resposta,
                c.motivo_recusa,
                m.nome AS modalidade_nome,
                gn_atual.id AS graduacao_atual_id,
                gn_atual.nome AS graduacao_atual_nome,
                gn_atual.cor_hex_primaria AS atual_cor_primaria,
                gn_atual.cor_hex_secundaria AS atual_cor_secundaria,
                gn_pret.id AS graduacao_pretendida_id,
                gn_pret.nome AS graduacao_pretendida_nome,
                gn_pret.cor_hex_primaria AS pretendida_cor_primaria,
                gn_pret.cor_hex_secundaria AS pretendida_cor_secundaria,
                gn_pret.prajied_icone_url AS pretendida_icone_url,
                c.percentual_avaliacao,
                c.apto_motivo,
                c.asaas_payment_id,
                c.asaas_invoice_url,
                c.asaas_pix_qrcode,
                c.asaas_pix_copia_cola,
                c.asaas_billing_type,
                c.asaas_status,
                c.data_pagamento
            FROM evento_graduacao_convites c
            JOIN eventos_graduacao eg ON eg.id = c.evento_id
            JOIN modalidades m ON m.id = c.modalidade_id
            JOIN graduacoes_niveis gn_atual ON gn_atual.id = c.graduacao_atual_id
            JOIN graduacoes_niveis gn_pret ON gn_pret.id = c.graduacao_pretendida_id
            WHERE c.aluno_id = ?
            ORDER BY eg.data_evento DESC, c.id DESC
        `, [alunoId]);

        res.json({ success: true, data: convites });
    } catch (err) {
        console.error('Erro ao consultar convites do aluno:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar convites de exame.' });
    }
});

/**
 * Helper para processar aceite de convite de graduação e geração de cobrança Asaas
 */
async function executarAceiteConvite({ conviteId, alunoId, billingType = 'PIX' }) {
    const [conviteRows] = await pool.query(`
        SELECT c.*, eg.titulo AS evento_titulo, eg.data_evento, eg.data_limite_inscricao,
               a.nome_completo, a.email, a.cpf, a.telefone_whatsapp,
               gn_pret.nome AS graduacao_pretendida_nome
        FROM evento_graduacao_convites c
        JOIN eventos_graduacao eg ON eg.id = c.evento_id
        JOIN alunos a ON a.id = c.aluno_id
        JOIN graduacoes_niveis gn_pret ON gn_pret.id = c.graduacao_pretendida_id
        WHERE c.id = ? AND c.aluno_id = ?
    `, [conviteId, alunoId]);

    if (conviteRows.length === 0) {
        return { success: false, status: 404, error: 'Convite não encontrado ou não pertence a este aluno.' };
    }

    const convite = conviteRows[0];

    if (convite.status === 'pago') {
        return {
            success: true,
            status: 200,
            message: 'Este exame já foi pago e sua vaga está confirmada!',
            ja_pago: true,
            convite
        };
    }

    // 1. Cria ou busca o cliente no Gateway Asaas
    const asaasContext = {
        alunoId: convite.aluno_id,
        referenciaTipo: 'convite_exame',
        referenciaId: convite.id,
        origemRota: '/api/exames/gerar-cobranca'
    };
    const customer = await asaasService.criarOuBuscarCliente({
        nome: convite.nome_completo,
        email: convite.email,
        cpfCnpj: convite.cpf,
        telefone: convite.telefone_whatsapp,
        alunoId: convite.aluno_id,
        context: asaasContext
    });

    // 2. Determina a data de vencimento da taxa
    let dueDate = convite.data_limite_inscricao;
    if (!dueDate) {
        const evDate = new Date(convite.data_evento);
        dueDate = evDate.toISOString().split('T')[0];
    }

    // 3. Gera a cobrança no Gateway Asaas
    const cobranca = await asaasService.criarCobranca({
        customerId: customer.id,
        valor: convite.valor,
        vencimento: dueDate,
        descricao: `Taxa de Exame: ${convite.evento_titulo} - Promoção para ${convite.graduacao_pretendida_nome}`,
        externalReference: `convite_${convite.id}_aluno_${convite.aluno_id}`,
        billingType: billingType,
        context: asaasContext
    });

    const pixQrCode = cobranca.pixQrCode ? cobranca.pixQrCode.encodedImage : null;
    const pixPayload = cobranca.pixQrCode ? cobranca.pixQrCode.payload : null;

    // 4. Salva os dados do Gateway Asaas no convite e altera status para 'aceito'
    await pool.query(`
        UPDATE evento_graduacao_convites
        SET status = 'aceito',
            data_resposta = NOW(),
            motivo_recusa = NULL,
            asaas_customer_id = ?,
            asaas_payment_id = ?,
            asaas_invoice_url = ?,
            asaas_pix_qrcode = ?,
            asaas_pix_copia_cola = ?,
            asaas_billing_type = ?,
            asaas_status = ?
        WHERE id = ?
    `, [
        customer.id,
        cobranca.id,
        cobranca.invoiceUrl,
        pixQrCode,
        pixPayload,
        billingType,
        cobranca.status,
        conviteId
    ]);

    const valorTaxaFmt = Number(cobranca.value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    notificationConfigService.dispatchEvent('inscricao_exame', {
        alunoId,
        variables: { evento: convite.evento_titulo || 'Exame de Graduação', valor: valorTaxaFmt },
        detalhes: [
            { label: 'Exame', value: convite.evento_titulo || 'Exame de Graduação' },
            { label: 'Taxa', value: valorTaxaFmt }
        ]
    });

    return {
        success: true,
        status: 200,
        message: 'Convite aceito com sucesso! Efetue o pagamento para garantir sua vaga.',
        convite_id: conviteId,
        cobranca: {
            payment_id: cobranca.id,
            asaas_payment_id: cobranca.id,
            invoice_url: cobranca.invoiceUrl,
            asaas_invoice_url: cobranca.invoiceUrl,
            pix_copia_cola: pixPayload,
            asaas_pix_copia_cola: pixPayload,
            pix_qrcode_base64: pixQrCode,
            asaas_pix_qrcode: pixQrCode,
            valor: cobranca.value,
            vencimento: cobranca.dueDate,
            status: cobranca.status,
            is_mock: cobranca.is_mock
        }
    };
}

/**
 * POST /api/aluno/exames/:conviteId/aceitar
 * O aluno aceita o convite e o sistema gera a cobrança via Gateway Asaas (Pix / Fatura)
 */
router.post('/exames/:conviteId/aceitar', optionalAuth, async (req, res) => {
    try {
        const conviteId = parseInt(req.params.conviteId, 10);
        if (isNaN(conviteId)) {
            return res.status(400).json({ success: false, error: 'ID do convite inválido.' });
        }

        const ctx = resolveStudentContext(req);
        if (!ctx.ok) {
            return res.status(ctx.status).json({ success: false, error: ctx.error });
        }

        const billingType = req.body.billing_type || 'PIX';
        const result = await executarAceiteConvite({ conviteId, alunoId: ctx.alunoId, billingType });
        return res.status(result.status || 200).json(result);

    } catch (err) {
        console.error('Erro ao aceitar convite de exame:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao processar aceite e cobrança.' });
    }
});

/**
 * POST /api/aluno/exames/:eventoId/inscrever
 * Inscrição direta no exame validando elegibilidade real e próxima graduação pelo motor unificado
 */
router.post('/exames/:eventoId/inscrever', optionalAuth, async (req, res) => {
    try {
        const eventoId = parseInt(req.params.eventoId, 10);
        if (isNaN(eventoId)) {
            return res.status(400).json({ success: false, error: 'ID do evento inválido.' });
        }

        const ctx = resolveStudentContext(req);
        if (!ctx.ok) {
            return res.status(ctx.status).json({ success: false, error: ctx.error });
        }
        const alunoId = ctx.alunoId;

        // 1. Verifica se evento existe e está com inscrições abertas
        const [eventos] = await pool.query(`
            SELECT eg.*, m.nome AS modalidade_nome
            FROM eventos_graduacao eg
            LEFT JOIN modalidades m ON m.id = eg.modalidade_id
            WHERE eg.id = ? AND eg.status IN ('aberto', 'em_andamento')
        `, [eventoId]);

        if (eventos.length === 0) {
            return res.status(404).json({ success: false, error: 'Evento de exame não encontrado ou inscrições encerradas.' });
        }
        const evento = eventos[0];

        // 2. Busca convite existente ou avalia elegibilidade real
        const [conviteExistente] = await pool.query(`
            SELECT id FROM evento_graduacao_convites WHERE evento_id = ? AND aluno_id = ?
        `, [eventoId, alunoId]);

        let conviteId;
        if (conviteExistente.length > 0) {
            conviteId = conviteExistente[0].id;
        } else {
            const eligRows = await examEligibilityService.loadExamEligibilityBatch(pool, {
                alunoIds: [alunoId],
                modalidadeId: evento.modalidade_id || null
            });

            const elig = eligRows[0] || null;
            if (!elig || !elig.graduacao_atual_id) {
                return res.status(400).json({
                    success: false,
                    error: 'Você não possui graduação ativa cadastrada para esta modalidade.'
                });
            }

            if (!elig.graduacao_pretendida_id) {
                return res.status(400).json({
                    success: false,
                    error: 'Você já atingiu a graduação máxima cadastrada nesta modalidade.'
                });
            }

            if (!elig.apto) {
                return res.status(403).json({
                    success: false,
                    error: elig.motivo_elegibilidade || 'Você ainda não atingiu os requisitos técnicos necessários para este exame.'
                });
            }

            const valorTaxa = parseFloat(evento.taxa_inscricao) || 150.00;
            const [insertRes] = await pool.query(`
                INSERT INTO evento_graduacao_convites (
                    evento_id, aluno_id, modalidade_id,
                    graduacao_atual_id, graduacao_pretendida_id,
                    percentual_avaliacao, apto_motivo, valor,
                    status, data_convite
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'convidado', NOW())
            `, [
                eventoId,
                alunoId,
                elig.modalidade_id,
                elig.graduacao_atual_id,
                elig.graduacao_pretendida_id,
                Number(elig.percentual_avaliacao || 0),
                elig.apto_motivo || 'Inscrição confirmada pelo atleta no portal',
                valorTaxa
            ]);
            conviteId = insertRes.insertId;
        }

        const billingType = req.body.billing_type || 'PIX';
        const result = await executarAceiteConvite({ conviteId, alunoId, billingType });
        return res.status(result.status || 200).json(result);

    } catch (err) {
        console.error('Erro na inscrição do exame:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao processar inscrição no exame.' });
    }
});

/**
 * Helper não-bloqueante para cancelar cobrança Asaas em aberto quando aluno recusa o exame
 */
async function cancelarCobrancaAsaasPendente(convite, origemRota) {
    if (!convite || !convite.asaas_payment_id) return false;
    try {
        await asaasService.cancelarCobranca(convite.asaas_payment_id, {
            alunoId: convite.aluno_id,
            referenciaTipo: 'convite_exame',
            referenciaId: convite.id,
            origemRota
        });
        await pool.query(
            "UPDATE evento_graduacao_convites SET asaas_status = 'CANCELLED' WHERE id = ?",
            [convite.id]
        );
        return true;
    } catch (err) {
        console.warn('[Exames] Falha não-bloqueante ao cancelar cobrança Asaas:', err.message);
        return false;
    }
}

/**
 * POST /api/aluno/exames/:conviteId/recusar
 * O aluno recusa o convite para o exame de graduação (cancela cobrança em aberto se houver)
 */
router.post('/exames/:conviteId/recusar', optionalAuth, async (req, res) => {
    try {
        const conviteId = parseInt(req.params.conviteId, 10);
        if (isNaN(conviteId)) {
            return res.status(400).json({ success: false, error: 'ID do convite inválido.' });
        }

        const ctx = resolveStudentContext(req);
        if (!ctx.ok) {
            return res.status(ctx.status).json({ success: false, error: ctx.error });
        }
        const alunoId = ctx.alunoId;

        const [convRows] = await pool.query(`
            SELECT c.id, c.aluno_id, c.status, c.asaas_payment_id, eg.titulo AS evento_titulo
            FROM evento_graduacao_convites c
            JOIN eventos_graduacao eg ON eg.id = c.evento_id
            WHERE c.id = ? AND c.aluno_id = ?
            LIMIT 1
        `, [conviteId, alunoId]);

        if (convRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Convite não encontrado ou não pertence a este aluno.' });
        }

        const convite = convRows[0];
        if (convite.status === 'pago') {
            return res.status(400).json({ success: false, error: 'Esta inscrição já foi paga. Entre em contato com a recepção caso precise cancelar.' });
        }

        const { motivo } = req.body;
        const cleanMotivo = motivo ? String(motivo).trim().substring(0, 255) : 'Não poderei comparecer na data do evento';

        await cancelarCobrancaAsaasPendente(convite, '/api/aluno/exames/:conviteId/recusar');

        await pool.query(`
            UPDATE evento_graduacao_convites
            SET status = 'recusado',
                data_resposta = NOW(),
                motivo_recusa = ?
            WHERE id = ? AND aluno_id = ?
        `, [cleanMotivo, conviteId, alunoId]);

        try {
            notificationConfigService.dispatchEvent('recusa_exame', {
                alunoId,
                variables: { evento: convite.evento_titulo || 'Exame de Graduação', motivo: cleanMotivo },
                detalhes: [
                    { label: 'Exame', value: convite.evento_titulo || 'Exame de Graduação' },
                    { label: 'Motivo', value: cleanMotivo }
                ]
            });
        } catch (wErr) {
            console.warn('[Exames] Falha ao notificar recusa:', wErr.message);
        }

        res.json({ success: true, message: 'Resposta registrada com sucesso. Seu professor foi notificado.' });
    } catch (err) {
        console.error('Erro ao recusar convite:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao registrar recusa.' });
    }
});

/**
 * POST /api/aluno/exames/:eventoId/recusar-evento
 * O aluno recusa a convocação diretamente no evento (mesmo sem convite prévio)
 */
router.post('/exames/:eventoId/recusar-evento', optionalAuth, async (req, res) => {
    try {
        const eventoId = parseInt(req.params.eventoId, 10);
        if (isNaN(eventoId)) {
            return res.status(400).json({ success: false, error: 'ID do evento inválido.' });
        }

        const ctx = resolveStudentContext(req);
        if (!ctx.ok) {
            return res.status(ctx.status).json({ success: false, error: ctx.error });
        }
        const alunoId = ctx.alunoId;

        const { motivo } = req.body;
        const cleanMotivo = motivo ? String(motivo).trim().substring(0, 255) : 'Não poderei comparecer na data do evento';

        const [conviteRows] = await pool.query(
            'SELECT id, aluno_id, status, asaas_payment_id FROM evento_graduacao_convites WHERE evento_id = ? AND aluno_id = ?',
            [eventoId, alunoId]
        );

        if (conviteRows.length > 0) {
            const convite = conviteRows[0];
            if (convite.status === 'pago') {
                return res.status(400).json({ success: false, error: 'Esta inscrição já foi paga. Entre em contato com a recepção caso precise cancelar.' });
            }
            await cancelarCobrancaAsaasPendente(convite, '/api/aluno/exames/:eventoId/recusar-evento');

            await pool.query(`
                UPDATE evento_graduacao_convites
                SET status = 'recusado',
                    data_resposta = NOW(),
                    motivo_recusa = ?
                WHERE id = ?
            `, [cleanMotivo, convite.id]);
        } else {
            const [eventos] = await pool.query('SELECT * FROM eventos_graduacao WHERE id = ?', [eventoId]);
            if (eventos.length === 0) {
                return res.status(404).json({ success: false, error: 'Evento de exame não encontrado.' });
            }
            const ev = eventos[0];

            const [gradRows] = await pool.query(`
                SELECT ag.modalidade_id, ag.graduacao_nivel_id, gn.ordem_hierarquica
                FROM aluno_graduacoes ag
                JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
                WHERE ag.aluno_id = ? AND ag.atual = 1
                ORDER BY ag.id DESC LIMIT 1
            `, [alunoId]);

            const modId = ev.modalidade_id || (gradRows[0] ? gradRows[0].modalidade_id : 1);
            const gradAtualId = gradRows[0] ? gradRows[0].graduacao_nivel_id : 1;
            const ordemAtual = gradRows[0] ? gradRows[0].ordem_hierarquica : 1;

            const [modLevels] = await pool.query(
                'SELECT id, ordem_hierarquica FROM graduacoes_niveis WHERE modalidade_id = ? ORDER BY ordem_hierarquica ASC',
                [modId]
            );
            const nextLvl = examEligibilityService.findNextLevel(modLevels, ordemAtual);
            const gradPretId = nextLvl ? nextLvl.id : gradAtualId;

            await pool.query(`
                INSERT INTO evento_graduacao_convites (
                    evento_id, aluno_id, modalidade_id,
                    graduacao_atual_id, graduacao_pretendida_id,
                    percentual_avaliacao, apto_motivo, valor,
                    status, data_convite, data_resposta, motivo_recusa
                ) VALUES (?, ?, ?, ?, ?, 0, 'Convocação recusada pelo atleta', ?, 'recusado', NOW(), NOW(), ?)
            `, [eventoId, alunoId, modId, gradAtualId, gradPretId, ev.taxa_inscricao, cleanMotivo]);
        }

        try {
            const [evInfo] = await pool.query('SELECT titulo FROM eventos_graduacao WHERE id = ? LIMIT 1', [eventoId]);
            notificationConfigService.dispatchEvent('recusa_exame', {
                alunoId,
                variables: { evento: evInfo[0]?.titulo || 'Exame de Graduação', motivo: cleanMotivo },
                detalhes: [
                    { label: 'Exame', value: evInfo[0]?.titulo || 'Exame de Graduação' },
                    { label: 'Motivo', value: cleanMotivo }
                ]
            });
        } catch (wErr) {
            console.warn('[Exames] Falha ao notificar desistência:', wErr.message);
        }

        res.json({ success: true, message: 'Desistência registrada com sucesso. Seu professor foi notificado.' });
    } catch (err) {
        console.error('Erro ao recusar evento:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao registrar recusa.' });
    }
});

/**
 * POST /api/aluno/exames/:conviteId/simular-pagamento
 * Simula a liquidação do pagamento Asaas para testes e demonstrações rápidas
 */
router.post('/exames/:conviteId/simular-pagamento', optionalAuth, async (req, res) => {
    try {
        if (process.env.NODE_ENV === 'production' || asaasService.isConfigured()) {
            return res.status(403).json({ success: false, error: 'Recurso indisponível em ambiente de produção.' });
        }

        const conviteId = parseInt(req.params.conviteId, 10);
        if (isNaN(conviteId)) {
            return res.status(400).json({ success: false, error: 'ID do convite inválido.' });
        }

        const [result] = await pool.query(`
            UPDATE evento_graduacao_convites
            SET status = 'pago',
                asaas_status = 'RECEIVED',
                data_pagamento = NOW()
            WHERE id = ?
        `, [conviteId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Convite não encontrado.' });
        }

        res.json({
            success: true,
            message: 'Pagamento simulado e confirmado com sucesso!'
        });
    } catch (err) {
        console.error('Erro ao simular pagamento:', err);
        res.status(500).json({ success: false, error: 'Erro ao simular pagamento.' });
    }
});

/**
 * POST /api/aluno/exames/:conviteId/verificar-asaas
 * Permite ao aluno checar imediatamente no Asaas se o PIX/Boleto da taxa de exame compensou
 */
router.post('/exames/:conviteId/verificar-asaas', optionalAuth, async (req, res) => {
    try {
        const ctx = resolveStudentContext(req);
        if (!ctx.ok) {
            return res.status(ctx.status).json({ success: false, error: ctx.error });
        }
        const alunoId = ctx.alunoId;

        const conviteId = parseInt(req.params.conviteId, 10);
        if (isNaN(conviteId)) {
            return res.status(400).json({ success: false, error: 'ID do convite inválido.' });
        }

        const [rows] = await pool.query(`
            SELECT c.*, eg.titulo AS evento_titulo
            FROM evento_graduacao_convites c
            JOIN eventos_graduacao eg ON eg.id = c.evento_id
            WHERE c.id = ? AND c.aluno_id = ?
            LIMIT 1
        `, [conviteId, alunoId]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Convite de exame não encontrado.' });
        }

        const convite = rows[0];
        if (convite.status === 'pago') {
            const origin = paymentReconciliationService.classifyConvitePaymentOrigin(convite);
            return res.json({
                success: true,
                pago: true,
                origem_pagamento: origin.origem,
                message: 'Inscrição já confirmada como paga!'
            });
        }

        if (!convite.asaas_payment_id) {
            return res.status(400).json({ success: false, error: 'Nenhuma cobrança online gerada para este exame.' });
        }

        const outcome = await paymentReconciliationService.reconcileConviteWithAsaas(convite);
        const isPaid = outcome === 'paid_online' || outcome === 'paid_manual';

        return res.json({
            success: true,
            pago: isPaid,
            origem_pagamento: outcome === 'paid_manual' ? 'manual' : (isPaid ? 'online' : null),
            message: isPaid
                ? 'Pagamento confirmado com sucesso! Sua vaga no exame está garantida.'
                : 'Aguardando confirmação do pagamento pelo banco.'
        });
    } catch (err) {
        console.error('Erro ao verificar pagamento do exame no Asaas:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao verificar pagamento do exame.' });
    }
});

/**
 * POST /api/aluno/exames/:conviteId/pagar-cartao
 * Processa pagamento direto com cartão de crédito da taxa de exame de graduação
 */
router.post(['/exames/:conviteId/pagar-cartao', '/exames/convites/:conviteId/pagar-cartao'], optionalAuth, async (req, res) => {
    try {
        const ctx = resolveStudentContext(req);
        if (!ctx.ok) {
            return res.status(ctx.status).json({ success: false, error: ctx.error });
        }
        const alunoId = ctx.alunoId;

        const conviteId = parseInt(req.params.conviteId, 10);
        const {
            numero_cartao,
            nome_impresso,
            mes_validade,
            ano_validade,
            cvv,
            cpf_titular,
            cep_titular,
            numero_endereco,
            telefone_titular
        } = req.body;

        if (!numero_cartao || !nome_impresso || !mes_validade || !ano_validade || !cvv) {
            return res.status(400).json({
                success: false,
                error: 'Informe todos os dados do cartão de crédito (número, titular, validade e CVV).'
            });
        }

        const [conviteRows] = await pool.query(`
            SELECT c.*, eg.titulo AS evento_titulo, eg.data_evento,
                   a.nome_completo, a.email, a.cpf, a.telefone_whatsapp,
                   gn_pret.nome AS graduacao_pretendida_nome
            FROM evento_graduacao_convites c
            JOIN eventos_graduacao eg ON eg.id = c.evento_id
            JOIN alunos a ON a.id = c.aluno_id
            JOIN graduacoes_niveis gn_pret ON gn_pret.id = c.graduacao_pretendida_id
            WHERE c.id = ? AND c.aluno_id = ?
        `, [conviteId, alunoId]);

        if (conviteRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Convite de exame não encontrado.' });
        }

        const convite = conviteRows[0];

        if (convite.status === 'pago') {
            return res.status(400).json({ success: false, error: 'A taxa deste exame já se encontra paga.' });
        }

        // 1. Obtém ou cria cliente no gateway
        const asaasContext = {
            alunoId: convite.aluno_id,
            referenciaTipo: 'convite_exame',
            referenciaId: convite.id,
            origemRota: '/api/exames/convites/:conviteId/pagar-cartao'
        };
        let customerId = convite.asaas_customer_id;
        if (!customerId) {
            const customer = await asaasService.criarOuBuscarCliente({
                nome: convite.nome_completo,
                email: convite.email,
                cpfCnpj: convite.cpf,
                telefone: convite.telefone_whatsapp,
                alunoId: convite.aluno_id,
                context: asaasContext
            });
            customerId = customer.id;
        }

        // 2. Processa cobrança de cartão
        const cobranca = await asaasService.pagarComCartao({
            paymentId: convite.asaas_payment_id,
            customerId: customerId,
            valor: Number(convite.valor),
            descricao: `Taxa de Exame: ${convite.evento_titulo} - ${convite.graduacao_pretendida_nome}`,
            externalReference: `convite_${convite.id}_aluno_${convite.aluno_id}`,
            creditCard: {
                holderName: nome_impresso,
                number: numero_cartao,
                expiryMonth: mes_validade,
                expiryYear: ano_validade,
                ccv: cvv
            },
            creditCardHolderInfo: {
                name: nome_impresso,
                email: convite.email,
                cpfCnpj: cpf_titular || convite.cpf,
                postalCode: cep_titular || '01001000',
                addressNumber: numero_endereco || 'S/N',
                phone: telefone_titular || convite.telefone_whatsapp
            },
            remoteIp: req.ip,
            context: asaasContext
        });

        const cardBrand = cobranca.creditCard?.creditCardBrand || asaasService.detectCardBrand(numero_cartao);
        const last4 = cobranca.creditCard?.creditCardNumber || String(numero_cartao).replace(/\D/g, '').slice(-4);

        // 3. Atualiza o convite para pago
        await pool.query(`
            UPDATE evento_graduacao_convites SET
                status = 'pago',
                data_resposta = NOW(),
                data_pagamento = NOW(),
                asaas_customer_id = COALESCE(asaas_customer_id, ?),
                asaas_payment_id = ?,
                asaas_billing_type = 'CREDIT_CARD',
                asaas_status = 'CONFIRMED'
            WHERE id = ?
        `, [
            customerId,
            cobranca.id || convite.asaas_payment_id,
            convite.id
        ]);

        const valorFmt = Number(convite.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        notificationConfigService.dispatchEvent('pagamento_exame', {
            alunoId: convite.aluno_id,
            variables: { evento: convite.evento_titulo, valor: valorFmt, metodo: `Cartão (${cardBrand} final ${last4})` },
            detalhes: [
                { label: 'Exame', value: convite.evento_titulo },
                { label: 'Valor', value: valorFmt },
                { label: 'Método', value: `Cartão (${cardBrand} •••• ${last4})` }
            ]
        });

        return res.json({
            success: true,
            pago: true,
            message: 'Taxa de exame paga com sucesso no cartão de crédito! Sua vaga está confirmada.',
            detalhes: {
                convite_id: convite.id,
                bandeira: cardBrand,
                ultimos4: last4,
                valor: Number(convite.valor),
                data_pagamento: new Date().toISOString()
            }
        });

    } catch (err) {
        console.error('Erro ao pagar taxa de exame com cartão:', err);
        return res.status(400).json({
            success: false,
            error: err.message || 'Falha ao processar pagamento com cartão de crédito.'
        });
    }
});

// ============================================================================
// 3. WEBHOOK ASAAS - NOTIFICAÇÃO AUTOMÁTICA DE LIQUIDAÇÃO
// ============================================================================

/**
 * POST /api/exames/webhook-asaas
 * Recebe webhooks do Asaas quando o Pix ou Boleto/Cartão é pago
 */
router.post('/webhook-asaas', async (req, res) => {
    try {
        if (!asaasService.isValidWebhookToken(req.headers['asaas-access-token'])) {
            return res.status(401).json({ success: false, error: 'Token de webhook inválido.' });
        }

        const { event, payment } = req.body;
        console.log(`[Webhook Asaas Exames] Evento recebido: ${event} para cobrança ${payment?.id}`);

        const result = await paymentReconciliationService.processAsaasWebhookEvent({
            event,
            payment,
            origemRota: '/api/exames/webhook-asaas'
        });

        res.json({ success: true, received: true, ...result });
    } catch (err) {
        console.error('[Webhook Asaas Exames] Erro no processamento:', err);
        res.status(500).json({ error: 'Erro no processamento do webhook' });
    }
});

module.exports = router;

