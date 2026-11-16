const pool = require('../db/connection');

let tableEnsured = false;

/**
 * Mascara ou remove campos sensíveis antes de persistir detalhes do erro em JSON.
 */
function sanitizeDetails(details) {
    if (!details || typeof details !== 'object') return null;

    const sensitiveKeys = new Set([
        'access_token',
        'token',
        'senha',
        'password',
        'ccv',
        'cvv',
        'number',
        'numero_cartao',
        'creditcard',
        'credit_card'
    ]);

    const redact = (obj, depth = 0) => {
        if (depth > 4 || obj === null || obj === undefined) return obj;
        if (Array.isArray(obj)) {
            return obj.slice(0, 20).map(item => redact(item, depth + 1));
        }
        if (typeof obj === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(obj)) {
                if (sensitiveKeys.has(String(k).toLowerCase())) {
                    out[k] = '[REDACTED]';
                } else {
                    out[k] = redact(v, depth + 1);
                }
            }
            return out;
        }
        if (typeof obj === 'string' && obj.length > 500) {
            return obj.slice(0, 500) + '...';
        }
        return obj;
    };

    try {
        return JSON.stringify(redact(details));
    } catch {
        return null;
    }
}

/**
 * Extrai metadados estruturados de uma exceção lançada pelo AsaasService ou fetch.
 */
function extractAsaasErrorInfo(err) {
    if (!err) {
        return {
            httpStatus: null,
            codigoErro: null,
            mensagemErro: 'Erro desconhecido no gateway de pagamento.',
            paymentId: null,
            detalhes: null
        };
    }

    const errorsArr = Array.isArray(err.asaasErrors) ? err.asaasErrors : null;
    const firstCode = errorsArr && errorsArr.length > 0 ? (errorsArr[0].code || null) : null;

    return {
        httpStatus: err.asaasStatus || err.statusCode || null,
        codigoErro: err.asaasCode || firstCode || err.code || null,
        mensagemErro: String(err.message || 'Falha na comunicação com o gateway de pagamento.').slice(0, 2000),
        paymentId: err.asaasPaymentId || null,
        detalhes: errorsArr ? { errors: errorsArr } : null
    };
}

/**
 * Garante a existência da tabela gateway_pagamento_logs mesmo antes de uma execução manual do migrate.js.
 */
async function ensurePaymentLogsTable() {
    if (tableEnsured) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS gateway_pagamento_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            gateway VARCHAR(30) NOT NULL DEFAULT 'asaas',
            operacao VARCHAR(80) NOT NULL,
            aluno_id INT NULL,
            referencia_tipo VARCHAR(40) NULL,
            referencia_id INT NULL,
            payment_id VARCHAR(100) NULL,
            http_status INT NULL,
            codigo_erro VARCHAR(100) NULL,
            mensagem_erro TEXT NOT NULL,
            detalhes_json JSON NULL,
            origem_rota VARCHAR(150) NULL,
            resolvido TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_gw_logs_created (created_at),
            INDEX idx_gw_logs_aluno (aluno_id),
            INDEX idx_gw_logs_resolvido (resolvido)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    tableEnsured = true;
}

const PaymentLogService = {
    sanitizeDetails,
    extractAsaasErrorInfo,
    ensurePaymentLogsTable,

    /**
     * Registra uma falha de pagamento emitida pelo Asaas ou ocorrida durante a comunicação com o gateway.
     * Nunca lança exceção para não mascarar o erro original da requisição.
     */
    async recordFailure({
        gateway = 'asaas',
        operacao = 'desconhecida',
        alunoId = null,
        referenciaTipo = null,
        referenciaId = null,
        paymentId = null,
        httpStatus = null,
        codigoErro = null,
        mensagemErro = 'Falha no processamento de pagamento.',
        detalhes = null,
        origemRota = null
    }) {
        try {
            console.error(
                `[PaymentLog:${gateway}] op=${operacao} aluno=${alunoId ?? '-'} ref=${referenciaTipo ?? '-'}:${referenciaId ?? '-'} status=${httpStatus ?? '-'} code=${codigoErro ?? '-'} msg=${mensagemErro}`
            );

            if (process.env.NODE_ENV === 'test') {
                return null;
            }

            await ensurePaymentLogsTable();

            const detalhesJson = sanitizeDetails(detalhes);
            const [res] = await pool.query(
                `INSERT INTO gateway_pagamento_logs
                    (gateway, operacao, aluno_id, referencia_tipo, referencia_id, payment_id, http_status, codigo_erro, mensagem_erro, detalhes_json, origem_rota)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    String(gateway).slice(0, 30),
                    String(operacao).slice(0, 80),
                    alunoId ? Number(alunoId) : null,
                    referenciaTipo ? String(referenciaTipo).slice(0, 40) : null,
                    referenciaId ? Number(referenciaId) : null,
                    paymentId ? String(paymentId).slice(0, 100) : null,
                    httpStatus ? Number(httpStatus) : null,
                    codigoErro ? String(codigoErro).slice(0, 100) : null,
                    String(mensagemErro).slice(0, 4000),
                    detalhesJson,
                    origemRota ? String(origemRota).slice(0, 150) : null
                ]
            );
            return res.insertId;
        } catch (logErr) {
            console.error('[PaymentLog] Erro ao persistir log de falha:', logErr.message);
            return null;
        }
    }
};

module.exports = PaymentLogService;
