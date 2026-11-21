const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const asaasService = require('../services/asaasService');
const PaymentLogService = require('../services/paymentLogService');
const notificationConfigService = require('../services/notificationConfigService');
const paymentReconciliationService = require('../services/paymentReconciliationService');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');

// GET /api/faturas - Listagem geral de faturas com filtros (admin e recepcao)
router.get('/', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        const { status, mes, aluno_id, sync_asaas } = req.query;

        if (sync_asaas === '1') {
            try {
                await paymentReconciliationService.reconcilePendingFaturas({
                    alunoId: aluno_id || null,
                    mes: mes || null
                });
            } catch (syncErr) {
                console.warn('[Faturas] Falha não-bloqueante ao conciliar Asaas:', syncErr.message);
            }
        }

        let query = `
            SELECT 
                f.id,
                f.competencia,
                f.valor_original,
                f.valor_desconto,
                f.valor_pago,
                f.data_vencimento,
                f.data_pagamento,
                f.metodo_pagamento,
                f.status,
                f.asaas_payment_id,
                f.asaas_invoice_url,
                f.asaas_status,
                f.observacoes,
                a.id AS aluno_id,
                a.nome_completo AS aluno_nome,
                a.telefone_whatsapp,
                p.nome AS plano_nome
            FROM faturas f
            JOIN alunos a ON a.id = f.aluno_id
            JOIN matriculas m ON m.id = f.matricula_id
            JOIN planos p ON p.id = m.plano_id
            WHERE 1=1
        `;

        const params = [];

        if (status && status !== 'todos') {
            query += ` AND f.status = ?`;
            params.push(status);
        }

        if (mes) {
            query += ` AND f.competencia = ?`;
            params.push(mes);
        }

        if (aluno_id) {
            query += ` AND f.aluno_id = ?`;
            params.push(aluno_id);
        }

        query += ` ORDER BY f.data_vencimento DESC LIMIT 100`;

        const [rawRows] = await pool.query(query, params);
        const rows = rawRows.map((r) => {
            const origin = paymentReconciliationService.classifyFaturaPaymentOrigin(r);
            return {
                ...r,
                origem_pagamento: origin.origem,
                origem_label: origin.label
            };
        });
        res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
        console.error('Erro ao listar faturas:', err);
        res.status(500).json({ success: false, error: 'Erro ao consultar faturas.' });
    }
});

// POST /api/faturas/sincronizar-asaas - Conciliação manual das faturas abertas contra o Gateway Asaas
router.post('/sincronizar-asaas', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        const stats = await paymentReconciliationService.reconcilePendingFaturas({
            mes: req.body?.mes || null,
            alunoId: req.body?.aluno_id || null
        });
        const totalMudancas = stats.atualizados_online + stats.ajustados_manual;
        res.json({
            success: true,
            ...stats,
            message: totalMudancas > 0
                ? `${totalMudancas} fatura(s) atualizada(s) com sucesso a partir do Gateway Asaas.`
                : 'Sincronização concluída. Nenhuma divergência encontrada no gateway.'
        });
    } catch (err) {
        console.error('Erro ao sincronizar faturas com Asaas:', err);
        res.status(500).json({ success: false, error: 'Erro ao sincronizar faturas com o gateway.' });
    }
});

// GET /api/faturas/resumo - Estatísticas consolidadas financeiras do mês/competência
router.get('/resumo', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        const { mes } = req.query;
        const comp = mes || new Date().toISOString().slice(0, 7);

        const [kpis] = await pool.query(`
            SELECT 
                COALESCE(SUM(valor_original), 0) AS total_previsto,
                COALESCE(SUM(CASE WHEN status = 'pago' THEN COALESCE(valor_pago, valor_original) ELSE 0 END), 0) AS total_recebido,
                COALESCE(SUM(CASE WHEN status = 'pendente' AND data_vencimento >= CURDATE() THEN valor_original ELSE 0 END), 0) AS total_pendente,
                COALESCE(SUM(CASE WHEN status = 'atrasado' OR (status = 'pendente' AND data_vencimento < CURDATE()) THEN valor_original ELSE 0 END), 0) AS total_atrasado,
                COUNT(*) AS total_faturas,
                SUM(CASE WHEN status = 'pago' THEN 1 ELSE 0 END) AS count_pagas,
                SUM(CASE WHEN status = 'pendente' AND data_vencimento >= CURDATE() THEN 1 ELSE 0 END) AS count_pendentes,
                SUM(CASE WHEN status = 'atrasado' OR (status = 'pendente' AND data_vencimento < CURDATE()) THEN 1 ELSE 0 END) AS count_atrasadas
            FROM faturas
            WHERE competencia = ? AND status != 'cancelado'
        `, [comp]);

        const resumo = kpis[0] || {};
        const taxaAdimplencia = resumo.total_faturas > 0
            ? Math.round((resumo.count_pagas / resumo.total_faturas) * 100)
            : 100;

        res.json({
            success: true,
            competencia: comp,
            data: {
                ...resumo,
                taxa_adimplencia: taxaAdimplencia
            }
        });
    } catch (err) {
        console.error('Erro ao obter resumo de faturas:', err);
        res.status(500).json({ success: false, error: 'Erro ao obter resumo financeiro.' });
    }
});

