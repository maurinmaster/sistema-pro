/**
 * PRO COMBATE - Motor de Engajamento RPG
 * 1. XP Automático, Nível Contínuo e Ofensiva Semanal (Streak 1.5x)
 * 2. Árvore de Habilidades Interativa (Skill Tree por Ramo e Prajied)
 * 3. Mural de Líderes Saudável (Assiduidade 30d, Maior Evolução e Top Atributos por Prajied)
 */

const XP_CHECKIN_REGULAR = 10;
const XP_CHECKIN_ESPECIAL = 20;
const XP_AVALIACAO_RPG = 50;
const XP_PER_LEVEL = 100;
const DEFAULT_WEEKLY_GOAL = 3;
const STREAK_MULTIPLIER_ACTIVE = 1.5;
const STREAK_MULTIPLIER_NORMAL = 1.0;

const SKILL_TREE_BRANCHES = [
    { id: 'punhos', nome: 'Punhos (หมัด)', nome_curto: 'Punhos', icone: '🥊', cor: '#ef4444' },
    { id: 'chutes', nome: 'Chutes (เตะ)', nome_curto: 'Chutes', icone: '🦵', cor: '#f97316' },
    { id: 'joelhos', nome: 'Joelhos (เข่า)', nome_curto: 'Joelhos', icone: '⚡', cor: '#eab308' },
    { id: 'cotovelos', nome: 'Cotovelos (ศอก)', nome_curto: 'Cotovelos', icone: '💥', cor: '#a855f7' },
    { id: 'clinch_defesas', nome: 'Clinch e Defesas', nome_curto: 'Clinch/Defesa', icone: '🛡️', cor: '#38bdf8' }
];

const VALID_BRANCH_IDS = new Set(SKILL_TREE_BRANCHES.map(b => b.id));

const VALID_RANKING_ATRIBUTOS = {
    score_total: { id: 'score_total', label: 'Score Geral RPG', col: 'score_total', max: 100 },
    inteligencia: { id: 'inteligencia', label: 'Inteligência', col: 'score_inteligencia', max: 20 },
    destreza: { id: 'destreza', label: 'Destreza', col: 'score_destreza', max: 20 },
    agilidade: { id: 'agilidade', label: 'Agilidade', col: 'score_agilidade', max: 20 },
    forca: { id: 'forca', label: 'Força', col: 'score_forca', max: 20 },
    vitalidade: { id: 'vitalidade', label: 'Vitalidade', col: 'score_vitalidade', max: 20 }
};

/**
 * Calcula nível contínuo e progresso até o próximo nível: Nível = floor(XP / 100) + 1.
 */
function computeLevelFromXp(xpTotal) {
    const xp = Math.max(0, Math.floor(Number(xpTotal) || 0));
    const nivel = Math.floor(xp / XP_PER_LEVEL) + 1;
    const xpNoNivel = xp % XP_PER_LEVEL;
    return {
        nivel,
        xp_total: xp,
        xp_no_nivel: xpNoNivel,
        xp_meta_nivel: XP_PER_LEVEL,
        xp_para_proximo: XP_PER_LEVEL - xpNoNivel,
        progresso_pct: xpNoNivel
    };
}

/**
 * Calcula XP ganho em um check-in considerando tipo de aula e multiplicador de ofensiva.
 */
function calculateCheckinXp({ tipoAula = 'regular', xpBaseCustom = null, multiplicador = STREAK_MULTIPLIER_NORMAL } = {}) {
    const tipo = String(tipoAula || '').toLowerCase() === 'especial' ? 'especial' : 'regular';
    const custom = Number(xpBaseCustom);
    const xpBase = (Number.isFinite(custom) && custom > 0)
        ? Math.round(custom)
        : (tipo === 'especial' ? XP_CHECKIN_ESPECIAL : XP_CHECKIN_REGULAR);
    const mult = Number(multiplicador) >= STREAK_MULTIPLIER_ACTIVE ? STREAK_MULTIPLIER_ACTIVE : STREAK_MULTIPLIER_NORMAL;
    return {
        tipo_aula: tipo,
        xp_base: xpBase,
        multiplicador: mult,
        xp_final: Math.round(xpBase * mult)
    };
}

