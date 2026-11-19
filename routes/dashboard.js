const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { authenticateToken } = require('../middlewares/auth');

// GET /api/dashboard/stats - Métricas gerais consolidadas (requer autenticação)
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        // 1. Contagens gerais de alunos por status
        const [statusCounts] = await pool.query(`
            SELECT 
                COUNT(*) AS total_alunos,
                SUM(CASE WHEN status = 'ativo' THEN 1 ELSE 0 END) AS ativos,
                SUM(CASE WHEN status = 'inativo' THEN 1 ELSE 0 END) AS inativos,
                SUM(CASE WHEN status = 'trancado' THEN 1 ELSE 0 END) AS trancados,
                SUM(CASE WHEN status = 'bloqueado' THEN 1 ELSE 0 END) AS bloqueados,
                SUM(CASE WHEN status = 'experimental' THEN 1 ELSE 0 END) AS experimentais,
                SUM(CASE WHEN TIMESTAMPDIFF(YEAR, data_nascimento, CURDATE()) < 18 THEN 1 ELSE 0 END) AS menores_idade
            FROM alunos
            WHERE deleted_at IS NULL
        `);

        // 2. Presenças hoje e últimos 7 dias
        const [presencas] = await pool.query(`
            SELECT 
                SUM(CASE WHEN DATE(data_hora_checkin) = CURDATE() AND status = 'aprovado' THEN 1 ELSE 0 END) AS checkins_hoje,
                SUM(CASE WHEN data_hora_checkin >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND status = 'aprovado' THEN 1 ELSE 0 END) AS checkins_semana
            FROM checkins
        `);

        // 3. Faturas e inadimplência
        const [financeiro] = await pool.query(`
            SELECT 
                COUNT(DISTINCT CASE WHEN status = 'atrasado' OR (status = 'pendente' AND data_vencimento < CURDATE()) THEN aluno_id END) AS alunos_inadimplentes,
                SUM(CASE WHEN status = 'pago' AND competencia = DATE_FORMAT(CURDATE(), '%Y-%m') THEN valor_pago ELSE 0 END) AS receita_mes,
                SUM(CASE WHEN status = 'atrasado' OR (status = 'pendente' AND data_vencimento < CURDATE()) THEN valor_original ELSE 0 END) AS valor_em_atraso
            FROM faturas
        `);

        // 4. Distribuição de alunos ativos por modalidade
        const [modalidadesDist] = await pool.query(`
            SELECT 
                m.id,
                m.nome,
                COUNT(DISTINCT a.id) AS total_alunos
            FROM modalidades m
            LEFT JOIN aluno_graduacoes ag ON ag.modalidade_id = m.id AND ag.atual = 1
            LEFT JOIN alunos a ON a.id = ag.aluno_id AND a.status = 'ativo' AND a.deleted_at IS NULL
            WHERE m.ativo = 1
            GROUP BY m.id
            ORDER BY total_alunos DESC, m.nome ASC
        `);

        // 5. Presenças por dia nos últimos 7 dias corridos (sempre retorna as 7 datas)
        const [graficoFrequencia] = await pool.query(`
            SELECT
                DATE_FORMAT(dias.dia_data, '%d/%m') AS dia,
                DATE_FORMAT(dias.dia_data, '%Y-%m-%d') AS data_iso,
                COUNT(c.id) AS total
            FROM (
                SELECT DATE_SUB(CURDATE(), INTERVAL 6 DAY) AS dia_data
                UNION ALL SELECT DATE_SUB(CURDATE(), INTERVAL 5 DAY)
                UNION ALL SELECT DATE_SUB(CURDATE(), INTERVAL 4 DAY)
                UNION ALL SELECT DATE_SUB(CURDATE(), INTERVAL 3 DAY)
                UNION ALL SELECT DATE_SUB(CURDATE(), INTERVAL 2 DAY)
                UNION ALL SELECT DATE_SUB(CURDATE(), INTERVAL 1 DAY)
                UNION ALL SELECT CURDATE()
            ) AS dias
            LEFT JOIN checkins c
                ON DATE(c.data_hora_checkin) = dias.dia_data
                AND c.status = 'aprovado'
            GROUP BY dias.dia_data
            ORDER BY dias.dia_data ASC
        `);

        // 6. Alunos que mais treinam (top assíduos)
        const [topAssiduos] = await pool.query(`
            SELECT 
                a.id,
                a.nome_completo,
                a.foto_perfil_url,
                COUNT(c.id) AS total_treinos
            FROM alunos a
            JOIN checkins c ON c.aluno_id = a.id AND c.status = 'aprovado'
            WHERE a.deleted_at IS NULL AND c.data_hora_checkin >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY a.id
            ORDER BY total_treinos DESC, a.nome_completo ASC
            LIMIT 5
        `);

        res.json({
            success: true,
            data: {
                alunos: statusCounts[0],
                presencas: presencas[0],
                financeiro: financeiro[0],
                modalidades: modalidadesDist,
                frequencia_semanal: graficoFrequencia,
                top_assiduos: topAssiduos
            }
        });
    } catch (err) {
        console.error('Erro ao gerar estatísticas do dashboard:', err);
        res.status(500).json({ success: false, error: 'Erro ao gerar métricas do dashboard.' });
    }
});

module.exports = router;