// POST /api/faturas - Criar fatura manual / avulsa para um aluno (admin e recepcao)
router.post('/', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        const { aluno_id, competencia, valor, data_vencimento, observacoes } = req.body;

        if (!aluno_id || !valor || !data_vencimento) {
            return res.status(400).json({
                success: false,
                error: 'Aluno, valor e data de vencimento são obrigatórios.'
            });
        }

        // Busca matrícula ativa do aluno
        const [mats] = await pool.query(
            'SELECT id FROM matriculas WHERE aluno_id = ? AND status = "ativa" ORDER BY id DESC LIMIT 1',
            [aluno_id]
        );

        let matriculaId = mats.length > 0 ? mats[0].id : null;

        // Se o aluno não tiver matrícula ativa, associa à última matrícula ou cria uma genérica
        if (!matriculaId) {
            const [lastMat] = await pool.query('SELECT id FROM matriculas WHERE aluno_id = ? ORDER BY id DESC LIMIT 1', [aluno_id]);
            matriculaId = lastMat.length > 0 ? lastMat[0].id : null;
        }

        if (!matriculaId) {
            return res.status(400).json({
                success: false,
                error: 'O aluno selecionado não possui nenhum contrato/matrícula cadastrada.'
            });
        }

        const comp = competencia || data_vencimento.slice(0, 7);

        const [result] = await pool.query(`
            INSERT INTO faturas (matricula_id, aluno_id, competencia, valor_original, data_vencimento, observacoes, status)
            VALUES (?, ?, ?, ?, ?, ?, 'pendente')
        `, [matriculaId, aluno_id, comp, parseFloat(valor), data_vencimento, observacoes ? observacoes.trim() : null]);

        res.status(201).json({
            success: true,
            message: 'Fatura lançada com sucesso!',
            faturaId: result.insertId
        });
    } catch (err) {
        console.error('Erro ao lançar fatura:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao emitir fatura.' });
    }
});

