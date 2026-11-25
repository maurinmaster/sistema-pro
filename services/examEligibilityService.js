/**
 * PRO COMBATE - Motor Unificado de Elegibilidade para Exames de Graduação
 * Fonte única de verdade para cálculo de próxima graduação, avaliação de aptidão
 * (Avaliação RPG + Avaliação Formal de Graduação + Wiki de Golpes) e detecção de divergências.
 */

const rpgEvaluationService = require('./rpgEvaluationService');

/**
 * Encontra o próximo nível hierárquico dentro de uma modalidade.
 * Corrige o bug de `ordem_atual + 1`, tolerando lacunas ou reordenações na hierarquia.
 *
 * @param {Array<object>} levelsForModality
 * @param {number} currentOrder
 * @returns {object|null}
 */
function findNextLevel(levelsForModality, currentOrder) {
    if (!Array.isArray(levelsForModality) || levelsForModality.length === 0) {
        return null;
    }

    const orderNum = Number(currentOrder);
    if (!Number.isFinite(orderNum)) {
        return null;
    }

    const candidates = levelsForModality
        .filter((lvl) => Number(lvl.ordem_hierarquica) > orderNum)
        .sort((a, b) => Number(a.ordem_hierarquica) - Number(b.ordem_hierarquica));

    return candidates.length > 0 ? candidates[0] : null;
}

/**
 * Encontra o nível imediatamente inferior dentro de uma modalidade.
 *
 * @param {Array<object>} levelsForModality
 * @param {number} currentOrder
 * @returns {object|null}
 */
function findPreviousLevel(levelsForModality, currentOrder) {
    if (!Array.isArray(levelsForModality) || levelsForModality.length === 0) {
        return null;
    }

    const orderNum = Number(currentOrder);
    if (!Number.isFinite(orderNum)) {
        return null;
    }

    const candidates = levelsForModality
        .filter((lvl) => Number(lvl.ordem_hierarquica) < orderNum)
        .sort((a, b) => Number(b.ordem_hierarquica) - Number(a.ordem_hierarquica));

    return candidates.length > 0 ? candidates[0] : null;
}

/**
 * Resolve de forma determinística o plano para retroceder uma graduação aprovada por engano.
 * Prioriza restaurar o registro imediatamente anterior no histórico (modo `restore_history`)
 * e, se houver apenas um registro acima do nível inicial, desce um nível na hierarquia (modo `step_down_level`).
 *
 * @param {object} params
 * @returns {object}
 */
function resolveGraduationRollbackPlan({ historyForModality = [], levelsForModality = [] }) {
    if (!Array.isArray(historyForModality) || historyForModality.length === 0) {
        return {
            allowed: false,
            error: 'O aluno não possui graduação ativa nesta modalidade.'
        };
    }

    const sorted = [...historyForModality].sort((a, b) => {
        const atualDiff = (Number(b.atual) ? 1 : 0) - (Number(a.atual) ? 1 : 0);
        if (atualDiff !== 0) return atualDiff;
        const dateA = a.data_graduacao ? new Date(a.data_graduacao).getTime() : 0;
        const dateB = b.data_graduacao ? new Date(b.data_graduacao).getTime() : 0;
        if (dateB !== dateA) return dateB - dateA;
        return Number(b.id || 0) - Number(a.id || 0);
    });

    const current = sorted.find((g) => Number(g.atual) === 1 || g.atual === true);
    if (!current) {
        return {
            allowed: false,
            error: 'O aluno não possui graduação ativa nesta modalidade.'
        };
    }

    const fromLevel = {
        id: Number(current.graduacao_nivel_id),
        nome: current.nivel_nome || 'Graduação Atual',
        ordem_hierarquica: Number(current.ordem_hierarquica)
    };

    const previous = sorted.find((g) => Number(g.id) !== Number(current.id));
    if (previous) {
        return {
            allowed: true,
            mode: 'restore_history',
            deleteGradId: Number(current.id),
            restoreGradId: Number(previous.id),
            fromLevel,
            toLevel: {
                id: Number(previous.graduacao_nivel_id),
                nome: previous.nivel_nome || 'Graduação Anterior',
                ordem_hierarquica: Number(previous.ordem_hierarquica),
                cor_hex_primaria: previous.cor_hex_primaria || null,
                cor_hex_secundaria: previous.cor_hex_secundaria || null
            }
        };
    }

    const prevLevel = findPreviousLevel(levelsForModality, current.ordem_hierarquica);
    if (prevLevel) {
        return {
            allowed: true,
            mode: 'step_down_level',
            updateGradId: Number(current.id),
            targetLevelId: Number(prevLevel.id),
            fromLevel,
            toLevel: {
                id: Number(prevLevel.id),
                nome: prevLevel.nome || 'Graduação Anterior',
                ordem_hierarquica: Number(prevLevel.ordem_hierarquica),
                cor_hex_primaria: prevLevel.cor_hex_primaria || null,
                cor_hex_secundaria: prevLevel.cor_hex_secundaria || null
            }
        };
    }

    return {
        allowed: false,
        error: 'Este aluno já está na graduação inicial desta modalidade e não possui histórico anterior para retroceder.'
    };
}

