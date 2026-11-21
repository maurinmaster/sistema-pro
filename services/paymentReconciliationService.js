/**
 * PRO COMBATE - Serviço Unificado de Conciliação e Classificação de Pagamentos (Asaas vs Manual/Avulso)
 * Unifica processamento de webhooks, sincronização ativa com o gateway Asaas e identificação
 * precisa da origem de liquidação (Gateway Online vs Baixa Manual/Balcão).
 */

const pool = require('../db/connection');
const asaasService = require('./asaasService');
const notificationConfigService = require('./notificationConfigService');
const PaymentLogService = require('./paymentLogService');

const ONLINE_PAID_STATUSES = new Set(['RECEIVED', 'CONFIRMED']);
const MANUAL_STATUSES = new Set(['RECEIVED_MANUALLY', 'MANUAL', 'RECEIVED_IN_CASH']);

function normalizeUpper(val) {
    return String(val || '').trim().toUpperCase();
}

function normalizeLower(val) {
    return String(val || '').trim().toLowerCase();
}

/**
 * Converte billingType do Asaas para valor válido do ENUM metodo_pagamento da tabela faturas.
 */
function mapAsaasBillingTypeToMetodo(billingType) {
    const upper = normalizeUpper(billingType);
    if (upper === 'CREDIT_CARD' || upper === 'CARTAO_CREDITO') return 'cartao_credito';
    if (upper === 'DEBIT_CARD' || upper === 'CARTAO_DEBITO') return 'cartao_debito';
    if (upper === 'BOLETO') return 'boleto';
    if (upper === 'DINHEIRO' || upper === 'CASH' || upper === 'MANUAL' || upper === 'RECEIVED_IN_CASH') return 'dinheiro';
    return 'pix';
}

function isAsaasStatusPaidOnline(asaasStatus) {
    return ONLINE_PAID_STATUSES.has(normalizeUpper(asaasStatus));
}

function isAsaasStatusManual(asaasStatus) {
    return MANUAL_STATUSES.has(normalizeUpper(asaasStatus));
}

/**
 * Extrai referência interna a partir do campo externalReference enviado ao Asaas.
 */
function parseExternalReference(externalReference) {
    const raw = String(externalReference || '').trim();
    if (!raw) return null;

    let match = raw.match(/^fatura_(\d+)_aluno_(\d+)$/i);
    if (match) {
        return { tipo: 'fatura', id: Number(match[1]), alunoId: Number(match[2]) };
    }

    match = raw.match(/^convite_(\d+)_aluno_(\d+)$/i);
    if (match) {
        return { tipo: 'convite', id: Number(match[1]), alunoId: Number(match[2]) };
    }

    return null;
}

/**
 * Determina se um convite/inscrição de exame pago foi liquidado via Gateway Online ou Baixa Manual.
 */
function classifyConvitePaymentOrigin(convite = {}) {
    const statusUpper = normalizeUpper(convite.asaas_status);
    const billingUpper = normalizeUpper(convite.asaas_billing_type);
    const hasGatewayRef = Boolean(convite.asaas_payment_id || convite.asaas_invoice_url);
    const conviteStatusLower = normalizeLower(convite.convite_status !== undefined ? convite.convite_status : convite.status);

    // Regra legada: versões anteriores de confirmar-manual gravavam asaas_status='CONFIRMED' sem billingType 'CREDIT_CARD'
    const isLegacyManualConfirmed = statusUpper === 'CONFIRMED' && billingUpper !== 'CREDIT_CARD';
    const isPaidWithNonOnlineAsaasStatus = conviteStatusLower === 'pago' && !isAsaasStatusPaidOnline(statusUpper);

    const isManual = (
        isAsaasStatusManual(statusUpper) ||
        billingUpper === 'MANUAL' ||
        !hasGatewayRef ||
        isLegacyManualConfirmed ||
        isPaidWithNonOnlineAsaasStatus
    );

    return {
        origem: isManual ? 'manual' : 'online',
        label: isManual ? 'Manual' : 'Online',
        badgeText: isManual ? '✓ Pago (Manual)' : '✓ Pago (Online)',
        canalLabel: isManual ? 'Manual / Balcão' : 'Pagamento Online'
    };
}

