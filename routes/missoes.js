/**
 * PRO COMBATE - Rotas de Missões (Quadro de Missões do Professor + Missões Automáticas do Aluno)
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db/connection');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');
const rpgEvaluationService = require('../services/rpgEvaluationService');
const missoesService = require('../services/missoesService');
const gamificationService = require('../services/gamificationService');

const adminRouter = express.Router();
const alunoRouter = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

function optionalAuthAluno(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    if (token && JWT_SECRET) {
        try {
            req.user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        } catch {
            req.user = null;
        }
    }
    if (process.env.NODE_ENV === 'production' && !req.user) {
        return res.status(401).json({ success: false, error: 'Autenticação obrigatória.' });
    }
    next();
}

function resolveAlunoId(req) {
    if (req.user && req.user.cargo === 'aluno') {
        const ownId = parseInt(req.user.aluno_id || req.user.id, 10);
        return (!Number.isNaN(ownId) && ownId > 0) ? ownId : null;
    }
    if (req.user && req.user.aluno_id) {
        const mappedId = parseInt(req.user.aluno_id, 10);
        if (!Number.isNaN(mappedId) && mappedId > 0) return mappedId;
    }
    const rawQueryId = parseInt(req.query.aluno_id, 10);
    if (!Number.isNaN(rawQueryId) && rawQueryId > 0) return rawQueryId;
    return 1;
}

// =========================================================================
// ROTAS ADMIN / PROFESSOR (/api/missoes)
// =========================================================================

// GET /api/missoes - Lista catálogo do Quadro de Missões com contadores de adesão
adminRouter.get('/', authenticateToken, authorizeRoles('admin', 'professor', 'recepcao'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                mq.*,
                m.nome AS modalidade_nome,
                ue.nome AS criador_nome,
                SUM(CASE WHEN am.status = 'em_andamento' THEN 1 ELSE 0 END) AS total_em_andamento,
                SUM(CASE WHEN am.status = 'aguardando_validacao' THEN 1 ELSE 0 END) AS total_aguardando,
                SUM(CASE WHEN am.status = 'concluida' THEN 1 ELSE 0 END) AS total_concluidas
            FROM missoes_quadro mq
            LEFT JOIN modalidades m ON m.id = mq.modalidade_id
            LEFT JOIN usuarios_equipe ue ON ue.id = mq.criado_por
            LEFT JOIN aluno_missoes am ON am.missao_id = mq.id
            GROUP BY mq.id
            ORDER BY mq.ativo DESC, mq.created_at DESC, mq.id DESC
        `);

        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('Erro ao listar quadro de missões:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao listar quadro de missões.' });
    }
});

// POST /api/missoes - Criar missão no Quadro de Missões
adminRouter.post('/', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const parsed = missoesService.validateMissaoPayload(req.body);
        if (!parsed.valid) {
            return res.status(400).json({ success: false, error: parsed.error });
        }
        const d = parsed.data;
        const criadorId = req.user?.id ? Number(req.user.id) : null;

        const [result] = await pool.query(`
            INSERT INTO missoes_quadro (
                titulo, descricao, categoria, dificuldade, pilar_foco, modalidade_id,
                recompensa_xp, recompensa_texto, limite_vagas, prazo_dias, ativo, criado_por
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            d.titulo,
            d.descricao,
            d.categoria,
            d.dificuldade,
            d.pilar_foco,
            d.modalidade_id,
            d.recompensa_xp,
            d.recompensa_texto,
            d.limite_vagas,
            d.prazo_dias,
            d.ativo,
            criadorId
        ]);

        res.status(201).json({
            success: true,
            message: 'Missão criada no quadro com sucesso!',
            id: result.insertId
        });
    } catch (err) {
        console.error('Erro ao criar missão no quadro:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao cadastrar missão.' });
    }
});

// PUT /api/missoes/:id - Editar missão do quadro
adminRouter.put('/:id', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id) || id <= 0) {
            return res.status(400).json({ success: false, error: 'ID de missão inválido.' });
        }

        const parsed = missoesService.validateMissaoPayload(req.body);
        if (!parsed.valid) {
            return res.status(400).json({ success: false, error: parsed.error });
        }
        const d = parsed.data;

        const [result] = await pool.query(`
            UPDATE missoes_quadro SET
                titulo = ?,
                descricao = ?,
                categoria = ?,
                dificuldade = ?,
                pilar_foco = ?,
                modalidade_id = ?,
                recompensa_xp = ?,
                recompensa_texto = ?,
                limite_vagas = ?,
                prazo_dias = ?,
                ativo = ?
            WHERE id = ?
        `, [
            d.titulo,
            d.descricao,
            d.categoria,
            d.dificuldade,
            d.pilar_foco,
            d.modalidade_id,
            d.recompensa_xp,
            d.recompensa_texto,
            d.limite_vagas,
            d.prazo_dias,
            d.ativo,
            id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Missão não encontrada.' });
        }

        res.json({ success: true, message: 'Missão atualizada com sucesso!' });
    } catch (err) {
        console.error('Erro ao atualizar missão:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao atualizar missão.' });
    }
});

// PATCH /api/missoes/:id/toggle - Ativar/Pausar missão no quadro
adminRouter.patch('/:id/toggle', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id) || id <= 0) {
            return res.status(400).json({ success: false, error: 'ID de missão inválido.' });
        }

        const [rows] = await pool.query('SELECT id, ativo FROM missoes_quadro WHERE id = ?', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Missão não encontrada.' });
        }

        const novoStatus = Number(rows[0].ativo) === 1 ? 0 : 1;
        await pool.query('UPDATE missoes_quadro SET ativo = ? WHERE id = ?', [novoStatus, id]);

        res.json({
            success: true,
            ativo: novoStatus,
            message: novoStatus === 1 ? 'Missão ativada no quadro!' : 'Missão pausada no quadro!'
        });
    } catch (err) {
        console.error('Erro ao alternar status da missão:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao alternar status da missão.' });
    }
});

// DELETE /api/missoes/:id - Remover missão do quadro
adminRouter.delete('/:id', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id) || id <= 0) {
            return res.status(400).json({ success: false, error: 'ID de missão inválido.' });
        }

        const [result] = await pool.query('DELETE FROM missoes_quadro WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Missão não encontrada.' });
        }

        res.json({ success: true, message: 'Missão removida do quadro com sucesso!' });
    } catch (err) {
        console.error('Erro ao excluir missão:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao remover missão.' });
    }
});

// GET /api/missoes/inscricoes - Listar solicitações/adesões dos alunos para validação
adminRouter.get('/inscricoes', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const statusFilter = req.query.status ? String(req.query.status).trim().toLowerCase() : 'aguardando_validacao';
        const allowedFilters = ['aguardando_validacao', 'em_andamento', 'concluida', 'cancelada'];

        const params = [];
        let whereClause = "WHERE am.status != 'cancelada'";
        if (statusFilter === 'todas') {
            whereClause = "WHERE am.status != 'cancelada'";
        } else if (allowedFilters.includes(statusFilter)) {
            whereClause = 'WHERE am.status = ?';
            params.push(statusFilter);
        }

        const [rows] = await pool.query(`
            SELECT
                am.*,
                a.nome_completo AS aluno_nome,
                a.foto_perfil_url AS aluno_foto_url,
                mq.titulo AS missao_titulo,
                mq.categoria AS missao_categoria,
                mq.dificuldade AS missao_dificuldade,
                mq.recompensa_xp,
                mq.recompensa_texto,
                ue.nome AS validador_nome
            FROM aluno_missoes am
            JOIN alunos a ON a.id = am.aluno_id AND a.deleted_at IS NULL
            JOIN missoes_quadro mq ON mq.id = am.missao_id
            LEFT JOIN usuarios_equipe ue ON ue.id = am.validado_por
            ${whereClause}
            ORDER BY
                (am.status = 'aguardando_validacao') DESC,
                am.solicitada_conclusao_em DESC,
                am.aceita_em DESC
            LIMIT 100
        `, params);

        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('Erro ao listar validações de missões:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar entregas dos alunos.' });
    }
});

// PATCH /api/missoes/inscricoes/:inscricaoId/validar - Aprovar ou devolver missão ao aluno
adminRouter.patch('/inscricoes/:inscricaoId/validar', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const inscricaoId = parseInt(req.params.inscricaoId, 10);
        if (Number.isNaN(inscricaoId) || inscricaoId <= 0) {
            return res.status(400).json({ success: false, error: 'ID de inscrição inválido.' });
        }

        const acao = req.body?.acao ? String(req.body.acao).trim().toLowerCase() : '';
        if (acao !== 'aprovar' && acao !== 'devolver') {
            return res.status(400).json({ success: false, error: 'Ação inválida. Utilize "aprovar" ou "devolver".' });
        }

        const rawFeedback = typeof req.body?.feedback_professor === 'string' ? req.body.feedback_professor.trim() : '';
        const feedback = rawFeedback ? rawFeedback.slice(0, 300) : null;
        const validadorId = req.user?.id ? Number(req.user.id) : null;

        const [rows] = await pool.query(`
            SELECT am.id, am.aluno_id, am.status, mq.titulo, mq.recompensa_xp
            FROM aluno_missoes am
            JOIN missoes_quadro mq ON mq.id = am.missao_id
            WHERE am.id = ?
        `, [inscricaoId]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Inscrição de missão não encontrada.' });
        }

        const insc = rows[0];

        if (acao === 'aprovar') {
            await pool.query(`
                UPDATE aluno_missoes SET
                    status = 'concluida',
                    concluida_em = NOW(),
                    validado_por = ?,
                    feedback_professor = COALESCE(?, feedback_professor)
                WHERE id = ?
            `, [validadorId, feedback, inscricaoId]);

            let xpAward = null;
            if (insc.status !== 'concluida' && Number(insc.recompensa_xp || 0) > 0) {
                xpAward = await gamificationService.awardXp(pool, {
                    alunoId: insc.aluno_id,
                    origem: 'missao_concluida',
                    referenciaId: insc.id,
                    xpBase: Number(insc.recompensa_xp),
                    multiplicador: 1.0,
                    descricao: `Missão concluída: ${insc.titulo}`
                });
            }

            return res.json({
                success: true,
                xp_ganho: xpAward ? xpAward.xp_final : 0,
                message: xpAward && xpAward.xp_final > 0
                    ? `Missão aprovada e +${xpAward.xp_final} XP liberado para o aluno!`
                    : 'Missão aprovada com sucesso!'
            });
        }

        await pool.query(`
            UPDATE aluno_missoes SET
                status = 'em_andamento',
                solicitada_conclusao_em = NULL,
                validado_por = ?,
                feedback_professor = ?
            WHERE id = ?
        `, [validadorId, feedback || 'Ajuste solicitado pelo professor antes de concluir.', inscricaoId]);

        res.json({ success: true, message: 'Missão devolvida para o aluno com orientações.' });
    } catch (err) {
        console.error('Erro ao validar missão do aluno:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao validar missão.' });
    }
});

// =========================================================================
// ROTAS DO PORTAL DO ALUNO (/api/aluno/missoes)
// =========================================================================

// GET /api/aluno/missoes - Missões Automáticas + Quadro de Missões do Professor + Minhas Missões
alunoRouter.get('/', optionalAuthAluno, async (req, res) => {
    try {
        const alunoId = resolveAlunoId(req);
        if (!alunoId) {
            return res.status(401).json({ success: false, error: 'Sessão de aluno inválida.' });
        }

        // 1. Última avaliação RPG & metas da próxima graduação
        const [rpgRows] = await pool.query(`
            SELECT aad.*
            FROM aluno_avaliacoes_desempenho aad
            WHERE aad.aluno_id = ? AND aad.modelo_avaliacao = 'rpg'
            ORDER BY aad.data_avaliacao DESC, aad.id DESC
            LIMIT 1
        `, [alunoId]);
        const rpgAtual = rpgRows.length > 0 ? rpgEvaluationService.normalizeRpgRow(rpgRows[0]) : null;

        const [grads] = await pool.query(`
            SELECT ag.modalidade_id, gn.id AS nivel_id, gn.nome AS nivel_nome, gn.ordem_hierarquica,
                   gn.porcentagem_minima, m.nome AS modalidade_nome
            FROM aluno_graduacoes ag
            JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
            JOIN modalidades m ON m.id = ag.modalidade_id
            WHERE ag.aluno_id = ? AND ag.atual = 1
            ORDER BY (m.nome LIKE '%Muay%') DESC, ag.id DESC
        `, [alunoId]);

        const gradPrincipal = grads[0] || null;
        const studentModIds = grads.map(g => Number(g.modalidade_id)).filter(Boolean);

        let proximaGrad = null;
        if (gradPrincipal && gradPrincipal.modalidade_id) {
            const [proxRows] = await pool.query(`
                SELECT id AS nivel_id, nome AS nivel_nome, cor_hex_primaria, cor_hex_secundaria,
                       ordem_hierarquica, rpg_rank_minimo, rpg_pontuacao_minima_atributo, rpg_exige_apto_sparring
                FROM graduacoes_niveis
                WHERE modalidade_id = ? AND ordem_hierarquica > ?
                ORDER BY ordem_hierarquica ASC
                LIMIT 1
            `, [gradPrincipal.modalidade_id, gradPrincipal.ordem_hierarquica || 0]);
            if (proxRows.length > 0) proximaGrad = proxRows[0];
        }

        const avaliacaoRpgResumo = {
            atual: rpgAtual,
            requisitos_exame: rpgEvaluationService.evaluateExamProgressionLock(rpgAtual, proximaGrad)
        };

        // 2. Frequência semanal
        const [planoRows] = await pool.query(`
            SELECT p.limite_checkins_semana
            FROM matriculas m
            JOIN planos p ON p.id = m.plano_id
            WHERE m.aluno_id = ? AND m.status = 'ativo'
            ORDER BY m.id DESC
            LIMIT 1
        `, [alunoId]);
        const metaSemana = (planoRows[0] && planoRows[0].limite_checkins_semana)
            ? Number(planoRows[0].limite_checkins_semana)
            : 3;

        const [semRows] = await pool.query(`
            SELECT COUNT(DISTINCT DATE(data_hora_checkin)) AS total_semana
            FROM checkins
            WHERE aluno_id = ? AND status = 'aprovado' AND YEARWEEK(data_hora_checkin, 1) = YEARWEEK(CURDATE(), 1)
        `, [alunoId]);
        const totalSemana = Number(semRows[0]?.total_semana || 0);

        const streakObj = {
            total_semana: totalSemana,
            meta_semana: metaSemana,
            meta_atingida: totalSemana >= metaSemana
        };

        // 3. Prontidão Wiki da faixa atual
        let prontidaoExame = null;
        if (gradPrincipal && gradPrincipal.nivel_id) {
            const [wikiRows] = await pool.query(`
                SELECT
                    COUNT(*) AS total_golpes,
                    SUM(CASE WHEN agp.status = 'dominado' THEN 1 ELSE 0 END) AS golpes_dominados
                FROM graduacao_nivel_golpes gng
                JOIN wiki_golpes wg ON wg.id = gng.golpe_id AND wg.ativo = 1
                LEFT JOIN aluno_golpes_progresso agp ON agp.golpe_id = wg.id AND agp.aluno_id = ?
                WHERE gng.graduacao_nivel_id = ?
            `, [alunoId, gradPrincipal.nivel_id]);

            const totalGolpes = Number(wikiRows[0]?.total_golpes || 0);
            const golpesDominados = Number(wikiRows[0]?.golpes_dominados || 0);
            const metaPct = Number(gradPrincipal.porcentagem_minima || 70);
            const pctProntidao = totalGolpes > 0 ? Math.round((golpesDominados / totalGolpes) * 100) : 0;

            prontidaoExame = {
                total_golpes: totalGolpes,
                golpes_dominados: golpesDominados,
                nivel_nome: gradPrincipal.nivel_nome,
                apto_exame: totalGolpes > 0 && pctProntidao >= metaPct
            };
        }

        const automaticas = missoesService.buildAutomaticMissions({
            avaliacaoRpg: avaliacaoRpgResumo,
            streak: streakObj,
            prontidaoExame
        });

        // 4. Minhas Missões escolhidas do Quadro do Professor
        const [minhasRows] = await pool.query(`
            SELECT
                am.*,
                mq.titulo,
                mq.descricao,
                mq.categoria,
                mq.dificuldade,
                mq.pilar_foco,
                mq.recompensa_xp,
                mq.recompensa_texto,
                mq.prazo_dias,
                mq.ativo AS missao_ativa,
                m.nome AS modalidade_nome,
                ue.nome AS criador_nome,
                uv.nome AS validador_nome
            FROM aluno_missoes am
            JOIN missoes_quadro mq ON mq.id = am.missao_id
            LEFT JOIN modalidades m ON m.id = mq.modalidade_id
            LEFT JOIN usuarios_equipe ue ON ue.id = mq.criado_por
            LEFT JOIN usuarios_equipe uv ON uv.id = am.validado_por
            WHERE am.aluno_id = ? AND am.status != 'cancelada'
            ORDER BY
                FIELD(am.status, 'aguardando_validacao', 'em_andamento', 'concluida'),
                am.updated_at DESC
        `, [alunoId]);

        const enrollmentByMissaoId = new Map(minhasRows.map(r => [Number(r.missao_id), r]));

        // 5. Quadro de Missões Ativas do Professor disponíveis para escolha
        let quadroQuery = `
            SELECT
                mq.*,
                m.nome AS modalidade_nome,
                ue.nome AS criador_nome,
                (
                    SELECT COUNT(*)
                    FROM aluno_missoes am2
                    WHERE am2.missao_id = mq.id
                      AND am2.status IN ('em_andamento', 'aguardando_validacao', 'concluida')
                ) AS vagas_ocupadas
            FROM missoes_quadro mq
            LEFT JOIN modalidades m ON m.id = mq.modalidade_id
            LEFT JOIN usuarios_equipe ue ON ue.id = mq.criado_por
            WHERE mq.ativo = 1
        `;
        const quadroParams = [];
        if (studentModIds.length > 0) {
            const placeholders = studentModIds.map(() => '?').join(', ');
            quadroQuery += ` AND (mq.modalidade_id IS NULL OR mq.modalidade_id IN (${placeholders}))`;
            quadroParams.push(...studentModIds);
        }
        quadroQuery += ` ORDER BY mq.recompensa_xp DESC, mq.created_at DESC`;

        const [quadroRows] = await pool.query(quadroQuery, quadroParams);
        const quadroDisponiveis = quadroRows.map((row) => {
            const insc = enrollmentByMissaoId.get(Number(row.id)) || null;
            return {
                ...row,
                vagas_ocupadas: Number(row.vagas_ocupadas || 0),
                meu_status: insc ? insc.status : null
            };
        });

        const ativasList = minhasRows.filter(r => r.status === 'em_andamento' || r.status === 'aguardando_validacao');
        const concluidasList = minhasRows.filter(r => r.status === 'concluida');
        const xpTotal = concluidasList.reduce((sum, r) => sum + Number(r.recompensa_xp || 0), 0);

        res.json({
            success: true,
            data: {
                foco_rpg: rpgAtual ? rpgAtual.foco_evolucao : null,
                automaticas,
                minhas_missoes: minhasRows,
                quadro_disponiveis: quadroDisponiveis,
                resumo: {
                    ativas_count: ativasList.length,
                    limite_ativas: missoesService.MAX_MISSOES_ATIVAS_ALUNO,
                    aguardando_count: minhasRows.filter(r => r.status === 'aguardando_validacao').length,
                    concluidas_count: concluidasList.length,
                    xp_total: xpTotal
                }
            }
        });
    } catch (err) {
        console.error('Erro ao carregar missões do aluno:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar missões do aluno.' });
    }
});

// POST /api/aluno/missoes/:missaoId/aceitar - Escolher/Aceitar missão do quadro
alunoRouter.post('/:missaoId/aceitar', optionalAuthAluno, async (req, res) => {
    try {
        const alunoId = resolveAlunoId(req);
        if (!alunoId) {
            return res.status(401).json({ success: false, error: 'Sessão de aluno inválida.' });
        }

        const missaoId = parseInt(req.params.missaoId, 10);
        if (Number.isNaN(missaoId) || missaoId <= 0) {
            return res.status(400).json({ success: false, error: 'ID de missão inválido.' });
        }

        const [missaoRows] = await pool.query('SELECT * FROM missoes_quadro WHERE id = ?', [missaoId]);
        const missao = missaoRows[0] || null;

        const [activeRows] = await pool.query(`
            SELECT COUNT(*) AS total
            FROM aluno_missoes
            WHERE aluno_id = ? AND status IN ('em_andamento', 'aguardando_validacao')
        `, [alunoId]);
        const activeCount = Number(activeRows[0]?.total || 0);

        const [enrollRows] = await pool.query(
            'SELECT * FROM aluno_missoes WHERE aluno_id = ? AND missao_id = ?',
            [alunoId, missaoId]
        );
        const currentEnrollment = enrollRows[0] || null;

        const [slotsRows] = await pool.query(`
            SELECT COUNT(*) AS total
            FROM aluno_missoes
            WHERE missao_id = ? AND status IN ('em_andamento', 'aguardando_validacao', 'concluida')
        `, [missaoId]);
        const totalAceites = Number(slotsRows[0]?.total || 0);

        const check = missoesService.canStudentAcceptMission({
            missao,
            activeCount,
            currentEnrollment,
            totalAceites
        });
        if (!check.allowed) {
            return res.status(400).json({ success: false, error: check.error });
        }

        await pool.query(`
            INSERT INTO aluno_missoes (aluno_id, missao_id, status, aceita_em)
            VALUES (?, ?, 'em_andamento', NOW())
            ON DUPLICATE KEY UPDATE
                status = 'em_andamento',
                nota_aluno = NULL,
                feedback_professor = NULL,
                validado_por = NULL,
                aceita_em = NOW(),
                solicitada_conclusao_em = NULL,
                concluida_em = NULL
        `, [alunoId, missaoId]);

        res.json({
            success: true,
            message: `Missão "${missao.titulo}" adicionada às suas missões ativas!`
        });
    } catch (err) {
        console.error('Erro ao aceitar missão:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao aceitar missão.' });
    }
});

// POST /api/aluno/missoes/:missaoId/concluir - Solicitar validação de conclusão ao professor
alunoRouter.post('/:missaoId/concluir', optionalAuthAluno, async (req, res) => {
    try {
        const alunoId = resolveAlunoId(req);
        if (!alunoId) {
            return res.status(401).json({ success: false, error: 'Sessão de aluno inválida.' });
        }

        const missaoId = parseInt(req.params.missaoId, 10);
        if (Number.isNaN(missaoId) || missaoId <= 0) {
            return res.status(400).json({ success: false, error: 'ID de missão inválido.' });
        }

        const rawNota = typeof req.body?.nota_aluno === 'string' ? req.body.nota_aluno.trim() : '';
        const notaAluno = rawNota ? rawNota.slice(0, 300) : null;

        const [rows] = await pool.query(
            'SELECT id, status FROM aluno_missoes WHERE aluno_id = ? AND missao_id = ?',
            [alunoId, missaoId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Missão não encontrada nas suas missões.' });
        }
        if (rows[0].status !== 'em_andamento') {
            return res.status(400).json({ success: false, error: 'Apenas missões em andamento podem ser enviadas para validação.' });
        }

        await pool.query(`
            UPDATE aluno_missoes SET
                status = 'aguardando_validacao',
                nota_aluno = ?,
                solicitada_conclusao_em = NOW()
            WHERE id = ?
        `, [notaAluno, rows[0].id]);

        res.json({
            success: true,
            message: 'Conclusão enviada! Aguarde a validação do professor no tatame.'
        });
    } catch (err) {
        console.error('Erro ao enviar conclusão de missão:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao enviar conclusão.' });
    }
});

// DELETE /api/aluno/missoes/:missaoId/abandonar - Cancelar participação em missão ativa
alunoRouter.delete('/:missaoId/abandonar', optionalAuthAluno, async (req, res) => {
    try {
        const alunoId = resolveAlunoId(req);
        if (!alunoId) {
            return res.status(401).json({ success: false, error: 'Sessão de aluno inválida.' });
        }

        const missaoId = parseInt(req.params.missaoId, 10);
        if (Number.isNaN(missaoId) || missaoId <= 0) {
            return res.status(400).json({ success: false, error: 'ID de missão inválido.' });
        }

        const [result] = await pool.query(`
            UPDATE aluno_missoes
            SET status = 'cancelada'
            WHERE aluno_id = ? AND missao_id = ? AND status IN ('em_andamento', 'aguardando_validacao')
        `, [alunoId, missaoId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Missão ativa não encontrada para abandonar.' });
        }

        res.json({ success: true, message: 'Você saiu desta missão. A vaga foi liberada!' });
    } catch (err) {
        console.error('Erro ao abandonar missão:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao abandonar missão.' });
    }
});

module.exports = { adminRouter, alunoRouter };