/**
 * Retorna a semana ISO imediatamente anterior no formato YYYYWW (igual ao YEARWEEK(data, 1) do MySQL).
 */
function prevIsoYearWeek(yearWeek) {
    const num = Number(yearWeek);
    if (!Number.isInteger(num) || num < 197001) return 197001;
    const year = Math.floor(num / 100);
    const week = num % 100;

    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dow = jan4.getUTCDay() || 7;
    const week1Monday = new Date(jan4.getTime() - (dow - 1) * 86400000);
    const targetMonday = new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000);
    const prevMonday = new Date(targetMonday.getTime() - 7 * 86400000);

    const thu = new Date(prevMonday.getTime() + 3 * 86400000);
    const isoYear = thu.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const dayOfYear = Math.floor((thu.getTime() - yearStart.getTime()) / 86400000) + 1;
    const isoWeek = Math.ceil(dayOfYear / 7);
    return isoYear * 100 + isoWeek;
}

/**
 * Avalia a ofensiva semanal (Seg–Dom) e se o multiplicador 1.5x XP está ativo nesta semana.
 * O multiplicador 1.5x é ativado na semana seguinte quando a semana anterior atingiu a meta (>= 3 treinos).
 */
function computeWeeklyStreak({ weeklyCounts, currentYearWeek, metaSemanal = DEFAULT_WEEKLY_GOAL } = {}) {
    const countsMap = new Map();
    if (weeklyCounts instanceof Map) {
        for (const [k, v] of weeklyCounts.entries()) countsMap.set(Number(k), Number(v) || 0);
    } else if (Array.isArray(weeklyCounts)) {
        for (const row of weeklyCounts) {
            countsMap.set(Number(row.yw ?? row.year_week), Number(row.total ?? row.count ?? 0) || 0);
        }
    } else if (weeklyCounts && typeof weeklyCounts === 'object') {
        for (const [k, v] of Object.entries(weeklyCounts)) countsMap.set(Number(k), Number(v) || 0);
    }

    const curYw = Number(currentYearWeek);
    const meta = Math.max(1, Math.min(7, Number(metaSemanal) || DEFAULT_WEEKLY_GOAL));
    const prevYw = prevIsoYearWeek(curYw);

    let prevConsecutive = 0;
    let cursor = prevYw;
    for (let i = 0; i < 104; i++) {
        const qtd = countsMap.get(cursor) || 0;
        if (qtd >= meta) {
            prevConsecutive++;
            cursor = prevIsoYearWeek(cursor);
        } else {
            break;
        }
    }

    const curCount = countsMap.get(curYw) || 0;
    const prevCount = countsMap.get(prevYw) || 0;
    const metaAtualAtingida = curCount >= meta;
    const ofensivaAtiva = prevConsecutive >= 1;
    const multiplicadorAtivo = ofensivaAtiva ? STREAK_MULTIPLIER_ACTIVE : STREAK_MULTIPLIER_NORMAL;
    const streakSemanas = metaAtualAtingida ? (prevConsecutive + 1) : (ofensivaAtiva ? prevConsecutive : 0);

    return {
        streak_semanas: streakSemanas,
        ofensiva_ativa: ofensivaAtiva,
        multiplicador_ativo: multiplicadorAtivo,
        treinos_semana_atual: curCount,
        treinos_semana_anterior: prevCount,
        meta_semanal: meta,
        meta_semana_atual_atingida: metaAtualAtingida,
        falta_para_meta: Math.max(0, meta - curCount)
    };
}

/**
 * Classifica um golpe em um dos 5 ramos da Árvore de Habilidades de Combate.
 */
