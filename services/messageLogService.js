const pool = require('../db/connection');

const ALLOWED_CHANNELS = ['email', 'whatsapp'];
const ALLOWED_STATUSES = ['enviado', 'simulado', 'ignorado', 'erro'];

class MessageLogService {
    constructor() {
        this.tableChecked = false;
    }

    async ensureTable() {
        if (this.tableChecked) return;
        await pool.query(`
            CREATE TABLE IF NOT EXISTS mensagens_envios_logs (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                canal ENUM('email', 'whatsapp') NOT NULL,
                tipo VARCHAR(60) NOT NULL DEFAULT 'sistema',
                destinatario VARCHAR(180) NOT NULL,
                assunto VARCHAR(200) NULL DEFAULT NULL,
                status ENUM('enviado', 'simulado', 'ignorado', 'erro') NOT NULL,
                erro_detalhe VARCHAR(500) NULL DEFAULT NULL,
                message_id VARCHAR(180) NULL DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_msg_logs_created (created_at),
                INDEX idx_msg_logs_canal_status (canal, status),
                INDEX idx_msg_logs_dest (destinatario)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        this.tableChecked = true;
    }

    sanitizeLogPayload({
        canal = 'email',
        tipo = 'sistema',
        destinatario = '',
        assunto = null,
        status = 'enviado',
        erro_detalhe = null,
        message_id = null
    } = {}) {
        const cleanCanal = ALLOWED_CHANNELS.includes(String(canal).toLowerCase())
            ? String(canal).toLowerCase()
            : 'email';

        const cleanStatus = ALLOWED_STATUSES.includes(String(status).toLowerCase())
            ? String(status).toLowerCase()
            : 'erro';

        const truncate = (val, maxLen) => {
            if (val === undefined || val === null) return null;
            const str = String(val).trim();
            return str ? str.slice(0, maxLen) : null;
        };

        return {
            canal: cleanCanal,
            tipo: truncate(tipo, 60) || 'sistema',
            destinatario: truncate(destinatario, 180) || 'desconhecido',
            assunto: truncate(assunto, 200),
            status: cleanStatus,
            erro_detalhe: truncate(erro_detalhe, 500),
            message_id: truncate(message_id, 180)
        };
    }

    async recordLog(entry) {
        try {
            const payload = this.sanitizeLogPayload(entry);
            await this.ensureTable();
            await pool.query(
                `INSERT INTO mensagens_envios_logs (
                    canal, tipo, destinatario, assunto, status, erro_detalhe, message_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    payload.canal,
                    payload.tipo,
                    payload.destinatario,
                    payload.assunto,
                    payload.status,
                    payload.erro_detalhe,
                    payload.message_id
                ]
            );
        } catch (err) {
            console.warn('[MessageLog] Aviso ao gravar log de envio:', err.message);
        }
    }

    buildPaginationMeta({ page = 1, limit = 15, total = 0 } = {}) {
        const parsedLimit = parseInt(String(limit), 10);
        const cleanLimit = Math.min(Math.max(Number.isNaN(parsedLimit) ? 15 : parsedLimit, 5), 100);
        const parsedTotal = parseInt(String(total), 10);
        const cleanTotal = Math.max(0, Number.isNaN(parsedTotal) ? 0 : parsedTotal);
        const totalPages = Math.max(1, Math.ceil(cleanTotal / cleanLimit));
        const parsedPage = parseInt(String(page), 10);
        const cleanPage = Math.min(Math.max(Number.isNaN(parsedPage) ? 1 : parsedPage, 1), totalPages);
        const offset = (cleanPage - 1) * cleanLimit;
        const from = cleanTotal === 0 ? 0 : offset + 1;
        const to = Math.min(cleanTotal, offset + cleanLimit);

        return {
            page: cleanPage,
            limit: cleanLimit,
            total: cleanTotal,
            total_pages: totalPages,
            offset,
            has_prev: cleanPage > 1,
            has_next: cleanPage < totalPages,
            from,
            to
        };
    }

    async listLogs({ canal = '', status = '', busca = '', page = 1, limit = 15 } = {}) {
        await this.ensureTable();

        const conditions = [];
        const params = [];

        if (canal && ALLOWED_CHANNELS.includes(String(canal).toLowerCase())) {
            conditions.push('canal = ?');
            params.push(String(canal).toLowerCase());
        }

        if (status && ALLOWED_STATUSES.includes(String(status).toLowerCase())) {
            conditions.push('status = ?');
            params.push(String(status).toLowerCase());
        }

        if (busca && String(busca).trim()) {
            const like = `%${String(busca).trim()}%`;
            conditions.push('(destinatario LIKE ? OR assunto LIKE ? OR tipo LIKE ? OR erro_detalhe LIKE ?)');
            params.push(like, like, like, like);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const [countRows] = await pool.query(
            `SELECT COUNT(*) AS total FROM mensagens_envios_logs ${whereClause}`,
            params
        );
        const pagination = this.buildPaginationMeta({
            page,
            limit,
            total: Number(countRows[0]?.total || 0)
        });

        const [logs] = await pool.query(
            `SELECT id, canal, tipo, destinatario, assunto, status, erro_detalhe, message_id, created_at
             FROM mensagens_envios_logs
             ${whereClause}
             ORDER BY id DESC
             LIMIT ? OFFSET ?`,
            [...params, pagination.limit, pagination.offset]
        );

        const [statRows] = await pool.query(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'enviado' THEN 1 ELSE 0 END) AS enviados,
                SUM(CASE WHEN status = 'erro' THEN 1 ELSE 0 END) AS erros,
                SUM(CASE WHEN status = 'ignorado' THEN 1 ELSE 0 END) AS ignorados,
                SUM(CASE WHEN status = 'simulado' THEN 1 ELSE 0 END) AS simulados
            FROM mensagens_envios_logs
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        `);

        const s = statRows[0] || {};
        return {
            logs,
            pagination,
            stats: {
                total: Number(s.total || 0),
                enviados: Number(s.enviados || 0),
                erros: Number(s.erros || 0),
                ignorados: Number(s.ignorados || 0),
                simulados: Number(s.simulados || 0)
            }
        };
    }
}

module.exports = new MessageLogService();
