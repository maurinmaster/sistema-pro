const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { authenticateToken } = require('../middlewares/auth');
const { evaluateCheckinEligibility } = require('../services/domainRules');

// GET /api/checkins/recentes - Lista os check-ins mais recentes (todos autenticados)
router.get('/recentes', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                c.id,
                c.data_hora_checkin,
                c.metodo,
                c.status,
                c.motivo_bloqueio,
                a.id AS aluno_id,
                a.nome_completo AS aluno_nome,
                a.foto_perfil_url,
                m.nome AS modalidade_nome,
                t.nome AS turma_nome
            FROM checkins c
            JOIN alunos a ON a.id = c.aluno_id
            JOIN modalidades m ON m.id = c.modalidade_id
            LEFT JOIN turmas t ON t.id = c.turma_id
            ORDER BY c.data_hora_checkin DESC
            LIMIT 50
        `);
        res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
        console.error('Erro ao listar check-ins:', err);
        res.status(500).json({ success: false, error: 'Erro ao listar check-ins.' });
    }
});

// POST /api/checkins - Registrar novo check-in / presença (todos autenticados)
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { aluno_id, modalidade_id, turma_id, metodo = 'manual_professor' } = req.body;

        if (!aluno_id || !modalidade_id) {
            return res.status(400).json({ success: false, error: 'Aluno e modalidade são obrigatórios.' });
        }

        // Verifica status do aluno
        const [alunos] = await pool.query('SELECT status, nome_completo FROM alunos WHERE id = ?', [aluno_id]);
        if (alunos.length === 0) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        const aluno = alunos[0];
        let faturasAtrasadas = 0;

        if (!['bloqueado', 'trancado', 'inativo'].includes(aluno.status)) {
            const [atrasos] = await pool.query(`
                SELECT COUNT(*) AS total_atrasadas 
                FROM faturas 
                WHERE aluno_id = ? AND status = 'atrasado'
            `, [aluno_id]);
            faturasAtrasadas = atrasos[0].total_atrasadas;
        }

        const { status: statusCheckin, motivoBloqueio } = evaluateCheckinEligibility(aluno.status, faturasAtrasadas);

        const [result] = await pool.query(`
            INSERT INTO checkins (aluno_id, modalidade_id, turma_id, metodo, status, motivo_bloqueio, validado_por_usuario_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [aluno_id, modalidade_id, turma_id || null, metodo, statusCheckin, motivoBloqueio, req.user ? req.user.id : null]);

        res.status(201).json({
            success: true,
            id: result.insertId,
            status: statusCheckin,
            motivo_bloqueio: motivoBloqueio,
            message: statusCheckin === 'aprovado'
                ? `Presença de ${aluno.nome_completo} confirmada com sucesso!`
                : `Check-in ${statusCheckin}: ${motivoBloqueio}`
        });
    } catch (err) {
        console.error('Erro ao registrar check-in:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao registrar check-in.' });
    }
});

// GET /api/checkins/turmas - Listar turmas ativas
router.get('/turmas', authenticateToken, async (req, res) => {
    try {
        const [turmas] = await pool.query(`
            SELECT t.*, m.nome AS modalidade_nome, ue.nome AS professor_nome
            FROM turmas t
            JOIN modalidades m ON m.id = t.modalidade_id
            LEFT JOIN usuarios_equipe ue ON ue.id = t.professor_id
            WHERE t.ativo = 1
            ORDER BY t.modalidade_id, t.horario_inicio
        `);
        res.json({ success: true, data: turmas });
    } catch (err) {
        console.error('Erro ao listar turmas:', err);
        res.status(500).json({ success: false, error: 'Erro ao listar turmas.' });
    }
});

module.exports = router;