function inferSkillBranch(golpe = {}) {
    const explicit = golpe.ramo_habilidade ? String(golpe.ramo_habilidade).trim().toLowerCase() : '';
    if (VALID_BRANCH_IDS.has(explicit)) return explicit;

    const cat = String(golpe.categoria || '').toLowerCase();
    const nome = String(golpe.nome || '').toLowerCase();
    const text = `${cat} ${nome}`;

    if (text.includes('soco') || text.includes('punho') || text.includes('jab') || text.includes('direto') || text.includes('cruzado') || text.includes('upper') || text.includes('gancho')) {
        return 'punhos';
    }
    if (text.includes('chute') || text.includes('teep') || text.includes('tei') || text.includes('low kick') || text.includes('high kick') || text.includes('frontal')) {
        return 'chutes';
    }
    if (text.includes('joelh') || text.includes('khao')) {
        return 'joelhos';
    }
    if (text.includes('cotovel') || text.includes('sok')) {
        return 'cotovelos';
    }
    return 'clinch_defesas';
}

/**
 * Monta a Árvore de Habilidades interativa agrupada nos 5 ramos, calculando estados
 * ('dominada' | 'em_treinamento' | 'bloqueada') a partir da graduação atual e pré-requisitos.
 */
function buildSkillTree({ golpes = [], studentCurrentOrder = 1, masteredIds = [] } = {}) {
    const masteredSet = new Set(masteredIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0));
    const currentOrder = Math.max(1, Number(studentCurrentOrder) || 1);

    const nodesById = new Map();
    for (const g of golpes) {
        const id = Number(g.id);
        if (!id) continue;
        const gradOrder = Number(g.graduacao_ordem || g.ordem_hierarquica || 0);
        const prereqId = g.habilidade_prerequisito_id ? Number(g.habilidade_prerequisito_id) : null;
        const branchId = inferSkillBranch(g);

        nodesById.set(id, {
            ...g,
            id,
            ramo_habilidade: branchId,
            graduacao_ordem: gradOrder,
            habilidade_prerequisito_id: (prereqId && prereqId !== id) ? prereqId : null
        });
    }

    // 1ª passagem: identifica nós já dominados (validação explícita OU graduação já ultrapassada)
    for (const node of nodesById.values()) {
        const autoByGrade = node.graduacao_ordem > 0 && node.graduacao_ordem < currentOrder;
        const explicitMaster = masteredSet.has(node.id);
        node.is_dominada = Boolean(explicitMaster || autoByGrade);
    }

    // 2ª passagem: define estado final considerando graduação superior e pré-requisito
    for (const node of nodesById.values()) {
        const prereqNode = node.habilidade_prerequisito_id ? (nodesById.get(node.habilidade_prerequisito_id) || null) : null;
        node.prerequisito_nome = prereqNode ? prereqNode.nome : (node.prerequisito_nome || null);

        if (node.is_dominada) {
            node.estado = 'dominada';
            node.motivo_bloqueio = null;
            continue;
        }

        const aboveGrade = node.graduacao_ordem > currentOrder;
        const prereqMissing = Boolean(prereqNode && !prereqNode.is_dominada);

        if (aboveGrade || prereqMissing) {
            node.estado = 'bloqueada';
            const reasons = [];
            if (aboveGrade) {
                reasons.push(`Disponível na graduação ${node.graduacao_nome || `#${node.graduacao_ordem}`}`);
            }
            if (prereqMissing) {
                reasons.push(`Requer "${prereqNode.nome}" dominado primeiro`);
            }
            node.motivo_bloqueio = reasons.join(' • ');
        } else {
            node.estado = 'em_treinamento';
            node.motivo_bloqueio = null;
        }
    }

    const allNodes = Array.from(nodesById.values());
    const ramos = SKILL_TREE_BRANCHES.map((branch) => {
        const branchNodes = allNodes
            .filter(n => n.ramo_habilidade === branch.id)
            .sort((a, b) => {
                const ordDiff = (a.graduacao_ordem || 999) - (b.graduacao_ordem || 999);
                if (ordDiff !== 0) return ordDiff;
                const preDiff = (a.habilidade_prerequisito_id ? 1 : 0) - (b.habilidade_prerequisito_id ? 1 : 0);
                if (preDiff !== 0) return preDiff;
                return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
            });

        const dominadasCount = branchNodes.filter(n => n.estado === 'dominada').length;
        return {
            ...branch,
            total: branchNodes.length,
            dominadas: dominadasCount,
            em_treinamento: branchNodes.filter(n => n.estado === 'em_treinamento').length,
            bloqueadas: branchNodes.filter(n => n.estado === 'bloqueada').length,
            progresso_pct: branchNodes.length > 0 ? Math.round((dominadasCount / branchNodes.length) * 100) : 0,
            habilidades: branchNodes
        };
    });

    const total = allNodes.length;
    const dominadas = allNodes.filter(n => n.estado === 'dominada').length;

    return {
        resumo: {
            total,
            dominadas,
            em_treinamento: allNodes.filter(n => n.estado === 'em_treinamento').length,
            bloqueadas: allNodes.filter(n => n.estado === 'bloqueada').length,
            progresso_pct: total > 0 ? Math.round((dominadas / total) * 100) : 0,
            graduacao_ordem_atual: currentOrder
        },
        ramos
    };
}

