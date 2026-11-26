const mysql = require('mysql2/promise');
require('dotenv').config();

const rawHost = (process.env.DB_HOST || '').trim();
const isInvalidHostName = (
    !rawHost ||
    rawHost === (process.env.DB_NAME || '').trim() ||
    rawHost === (process.env.DB_USER || '').trim() ||
    /^u\d+_/i.test(rawHost)
);
const dbHost = isInvalidHostName ? 'localhost' : rawHost;

const parsedDbPort = parseInt(process.env.DB_PORT || '3306', 10);
const appPort = parseInt(process.env.PORT || '3000', 10);
const dbPort = (Number.isNaN(parsedDbPort) || parsedDbPort <= 0 || parsedDbPort === appPort) ? 3306 : parsedDbPort;

const pool = mysql.createPool({
    host: dbHost,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sistema_pro',
    port: dbPort,
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0,
    decimalNumbers: true,
    timezone: '-03:00',
    charset: 'utf8mb4'
});

// Garante que cada conexão da sessão MySQL utilize GMT-3 (Feira de Santana / Bahia) em NOW(), CURDATE() e CURRENT_TIMESTAMP
pool.on('connection', (connection) => {
    connection.query("SET time_zone = '-03:00'");
});

module.exports = pool;

// Testa conexão inicial e garante schema sincronizado fora de ambiente de testes unitários
if (process.env.NODE_ENV !== 'test') {
    if (isInvalidHostName && rawHost) {
        console.warn(`⚠️ [MySQL] DB_HOST continha identificador de banco/usuário; ajustado automaticamente para '${dbHost}'.`);
    }
    (async () => {
        try {
            const connection = await pool.getConnection();
            console.log(`✅ [MySQL] Conectado com sucesso ao banco de dados: ${process.env.DB_NAME || 'sistema_pro'} (${dbHost}:${dbPort})`);
            connection.release();
            const { runMigrations } = require('./migrate');
            await runMigrations();
        } catch (err) {
            const detail = err.message || err.code || (Array.isArray(err.errors) ? err.errors.map(e => e.message || e.code).join('; ') : String(err));
            console.error(`❌ [MySQL] Erro ao conectar ao banco de dados (${dbHost}:${dbPort}):`, detail);
        }
    })();
}