// PATCH /api/faturas/:id/pagar - Baixa / registro de pagamento (admin e recepcao)
router.patch('/:id/pagar', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        const { id } = req.params;
        const { metodo_pagamento = 'pix', valor_pago, observacoes } = req.body;

        const [faturas] = await pool.query(
            'SELECT id, aluno_id, status, valor_original, asaas_payment_id, asaas_status FROM faturas WHERE id = ?',
            [id]
        );
        if (faturas.length === 0) {
            return res.status(404).json({ success: false, error: 'Fatura não encontrada.' });
        }

        const fat = faturas[0];
        const wasPaid = fat.status === 'pago';
        const valor = valor_pago !== undefined ? parseFloat(valor_pago) : fat.valor_original;
        let settlement = { alreadyPaidOnline: false, asaasClosedInCash: false };

        if (fat.asaas_payment_id) {
            settlement = await paymentReconciliationService.notifyAsaasManualSettlement(fat.asaas_payment_id, {
                valor,
                context: {
                    alunoId: fat.aluno_id,
                    referenciaTipo: 'fatura',
                    referenciaId: fat.id,
                    origemRota: '/api/faturas/:id/pagar'
                }
            });
        }

        if (settlement.alreadyPaidOnline) {
            const metodoGateway = paymentReconciliationService.mapAsaasBillingTypeToMetodo(settlement.cobranca?.billingType);
            const valorGateway = settlement.cobranca?.value ? parseFloat(settlement.cobranca.value) : valor;
            const nextStatus = (String(settlement.cobranca?.status || '').toUpperCase() === 'CONFIRMED' && metodoGateway === 'cartao_credito')
                ? 'CONFIRMED'
                : 'RECEIVED';

            await pool.query(`
                UPDATE faturas SET
                    status = 'pago',
                    data_pagamento = COALESCE(data_pagamento, NOW()),
                    metodo_pagamento = ?,
                    valor_pago = COALESCE(?, valor_original),
                    asaas_status = ?,
                    observacoes = COALESCE(?, observacoes)
                WHERE id = ?
            `, [metodoGateway, !isNaN(valorGateway) ? valorGateway : valor, nextStatus, observacoes || null, id]);

            if (!wasPaid && fat.aluno_id) {
                const valorFmt = Number(valorGateway || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                const metodoFmt = String(metodoGateway).toUpperCase();
                notificationConfigService.dispatchEvent('pagamento_mensalidade', {
                    alunoId: fat.aluno_id,
                    variables: { valor: valorFmt, metodo: metodoFmt },
                    detalhes: [
                        { label: 'Valor', value: valorFmt },
                        { label: 'Forma de Pagamento', value: metodoFmt }
                    ]
                });
            }

            return res.json({
                success: true,
                origem_pagamento: 'online',
                message: 'Esta fatura já constava como paga no gateway Asaas! Status sincronizado como Pago (Online).'
            });
        }

        await pool.query(`
            UPDATE faturas SET
                status = 'pago',
                data_pagamento = NOW(),
                metodo_pagamento = ?,
                valor_pago = ?,
                asaas_status = 'RECEIVED_MANUALLY',
                observacoes = COALESCE(?, observacoes)
            WHERE id = ?
        `, [metodo_pagamento, valor, observacoes || null, id]);

        if (!wasPaid && fat.aluno_id) {
            const valorFmt = Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const metodoFmt = String(metodo_pagamento).toUpperCase();
            notificationConfigService.dispatchEvent('pagamento_mensalidade', {
                alunoId: fat.aluno_id,
                variables: { valor: valorFmt, metodo: metodoFmt },
                detalhes: [
                    { label: 'Valor', value: valorFmt },
                    { label: 'Forma de Pagamento', value: metodoFmt }
                ]
            });
        }

        res.json({
            success: true,
            origem_pagamento: 'manual',
            asaas_baixa_dinheiro: Boolean(settlement.asaasClosedInCash),
            message: 'Pagamento registrado com sucesso!'
        });
    } catch (err) {
        console.error('Erro ao registrar pagamento:', err);
        res.status(500).json({ success: false, error: 'Erro ao registrar pagamento.' });
    }
});

// DELETE /api/faturas/:id - Cancelar / estornar fatura pendente (admin)
router.delete('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const [faturas] = await pool.query('SELECT id, aluno_id, status, asaas_payment_id FROM faturas WHERE id = ?', [id]);
        if (faturas.length === 0) {
            return res.status(404).json({ success: false, error: 'Fatura não encontrada.' });
        }

        if (faturas[0].status === 'pago') {
            return res.status(400).json({ success: false, error: 'Fatura já quitada não pode ser excluída diretamente. Cancele o recebimento primeiro.' });
        }

        if (faturas[0].asaas_payment_id && !String(faturas[0].asaas_payment_id).startsWith('pay_mock_')) {
            await asaasService.cancelarCobranca(faturas[0].asaas_payment_id, {
                alunoId: faturas[0].aluno_id,
                referenciaTipo: 'fatura',
                referenciaId: faturas[0].id,
                origemRota: '/api/faturas/:id'
            }).catch((err) => {
                console.warn(`[Faturas] Aviso ao cancelar cobrança Asaas ${faturas[0].asaas_payment_id}:`, err.message);
            });
        }

        await pool.query('DELETE FROM faturas WHERE id = ?', [id]);
        res.json({ success: true, message: 'Fatura cancelada e removida com sucesso!' });
    } catch (err) {
        console.error('Erro ao cancelar fatura:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao cancelar fatura.' });
    }
});