/**
 * Monta o resumo fixo de rodapé ("Sua posição: #7 — faltam 20 XP para alcançar o #6").
 */
function buildStickyRankSummary(rankedList = [], currentAlunoId = null, metricField = 'valor', unitLabel = 'XP') {
    if (!currentAlunoId || !Array.isArray(rankedList) || rankedList.length === 0) return null;
    const idx = rankedList.findIndex(r => Number(r.aluno_id ?? r.id) === Number(currentAlunoId));
    if (idx === -1) return null;

    const currentEntry = rankedList[idx];
    const posicao = idx + 1;
    const valAtual = Number(currentEntry[metricField] ?? 0);

    if (idx === 0) {
        return {
            posicao: 1,
            total_participantes: rankedList.length,
            valor_atual: valAtual,
            faltam_para_proximo: 0,
            proximo_posicao: null,
            texto: `Sua posição: #1 (${valAtual} ${unitLabel}) — Você lidera o ranking! 🏆`
        };
    }

    const above = rankedList[idx - 1];
    const valAbove = Number(above[metricField] ?? 0);
    const diff = Math.max(1, valAbove - valAtual + (valAbove === valAtual ? 1 : 0));
    const exactDiff = valAbove > valAtual ? (valAbove - valAtual) : 1;

    return {
        posicao,
        total_participantes: rankedList.length,
        valor_atual: valAtual,
        faltam_para_proximo: diff,
        proximo_posicao: idx,
        texto: `Sua posição: #${posicao} — faltam ${exactDiff} ${unitLabel} para alcançar o #${idx}`
    };
}

/**
 * Aba 1 do Ranking: Assiduidade dos últimos 30 dias (exclui opt-outs de privacidade).
 */
function rankMonthlyAttendance(rows = [], currentAlunoId = null) {
    const publicList = rows
        .filter(r => r.exibir_no_ranking !== 0 && r.exibir_no_ranking !== false)
        .map(r => {
            const aid = Number(r.aluno_id ?? r.id);
            return {
                ...r,
                aluno_id: aid,
                xp_30d: Number(r.xp_30d || 0),
                checkins_30d: Number(r.checkins_30d || 0),
                streak_semanas: Number(r.streak_semanas || 0),
                xp_level: computeLevelFromXp(r.xp_total || 0),
                is_current_student: Boolean(currentAlunoId && aid === Number(currentAlunoId)),
                valor: Number(r.xp_30d || 0)
            };
        })
        .filter(r => r.xp_30d > 0 || r.checkins_30d > 0)
        .sort((a, b) => (b.xp_30d - a.xp_30d) || (b.checkins_30d - a.checkins_30d) || String(a.nome_completo || '').localeCompare(String(b.nome_completo || ''), 'pt-BR'));

    const lista = publicList.map((item, i) => ({ ...item, posicao: i + 1 }));
    return {
        top3: lista.slice(0, 3),
        lista,
        minha_posicao: buildStickyRankSummary(lista, currentAlunoId, 'xp_30d', 'XP')
    };
}

