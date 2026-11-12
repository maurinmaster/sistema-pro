const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sistema_pro',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0,
    decimalNumbers: true,
    timezone: '-03:00',
    charset: 'utf8mb4'
});

// Testa conexão inicial apenas fora de ambiente de testes unitários
if (process.env.NODE_ENV !== 'test') {
    (async () => {
        try {
            const connection = await pool.getConnection();
            console.log('✅ [MySQL] Conectado com sucesso ao banco de dados:', process.env.DB_NAME || 'sistema_pro');
            connection.release();
        } catch (err) {
            console.error('❌ [MySQL] Erro ao conectar ao banco de dados:', err.message);
        }
    })();
}

module.exports = pool;