// POST /api/faturas/webhook-asaas - Webhook unificado de recebimento de pagamentos do Asaas
router.post('/webhook-asaas', async (req, res) => {
    try {
        if (!asaasService.isValidWebhookToken(req.headers['asaas-access-token'])) {
            return res.status(401).json({ success: false, error: 'Token de webhook inválido.' });
        }

        const { event, payment } = req.body;
        console.log(`[Webhook Asaas Faturas] Evento recebido: ${event} para cobrança ${payment?.id}`);

        const result = await paymentReconciliationService.processAsaasWebhookEvent({
            event,
            payment,
            origemRota: '/api/faturas/webhook-asaas'
        });

        res.status(200).json({ received: true, ...result });
    } catch (err) {
        console.error('[Webhook Asaas Faturas] Erro:', err.message);
        await PaymentLogService.recordFailure({
            operacao: 'webhook_fatura',
            paymentId: req.body?.payment?.id || null,
            httpStatus: 500,
            mensagemErro: err.message || 'Erro interno ao processar webhook',
            origemRota: '/api/faturas/webhook-asaas'
        });
        res.status(500).json({ error: 'Erro interno ao processar webhook' });
    }
});

// GET /api/faturas/logs-falhas - Lista falhas de pagamento registradas pelo gateway (admin e recepcao)
router.get('/logs-falhas', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        await PaymentLogService.ensurePaymentLogsTable();

        const { resolvido = '0', busca = '', limit = 100 } = req.query;
        const limitNum = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 200);

        let query = `
            SELECT
                l.id, l.gateway, l.operacao, l.aluno_id, l.referencia_tipo, l.referencia_id,
                l.payment_id, l.http_status, l.codigo_erro, l.mensagem_erro, l.detalhes_json,
                l.origem_rota, l.resolvido, l.created_at,
                a.nome_completo AS aluno_nome,
                a.email AS aluno_email,
                a.cpf AS aluno_cpf
            FROM gateway_pagamento_logs l
            LEFT JOIN alunos a ON a.id = l.aluno_id
            WHERE 1=1
        `;
        const params = [];

        if (resolvido === '0' || resolvido === '1') {
            query += ' AND l.resolvido = ?';
            params.push(Number(resolvido));
        }

        if (busca && busca.trim()) {
            const term = `%${busca.trim()}%`;
            query += ' AND (a.nome_completo LIKE ? OR l.mensagem_erro LIKE ? OR l.codigo_erro LIKE ? OR l.operacao LIKE ?)';
            params.push(term, term, term, term);
        }

        query += ' ORDER BY l.created_at DESC, l.id DESC LIMIT ?';
        params.push(limitNum);

        const [rows] = await pool.query(query, params);

        const [counts] = await pool.query(`
            SELECT
                SUM(CASE WHEN resolvido = 0 THEN 1 ELSE 0 END) AS total_pendentes,
                SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) AS total_24h
            FROM gateway_pagamento_logs
        `);

        res.json({
            success: true,
            data: rows,
            resumo: {
                total_pendentes: Number(counts[0]?.total_pendentes || 0),
                total_24h: Number(counts[0]?.total_24h || 0)
            }
        });
    } catch (err) {
        console.error('Erro ao listar logs de falha de pagamento:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar logs de pagamento.' });
    }
});

// PATCH /api/faturas/logs-falhas/:id/resolver - Marca log de falha como resolvido/pendente
router.patch('/logs-falhas/:id/resolver', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        await PaymentLogService.ensurePaymentLogsTable();
        const { id } = req.params;
        const resolvido = req.body?.resolvido === false || req.body?.resolvido === 0 ? 0 : 1;

        const [result] = await pool.query(
            'UPDATE gateway_pagamento_logs SET resolvido = ? WHERE id = ?',
            [resolvido, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Registro de log não encontrado.' });
        }

        res.json({ success: true, message: resolvido ? 'Log marcado como resolvido.' : 'Log reaberto como pendente.' });
    } catch (err) {
        console.error('Erro ao atualizar log de pagamento:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao atualizar log de pagamento.' });
    }
});

// DELETE /api/faturas/logs-falhas/limpar-resolvidos - Remove logs já resolvidos (admin)
router.delete('/logs-falhas/limpar-resolvidos', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        await PaymentLogService.ensurePaymentLogsTable();
        const [result] = await pool.query('DELETE FROM gateway_pagamento_logs WHERE resolvido = 1');
        res.json({
            success: true,
            removed: result.affectedRows || 0,
            message: `${result.affectedRows || 0} log(s) resolvido(s) removido(s).`
        });
    } catch (err) {
        console.error('Erro ao limpar logs de pagamento:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao limpar logs de pagamento.' });
    }
});

module.exports = router;