/**
 * Aba 2 do Ranking: Maior Evolução (delta > 0 entre a última e penúltima avaliação RPG).
 */
function rankMostImproved(studentsWithEvals = [], currentAlunoId = null) {
    const candidates = [];

    for (const st of studentsWithEvals) {
        if (st.exibir_no_ranking === 0 || st.exibir_no_ranking === false) continue;
        const evals = Array.isArray(st.avaliacoes) ? st.avaliacoes : [];
        if (evals.length < 2) continue;

        const latest = evals[0];
        const previous = evals[1];
        const scoreAtual = Number(latest.score_total || 0);
        const scoreAnterior = Number(previous.score_total || 0);
        const delta = scoreAtual - scoreAnterior;
        if (delta <= 0) continue;

        const aid = Number(st.aluno_id ?? st.id);
        candidates.push({
            aluno_id: aid,
            nome_completo: st.nome_completo,
            foto_perfil_url: st.foto_perfil_url || null,
            nivel_nome: st.nivel_nome || 'Atleta',
            cor_primaria: st.cor_primaria || '#ffffff',
            cor_secundaria: st.cor_secundaria || '#0f172a',
            streak_semanas: Number(st.streak_semanas || 0),
            xp_level: computeLevelFromXp(st.xp_total || 0),
            is_current_student: Boolean(currentAlunoId && aid === Number(currentAlunoId)),
            score_atual: scoreAtual,
            score_anterior: scoreAnterior,
            delta_pts: delta,
            rank_combate: latest.rank_combate || 'D',
            valor: delta
        });
    }

    candidates.sort((a, b) => (b.delta_pts - a.delta_pts) || (b.score_atual - a.score_atual) || String(a.nome_completo || '').localeCompare(String(b.nome_completo || ''), 'pt-BR'));
    const lista = candidates.map((item, i) => ({ ...item, posicao: i + 1 }));

    return {
        top3: lista.slice(0, 3),
        lista,
        minha_posicao: buildStickyRankSummary(lista, currentAlunoId, 'delta_pts', 'pts')
    };
}

/**
 * Aba 3 do Ranking: Top Atributos por Graduação (Prajied).
 */
function rankTopAttributesByGrade(rows = [], atributo = 'score_total', currentAlunoId = null) {
    const attrMeta = VALID_RANKING_ATRIBUTOS[atributo] || VALID_RANKING_ATRIBUTOS.score_total;
    const list = rows
        .filter(r => r.exibir_no_ranking !== 0 && r.exibir_no_ranking !== false)
        .map((r) => {
            const aid = Number(r.aluno_id ?? r.id);
            const val = Number(r[attrMeta.col] ?? r[attrMeta.id] ?? 0);
            return {
                ...r,
                aluno_id: aid,
                atributo: attrMeta.id,
                atributo_label: attrMeta.label,
                atributo_max: attrMeta.max,
                valor: val,
                streak_semanas: Number(r.streak_semanas || 0),
                xp_level: computeLevelFromXp(r.xp_total || 0),
                is_current_student: Boolean(currentAlunoId && aid === Number(currentAlunoId))
            };
        })
        .sort((a, b) => (b.valor - a.valor) || (Number(b.score_total || 0) - Number(a.score_total || 0)) || String(a.nome_completo || '').localeCompare(String(b.nome_completo || ''), 'pt-BR'));

    const ranked = list.map((item, i) => ({ ...item, posicao: i + 1 }));
    return {
        atributo: attrMeta,
        top3: ranked.slice(0, 3),
        lista: ranked,
        minha_posicao: buildStickyRankSummary(ranked, currentAlunoId, 'valor', 'pts')
    };
}