/**
 * Detecta conflitos ou divergências entre a graduação registrada em um convite
 * e a graduação ativa real do aluno no momento.
 *
 * @param {object} params
 * @returns {{ divergente: boolean, tipo: string|null, mensagem: string|null }}
 */
function detectInviteBeltConflict({
    inviteAtualId = null,
    invitePretendidaId = null,
    invitePretendidaOrdem = null,
    currentRealBelt = null
}) {
    if (!currentRealBelt || !currentRealBelt.nivel_id) {
        return {
            divergente: true,
            tipo: 'sem_graduacao_ativa',
            mensagem: 'Aluno sem graduação ativa cadastrada'
        };
    }

    const realNivelId = Number(currentRealBelt.nivel_id);
    const realOrdem = Number(currentRealBelt.ordem_hierarquica);
    const pretOrdem = invitePretendidaOrdem !== null && invitePretendidaOrdem !== undefined
        ? Number(invitePretendidaOrdem)
        : null;

    if (pretOrdem !== null && Number.isFinite(pretOrdem) && Number.isFinite(realOrdem) && pretOrdem < realOrdem) {
        return {
            divergente: true,
            tipo: 'regressao',
            mensagem: 'Faixa pretendida no convite é inferior à faixa atual do aluno'
        };
    }

    if (
        (invitePretendidaId && Number(invitePretendidaId) === realNivelId) ||
        (pretOrdem !== null && Number.isFinite(pretOrdem) && Number.isFinite(realOrdem) && pretOrdem === realOrdem)
    ) {
        return {
            divergente: true,
            tipo: 'ja_conquistada',
            mensagem: 'Aluno já possui a graduação pretendida neste convite'
        };
    }

    if (inviteAtualId && Number(inviteAtualId) !== realNivelId) {
        return {
            divergente: true,
            tipo: 'faixa_atual_alterada',
            mensagem: 'A faixa atual do aluno mudou após a emissão do convite'
        };
    }

    return {
        divergente: false,
        tipo: null,
        mensagem: null
    };
}

/**
 * Avalia de forma unificada a aptidão técnica de um atleta para o próximo exame.
 * Prioriza travas de progressão RPG configuradas no nível pretendido e combina:
 * 1) Avaliação Técnica RPG (aluno_avaliacoes_desempenho)
 * 2) Avaliação Formal de Graduação (aluno_avaliacoes_graduacao)
 * 3) Domínio de Técnicas na Wiki (graduacao_nivel_golpes + aluno_golpes_progresso)
 *
 * @param {object} params
 * @returns {object}
 */
