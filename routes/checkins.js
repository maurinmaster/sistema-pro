const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');
const { evaluateCheckinEligibility } = require('../services/domainRules');
const gamificationService = require('../services/gamificationService');

// GET /api/checkins/recentes - Lista os check-ins mais recentes (todos autenticados)
router.get('/recentes', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                c.id,
                c.data_hora_checkin,
                c.metodo,
                c.tipo_aula,
                c.xp_ganho,
                c.multiplicador_xp,
                c.status,
                c.motivo_bloqueio,
                a.id AS aluno_id,
                a.nome_completo AS aluno_nome,
                a.foto_perfil_url,
                a.streak_semanas,
                m.nome AS modalidade_nome,
                t.nome AS turma_nome,
                t.tipo_aula AS turma_tipo_aula
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

// POST /api/checkins - Registrar novo check-in / presença + Motor de XP e Ofensiva Semanal
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { aluno_id, modalidade_id, turma_id, metodo = 'manual_professor', tipo_aula } = req.body;

        if (!aluno_id || !modalidade_id) {
            return res.status(400).json({ success: false, error: 'Aluno e modalidade são obrigatórios.' });
        }

        // Verifica status do aluno
        const [alunos] = await pool.query('SELECT id, status, nome_completo FROM alunos WHERE id = ? AND deleted_at IS NULL', [aluno_id]);
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

        let turmaInfo = null;
        if (turma_id) {
            const [tRows] = await pool.query('SELECT id, nome, tipo_aula, xp_base FROM turmas WHERE id = ?', [turma_id]);
            if (tRows.length > 0) turmaInfo = tRows[0];
        }

        const requestedTipo = (tipo_aula === 'especial' || tipo_aula === 'regular')
            ? tipo_aula
            : (turmaInfo?.tipo_aula === 'especial' ? 'especial' : 'regular');
        const customXpBase = (turmaInfo && !tipo_aula && Number(turmaInfo.xp_base) > 0)
            ? Number(turmaInfo.xp_base)
            : null;

        let xpCalc = { tipo_aula: requestedTipo, xp_base: 0, multiplicador: 1.0, xp_final: 0 };
        if (statusCheckin === 'aprovado') {
            const preState = await gamificationService.recalculateStudentStreakAndXp(pool, aluno.id);
            const mult = preState?.ofensiva?.multiplicador_ativo || 1.0;
            xpCalc = gamificationService.calculateCheckinXp({
                tipoAula: requestedTipo,
                xpBaseCustom: customXpBase,
                multiplicador: mult
            });
        }

        const [result] = await pool.query(`
            INSERT INTO checkins (aluno_id, modalidade_id, turma_id, metodo, tipo_aula, xp_ganho, multiplicador_xp, status, motivo_bloqueio, validado_por_usuario_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            aluno.id,
            modalidade_id,
            turma_id || null,
            metodo,
            xpCalc.tipo_aula,
            xpCalc.xp_final,
            xpCalc.multiplicador,
            statusCheckin,
            motivoBloqueio,
            req.user ? req.user.id : null
        ]);

        let postState = null;
        if (statusCheckin === 'aprovado') {
            await gamificationService.awardXp(pool, {
                alunoId: aluno.id,
                origem: xpCalc.tipo_aula === 'especial' ? 'checkin_especial' : 'checkin_regular',
                referenciaId: result.insertId,
                xpBase: xpCalc.xp_base,
                multiplicador: xpCalc.multiplicador,
                descricao: xpCalc.tipo_aula === 'especial'
                    ? `Check-in Especial${turmaInfo ? ' (' + turmaInfo.nome + ')' : ''}`
                    : `Check-in Aula Regular${turmaInfo ? ' (' + turmaInfo.nome + ')' : ''}`
            });
            postState = await gamificationService.recalculateStudentStreakAndXp(pool, aluno.id);
        }

        const multLabel = xpCalc.multiplicador > 1 ? ` (${xpCalc.multiplicador}x Ofensiva!)` : '';
        res.status(201).json({
            success: true,
            id: result.insertId,
            status: statusCheckin,
            motivo_bloqueio: motivoBloqueio,
            tipo_aula: xpCalc.tipo_aula,
            xp_ganho: xpCalc.xp_final,
            multiplicador_xp: xpCalc.multiplicador,
            ofensiva: postState?.ofensiva || null,
            xp_level: postState?.xp_level || null,
            message: statusCheckin === 'aprovado'
                ? `Presença de ${aluno.nome_completo} confirmada! +${xpCalc.xp_final} XP${multLabel}`
                : `Check-in ${statusCheckin}: ${motivoBloqueio}`
        });
    } catch (err) {
        console.error('Erro ao registrar check-in:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao registrar check-in.' });
    }
});

// PATCH /api/checkins/turmas/:id/tipo-aula - Configurar tipo/multiplicador XP da turma (Regular +10XP / Especial +20XP)
router.patch('/turmas/:id/tipo-aula', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const turmaId = parseInt(req.params.id, 10);
        if (Number.isNaN(turmaId) || turmaId <= 0) {
            return res.status(400).json({ success: false, error: 'ID de turma inválido.' });
        }

        const tipo = String(req.body?.tipo_aula || '').trim().toLowerCase();
        if (tipo !== 'regular' && tipo !== 'especial') {
            return res.status(400).json({ success: false, error: 'tipo_aula inválido. Use "regular" ou "especial".' });
        }

        const rawXp = req.body?.xp_base !== undefined && req.body?.xp_base !== null
            ? parseInt(req.body.xp_base, 10)
            : (tipo === 'especial' ? gamificationService.XP_CHECKIN_ESPECIAL : gamificationService.XP_CHECKIN_REGULAR);
        const xpBase = (!Number.isNaN(rawXp) && rawXp >= 5 && rawXp <= 200)
            ? rawXp
            : (tipo === 'especial' ? 20 : 10);

        const [result] = await pool.query(
            'UPDATE turmas SET tipo_aula = ?, xp_base = ? WHERE id = ?',
            [tipo, xpBase, turmaId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Turma não encontrada.' });
        }

        res.json({
            success: true,
            tipo_aula: tipo,
            xp_base: xpBase,
            message: tipo === 'especial'
                ? `Turma configurada como Treino Especial (+${xpBase} XP).`
                : `Turma configurada como Aula Regular (+${xpBase} XP).`
        });
    } catch (err) {
        console.error('Erro ao configurar tipo de aula da turma:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao atualizar turma.' });
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