/**
 * Sincroniza e calcula streak semanal + XP efetivo de um aluno direto no banco.
 * Faz backfill automático caso o aluno já possua check-ins/avaliações anteriores sem log de XP.
 */
async function recalculateStudentStreakAndXp(dbPool, alunoId) {
    const id = parseInt(alunoId, 10);
    if (!id || Number.isNaN(id)) return null;

    const [alunoRows] = await dbPool.query(`
        SELECT a.id, a.xp_total, a.streak_semanas, a.meta_semanal_treinos, a.exibir_no_ranking,
               (SELECT p.limite_checkins_semana
                FROM matriculas m
                JOIN planos p ON p.id = m.plano_id
                WHERE m.aluno_id = a.id AND m.status = 'ativa'
                ORDER BY m.id DESC LIMIT 1) AS plano_meta_semana
        FROM alunos a
        WHERE a.id = ?
    `, [id]);

    if (alunoRows.length === 0) return null;
    const alunoRow = alunoRows[0];

    const [weekRows] = await dbPool.query(`
        SELECT YEARWEEK(data_hora_checkin, 1) AS yw, COUNT(DISTINCT DATE(data_hora_checkin)) AS total
        FROM checkins
        WHERE aluno_id = ? AND status = 'aprovado'
        GROUP BY YEARWEEK(data_hora_checkin, 1)
        ORDER BY yw DESC
        LIMIT 104
    `, [id]);

    const [curYwRows] = await dbPool.query('SELECT YEARWEEK(CURDATE(), 1) AS cur_yw');
    const curYw = Number(curYwRows[0]?.cur_yw);

    const metaSemanal = Number(alunoRow.meta_semanal_treinos || alunoRow.plano_meta_semana || DEFAULT_WEEKLY_GOAL);
    const ofensiva = computeWeeklyStreak({
        weeklyCounts: weekRows,
        currentYearWeek: curYw,
        metaSemanal
    });

    let xpTotal = Number(alunoRow.xp_total || 0);
    if (xpTotal === 0) {
        const [logSumRows] = await dbPool.query('SELECT COUNT(*) AS cnt, COALESCE(SUM(xp_final), 0) AS soma FROM aluno_xp_logs WHERE aluno_id = ?', [id]);
        if (Number(logSumRows[0]?.cnt || 0) === 0) {
            const [chkCntRows] = await dbPool.query(`
                SELECT COALESCE(SUM(CASE WHEN tipo_aula = 'especial' THEN ${XP_CHECKIN_ESPECIAL} ELSE ${XP_CHECKIN_REGULAR} END), 0) AS xp_chks
                FROM checkins WHERE aluno_id = ? AND status = 'aprovado'
            `, [id]);
            const [rpgCntRows] = await dbPool.query(`
                SELECT COUNT(*) AS total FROM aluno_avaliacoes_desempenho WHERE aluno_id = ? AND modelo_avaliacao = 'rpg'
            `, [id]);
            const [misXpRows] = await dbPool.query(`
                SELECT COALESCE(SUM(mq.recompensa_xp), 0) AS xp_mis
                FROM aluno_missoes am
                JOIN missoes_quadro mq ON mq.id = am.missao_id
                WHERE am.aluno_id = ? AND am.status = 'concluida'
            `, [id]).catch(() => [[{ xp_mis: 0 }]]);

            const inferredXp = Number(chkCntRows[0]?.xp_chks || 0)
                + (Number(rpgCntRows[0]?.total || 0) * XP_AVALIACAO_RPG)
                + Number(misXpRows[0]?.xp_mis || 0);

            if (inferredXp > 0) {
                xpTotal = inferredXp;
                await dbPool.query('UPDATE alunos SET xp_total = ? WHERE id = ? AND xp_total = 0', [xpTotal, id]);
            }
        }
    }

    if (Number(alunoRow.streak_semanas || 0) !== ofensiva.streak_semanas) {
        await dbPool.query('UPDATE alunos SET streak_semanas = ? WHERE id = ?', [ofensiva.streak_semanas, id]);
    }

    return {
        ofensiva,
        xp_level: computeLevelFromXp(xpTotal),
        exibir_no_ranking: alunoRow.exibir_no_ranking !== 0
    };
}