/**
 * Determina se uma fatura de mensalidade/avulsa paga foi liquidada via Gateway Online ou Baixa Manual.
 */
function classifyFaturaPaymentOrigin(fatura = {}) {
    const statusUpper = normalizeUpper(fatura.asaas_status);
    const metodoLower = normalizeLower(fatura.metodo_pagamento);
    const faturaStatusLower = normalizeLower(fatura.status);
    const hasPaymentId = Boolean(fatura.asaas_payment_id);

    const isManual = (
        isAsaasStatusManual(statusUpper) ||
        !hasPaymentId ||
        (['dinheiro', 'balcao'].includes(metodoLower) && !isAsaasStatusPaidOnline(statusUpper)) ||
        (faturaStatusLower === 'pago' && !isAsaasStatusPaidOnline(statusUpper))
    );

    return {
        origem: isManual ? 'manual' : 'online',
        label: isManual ? 'Manual' : 'Online',
        badgeText: isManual ? 'Pago (Manual)' : 'Pago (Online)',
        canalLabel: isManual ? 'Manual / Balcão' : 'Pagamento Online'
    };
}

function buildOnlineAsaasStatus({ eventName, cobrancaStatus, billingType }) {
    const evUpper = normalizeUpper(eventName);
    const stUpper = normalizeUpper(cobrancaStatus);
    const billingUpper = normalizeUpper(billingType);

    if ((evUpper === 'PAYMENT_CONFIRMED' || stUpper === 'CONFIRMED') && billingUpper === 'CREDIT_CARD') {
        return 'CONFIRMED';
    }
    return 'RECEIVED';
}

function buildPaymentMethodDetail(billingType, defaultLabel = 'PIX / Asaas') {
    const upper = normalizeUpper(billingType);
    if (upper === 'CREDIT_CARD') return 'Cartão de Crédito (Asaas)';
    if (upper === 'DEBIT_CARD') return 'Cartão de Débito (Asaas)';
    if (upper === 'BOLETO') return 'Boleto Bancário (Asaas)';
    if (upper === 'PIX') return 'PIX (Asaas)';
    return String(billingType || defaultLabel);
}

/**
 * Localiza registro correspondente (fatura ou convite) para um pagamento Asaas.
 */
async function findTargetForAsaasPayment(payment) {
    if (!payment || !payment.id) return null;
    const paymentId = String(payment.id).trim();
    const extRef = parseExternalReference(payment.externalReference);

    // 1. Busca direta por asaas_payment_id em faturas
    const [fatByPay] = await pool.query(
        'SELECT id, aluno_id, status, valor_original, asaas_payment_id, asaas_status FROM faturas WHERE asaas_payment_id = ? LIMIT 1',
        [paymentId]
    );
    if (fatByPay.length > 0) {
        return { kind: 'fatura', row: fatByPay[0] };
    }

    // 2. Busca direta por asaas_payment_id em convites de exame
    const [convByPay] = await pool.query(`
        SELECT c.id, c.aluno_id, c.status, c.valor, c.asaas_payment_id, c.asaas_billing_type, c.asaas_status,
               eg.titulo AS evento_titulo
        FROM evento_graduacao_convites c
        JOIN eventos_graduacao eg ON eg.id = c.evento_id
        WHERE c.asaas_payment_id = ?
        LIMIT 1
    `, [paymentId]);
    if (convByPay.length > 0) {
        return { kind: 'convite', row: convByPay[0] };
    }

    // 3. Fallback seguro via externalReference (id + aluno_id)
    if (extRef && extRef.tipo === 'fatura') {
        const [fatByRef] = await pool.query(
            'SELECT id, aluno_id, status, valor_original, asaas_payment_id, asaas_status FROM faturas WHERE id = ? AND aluno_id = ? LIMIT 1',
            [extRef.id, extRef.alunoId]
        );
        if (fatByRef.length > 0) {
            return { kind: 'fatura', row: fatByRef[0] };
        }
    } else if (extRef && extRef.tipo === 'convite') {
        const [convByRef] = await pool.query(`
            SELECT c.id, c.aluno_id, c.status, c.valor, c.asaas_payment_id, c.asaas_billing_type, c.asaas_status,
                   eg.titulo AS evento_titulo
            FROM evento_graduacao_convites c
            JOIN eventos_graduacao eg ON eg.id = c.evento_id
            WHERE c.id = ? AND c.aluno_id = ?
            LIMIT 1
        `, [extRef.id, extRef.alunoId]);
        if (convByRef.length > 0) {
            return { kind: 'convite', row: convByRef[0] };
        }
    }

    return null;
}

