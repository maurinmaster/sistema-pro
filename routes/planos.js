const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');
const matriculasRoutes = require('./matriculas');

// Sub-roteador dedicado para ciclo de vida de matrículas (/api/planos/matriculas/*)
router.use('/matriculas', matriculasRoutes);

// GET /api/planos - Listar planos comerciais com modalidades inclusas
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { todos } = req.query;
        let whereClause = 'WHERE p.ativo = 1';
        if (todos === 'true' || todos === '1') {
            whereClause = '';
        }

        const [planos] = await pool.query(`
            SELECT 
                p.id, p.nome, p.descricao, p.valor_mensal, 
                p.periodicidade_meses, p.limite_checkins_semana, 
                p.tolerancia_inadimplencia_dias, p.ativo, p.created_at,
                GROUP_CONCAT(DISTINCT m.nome ORDER BY m.nome SEPARATOR ', ') AS modalidades_nomes,
                GROUP_CONCAT(DISTINCT pm.modalidade_id SEPARATOR ',') AS modalidades_ids,
                (
                    SELECT COUNT(*) 
                    FROM matriculas mat 
                    WHERE mat.plano_id = p.id AND mat.status = 'ativa'
                ) AS total_alunos_ativos
            FROM planos p
            LEFT JOIN planos_modalidades pm ON pm.plano_id = p.id
            LEFT JOIN modalidades m ON m.id = pm.modalidade_id
            ${whereClause}
            GROUP BY p.id
            ORDER BY p.ativo DESC, p.valor_mensal ASC
        `);

        // Formata modalidades_ids em array numérico
        const formatados = planos.map(p => ({
            ...p,
            modalidades_ids: p.modalidades_ids ? p.modalidades_ids.split(',').map(Number) : []
        }));

        res.json({ success: true, count: formatados.length, data: formatados });
    } catch (err) {
        console.error('Erro ao listar planos:', err);
        res.status(500).json({ success: false, error: 'Erro ao listar planos.' });
    }
});