function evaluateStudentExamEligibility({
    currentBelt = null,
    nextBelt = null,
    formalEval = null,
    rpgEval = null,
    wikiProgress = null
}) {
    const metaMinima = Number(currentBelt?.porcentagem_minima) || 70;

    if (!currentBelt) {
        return {
            apto: false,
            percentual: 0,
            meta_minima: metaMinima,
            fonte: 'sem_graduacao',
            motivo: 'Sem graduação inicial cadastrada',
            bloqueios: ['Atleta sem faixa inicial vinculada'],
            rpg_lock: null
        };
    }

    if (!nextBelt) {
        return {
            apto: false,
            percentual: 100,
            meta_minima: metaMinima,
            fonte: 'nivel_maximo',
            motivo: 'Graduação máxima atingida',
            bloqueios: ['Atleta já está na graduação máxima da modalidade'],
            rpg_lock: null
        };
    }

    const rpgLock = rpgEvaluationService.evaluateExamProgressionLock(rpgEval, nextBelt);

    const formalPct = formalEval && formalEval.percentual_obtido !== null && formalEval.percentual_obtido !== undefined
        ? Math.round(Number(formalEval.percentual_obtido) || 0)
        : null;
    const formalApto = Boolean(
        formalEval && (
            Number(formalEval.apto) === 1 ||
            formalEval.apto === true ||
            (formalPct !== null && formalPct >= metaMinima)
        )
    );

    const rpgScore = (rpgEval && rpgEval.is_rpg)
        ? Math.round(Number(rpgEval.score_total || 0))
        : null;
    const rpgApto = rpgLock && rpgLock.possui_requisitos_rpg
        ? Boolean(rpgLock.elegivel)
        : (rpgScore !== null && rpgScore >= metaMinima);

    const totalGolpes = Number(wikiProgress?.total_golpes || 0);
    const golpesDominados = Number(wikiProgress?.golpes_dominados || 0);
    const wikiPct = totalGolpes > 0 ? Math.round((golpesDominados / totalGolpes) * 100) : null;
    const wikiApto = wikiPct !== null && wikiPct >= metaMinima;

    // Quando a próxima faixa possui trava RPG explícita e ela NÃO foi cumprida, bloqueia com pendências claras
    if (rpgLock && rpgLock.possui_requisitos_rpg && !rpgLock.elegivel) {
        const pendencias = Array.isArray(rpgLock.pendencias) ? rpgLock.pendencias : [];
        return {
            apto: false,
            percentual: Number(rpgLock.progresso_pct || 0),
            meta_minima: metaMinima,
            fonte: 'trava_rpg',
            motivo: pendencias[0] || 'Requisitos RPG da próxima faixa pendentes',
            bloqueios: pendencias,
            rpg_lock: rpgLock
        };
    }

    if (formalApto || rpgApto || wikiApto) {
        let fonte = 'wiki_golpes';
        let percentual = wikiPct !== null ? wikiPct : metaMinima;
        let motivo = `Domínio da Wiki (${percentual}%)`;

        if (rpgApto && rpgScore !== null) {
            fonte = 'rpg';
            percentual = rpgScore;
            const rankCod = String(rpgEval.rank_combate || 'D').toUpperCase();
            motivo = `Avaliação RPG: Rank ${rankCod} (${rpgScore}/100)`;
        } else if (formalApto) {
            fonte = 'avaliacao_graduacao';
            percentual = formalPct !== null ? formalPct : 100;
            motivo = formalEval.professor_nome
                ? `Aprovado por ${formalEval.professor_nome} (${percentual}%)`
                : `Avaliação de graduação (${percentual}%)`;
        } else if (wikiApto) {
            fonte = 'wiki_golpes';
            percentual = wikiPct;
            motivo = `Domínio de ${golpesDominados}/${totalGolpes} técnicas da faixa (${wikiPct}%)`;
        }

        return {
            apto: true,
            percentual: Math.min(100, Math.max(0, percentual)),
            meta_minima: metaMinima,
            fonte,
            motivo,
            bloqueios: [],
            rpg_lock: rpgLock
        };
    }

    const candidatesPct = [rpgScore, formalPct, wikiPct].filter((v) => v !== null && Number.isFinite(v));
    const bestPct = candidatesPct.length > 0 ? Math.max(...candidatesPct) : 0;

    let motivo = 'Sem avaliação registrada para a faixa atual';
    if (rpgScore !== null) {
        motivo = `RPG ${rpgScore}/100 (mínimo ${metaMinima})`;
    } else if (formalPct !== null) {
        motivo = `Avaliação ${formalPct}% (mínimo ${metaMinima}%)`;
    } else if (wikiPct !== null && wikiPct > 0) {
        motivo = `Wiki ${wikiPct}% (mínimo ${metaMinima}%)`;
    }

    return {
        apto: false,
        percentual: Math.min(100, Math.max(0, bestPct)),
        meta_minima: metaMinima,
        fonte: 'em_evolucao',
        motivo,
        bloqueios: [motivo],
        rpg_lock: rpgLock
    };
}

