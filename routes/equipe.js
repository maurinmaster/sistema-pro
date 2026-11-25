/**
 * PRO COMBATE - Rotas de Gestão de Professores e Equipe (Admin)
 * CRUD seguro para cadastro de professores avaliadores, administradores e recepção.
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/connection');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');

const ALLOWED_ROLES = ['professor', 'admin', 'recepcao'];

/**
 * Valida e normaliza payload de criação/edição de membro da equipe.
 *
 * @param {object} body
 * @param {object} options
 * @returns {{ valid: boolean, error?: string, data?: object }}
 */
function validateTeamMemberPayload(body = {}, { isCreate = true } = {}) {
    const rawNome = typeof body.nome === 'string' ? body.nome.trim() : '';
    if (rawNome.length < 2 || rawNome.length > 120) {
        return { valid: false, error: 'O nome deve ter entre 2 e 120 caracteres.' };
    }

    const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!rawEmail || rawEmail.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        return { valid: false, error: 'Informe um e-mail válido (até 120 caracteres).' };
    }

    const cargoRaw = body.cargo !== undefined && body.cargo !== null && String(body.cargo).trim() !== ''
        ? String(body.cargo).trim().toLowerCase()
        : 'professor';
    if (!ALLOWED_ROLES.includes(cargoRaw)) {
        return { valid: false, error: 'Cargo inválido. Utilize professor, admin ou recepcao.' };
    }

    const rawTelefone = typeof body.telefone === 'string' ? body.telefone.trim() : '';
    if (rawTelefone.length > 20) {
        return { valid: false, error: 'O telefone deve ter no máximo 20 caracteres.' };
    }
    const telefone = rawTelefone || null;

    let ativo = 1;
    if (body.ativo !== undefined && body.ativo !== null) {
        ativo = (body.ativo === false || body.ativo === 0 || body.ativo === '0' || body.ativo === 'false') ? 0 : 1;
    }

    const rawSenhaInput = isCreate
        ? body.senha
        : (body.nova_senha !== undefined ? body.nova_senha : body.senha);
    const senhaStr = typeof rawSenhaInput === 'string' ? rawSenhaInput.trim() : '';

    if (isCreate) {
        if (senhaStr.length < 6 || senhaStr.length > 128) {
            return { valid: false, error: 'A senha inicial é obrigatória e deve ter entre 6 e 128 caracteres.' };
        }
    } else if (senhaStr.length > 0 && (senhaStr.length < 6 || senhaStr.length > 128)) {
        return { valid: false, error: 'A nova senha deve ter entre 6 e 128 caracteres.' };
    }

    return {
        valid: true,
        data: {
            nome: rawNome,
            email: rawEmail,
            cargo: cargoRaw,
            telefone,
            ativo,
            senha: senhaStr || null
        }
    };
}

/**
 * Impede que um administrador exclua/desative a própria conta ou remova o último admin ativo.
 *
 * @param {object} params
 * @returns {{ allowed: boolean, error?: string }}
 */
function checkAdminSafetyGuard({
    targetId,
    actorId,
    targetCurrentCargo,
    targetCurrentAtivo,
    nextCargo,
    nextAtivo,
    activeAdminsCount,
    isDelete = false
}) {
    const isSelf = Number(targetId) > 0 && Number(targetId) === Number(actorId);
    const willBeActiveAdmin = !isDelete && String(nextCargo) === 'admin' && Boolean(Number(nextAtivo));

    if (isSelf && !willBeActiveAdmin) {
        return {
            allowed: false,
            error: 'Você não pode excluir, desativar ou remover privilégios de administrador da própria conta.'
        };
    }

    const isCurrentlyActiveAdmin = String(targetCurrentCargo) === 'admin' && Boolean(Number(targetCurrentAtivo));
    if (isCurrentlyActiveAdmin && !willBeActiveAdmin && Number(activeAdminsCount) <= 1) {
        return {
            allowed: false,
            error: 'Não é possível remover ou desativar o último administrador ativo do sistema.'
        };
    }

    return { allowed: true };
}