/**
 * Concede XP a um aluno, grava no ledger aluno_xp_logs e atualiza alunos.xp_total.
 */
async function awardXp(connOrPool, { alunoId, origem, referenciaId = null, xpBase = 0, multiplicador = 1.0, descricao = null }) {
    const id = parseInt(alunoId, 10);
    if (!id || Number.isNaN(id)) return null;

    const safeBase = Math.max(0, Math.round(Number(xpBase) || 0));
    const safeMult = Number(multiplicador) >= 1.5 ? 1.5 : 1.0;
    const xpFinal = Math.round(safeBase * safeMult);

    if (xpFinal > 0) {
        await connOrPool.query(`
            INSERT INTO aluno_xp_logs (aluno_id, origem, referencia_id, xp_base, multiplicador, xp_final, descricao)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [id, origem, referenciaId || null, safeBase, safeMult, xpFinal, descricao ? String(descricao).slice(0, 180) : null]);

        await connOrPool.query('UPDATE alunos SET xp_total = xp_total + ? WHERE id = ?', [xpFinal, id]);
    }

    const [rows] = await connOrPool.query('SELECT xp_total FROM alunos WHERE id = ?', [id]);
    const newXpTotal = Number(rows[0]?.xp_total || 0);

    return {
        xp_final: xpFinal,
        multiplicador: safeMult,
        xp_level: computeLevelFromXp(newXpTotal)
    };
}

/**
 * Marca automaticamente como Dominadas todas as técnicas vinculadas às graduações
 * anteriores quando um aluno é promovido para um novo Prajied.
 */
async function autoMasterCompletedGradeSkills(conn, { alunoId, modalidadeId, newOrder, professorId = null }) {
    const id = parseInt(alunoId, 10);
    const modId = parseInt(modalidadeId, 10);
    const orderNum = parseInt(newOrder, 10);
    if (!id || !modId || !orderNum || orderNum <= 1) return 0;

    const [golpesRows] = await conn.query(`
        SELECT DISTINCT gng.golpe_id
        FROM graduacao_nivel_golpes gng
        JOIN graduacoes_niveis gn ON gn.id = gng.graduacao_nivel_id
        WHERE gn.modalidade_id = ? AND gn.ordem_hierarquica < ?
    `, [modId, orderNum]);

    for (const row of golpesRows) {
        await conn.query(`
            INSERT INTO aluno_golpes_progresso (aluno_id, golpe_id, status, validado_por, validado_em)
            VALUES (?, ?, 'dominado', ?, NOW())
            ON DUPLICATE KEY UPDATE
                status = 'dominado',
                validado_por = COALESCE(VALUES(validado_por), validado_por),
                validado_em = COALESCE(validado_em, NOW())
        `, [id, row.golpe_id, professorId || null]);
    }

    return golpesRows.length;
}

module.exports = {
    XP_CHECKIN_REGULAR,
    XP_CHECKIN_ESPECIAL,
    XP_AVALIACAO_RPG,
    XP_PER_LEVEL,
    DEFAULT_WEEKLY_GOAL,
    STREAK_MULTIPLIER_ACTIVE,
    STREAK_MULTIPLIER_NORMAL,
    SKILL_TREE_BRANCHES,
    VALID_RANKING_ATRIBUTOS,
    computeLevelFromXp,
    calculateCheckinXp,
    prevIsoYearWeek,
    computeWeeklyStreak,
    inferSkillBranch,
    buildSkillTree,
    buildStickyRankSummary,
    rankMonthlyAttendance,
    rankMostImproved,
    rankTopAttributesByGrade,
    recalculateStudentStreakAndXp,
    awardXp,
    autoMasterCompletedGradeSkills
};
