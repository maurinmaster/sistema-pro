const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');
const MatriculaService = require('../services/matriculaService');
const whatsappService = require('../services/whatsappService');

// POST /api/planos/matriculas (ou /api/matriculas) - Criar ou renovar matrícula (admin e recepcao)
router.post('/', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const { aluno_id, plano_id, dia_vencimento = 10, valor_acordado, desconto_motivo } = req.body;

        if (!aluno_id || !plano_id) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'Aluno e Plano são obrigatórios.' });
        }

        await MatriculaService.createEnrollmentWithInvoice(conn, {
            alunoId: aluno_id,
            planoId: plano_id,
            diaVencimento: dia_vencimento,
            valorAcordado: valor_acordado,
            descontoMotivo: desconto_motivo,
            dueDateMode: 'keep_current_month'
        });

        await conn.commit();

        whatsappService.notifyAluno(Number(aluno_id), (aluno) => {
            const primeiroNome = String(aluno.nome_completo || '').trim().split(/\s+/)[0] || 'Atleta';
            return `🥋 *PRO COMBATE — Inscrição / Matrícula Confirmada*\n\nOlá, *${primeiroNome}*!\nSua matrícula foi confirmada com sucesso no sistema. Seja bem-vindo(a) aos treinos!\n• *Vencimento:* Todo dia ${dia_vencimento}\n\nVocê pode acompanhar suas faturas e evolução no Portal do Aluno.`;
        });

        res.status(201).json({ success: true, message: 'Matrícula efetuada com sucesso!' });
    } catch (err) {
        await conn.rollback();
        console.error('Erro ao efetuar matrícula:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao registrar matrícula.' });
    } finally {
        conn.release();
    }
});

// POST /api/planos/matriculas/:id/trancar - Trancar matrícula temporariamente (admin e recepcao)
router.post('/:id/trancar', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const { id } = req.params;
        const { motivo, data_retorno_prevista, cancelar_faturas_abertas = true } = req.body;

        if (!motivo || !String(motivo).trim()) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'O motivo do trancamento é obrigatório.' });
        }

        const result = await MatriculaService.lockEnrollment(conn, {
            matriculaId: id,
            motivo: String(motivo),
            dataRetornoPrevista: data_retorno_prevista,
            cancelarFaturasAbertas: cancelar_faturas_abertas
        });

        if (result.error) {
            await conn.rollback();
            return res.status(result.statusCode).json({ success: false, error: result.error });
        }

        await conn.commit();
        res.json({
            success: true,
            message: 'Matrícula trancada com sucesso. O acesso aos treinos foi suspenso temporariamente.'
        });
    } catch (err) {
        await conn.rollback();
        console.error('Erro ao trancar matrícula:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao trancar matrícula.' });
    } finally {
        conn.release();
    }
});

// POST /api/planos/matriculas/:id/destrancar - Reativar matrícula trancada (admin e recepcao)
router.post('/:id/destrancar', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const { id } = req.params;

        const result = await MatriculaService.unlockEnrollment(conn, { matriculaId: id });
        if (result.error) {
            await conn.rollback();
            return res.status(result.statusCode).json({ success: false, error: result.error });
        }

        await conn.commit();
        res.json({
            success: true,
            message: 'Matrícula destrancada com sucesso! O acesso do aluno aos treinos foi restabelecido.'
        });
    } catch (err) {
        await conn.rollback();
        console.error('Erro ao destrancar matrícula:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao destrancar matrícula.' });
    } finally {
        conn.release();
    }
});

// POST /api/planos/matriculas/:id/cancelar - Cancelar contrato / matrícula (admin e recepcao)
router.post('/:id/cancelar', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const { id } = req.params;
        const { motivo, cancelar_faturas_abertas = true } = req.body;

        if (!motivo || !String(motivo).trim()) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'O motivo do cancelamento é obrigatório.' });
        }

        const result = await MatriculaService.cancelEnrollment(conn, {
            matriculaId: id,
            motivo: String(motivo),
            cancelarFaturasAbertas: cancelar_faturas_abertas
        });

        if (result.error) {
            await conn.rollback();
            return res.status(result.statusCode).json({ success: false, error: result.error });
        }

        await conn.commit();
        res.json({
            success: true,
            message: 'Matrícula cancelada com sucesso.'
        });
    } catch (err) {
        await conn.rollback();
        console.error('Erro ao cancelar matrícula:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao cancelar matrícula.' });
    } finally {
        conn.release();
    }
});

// POST /api/planos/matriculas/:id/trocar-plano - Upgrade ou Downgrade de plano (admin e recepcao)
router.post('/:id/trocar-plano', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const { id } = req.params;
        const { novo_plano_id, novo_valor_acordado, novo_dia_vencimento, motivo } = req.body;

        if (!novo_plano_id) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'O novo plano é obrigatório.' });
        }

        const result = await MatriculaService.switchEnrollmentPlan(conn, {
            matriculaId: id,
            novoPlanoId: novo_plano_id,
            novoValorAcordado: novo_valor_acordado,
            novoDiaVencimento: novo_dia_vencimento,
            motivo
        });

        if (result.error) {
            await conn.rollback();
            return res.status(result.statusCode).json({ success: false, error: result.error });
        }

        await conn.commit();
        res.json(result.data);
    } catch (err) {
        await conn.rollback();
        console.error('Erro na troca de plano:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao trocar plano.' });
    } finally {
        conn.release();
    }
});

module.exports = router;