// GET /api/equipe - Listar membros da equipe e resumo (exclusivo admin)
router.get('/', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const busca = typeof req.query.busca === 'string' ? req.query.busca.trim() : '';
        const cargo = typeof req.query.cargo === 'string' ? req.query.cargo.trim().toLowerCase() : '';
        const status = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';

        let sql = `
            SELECT
                ue.id,
                ue.nome,
                ue.email,
                ue.cargo,
                ue.telefone,
                ue.ativo,
                ue.created_at,
                ue.updated_at,
                (SELECT COUNT(*) FROM aluno_graduacoes ag WHERE ag.professor_avaliador_id = ue.id) AS total_graduacoes_avaliadas,
                (SELECT COUNT(*) FROM aluno_avaliacoes_desempenho aad WHERE aad.professor_id = ue.id) AS total_avaliacoes_rpg
            FROM usuarios_equipe ue
            WHERE 1=1
        `;
        const params = [];

        if (busca) {
            sql += ' AND (ue.nome LIKE ? OR ue.email LIKE ? OR ue.telefone LIKE ?)';
            const like = `%${busca}%`;
            params.push(like, like, like);
        }

        if (ALLOWED_ROLES.includes(cargo)) {
            sql += ' AND ue.cargo = ?';
            params.push(cargo);
        }

        if (status === 'ativo') {
            sql += ' AND ue.ativo = 1';
        } else if (status === 'inativo') {
            sql += ' AND ue.ativo = 0';
        }

        sql += ' ORDER BY ue.ativo DESC, (ue.cargo = "professor") DESC, ue.nome ASC';

        const [rows] = await pool.query(sql, params);
        const [summaryRows] = await pool.query(`
            SELECT
                COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN ativo = 1 THEN 1 ELSE 0 END), 0) AS ativos,
                COALESCE(SUM(CASE WHEN ativo = 0 THEN 1 ELSE 0 END), 0) AS inativos,
                COALESCE(SUM(CASE WHEN ativo = 1 AND cargo = 'professor' THEN 1 ELSE 0 END), 0) AS professores_ativos,
                COALESCE(SUM(CASE WHEN ativo = 1 AND cargo = 'admin' THEN 1 ELSE 0 END), 0) AS admins_ativos,
                COALESCE(SUM(CASE WHEN ativo = 1 AND cargo = 'recepcao' THEN 1 ELSE 0 END), 0) AS recepcao_ativos
            FROM usuarios_equipe
        `);

        const s = summaryRows[0] || {};
        res.json({
            success: true,
            data: rows,
            resumo: {
                total: Number(s.total || 0),
                ativos: Number(s.ativos || 0),
                inativos: Number(s.inativos || 0),
                professores_ativos: Number(s.professores_ativos || 0),
                admins_ativos: Number(s.admins_ativos || 0),
                recepcao_ativos: Number(s.recepcao_ativos || 0)
            }
        });
    } catch (err) {
        console.error('Erro ao listar membros da equipe:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar professores e equipe.' });
    }
});

