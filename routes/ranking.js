/**
 * PRO COMBATE - Mural de Líderes Saudável (Leaderboards Segmentados)
 * Abas: Assiduidade (últimos 30 dias), Maior Evolução RPG e Top Atributos por Prajied.
 * Respeita privacidade (alunos.exibir_no_ranking = 1) e não expõe dados sensíveis.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db/connection');
const { authenticateToken } = require('../middlewares/auth');
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
        const mapped = parseInt(req.user.aluno_id, 10);
        if (!Number.isNaN(mapped) && mapped > 0) return mapped;
    }
    const q = parseInt(req.query.aluno_id, 10);
    return (!Number.isNaN(q) && q > 0) ? q : null;
}

async function computeLeaderboardPayload(req, currentAlunoId = null) {
    const rawTab = String(req.query.tab || req.query.aba || '').toLowerCase();
    const tab = ['assiduidade', 'evolucao', 'atributos'].includes(rawTab)
        ? rawTab
        : 'assiduidade';

    const requestedAttr = String(req.query.atributo || 'score_total').toLowerCase();
    const attrKey = gamificationService.VALID_RANKING_ATRIBUTOS[requestedAttr] ? requestedAttr : 'score_total';

    // Lista de graduações (Prajieds) disponíveis para o filtro da aba 3
    const [niveisRows] = await pool.query(`
        SELECT gn.id, gn.nome, gn.cor_hex_primaria, gn.cor_hex_secundaria, gn.ordem_hierarquica,
               m.id AS modalidade_id, m.nome AS modalidade_nome
        FROM graduacoes_niveis gn
        JOIN modalidades m ON m.id = gn.modalidade_id
        WHERE m.ativo = 1
        ORDER BY (m.nome LIKE '%Muay%') DESC, gn.ordem_hierarquica ASC
    `);

    const isTodasGraduacoes = String(req.query.graduacao_nivel_id || '').toLowerCase() === 'todas';
    let targetNivelId = null;
    if (!isTodasGraduacoes) {
        const parsedNivel = req.query.graduacao_nivel_id ? parseInt(req.query.graduacao_nivel_id, 10) : null;
        targetNivelId = (parsedNivel && !Number.isNaN(parsedNivel)) ? parsedNivel : null;
        if (!targetNivelId && currentAlunoId) {
            const [curGrad] = await pool.query(`
                SELECT ag.graduacao_nivel_id
                FROM aluno_graduacoes ag
                JOIN modalidades m ON m.id = ag.modalidade_id
                WHERE ag.aluno_id = ? AND ag.atual = 1
                ORDER BY (m.nome LIKE '%Muay%') DESC, ag.id DESC
                LIMIT 1
            `, [currentAlunoId]);
            if (curGrad.length > 0) {
                targetNivelId = Number(curGrad[0].graduacao_nivel_id);
            }
        }
        if (!targetNivelId && niveisRows.length > 0) {
            targetNivelId = Number(niveisRows[0].id);
        }
    }

    // 1. Assiduidade últimos 30 dias (XP ganho em check-ins e atividades nos últimos 30 dias + check-ins aprovados)
    const [assiduidadeRows] = await pool.query(`
        SELECT
            a.id AS aluno_id,
            a.nome_completo,
            a.foto_perfil_url,
            a.xp_total,
            a.streak_semanas,
            a.exibir_no_ranking,
            COALESCE(gn.nome, 'Iniciante') AS nivel_nome,
            COALESCE(gn.cor_hex_primaria, '#94a3b8') AS cor_primaria,
            COALESCE(gn.cor_hex_secundaria, '#0f172a') AS cor_secundaria,
            COALESCE((
                SELECT COUNT(*)
                FROM checkins c
                WHERE c.aluno_id = a.id
                  AND c.status = 'aprovado'
                  AND c.data_hora_checkin >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            ), 0) AS checkins_30d,
            GREATEST(
                COALESCE((
                    SELECT SUM(l.xp_final)
                    FROM aluno_xp_logs l
                    WHERE l.aluno_id = a.id
                      AND l.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                ), 0),
                COALESCE((
                    SELECT SUM(CASE WHEN c2.xp_ganho > 0 THEN c2.xp_ganho WHEN c2.tipo_aula = 'especial' THEN 20 ELSE 10 END)
                    FROM checkins c2
                    WHERE c2.aluno_id = a.id
                      AND c2.status = 'aprovado'
                      AND c2.data_hora_checkin >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                ), 0)
            ) AS xp_30d
        FROM alunos a
        LEFT JOIN aluno_graduacoes ag ON ag.aluno_id = a.id AND ag.atual = 1
        LEFT JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
        WHERE a.deleted_at IS NULL AND a.status = 'ativo'
        GROUP BY a.id, a.nome_completo, a.foto_perfil_url, a.xp_total, a.streak_semanas, a.exibir_no_ranking, gn.nome, gn.cor_hex_primaria, gn.cor_hex_secundaria
    `);
    const assiduidade = gamificationService.rankMonthlyAttendance(assiduidadeRows, currentAlunoId);

    // 2. Maior Evolução (comparativo última vs penúltima avaliação RPG)
    const [rpgEvalRows] = await pool.query(`
        SELECT
            a.id AS aluno_id,
            a.nome_completo,
            a.foto_perfil_url,
            a.xp_total,
            a.streak_semanas,
            a.exibir_no_ranking,
            COALESCE(gn.nome, 'Iniciante') AS nivel_nome,
            COALESCE(gn.cor_hex_primaria, '#94a3b8') AS cor_primaria,
            COALESCE(gn.cor_hex_secundaria, '#0f172a') AS cor_secundaria,
            aad.score_total,
            aad.rank_combate,
            aad.data_avaliacao,
            aad.id AS eval_id
        FROM alunos a
        JOIN aluno_avaliacoes_desempenho aad ON aad.aluno_id = a.id AND aad.modelo_avaliacao = 'rpg'
        LEFT JOIN aluno_graduacoes ag ON ag.aluno_id = a.id AND ag.atual = 1
        LEFT JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
        WHERE a.deleted_at IS NULL AND a.status = 'ativo'
        ORDER BY a.id ASC, aad.data_avaliacao DESC, aad.id DESC
    `);

    const groupedEvals = new Map();
    for (const row of rpgEvalRows) {
        const key = Number(row.aluno_id);
        if (!groupedEvals.has(key)) {
            groupedEvals.set(key, {
                aluno_id: key,
                nome_completo: row.nome_completo,
                foto_perfil_url: row.foto_perfil_url,
                xp_total: row.xp_total,
                streak_semanas: row.streak_semanas,
                exibir_no_ranking: row.exibir_no_ranking,
                nivel_nome: row.nivel_nome,
                cor_primaria: row.cor_primaria,
                cor_secundaria: row.cor_secundaria,
                avaliacoes: []
            });
        }
        groupedEvals.get(key).avaliacoes.push({
            id: row.eval_id,
            score_total: row.score_total,
            rank_combate: row.rank_combate
        });
    }
    const evolucao = gamificationService.rankMostImproved(Array.from(groupedEvals.values()), currentAlunoId);

    // 3. Top Atributos por Graduação (Prajied) — ou geral quando "todas" é selecionado
    let atributosRows = [];
    if (isTodasGraduacoes) {
        const [rawAttrRows] = await pool.query(`
            SELECT
                a.id AS aluno_id,
                a.nome_completo,
                a.foto_perfil_url,
                a.xp_total,
                a.streak_semanas,
                a.exibir_no_ranking,
                COALESCE(MAX(gn.nome), 'Iniciante') AS nivel_nome,
                COALESCE(MAX(gn.cor_hex_primaria), '#94a3b8') AS cor_primaria,
                COALESCE(MAX(gn.cor_hex_secundaria), '#0f172a') AS cor_secundaria,
                aad.score_total,
                aad.score_inteligencia AS inteligencia,
                aad.score_destreza AS destreza,
                aad.score_agilidade AS agilidade,
                aad.score_forca AS forca,
                aad.score_vitalidade AS vitalidade,
                aad.rank_combate
            FROM alunos a
            LEFT JOIN aluno_graduacoes ag ON ag.aluno_id = a.id AND ag.atual = 1
            LEFT JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
            JOIN (
                SELECT x.*
                FROM aluno_avaliacoes_desempenho x
                INNER JOIN (
                    SELECT aluno_id, MAX(id) AS max_id
                    FROM aluno_avaliacoes_desempenho
                    WHERE modelo_avaliacao = 'rpg'
                    GROUP BY aluno_id
                ) ult ON ult.max_id = x.id
            ) aad ON aad.aluno_id = a.id
            WHERE a.deleted_at IS NULL AND a.status = 'ativo'
            GROUP BY a.id, a.nome_completo, a.foto_perfil_url, a.xp_total, a.streak_semanas, a.exibir_no_ranking,
                     aad.score_total, aad.score_inteligencia, aad.score_destreza, aad.score_agilidade,
                     aad.score_forca, aad.score_vitalidade, aad.rank_combate
        `);
        atributosRows = rawAttrRows;
    } else if (targetNivelId) {
        const [rawAttrRows] = await pool.query(`
            SELECT
                a.id AS aluno_id,
                a.nome_completo,
                a.foto_perfil_url,
                a.xp_total,
                a.streak_semanas,
                a.exibir_no_ranking,
                gn.nome AS nivel_nome,
                gn.cor_hex_primaria AS cor_primaria,
                gn.cor_hex_secundaria AS cor_secundaria,
                aad.score_total,
                aad.score_inteligencia AS inteligencia,
                aad.score_destreza AS destreza,
                aad.score_agilidade AS agilidade,
                aad.score_forca AS forca,
                aad.score_vitalidade AS vitalidade,
                aad.rank_combate
            FROM alunos a
            JOIN aluno_graduacoes ag ON ag.aluno_id = a.id AND ag.atual = 1 AND ag.graduacao_nivel_id = ?
            JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
            JOIN (
                SELECT x.*
                FROM aluno_avaliacoes_desempenho x
                INNER JOIN (
                    SELECT aluno_id, MAX(id) AS max_id
                    FROM aluno_avaliacoes_desempenho
                    WHERE modelo_avaliacao = 'rpg'
                    GROUP BY aluno_id
                ) ult ON ult.max_id = x.id
            ) aad ON aad.aluno_id = a.id
            WHERE a.deleted_at IS NULL AND a.status = 'ativo'
        `, [targetNivelId]);
        atributosRows = rawAttrRows;
    }

    const atributos = gamificationService.rankTopAttributesByGrade(atributosRows, attrKey, currentAlunoId);
    const activeBucket = tab === 'evolucao' ? evolucao : (tab === 'atributos' ? atributos : assiduidade);

    let minhaPrivacidade = null;
    if (currentAlunoId) {
        const [privRow] = await pool.query('SELECT exibir_no_ranking, xp_total, streak_semanas FROM alunos WHERE id = ?', [currentAlunoId]);
        if (privRow.length > 0) {
            minhaPrivacidade = {
                exibir_no_ranking: privRow[0].exibir_no_ranking !== 0,
                xp_level: gamificationService.computeLevelFromXp(privRow[0].xp_total || 0),
                streak_semanas: Number(privRow[0].streak_semanas || 0)
            };
        }
    }

    return {
        tab_ativa: tab,
        graduacao_selecionada_id: targetNivelId,
        atributo_selecionado: attrKey,
        niveis_disponiveis: niveisRows,
        atributos_disponiveis: Object.values(gamificationService.VALID_RANKING_ATRIBUTOS),
        top3: activeBucket.top3,
        lista: activeBucket.lista,
        minha_posicao: activeBucket.minha_posicao,
        assiduidade,
        evolucao,
        atributos,
        meu_perfil: minhaPrivacidade
    };
}

// GET /api/ranking (Admin / Professor / Recepção)
adminRouter.get('/', authenticateToken, async (req, res) => {
    try {
        const payload = await computeLeaderboardPayload(req, null);
        res.json({ success: true, data: payload });
    } catch (err) {
        console.error('Erro ao consultar Mural de Líderes (Admin):', err);
        res.status(500).json({ success: false, error: 'Erro interno ao carregar Mural de Líderes.' });
    }
});

// GET /api/aluno/ranking (Portal do Aluno)
alunoRouter.get('/', optionalAuthAluno, async (req, res) => {
    try {
        const alunoId = resolveAlunoId(req);
        if (!alunoId) {
            return res.status(401).json({ success: false, error: 'Sessão de aluno inválida.' });
        }
        const payload = await computeLeaderboardPayload(req, alunoId);
        res.json({ success: true, data: payload });
    } catch (err) {
        console.error('Erro ao consultar Mural de Líderes (Aluno):', err);
        res.status(500).json({ success: false, error: 'Erro interno ao carregar Mural de Líderes.' });
    }
});

module.exports = { adminRouter, alunoRouter };