// POST /api/planos - Criar novo plano comercial (admin e recepcao)
router.post('/', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const {
            nome,
            descricao,
            valor_mensal,
            periodicidade_meses = 1,
            limite_checkins_semana = null,
            tolerancia_inadimplencia_dias = 5,
            ativo = 1,
            modalidades_ids = []
        } = req.body;

        if (!nome || !valor_mensal) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'Nome do plano e valor mensal são obrigatórios.' });
        }

        const valor = parseFloat(valor_mensal);
        if (isNaN(valor) || valor <= 0) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'Valor mensal inválido.' });
        }

        const [result] = await conn.query(`
            INSERT INTO planos (
                nome, descricao, valor_mensal, periodicidade_meses,
                limite_checkins_semana, tolerancia_inadimplencia_dias, ativo
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            nome.trim(),
            descricao ? descricao.trim() : null,
            valor,
            parseInt(periodicidade_meses, 10) || 1,
            limite_checkins_semana ? parseInt(limite_checkins_semana, 10) : null,
            parseInt(tolerancia_inadimplencia_dias, 10) || 5,
            ativo ? 1 : 0
        ]);

        const planoId = result.insertId;

        // Vínculo com modalidades na tabela planos_modalidades
        if (Array.isArray(modalidades_ids) && modalidades_ids.length > 0) {
            const values = modalidades_ids.map(mid => [planoId, parseInt(mid, 10)]);
            await conn.query('INSERT INTO planos_modalidades (plano_id, modalidade_id) VALUES ?', [values]);
        }

        await conn.commit();
        res.status(201).json({
            success: true,
            message: 'Plano comercial cadastrado com sucesso!',
            planoId
        });
    } catch (err) {
        await conn.rollback();
        console.error('Erro ao cadastrar plano:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao cadastrar plano comercial.' });
    } finally {
        conn.release();
    }
});

// PUT /api/planos/:id - Atualizar plano comercial (admin e recepcao)
router.put('/:id', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const { id } = req.params;
        const {
            nome,
            descricao,
            valor_mensal,
            periodicidade_meses = 1,
            limite_checkins_semana = null,
            tolerancia_inadimplencia_dias = 5,
            ativo = 1,
            modalidades_ids = []
        } = req.body;

        const [existe] = await conn.query('SELECT id FROM planos WHERE id = ?', [id]);
        if (existe.length === 0) {
            await conn.rollback();
            return res.status(404).json({ success: false, error: 'Plano não encontrado.' });
        }

        if (!nome || !valor_mensal) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'Nome do plano e valor mensal são obrigatórios.' });
        }

        const valor = parseFloat(valor_mensal);
        if (isNaN(valor) || valor <= 0) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'Valor mensal inválido.' });
        }

        await conn.query(`
            UPDATE planos SET
                nome = ?,
                descricao = ?,
                valor_mensal = ?,
                periodicidade_meses = ?,
                limite_checkins_semana = ?,
                tolerancia_inadimplencia_dias = ?,
                ativo = ?
            WHERE id = ?
        `, [
            nome.trim(),
            descricao ? descricao.trim() : null,
            valor,
            parseInt(periodicidade_meses, 10) || 1,
            limite_checkins_semana ? parseInt(limite_checkins_semana, 10) : null,
            parseInt(tolerancia_inadimplencia_dias, 10) || 5,
            ativo ? 1 : 0,
            id
        ]);

        // Atualiza modalidades vinculadas
        await conn.query('DELETE FROM planos_modalidades WHERE plano_id = ?', [id]);
        if (Array.isArray(modalidades_ids) && modalidades_ids.length > 0) {
            const values = modalidades_ids.map(mid => [id, parseInt(mid, 10)]);
            await conn.query('INSERT INTO planos_modalidades (plano_id, modalidade_id) VALUES ?', [values]);
        }

        await conn.commit();
        res.json({ success: true, message: 'Plano comercial atualizado com sucesso!' });
    } catch (err) {
        await conn.rollback();
        console.error('Erro ao atualizar plano:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao atualizar plano.' });
    } finally {
        conn.release();
    }
});

// PATCH /api/planos/:id/status - Alternar status ativo/inativo
router.patch('/:id/status', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        const { id } = req.params;
        const [planos] = await pool.query('SELECT id, ativo FROM planos WHERE id = ?', [id]);
        if (planos.length === 0) {
            return res.status(404).json({ success: false, error: 'Plano não encontrado.' });
        }

        const novoStatus = planos[0].ativo ? 0 : 1;
        await pool.query('UPDATE planos SET ativo = ? WHERE id = ?', [novoStatus, id]);

        res.json({
            success: true,
            message: `Plano ${novoStatus ? 'ativado' : 'inativado'} com sucesso!`,
            ativo: novoStatus
        });
    } catch (err) {
        console.error('Erro ao alternar status do plano:', err);
        res.status(500).json({ success: false, error: 'Erro ao alterar status do plano.' });
    }
});

// DELETE /api/planos/:id - Excluir plano comercial (apenas se não houver matrículas)
router.delete('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const { id } = req.params;

        const [planos] = await conn.query('SELECT id, nome FROM planos WHERE id = ?', [id]);
        if (planos.length === 0) {
            await conn.rollback();
            return res.status(404).json({ success: false, error: 'Plano não encontrado.' });
        }

        // Verifica matrículas vinculadas
        const [matriculas] = await conn.query('SELECT COUNT(*) AS total FROM matriculas WHERE plano_id = ?', [id]);
        if (matriculas[0].total > 0) {
            await conn.rollback();
            return res.status(400).json({
                success: false,
                error: `Não é possível excluir o plano "${planos[0].nome}" pois existem ${matriculas[0].total} matrícula(s) associada(s). Recomendamos inativá-lo.`
            });
        }

        // Deleta vínculos e o plano
        await conn.query('DELETE FROM planos_modalidades WHERE plano_id = ?', [id]);
        await conn.query('DELETE FROM planos WHERE id = ?', [id]);

        await conn.commit();
        res.json({ success: true, message: `Plano "${planos[0].nome}" excluído com sucesso!` });
    } catch (err) {
        await conn.rollback();
        console.error('Erro ao excluir plano:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao excluir plano.' });
    } finally {
        conn.release();
    }
});

module.exports = router;