// POST /api/equipe - Cadastrar novo professor ou membro da equipe (exclusivo admin)
router.post('/', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const validation = validateTeamMemberPayload(req.body || {}, { isCreate: true });
        if (!validation.valid) {
            return res.status(400).json({ success: false, error: validation.error });
        }

        const { nome, email, cargo, telefone, ativo, senha } = validation.data;

        const [dup] = await pool.query(
            'SELECT id FROM usuarios_equipe WHERE email = ? LIMIT 1',
            [email]
        );
        if (dup.length > 0) {
            return res.status(409).json({ success: false, error: 'Já existe um membro cadastrado com este e-mail.' });
        }

        const senhaHash = await bcrypt.hash(senha, 10);
        const [insertRes] = await pool.query(`
            INSERT INTO usuarios_equipe (nome, email, senha_hash, cargo, telefone, ativo)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [nome, email, senhaHash, cargo, telefone, ativo]);

        res.status(201).json({
            success: true,
            message: `Cadastro de "${nome}" criado com sucesso!`,
            data: {
                id: insertRes.insertId,
                nome,
                email,
                cargo,
                telefone,
                ativo: Boolean(ativo)
            }
        });
    } catch (err) {
        console.error('Erro ao cadastrar membro da equipe:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, error: 'Já existe um membro cadastrado com este e-mail.' });
        }
        res.status(500).json({ success: false, error: 'Erro interno ao cadastrar membro da equipe.' });
    }
});

// PUT /api/equipe/:id - Atualizar membro da equipe (exclusivo admin)
router.put('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const memberId = parseInt(req.params.id, 10);
        if (!Number.isInteger(memberId) || memberId <= 0) {
            return res.status(400).json({ success: false, error: 'ID inválido.' });
        }

        const [existingRows] = await pool.query(
            'SELECT id, cargo, ativo FROM usuarios_equipe WHERE id = ? LIMIT 1',
            [memberId]
        );
        if (existingRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Membro da equipe não encontrado.' });
        }
        const currentMember = existingRows[0];

        const validation = validateTeamMemberPayload(req.body || {}, { isCreate: false });
        if (!validation.valid) {
            return res.status(400).json({ success: false, error: validation.error });
        }
        const { nome, email, cargo, telefone, ativo, senha } = validation.data;

        const [adminCountRows] = await pool.query(
            "SELECT COUNT(*) AS total FROM usuarios_equipe WHERE cargo = 'admin' AND ativo = 1"
        );
        const guard = checkAdminSafetyGuard({
            targetId: memberId,
            actorId: req.user?.id,
            targetCurrentCargo: currentMember.cargo,
            targetCurrentAtivo: currentMember.ativo,
            nextCargo: cargo,
            nextAtivo: ativo,
            activeAdminsCount: Number(adminCountRows[0]?.total || 0),
            isDelete: false
        });
        if (!guard.allowed) {
            return res.status(400).json({ success: false, error: guard.error });
        }

        const [dup] = await pool.query(
            'SELECT id FROM usuarios_equipe WHERE email = ? AND id != ? LIMIT 1',
            [email, memberId]
        );
        if (dup.length > 0) {
            return res.status(409).json({ success: false, error: 'Este e-mail já está em uso por outro membro da equipe.' });
        }

        if (senha) {
            const senhaHash = await bcrypt.hash(senha, 10);
            await pool.query(`
                UPDATE usuarios_equipe
                SET nome = ?, email = ?, cargo = ?, telefone = ?, ativo = ?, senha_hash = ?
                WHERE id = ?
            `, [nome, email, cargo, telefone, ativo, senhaHash, memberId]);
        } else {
            await pool.query(`
                UPDATE usuarios_equipe
                SET nome = ?, email = ?, cargo = ?, telefone = ?, ativo = ?
                WHERE id = ?
            `, [nome, email, cargo, telefone, ativo, memberId]);
        }

        res.json({
            success: true,
            message: `Cadastro de "${nome}" atualizado com sucesso!`
        });
    } catch (err) {
        console.error('Erro ao atualizar membro da equipe:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, error: 'Este e-mail já está em uso por outro membro da equipe.' });
        }
        res.status(500).json({ success: false, error: 'Erro interno ao atualizar membro da equipe.' });
    }
});

// PATCH /api/equipe/:id/status - Ativar ou desativar membro da equipe (exclusivo admin)
router.patch('/:id/status', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const memberId = parseInt(req.params.id, 10);
        if (!Number.isInteger(memberId) || memberId <= 0) {
            return res.status(400).json({ success: false, error: 'ID inválido.' });
        }

        const rawAtivo = req.body?.ativo;
        if (rawAtivo === undefined || rawAtivo === null) {
            return res.status(400).json({ success: false, error: 'Informe o novo status (ativo).' });
        }
        const nextAtivo = (rawAtivo === true || rawAtivo === 1 || rawAtivo === '1' || rawAtivo === 'true') ? 1 : 0;

        const [existingRows] = await pool.query(
            'SELECT id, nome, cargo, ativo FROM usuarios_equipe WHERE id = ? LIMIT 1',
            [memberId]
        );
        if (existingRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Membro da equipe não encontrado.' });
        }
        const currentMember = existingRows[0];

        const [adminCountRows] = await pool.query(
            "SELECT COUNT(*) AS total FROM usuarios_equipe WHERE cargo = 'admin' AND ativo = 1"
        );
        const guard = checkAdminSafetyGuard({
            targetId: memberId,
            actorId: req.user?.id,
            targetCurrentCargo: currentMember.cargo,
            targetCurrentAtivo: currentMember.ativo,
            nextCargo: currentMember.cargo,
            nextAtivo,
            activeAdminsCount: Number(adminCountRows[0]?.total || 0),
            isDelete: false
        });
        if (!guard.allowed) {
            return res.status(400).json({ success: false, error: guard.error });
        }

        await pool.query('UPDATE usuarios_equipe SET ativo = ? WHERE id = ?', [nextAtivo, memberId]);

        res.json({
            success: true,
            message: nextAtivo
                ? `"${currentMember.nome}" reativado com sucesso!`
                : `"${currentMember.nome}" desativado com sucesso.`
        });
    } catch (err) {
        console.error('Erro ao alterar status do membro da equipe:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao alterar status.' });
    }
});

// DELETE /api/equipe/:id - Remover membro da equipe (preserva histórico com ON DELETE SET NULL)
router.delete('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const memberId = parseInt(req.params.id, 10);
        if (!Number.isInteger(memberId) || memberId <= 0) {
            return res.status(400).json({ success: false, error: 'ID inválido.' });
        }

        const [existingRows] = await pool.query(
            'SELECT id, nome, cargo, ativo FROM usuarios_equipe WHERE id = ? LIMIT 1',
            [memberId]
        );
        if (existingRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Membro da equipe não encontrado.' });
        }
        const currentMember = existingRows[0];

        const [adminCountRows] = await pool.query(
            "SELECT COUNT(*) AS total FROM usuarios_equipe WHERE cargo = 'admin' AND ativo = 1"
        );
        const guard = checkAdminSafetyGuard({
            targetId: memberId,
            actorId: req.user?.id,
            targetCurrentCargo: currentMember.cargo,
            targetCurrentAtivo: currentMember.ativo,
            nextCargo: currentMember.cargo,
            nextAtivo: 0,
            activeAdminsCount: Number(adminCountRows[0]?.total || 0),
            isDelete: true
        });
        if (!guard.allowed) {
            return res.status(400).json({ success: false, error: guard.error });
        }

        await pool.query('DELETE FROM usuarios_equipe WHERE id = ?', [memberId]);

        res.json({
            success: true,
            message: `Cadastro de "${currentMember.nome}" excluído com sucesso. Registros históricos foram preservados.`
        });
    } catch (err) {
        console.error('Erro ao excluir membro da equipe:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao excluir cadastro da equipe.' });
    }
});

router.validateTeamMemberPayload = validateTeamMemberPayload;
router.checkAdminSafetyGuard = checkAdminSafetyGuard;

module.exports = router;