/**
 * Processa eventos de webhook do Asaas unificando Faturas (mensalidades/avulsas) e Exames de Graduação.
 */
async function processAsaasWebhookEvent({ event, payment, origemRota = '/api/webhook/asaas' }) {
    const eventUpper = normalizeUpper(event);
    if (!payment || !payment.id) {
        return { processed: false, matched: false, kind: null };
    }

    const target = await findTargetForAsaasPayment(payment);
    if (!target) {
        return { processed: true, matched: false, kind: null, event: eventUpper };
    }

    const paymentId = String(payment.id).trim();
    const billingUpper = normalizeUpper(payment.billingType || 'PIX');
    const isPaidOnlineEvent = eventUpper === 'PAYMENT_RECEIVED' || eventUpper === 'PAYMENT_CONFIRMED';
    const isCashInEvent = eventUpper === 'PAYMENT_RECEIVED_IN_CASH';

    if (target.kind === 'fatura') {
        const fat = target.row;
        const wasPaid = fat.status === 'pago';

        if (isPaidOnlineEvent) {
            const metodo = mapAsaasBillingTypeToMetodo(billingUpper);
            const valorPago = payment.value ? parseFloat(payment.value) : null;
            const nextAsaasStatus = buildOnlineAsaasStatus({ eventName: eventUpper, billingType: billingUpper });

            await pool.query(`
                UPDATE faturas SET
                    status = 'pago',
                    data_pagamento = COALESCE(data_pagamento, NOW()),
                    metodo_pagamento = ?,
                    valor_pago = COALESCE(?, valor_original),
                    asaas_payment_id = COALESCE(asaas_payment_id, ?),
                    asaas_status = ?
                WHERE id = ?
            `, [metodo, !isNaN(valorPago) && valorPago > 0 ? valorPago : null, paymentId, nextAsaasStatus, fat.id]);

            if (!wasPaid && fat.aluno_id) {
                const vPago = (!isNaN(valorPago) && valorPago > 0 ? valorPago : fat.valor_original) || 0;
                const valorFmt = Number(vPago).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                const metodoFmt = metodo.toUpperCase();
                notificationConfigService.dispatchEvent('pagamento_mensalidade', {
                    alunoId: fat.aluno_id,
                    variables: { valor: valorFmt, metodo: metodoFmt },
                    detalhes: [
                        { label: 'Valor', value: valorFmt },
                        { label: 'Forma de Pagamento', value: metodoFmt }
                    ]
                });
            }

            return { processed: true, matched: true, kind: 'fatura', id: fat.id, updatedTo: 'online' };
        }

        if (isCashInEvent) {
            const valorPago = payment.value ? parseFloat(payment.value) : null;
            await pool.query(`
                UPDATE faturas SET
                    status = 'pago',
                    data_pagamento = COALESCE(data_pagamento, NOW()),
                    metodo_pagamento = 'dinheiro',
                    valor_pago = COALESCE(?, valor_original),
                    asaas_payment_id = COALESCE(asaas_payment_id, ?),
                    asaas_status = 'RECEIVED_MANUALLY'
                WHERE id = ? AND status != 'pago'
            `, [!isNaN(valorPago) && valorPago > 0 ? valorPago : null, paymentId, fat.id]);

            return { processed: true, matched: true, kind: 'fatura', id: fat.id, updatedTo: 'manual' };
        }

        if (eventUpper === 'PAYMENT_OVERDUE') {
            await pool.query(
                "UPDATE faturas SET asaas_status = 'OVERDUE' WHERE id = ? AND status != 'pago'",
                [fat.id]
            );
            return { processed: true, matched: true, kind: 'fatura', id: fat.id, updatedTo: 'overdue' };
        }

        return { processed: true, matched: true, kind: 'fatura', id: fat.id, updatedTo: 'ignored' };
    }

    // Target: convite de exame
    const conv = target.row;
    const wasPaid = conv.status === 'pago';

    if (isPaidOnlineEvent) {
        const nextBillingType = ['PIX', 'BOLETO', 'CREDIT_CARD', 'DEBIT_CARD'].includes(billingUpper) ? billingUpper : 'PIX';
        const nextAsaasStatus = buildOnlineAsaasStatus({ eventName: eventUpper, billingType: nextBillingType });

        await pool.query(`
            UPDATE evento_graduacao_convites SET
                status = 'pago',
                data_resposta = COALESCE(data_resposta, NOW()),
                data_pagamento = COALESCE(data_pagamento, NOW()),
                asaas_payment_id = COALESCE(asaas_payment_id, ?),
                asaas_billing_type = ?,
                asaas_status = ?
            WHERE id = ?
        `, [paymentId, nextBillingType, nextAsaasStatus, conv.id]);

        if (!wasPaid && conv.aluno_id) {
            const valorFmt = Number(conv.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const metodoDetalhe = buildPaymentMethodDetail(nextBillingType);
            notificationConfigService.dispatchEvent('pagamento_exame', {
                alunoId: conv.aluno_id,
                variables: { evento: conv.evento_titulo, valor: valorFmt, metodo: metodoDetalhe },
                detalhes: [
                    { label: 'Exame', value: conv.evento_titulo },
                    { label: 'Valor', value: valorFmt },
                    { label: 'Método', value: metodoDetalhe }
                ]
            });
        }

        return { processed: true, matched: true, kind: 'convite', id: conv.id, updatedTo: 'online' };
    }

    if (isCashInEvent) {
        await pool.query(`
            UPDATE evento_graduacao_convites SET
                status = 'pago',
                data_resposta = COALESCE(data_resposta, NOW()),
                data_pagamento = COALESCE(data_pagamento, NOW()),
                asaas_payment_id = COALESCE(asaas_payment_id, ?),
                asaas_billing_type = 'MANUAL',
                asaas_status = 'RECEIVED_MANUALLY'
            WHERE id = ? AND status != 'pago'
        `, [paymentId, conv.id]);

        return { processed: true, matched: true, kind: 'convite', id: conv.id, updatedTo: 'manual' };
    }

    if (eventUpper === 'PAYMENT_OVERDUE') {
        await pool.query(
            "UPDATE evento_graduacao_convites SET asaas_status = 'OVERDUE' WHERE id = ? AND status != 'pago'",
            [conv.id]
        );
        return { processed: true, matched: true, kind: 'convite', id: conv.id, updatedTo: 'overdue' };
    }

    if (eventUpper === 'PAYMENT_DELETED') {
        return { processed: true, matched: true, kind: 'convite', id: conv.id, updatedTo: 'ignored' };
    }

    return { processed: true, matched: true, kind: 'convite', id: conv.id, updatedTo: 'ignored', origemRota };
}

/**
 * Antes de gravar baixa manual em uma fatura ou exame que já possui asaas_payment_id,
 * verifica se o aluno já pagou online no gateway (evitando sobrescrever Online como Manual)
 * e, se ainda estiver aberto no Asaas, comunica recebimento em dinheiro (receiveInCash).
 */
async function notifyAsaasManualSettlement(paymentId, { valor = null, context = {} } = {}) {
    if (!paymentId || !asaasService.isConfigured() || String(paymentId).startsWith('pay_mock_')) {
        return { alreadyPaidOnline: false, asaasClosedInCash: false };
    }

    try {
        const cobranca = await asaasService.consultarCobranca(paymentId, context);
        const st = normalizeUpper(cobranca?.status);

        if (isAsaasStatusPaidOnline(st)) {
            return { alreadyPaidOnline: true, cobranca };
        }

        if (st === 'PENDING' || st === 'OVERDUE') {
            try {
                await asaasService.confirmarRecebimentoEmDinheiro(paymentId, {
                    valor,
                    notifyCustomer: false,
                    context
                });
                return { alreadyPaidOnline: false, asaasClosedInCash: true, cobranca };
            } catch (cashErr) {
                console.warn('[Reconciliation] Não foi possível dar baixa em dinheiro no Asaas:', cashErr.message);
            }
        }

        return { alreadyPaidOnline: false, asaasClosedInCash: false, cobranca };
    } catch (err) {
        console.warn('[Reconciliation] Falha ao consultar Asaas antes da baixa manual:', err.message);
        return { alreadyPaidOnline: false, asaasClosedInCash: false };
    }
}

/**
 * Concilia um convite de exame com a API do Asaas (incluindo correção de registros legados ambíguos).
 */
async function reconcileConviteWithAsaas(conviteRow) {
    const conviteId = Number(conviteRow.id || conviteRow.convite_id);
    if (!conviteId || !asaasService.isConfigured() || !conviteRow.asaas_payment_id || String(conviteRow.asaas_payment_id).startsWith('pay_mock_')) {
        return 'skipped';
    }

    try {
        const context = {
            alunoId: conviteRow.aluno_id,
            referenciaTipo: 'convite_exame',
            referenciaId: conviteId,
            origemRota: '/api/exames/sincronizar-asaas'
        };
        const cobranca = await asaasService.consultarCobranca(conviteRow.asaas_payment_id, context);
        const st = normalizeUpper(cobranca?.status);
        const billingUpper = normalizeUpper(cobranca?.billingType || conviteRow.asaas_billing_type || 'PIX');
        const statusLocal = normalizeLower(conviteRow.convite_status !== undefined ? conviteRow.convite_status : conviteRow.status);

        if (statusLocal !== 'pago') {
            if (isAsaasStatusPaidOnline(st)) {
                const nextBilling = ['PIX', 'BOLETO', 'CREDIT_CARD', 'DEBIT_CARD'].includes(billingUpper) ? billingUpper : 'PIX';
                const nextStatus = buildOnlineAsaasStatus({ cobrancaStatus: st, billingType: nextBilling });

                await pool.query(`
                    UPDATE evento_graduacao_convites SET
                        status = 'pago',
                        data_resposta = COALESCE(data_resposta, NOW()),
                        data_pagamento = COALESCE(data_pagamento, NOW()),
                        asaas_billing_type = ?,
                        asaas_status = ?
                    WHERE id = ?
                `, [nextBilling, nextStatus, conviteId]);

                if (conviteRow.aluno_id && conviteRow.evento_titulo) {
                    const valorFmt = Number(conviteRow.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    const metodoDetalhe = buildPaymentMethodDetail(nextBilling);
                    notificationConfigService.dispatchEvent('pagamento_exame', {
                        alunoId: conviteRow.aluno_id,
                        variables: { evento: conviteRow.evento_titulo, valor: valorFmt, metodo: metodoDetalhe },
                        detalhes: [
                            { label: 'Exame', value: conviteRow.evento_titulo },
                            { label: 'Valor', value: valorFmt },
                            { label: 'Método', value: metodoDetalhe }
                        ]
                    });
                }
                return 'paid_online';
            }

            if (st === 'RECEIVED_IN_CASH') {
                await pool.query(`
                    UPDATE evento_graduacao_convites SET
                        status = 'pago',
                        data_resposta = COALESCE(data_resposta, NOW()),
                        data_pagamento = COALESCE(data_pagamento, NOW()),
                        asaas_billing_type = 'MANUAL',
                        asaas_status = 'RECEIVED_MANUALLY'
                    WHERE id = ?
                `, [conviteId]);
                return 'paid_manual';
            }

            if (st === 'OVERDUE' && normalizeUpper(conviteRow.asaas_status) !== 'OVERDUE') {
                await pool.query("UPDATE evento_graduacao_convites SET asaas_status = 'OVERDUE' WHERE id = ?", [conviteId]);
                return 'overdue';
            }

            return 'unchanged';
        }

        // Registro já está 'pago', mas em estado legado ambíguo (CONFIRMED sem CREDIT_CARD/MANUAL ou PENDING/OVERDUE)
        const currentAsaasSt = normalizeUpper(conviteRow.asaas_status);
        const currentBilling = normalizeUpper(conviteRow.asaas_billing_type);
        const isAmbiguousLegacy = (
            (currentAsaasSt === 'CONFIRMED' && !['CREDIT_CARD', 'MANUAL'].includes(currentBilling)) ||
            !isAsaasStatusPaidOnline(currentAsaasSt) && !isAsaasStatusManual(currentAsaasSt)
        );

        if (isAmbiguousLegacy) {
            if (isAsaasStatusPaidOnline(st)) {
                const nextBilling = ['PIX', 'BOLETO', 'CREDIT_CARD', 'DEBIT_CARD'].includes(billingUpper) ? billingUpper : 'PIX';
                const nextStatus = buildOnlineAsaasStatus({ cobrancaStatus: st, billingType: nextBilling });
                await pool.query(
                    'UPDATE evento_graduacao_convites SET asaas_billing_type = ?, asaas_status = ? WHERE id = ?',
                    [nextBilling, nextStatus, conviteId]
                );
                return 'repaired_online';
            }

            await pool.query(
                "UPDATE evento_graduacao_convites SET asaas_billing_type = 'MANUAL', asaas_status = 'RECEIVED_MANUALLY' WHERE id = ?",
                [conviteId]
            );
            if (st === 'PENDING' || st === 'OVERDUE') {
                await asaasService.confirmarRecebimentoEmDinheiro(conviteRow.asaas_payment_id, {
                    valor: conviteRow.valor,
                    notifyCustomer: false,
                    context
                }).catch(() => {});
            }
            return 'repaired_manual';
        }

        return 'unchanged';
    } catch (err) {
        console.warn(`[Reconciliation] Falha ao conciliar convite #${conviteId}:`, err.message);
        return 'error';
    }
}

/**
 * Concilia todos os convites aplicáveis de um evento de exame com o gateway Asaas.
 */
async function reconcileEventoConvites(eventoId) {
    const stats = { verificados: 0, atualizados_online: 0, ajustados_manual: 0 };
    if (!asaasService.isConfigured()) return stats;

    const [rows] = await pool.query(`
        SELECT c.id, c.aluno_id, c.status, c.valor, c.asaas_payment_id, c.asaas_billing_type, c.asaas_status,
               eg.titulo AS evento_titulo
        FROM evento_graduacao_convites c
        JOIN eventos_graduacao eg ON eg.id = c.evento_id
        WHERE c.evento_id = ?
          AND c.asaas_payment_id IS NOT NULL
          AND c.asaas_payment_id != ''
          AND c.asaas_payment_id NOT LIKE 'pay_mock_%'
          AND (
              c.status IN ('convidado', 'aceito')
              OR (c.status = 'pago' AND c.asaas_status = 'CONFIRMED' AND COALESCE(c.asaas_billing_type, '') NOT IN ('CREDIT_CARD', 'MANUAL'))
              OR (c.status = 'pago' AND COALESCE(c.asaas_status, '') IN ('', 'PENDING', 'OVERDUE'))
          )
        LIMIT 50
    `, [eventoId]);

    for (let i = 0; i < rows.length; i += 5) {
        const chunk = rows.slice(i, i + 5);
        const outcomes = await Promise.all(chunk.map(r => reconcileConviteWithAsaas(r)));
        for (const out of outcomes) {
            if (out !== 'skipped' && out !== 'error') stats.verificados++;
            if (out === 'paid_online' || out === 'repaired_online') stats.atualizados_online++;
            if (out === 'paid_manual' || out === 'repaired_manual') stats.ajustados_manual++;
        }
    }

    return stats;
}

/**
 * Concilia faturas em aberto (e registros pagos com asaas_status legado) contra a API do Asaas.
 */
async function reconcilePendingFaturas({ alunoId = null, mes = null, limit = 25 } = {}) {
    const stats = { verificados: 0, atualizados_online: 0, ajustados_manual: 0 };
    if (!asaasService.isConfigured()) return stats;

    let sql = `
        SELECT id, aluno_id, status, valor_original, metodo_pagamento, asaas_payment_id, asaas_status
        FROM faturas
        WHERE asaas_payment_id IS NOT NULL
          AND asaas_payment_id != ''
          AND asaas_payment_id NOT LIKE 'pay_mock_%'
          AND (
              status IN ('pendente', 'atrasado')
              OR (status = 'pago' AND COALESCE(asaas_status, '') IN ('', 'PENDING', 'OVERDUE'))
          )
    `;
    const params = [];

    if (alunoId) {
        sql += ' AND aluno_id = ?';
        params.push(alunoId);
    }
    if (mes) {
        sql += ' AND competencia = ?';
        params.push(mes);
    }

    const safeLimit = Math.min(Math.max(parseInt(String(limit), 10) || 25, 1), 50);
    sql += ' ORDER BY data_vencimento DESC LIMIT ?';
    params.push(safeLimit);

    const [rows] = await pool.query(sql, params);

    for (let i = 0; i < rows.length; i += 5) {
        const chunk = rows.slice(i, i + 5);
        await Promise.all(chunk.map(async (fat) => {
            try {
                const context = {
                    alunoId: fat.aluno_id,
                    referenciaTipo: 'fatura',
                    referenciaId: fat.id,
                    origemRota: '/api/faturas/sincronizar-asaas'
                };
                const cobranca = await asaasService.consultarCobranca(fat.asaas_payment_id, context);
                stats.verificados++;
                const st = normalizeUpper(cobranca?.status);
                const billingUpper = normalizeUpper(cobranca?.billingType || 'PIX');

                if (fat.status !== 'pago') {
                    if (isAsaasStatusPaidOnline(st)) {
                        const metodo = mapAsaasBillingTypeToMetodo(billingUpper);
                        const valorPago = cobranca?.value ? parseFloat(cobranca.value) : null;
                        const nextStatus = buildOnlineAsaasStatus({ cobrancaStatus: st, billingType: billingUpper });

                        await pool.query(`
                            UPDATE faturas SET
                                status = 'pago',
                                data_pagamento = COALESCE(data_pagamento, NOW()),
                                metodo_pagamento = ?,
                                valor_pago = COALESCE(?, valor_original),
                                asaas_status = ?
                            WHERE id = ?
                        `, [metodo, !isNaN(valorPago) && valorPago > 0 ? valorPago : null, nextStatus, fat.id]);

                        stats.atualizados_online++;

                        if (fat.aluno_id) {
                            const vPago = (!isNaN(valorPago) && valorPago > 0 ? valorPago : fat.valor_original) || 0;
                            const valorFmt = Number(vPago).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                            notificationConfigService.dispatchEvent('pagamento_mensalidade', {
                                alunoId: fat.aluno_id,
                                variables: { valor: valorFmt, metodo: metodo.toUpperCase() },
                                detalhes: [
                                    { label: 'Valor', value: valorFmt },
                                    { label: 'Forma de Pagamento', value: metodo.toUpperCase() }
                                ]
                            });
                        }
                    } else if (st === 'RECEIVED_IN_CASH') {
                        await pool.query(`
                            UPDATE faturas SET
                                status = 'pago',
                                data_pagamento = COALESCE(data_pagamento, NOW()),
                                metodo_pagamento = 'dinheiro',
                                valor_pago = COALESCE(valor_pago, valor_original),
                                asaas_status = 'RECEIVED_MANUALLY'
                            WHERE id = ?
                        `, [fat.id]);
                        stats.ajustados_manual++;
                    } else if (st === 'OVERDUE' && normalizeUpper(fat.asaas_status) !== 'OVERDUE') {
                        await pool.query("UPDATE faturas SET asaas_status = 'OVERDUE' WHERE id = ?", [fat.id]);
                    }
                } else {
                    // Fatura já estava 'pago', corrige asaas_status legado
                    if (isAsaasStatusPaidOnline(st)) {
                        const nextStatus = buildOnlineAsaasStatus({ cobrancaStatus: st, billingType: billingUpper });
                        await pool.query('UPDATE faturas SET asaas_status = ? WHERE id = ?', [nextStatus, fat.id]);
                        stats.atualizados_online++;
                    } else {
                        await pool.query("UPDATE faturas SET asaas_status = 'RECEIVED_MANUALLY' WHERE id = ?", [fat.id]);
                        stats.ajustados_manual++;
                    }
                }
            } catch (err) {
                console.warn(`[Reconciliation] Falha ao conciliar fatura #${fat.id}:`, err.message);
            }
        }));
    }

    return stats;
}

module.exports = {
    mapAsaasBillingTypeToMetodo,
    isAsaasStatusPaidOnline,
    isAsaasStatusManual,
    parseExternalReference,
    classifyConvitePaymentOrigin,
    classifyFaturaPaymentOrigin,
    processAsaasWebhookEvent,
    notifyAsaasManualSettlement,
    reconcileConviteWithAsaas,
    reconcileEventoConvites,
    reconcilePendingFaturas
};