/**
 * Converte valores Date/string em string YYYY-MM-DD segura.
 */
function formatIsoDateOnly(val) {
    if (!val) return null;
    if (val instanceof Date && !isNaN(val.getTime())) {
        return val.toISOString().split('T')[0];
    }
    const str = String(val).trim();
    const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}

/**
 * Carrega em lote todos os atletas com graduação ativa (ou filtrados) e computa
 * próxima faixa + elegibilidade unificada usando Prepared Statements e sem queries N+1.
 *
 * @param {object} pool
 * @param {object} options
 * @returns {Promise<Array<object>>}
 */
async function loadExamEligibilityBatch(pool, { modalidadeId = null, alunoIds = null, includeInactive = false } = {}) {
    const cleanModId = modalidadeId !== null && modalidadeId !== undefined && !isNaN(Number(modalidadeId))
        ? Number(modalidadeId)
        : null;

    const cleanAlunoIds = Array.isArray(alunoIds)
        ? [...new Set(alunoIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
        : null;

    if (cleanAlunoIds && cleanAlunoIds.length === 0) {
        return [];
    }

    // 1. Níveis por modalidade (ordem hierárquica completa)
    const [allLevels] = await pool.query(`
        SELECT id, modalidade_id, nome, ordem_hierarquica,
               cor_hex_primaria, cor_hex_secundaria, porcentagem_minima,
               rpg_rank_minimo, rpg_pontuacao_minima_atributo, rpg_exige_apto_sparring
        FROM graduacoes_niveis
        ORDER BY modalidade_id ASC, ordem_hierarquica ASC, id ASC
    `);

    const levelsByModality = new Map();
    for (const lvl of allLevels) {
        const mId = Number(lvl.modalidade_id);
        if (!levelsByModality.has(mId)) levelsByModality.set(mId, []);
        levelsByModality.get(mId).push(lvl);
    }

    // 2. Alunos e suas graduações atuais
    let sql = `
        SELECT
            a.id AS aluno_id,
            a.nome_completo,
            a.foto_perfil_url,
            a.email,
            a.telefone_whatsapp,
            a.status AS aluno_status,
            ag.id AS aluno_graduacao_id,
            m.id AS modalidade_id,
            m.nome AS modalidade_nome,
            gn.id AS graduacao_atual_id,
            gn.nome AS graduacao_atual_nome,
            gn.ordem_hierarquica AS ordem_atual,
            gn.cor_hex_primaria AS atual_cor_primaria,
            gn.cor_hex_secundaria AS atual_cor_secundaria,
            gn.porcentagem_minima AS meta_minima
        FROM alunos a
        JOIN aluno_graduacoes ag ON ag.aluno_id = a.id AND ag.atual = 1
        JOIN modalidades m ON m.id = ag.modalidade_id
        JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
        WHERE a.deleted_at IS NULL
    `;
    const params = [];

    if (!includeInactive) {
        sql += ` AND a.status != 'inativo'`;
    }
    if (cleanModId) {
        sql += ` AND m.id = ?`;
        params.push(cleanModId);
    }
    if (cleanAlunoIds) {
        sql += ` AND a.id IN (${cleanAlunoIds.map(() => '?').join(', ')})`;
        params.push(...cleanAlunoIds);
    }

    sql += ` ORDER BY m.nome ASC, gn.ordem_hierarquica ASC, a.nome_completo ASC, ag.id DESC`;

    const [rawRows] = await pool.query(sql, params);
    if (rawRows.length === 0) {
        return [];
    }

    // Deduplica caso um aluno tenha registros duplicados (ag.atual = 1) na mesma modalidade
    const seenAlunoMod = new Set();
    const graduatedRows = [];
    const targetAlunoIdsSet = new Set();
    const targetLevelIdsSet = new Set();

    for (const row of rawRows) {
        const key = `${row.aluno_id}::${row.modalidade_id}`;
        if (seenAlunoMod.has(key)) continue;
        seenAlunoMod.add(key);
        graduatedRows.push(row);
        targetAlunoIdsSet.add(Number(row.aluno_id));
        targetLevelIdsSet.add(Number(row.graduacao_atual_id));
    }

    const targetAlunoIds = Array.from(targetAlunoIdsSet);
    const targetLevelIds = Array.from(targetLevelIdsSet);
    const alunoPlaceholders = targetAlunoIds.map(() => '?').join(', ');

    // 3. Última avaliação formal de graduação por (aluno_id, graduacao_nivel_id)
    const [formalEvalRows] = await pool.query(`
        SELECT aag.id, aag.aluno_id, aag.graduacao_nivel_id, aag.percentual_obtido,
               aag.total_pontos_obtidos, aag.apto, aag.observacoes_professor, aag.data_avaliacao,
               ue.nome AS professor_nome
        FROM aluno_avaliacoes_graduacao aag
        LEFT JOIN usuarios_equipe ue ON ue.id = aag.professor_id
        WHERE aag.aluno_id IN (${alunoPlaceholders})
        ORDER BY aag.data_avaliacao DESC, aag.id DESC
    `, targetAlunoIds);

    const formalByAlunoLevel = new Map();
    const formalLatestByAluno = new Map();
    for (const ev of formalEvalRows) {
        const key = `${ev.aluno_id}::${ev.graduacao_nivel_id}`;
        if (!formalByAlunoLevel.has(key)) {
            formalByAlunoLevel.set(key, ev);
        }
        if (!formalLatestByAluno.has(Number(ev.aluno_id))) {
            formalLatestByAluno.set(Number(ev.aluno_id), ev);
        }
    }

    // 4. Última avaliação técnica RPG por aluno_id
    const [rpgRows] = await pool.query(`
        SELECT aad.*
        FROM aluno_avaliacoes_desempenho aad
        WHERE aad.aluno_id IN (${alunoPlaceholders})
        ORDER BY aad.data_avaliacao DESC, aad.id DESC
    `, targetAlunoIds);

    const rpgByAluno = new Map();
    for (const row of rpgRows) {
        const aId = Number(row.aluno_id);
        if (!rpgByAluno.has(aId)) {
            rpgByAluno.set(aId, rpgEvaluationService.normalizeRpgRow(row));
        }
    }

    // 5. Progresso de golpes na Wiki para os níveis atuais dos atletas
    const wikiByAlunoLevel = new Map();
    if (targetLevelIds.length > 0) {
        const levelPlaceholders = targetLevelIds.map(() => '?').join(', ');
        const [levelTotalRows] = await pool.query(`
            SELECT gng.graduacao_nivel_id, COUNT(*) AS total_golpes
            FROM graduacao_nivel_golpes gng
            WHERE gng.graduacao_nivel_id IN (${levelPlaceholders})
            GROUP BY gng.graduacao_nivel_id
        `, targetLevelIds);

        const totalGolpesByLevel = new Map(
            levelTotalRows.map((r) => [Number(r.graduacao_nivel_id), Number(r.total_golpes || 0)])
        );

        const [dominadosRows] = await pool.query(`
            SELECT agp.aluno_id, gng.graduacao_nivel_id, COUNT(*) AS golpes_dominados
            FROM aluno_golpes_progresso agp
            JOIN graduacao_nivel_golpes gng ON gng.golpe_id = agp.golpe_id
            WHERE agp.aluno_id IN (${alunoPlaceholders})
              AND gng.graduacao_nivel_id IN (${levelPlaceholders})
              AND agp.status = 'dominado'
            GROUP BY agp.aluno_id, gng.graduacao_nivel_id
        `, [...targetAlunoIds, ...targetLevelIds]);

        for (const r of dominadosRows) {
            const lvlId = Number(r.graduacao_nivel_id);
            wikiByAlunoLevel.set(`${r.aluno_id}::${lvlId}`, {
                total_golpes: totalGolpesByLevel.get(lvlId) || 0,
                golpes_dominados: Number(r.golpes_dominados || 0)
            });
        }
        // Garante entrada com 0 dominados quando há golpes cadastrados para a faixa
        for (const row of graduatedRows) {
            const key = `${row.aluno_id}::${row.graduacao_atual_id}`;
            if (!wikiByAlunoLevel.has(key)) {
                wikiByAlunoLevel.set(key, {
                    total_golpes: totalGolpesByLevel.get(Number(row.graduacao_atual_id)) || 0,
                    golpes_dominados: 0
                });
            }
        }
    }

    return graduatedRows.map((item) => {
        const modLevels = levelsByModality.get(Number(item.modalidade_id)) || [];
        const currentBelt = {
            id: Number(item.graduacao_atual_id),
            nome: item.graduacao_atual_nome,
            ordem_hierarquica: Number(item.ordem_atual),
            cor_hex_primaria: item.atual_cor_primaria,
            cor_hex_secundaria: item.atual_cor_secundaria,
            porcentagem_minima: item.meta_minima
        };
        const nextBelt = findNextLevel(modLevels, item.ordem_atual);

        const formalEval = formalByAlunoLevel.get(`${item.aluno_id}::${item.graduacao_atual_id}`) || null;
        const formalLatest = formalLatestByAluno.get(Number(item.aluno_id)) || null;
        const rpgEval = rpgByAluno.get(Number(item.aluno_id)) || null;
        const wikiProgress = wikiByAlunoLevel.get(`${item.aluno_id}::${item.graduacao_atual_id}`) || null;

        const eligibility = evaluateStudentExamEligibility({
            currentBelt,
            nextBelt,
            formalEval,
            rpgEval,
            wikiProgress
        });

        const dtFormal = formatIsoDateOnly(formalEval?.data_avaliacao || formalLatest?.data_avaliacao);
        const dtRpg = formatIsoDateOnly(rpgEval?.data_avaliacao);
        const ultimaAvaliacaoData = dtFormal && dtRpg
            ? (dtFormal >= dtRpg ? dtFormal : dtRpg)
            : (dtFormal || dtRpg || null);

        return {
            aluno_id: Number(item.aluno_id),
            nome_completo: item.nome_completo,
            foto_perfil_url: item.foto_perfil_url,
            email: item.email,
            telefone_whatsapp: item.telefone_whatsapp,
            aluno_status: item.aluno_status,
            modalidade_id: Number(item.modalidade_id),
            modalidade_nome: item.modalidade_nome,
            graduacao_atual_id: Number(item.graduacao_atual_id),
            graduacao_atual_nome: item.graduacao_atual_nome,
            ordem_atual: Number(item.ordem_atual),
            atual_cor_primaria: item.atual_cor_primaria,
            atual_cor_secundaria: item.atual_cor_secundaria || null,
            graduacao_atual_cor_secundaria: item.atual_cor_secundaria || null,
            graduacao_pretendida_id: nextBelt ? Number(nextBelt.id) : null,
            graduacao_pretendida_nome: nextBelt ? nextBelt.nome : null,
            ordem_pretendida: nextBelt ? Number(nextBelt.ordem_hierarquica) : null,
            pretendida_cor_primaria: nextBelt ? nextBelt.cor_hex_primaria : null,
            pretendida_cor_secundaria: nextBelt ? (nextBelt.cor_hex_secundaria || null) : null,
            proxima_graduacao_cor_secundaria: nextBelt ? (nextBelt.cor_hex_secundaria || null) : null,
            apto: eligibility.apto,
            percentual_avaliacao: eligibility.percentual,
            meta_minima: eligibility.meta_minima,
            aptidao_fonte: eligibility.fonte,
            apto_motivo: eligibility.motivo,
            motivo_elegibilidade: eligibility.motivo,
            motivo_inelegibilidade: eligibility.apto ? null : eligibility.motivo,
            bloqueios: eligibility.bloqueios,
            rpg_lock: eligibility.rpg_lock,
            rpg_rank: (rpgEval && rpgEval.is_rpg) ? rpgEval.rank_combate : null,
            rpg_score: (rpgEval && rpgEval.is_rpg) ? rpgEval.score_total : null,
            ultima_avaliacao_data: ultimaAvaliacaoData
        };
    });
}

/**
 * Agrupa e contabiliza as faixas/prajieds pretendidos de um evento para facilitar
 * o levantamento de compras (exclui convites recusados e alunos removidos).
 *
 * @param {Array<object>} convites
 * @returns {{ faixas: Array<object>, totais: object }}
 */
function summarizeIntendedBeltsForPurchase(convites = []) {
    const emptyTotais = {
        pagos: 0,
        aceitos: 0,
        convidados: 0,
        total_pagos_e_aceitos: 0,
        total_ativos: 0,
        ignorados_recusados_ou_excluidos: 0,
        com_divergencia: 0
    };

    if (!Array.isArray(convites) || convites.length === 0) {
        return { faixas: [], totais: emptyTotais };
    }

    const groups = new Map();
    const totais = { ...emptyTotais };

    for (const c of convites) {
        if (!c) continue;
        const status = String(c.convite_status ?? c.status ?? '').trim().toLowerCase();
        const isExcluido = Boolean(c.aluno_excluido || c.aluno_deleted_at);

        if (status === 'recusado' || isExcluido) {
            totais.ignorados_recusados_ou_excluidos++;
            continue;
        }

        const gradId = c.graduacao_pretendida_id ? Number(c.graduacao_pretendida_id) : null;
        const gradNome = String(c.graduacao_pretendida_nome || 'Graduação não informada').trim();
        const key = gradId ? `id:${gradId}` : `nome:${gradNome.toLowerCase()}`;

        if (!groups.has(key)) {
            groups.set(key, {
                graduacao_id: gradId,
                nome: gradNome,
                cor_primaria: c.pretendida_cor_primaria || c.cor_primaria || '#94a3b8',
                cor_secundaria: c.pretendida_cor_secundaria || c.cor_secundaria || null,
                ordem: Number.isFinite(Number(c.pretendida_ordem)) ? Number(c.pretendida_ordem) : 999,
                pagos: 0,
                aceitos: 0,
                convidados: 0,
                total_pagos_e_aceitos: 0,
                total_ativos: 0,
                com_divergencia: 0
            });
        }

        const item = groups.get(key);
        if (status === 'pago') {
            item.pagos++;
            totais.pagos++;
        } else if (status === 'aceito') {
            item.aceitos++;
            totais.aceitos++;
        } else {
            item.convidados++;
            totais.convidados++;
        }

        item.total_pagos_e_aceitos = item.pagos + item.aceitos;
        item.total_ativos = item.pagos + item.aceitos + item.convidados;
        totais.total_ativos++;

        if (c.faixa_divergente) {
            item.com_divergencia++;
            totais.com_divergencia++;
        }
    }

    totais.total_pagos_e_aceitos = totais.pagos + totais.aceitos;

    const faixas = Array.from(groups.values()).sort((a, b) => {
        if (a.ordem !== b.ordem) return a.ordem - b.ordem;
        return a.nome.localeCompare(b.nome, 'pt-BR');
    });

    return { faixas, totais };
}

/**
 * Normaliza o método de cobrança digital Asaas permitido para taxas de exame.
 *
 * @param {string} value
 * @returns {'PIX'|'BOLETO'|'UNDEFINED'}
 */
function normalizeExamBillingType(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'BOLETO' || normalized === 'UNDEFINED' || normalized === 'PIX') {
        return normalized;
    }
    return 'PIX';
}

/**
 * Valida se um convite de exame pode ser aprovado manualmente por professor/admin/recepção
 * (cenário em que o aluno está sem acesso à plataforma, mas deseja participar).
 *
 * @param {object|null} convite
 * @param {{ gerarCobranca?: boolean }} [options]
 * @returns {{ allowed: boolean, mode?: 'accept_and_bill'|'accept_only'|'generate_invoice', code?: string, error?: string }}
 */
function validateManualInviteAcceptance(convite, { gerarCobranca = true } = {}) {
    if (!convite) {
        return {
            allowed: false,
            code: 'NOT_FOUND',
            error: 'Convite não encontrado.'
        };
    }

    if (convite.aluno_excluido || convite.aluno_deleted_at || convite.deleted_at) {
        return {
            allowed: false,
            code: 'STUDENT_DELETED',
            error: 'Não é possível aprovar o convite de um aluno na lixeira.'
        };
    }

    const status = String(convite.convite_status ?? convite.status ?? '').trim().toLowerCase();
    if (status === 'pago') {
        return {
            allowed: false,
            code: 'ALREADY_PAID',
            error: 'Este convite já está quitado e confirmado.'
        };
    }

    if (status === 'recusado') {
        return {
            allowed: false,
            code: 'REFUSED',
            error: 'Este convite está marcado como recusado. Reative-o antes de aprovar manualmente.'
        };
    }

    const wantsBilling = gerarCobranca !== false;
    if (status === 'aceito') {
        const hasInvoice = Boolean(convite.asaas_invoice_url || convite.asaas_payment_id);
        if (wantsBilling && !hasInvoice) {
            return { allowed: true, mode: 'generate_invoice' };
        }
        if (wantsBilling) {
            return {
                allowed: false,
                code: 'ALREADY_ACCEPTED_WITH_INVOICE',
                error: 'Este convite já foi aceito e já possui fatura digital gerada.'
            };
        }
        return {
            allowed: false,
            code: 'ALREADY_ACCEPTED',
            error: 'Este convite já está marcado como aceito (aguardando pagamento).'
        };
    }

    if (status === 'convidado') {
        return {
            allowed: true,
            mode: wantsBilling ? 'accept_and_bill' : 'accept_only'
        };
    }

    return {
        allowed: false,
        code: 'INVALID_STATUS',
        error: 'Status do convite inválido para aprovação manual.'
    };
}

module.exports = {
    findNextLevel,
    findPreviousLevel,
    resolveGraduationRollbackPlan,
    detectInviteBeltConflict,
    evaluateStudentExamEligibility,
    loadExamEligibilityBatch,
    summarizeIntendedBeltsForPurchase,
    normalizeExamBillingType,
    validateManualInviteAcceptance
};
