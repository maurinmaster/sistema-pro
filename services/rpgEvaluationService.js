/**
 * PRO COMBATE - Domínio de Avaliação Técnica Gamificada (Estilo RPG - Muay Thai)
 * Define os 5 pilares, os 20 critérios técnicos (escala 0..5), trava de sparring (teto 3),
 * cálculo de pontuações (0..20 por pilar | 0..100 geral), classificação de Rank (D..S)
 * e comparação evolutiva (deltas).
 */

const RPG_PILLARS = [
    {
        id: 'inteligencia',
        nome: 'Inteligência',
        sigla: 'INT',
        subtitulo: 'Leitura tática e controle mental',
        cor: '#38bdf8'
    },
    {
        id: 'destreza',
        nome: 'Destreza',
        sigla: 'DES',
        subtitulo: 'Técnica pura, precisão e postura',
        cor: '#a855f7'
    },
    {
        id: 'agilidade',
        nome: 'Agilidade',
        sigla: 'AGI',
        subtitulo: 'Velocidade, reflexo e mobilidade',
        cor: '#22c55e'
    },
    {
        id: 'forca',
        nome: 'Força',
        sigla: 'FOR',
        subtitulo: 'Potência, controle de impacto e isometria',
        cor: '#f97316'
    },
    {
        id: 'vitalidade',
        nome: 'Vitalidade',
        sigla: 'VIT',
        subtitulo: 'Resistência, fôlego e recuperação',
        cor: '#ef4444'
    }
];

const RPG_CRITERIA = [
    // Pilar 1: Inteligência
    {
        numero: 1,
        id: 'controle_emocional_sparring',
        pilar: 'inteligencia',
        nome: 'Controle emocional no sparring',
        isSparring: true,
        minLabel: 'Afobado / perde a calma',
        maxLabel: 'Frio e estratégico sob pressão'
    },
    {
        numero: 2,
        id: 'controle_distancia',
        pilar: 'inteligencia',
        nome: 'Controle de distância',
        isSparring: false,
        minLabel: 'Não domina',
        maxLabel: 'Domínio total: longa, média e curta',
        landmarks: {
            0: 'Não domina',
            3: 'Domina 1 distância',
            4: 'Domina 2 distâncias',
            5: 'Domínio total: longa, média e curta'
        }
    },
    {
        numero: 3,
        id: 'contra_ataques',
        pilar: 'inteligencia',
        nome: 'Contra-ataques',
        isSparring: false,
        minLabel: 'Nulo ou reativo sem critério',
        maxLabel: 'Lê o golpe e responde na janela exata'
    },
    {
        numero: 4,
        id: 'dominio_clinch_tatico',
        pilar: 'inteligencia',
        nome: 'Domínio do clinch (Tático)',
        isSparring: false,
        minLabel: 'Perdido na curta distância',
        maxLabel: 'Sabe travar, desequilibrar e pontuar'
    },

    // Pilar 2: Destreza
    {
        numero: 5,
        id: 'controle_tecnica_sparring',
        pilar: 'destreza',
        nome: 'Controle de técnica no sparring',
        isSparring: true,
        minLabel: 'Perde a forma na luta',
        maxLabel: 'Execução limpa compatível com a graduação atual'
    },
    {
        numero: 6,
        id: 'postura_base',
        pilar: 'destreza',
        nome: 'Postura e Base',
        isSparring: false,
        minLabel: 'Desequilibrado / cruza pernas',
        maxLabel: 'Base sólida e eixo alinhado'
    },
    {
        numero: 7,
        id: 'precisao',
        pilar: 'destreza',
        nome: 'Precisão',
        isSparring: false,
        minLabel: 'Golpes no vazio ou na guarda',
        maxLabel: 'Atinge os alvos limpos com eficiência'
    },
    {
        numero: 8,
        id: 'defesas',
        pilar: 'destreza',
        nome: 'Defesas',
        isSparring: false,
        minLabel: 'Guarda vazada / aceita golpes',
        maxLabel: 'Bloqueios, esquivas e aparos eficientes'
    },

    // Pilar 3: Agilidade
    {
        numero: 9,
        id: 'velocidade_execucao',
        pilar: 'agilidade',
        nome: 'Velocidade de execução',
        isSparring: false,
        minLabel: 'Muito lento / telegrafado',
        maxLabel: 'Rápido e explosivo'
    },
    {
        numero: 10,
        id: 'tempo_reacao',
        pilar: 'agilidade',
        nome: 'Tempo de reação',
        isSparring: false,
        minLabel: 'Lento para responder',
        maxLabel: 'Ataca ou defende antes do oponente fechar a guarda'
    },
    {
        numero: 11,
        id: 'saidas_clinch',
        pilar: 'agilidade',
        nome: 'Saídas de clinch',
        isSparring: false,
        minLabel: 'Fica preso',
        maxLabel: 'Escapa rápido com giro, esgrima ou empurrão'
    },
    {
        numero: 12,
        id: 'jogo_pernas_footwork',
        pilar: 'agilidade',
        nome: 'Jogo de pernas (Footwork e Ângulos)',
        isSparring: false,
        minLabel: 'Plantado / anda em linha reta',
        maxLabel: 'Entra, sai e angula com fluidez'
    },

    // Pilar 4: Força
    {
        numero: 13,
        id: 'controle_forca_golpes',
        pilar: 'forca',
        nome: 'Controle de força nos golpes',
        isSparring: true,
        minLabel: 'Sem controle / machuca o parceiro',
        maxLabel: 'Total controle; dosa o impacto conforme o colega'
    },
    {
        numero: 14,
        id: 'potencia_impacto',
        pilar: 'forca',
        nome: 'Potência de impacto (Aparador / Saco)',
        isSparring: false,
        minLabel: 'Golpes empurrados sem peso',
        maxLabel: 'Transferência máxima de quadril e peso corporal'
    },
    {
        numero: 15,
        id: 'forca_isometrica_clinch',
        pilar: 'forca',
        nome: 'Força isométrica no Clinch',
        isSparring: false,
        minLabel: 'Cede fácil à pressão na nuca/braços',
        maxLabel: 'Sustenta a postura e impõe peso físico'
    },
    {
        numero: 16,
        id: 'explosao_combinacoes',
        pilar: 'forca',
        nome: 'Explosão em combinações (Cadência)',
        isSparring: false,
        minLabel: 'Perde potência após o 1º golpe',
        maxLabel: 'Mantém impacto pesado do início ao fim'
    },

    // Pilar 5: Vitalidade
    {
        numero: 17,
        id: 'resistencia_cardiovascular',
        pilar: 'vitalidade',
        nome: 'Resistência cardiovascular (Gás)',
        isSparring: false,
        minLabel: 'Exausto no 1º round',
        maxLabel: 'Mantém volume constante até o fim'
    },
    {
        numero: 18,
        id: 'recuperacao_entre_rounds',
        pilar: 'vitalidade',
        nome: 'Recuperação entre rounds',
        isSparring: false,
        minLabel: 'Demora a estabilizar a respiração',
        maxLabel: 'Recupera o fôlego rapidamente nos 60s de intervalo'
    },
    {
        numero: 19,
        id: 'absorcao_resiliencia',
        pilar: 'vitalidade',
        nome: 'Absorção e resiliência',
        isSparring: false,
        minLabel: 'Recua ou vira de costas ao sentir golpes',
        maxLabel: 'Mantém guarda fechada e postura sob pressão'
    },
    {
        numero: 20,
        id: 'manutencao_guarda_fadiga',
        pilar: 'vitalidade',
        nome: 'Manutenção de guarda sob fadiga',
        isSparring: false,
        minLabel: 'Braços caem quando cansa',
        maxLabel: 'Mantém guarda alta e cotovelos fechados no último round'
    }
];

const CRITERIA_BY_ID = new Map(RPG_CRITERIA.map(c => [c.id, c]));

/**
 * Classifica o Rank de combate a partir da pontuação geral (0 a 100).
 */
function classifyRpgRank(scoreTotal) {
    const score = Math.max(0, Math.min(100, Math.round(Number(scoreTotal) || 0)));
    if (score >= 91) return { codigo: 'S', titulo: 'Elite / Instrutor', cor: '#f43f5e' };
    if (score >= 76) return { codigo: 'A', titulo: 'Competidor', cor: '#f59e0b' };
    if (score >= 51) return { codigo: 'B', titulo: 'Combatente', cor: '#10b981' };
    if (score >= 26) return { codigo: 'C', titulo: 'Praticante', cor: '#38bdf8' };
    return { codigo: 'D', titulo: 'Iniciante', cor: '#94a3b8' };
}

function parseBooleanStrict(value) {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
    return null;
}

/**
 * Valida, aplica a trava de sparring (máx 3 nos critérios [SPARRING] quando apto_sparring = false),
 * calcula os 5 pilares (0..20), score_total (0..100) e Rank.
 */
function evaluateRpgPayload(body = {}) {
    const aptoSparring = parseBooleanStrict(body.apto_sparring);
    if (aptoSparring === null) {
        return {
            valid: false,
            error: 'Informe obrigatoriamente se o aluno está Apto para Sparring (Sim ou Não).'
        };
    }

    const rawCriterios = body.criterios;
    if (!rawCriterios || typeof rawCriterios !== 'object' || Array.isArray(rawCriterios)) {
        return {
            valid: false,
            error: 'Informe as notas (0 a 5) para todos os 20 critérios técnicos RPG.'
        };
    }

    const criteriosSanitizados = {};
    const pilares = {
        inteligencia: 0,
        destreza: 0,
        agilidade: 0,
        forca: 0,
        vitalidade: 0
    };
    let travaSparringAplicada = false;

    for (const criterion of RPG_CRITERIA) {
        const rawVal = rawCriterios[criterion.id];
        if (rawVal === undefined || rawVal === null || rawVal === '') {
            return {
                valid: false,
                error: `Critério "${criterion.nome}" não foi preenchido.`
            };
        }

        const num = Number(rawVal);
        if (!Number.isInteger(num) || num < 0 || num > 5) {
            return {
                valid: false,
                error: `A nota do critério "${criterion.nome}" deve ser um número inteiro de 0 a 5.`
            };
        }

        let finalVal = num;
        if (!aptoSparring && criterion.isSparring && finalVal > 3) {
            finalVal = 3;
            travaSparringAplicada = true;
        }

        criteriosSanitizados[criterion.id] = finalVal;
        pilares[criterion.pilar] += finalVal;
    }

    const scoreTotal = (
        pilares.inteligencia +
        pilares.destreza +
        pilares.agilidade +
        pilares.forca +
        pilares.vitalidade
    );
    const rank = classifyRpgRank(scoreTotal);

    let dataAval = body.data_avaliacao;
    if (!dataAval || !/^\d{4}-\d{2}-\d{2}$/.test(String(dataAval).trim())) {
        dataAval = new Date().toISOString().split('T')[0];
    } else {
        dataAval = String(dataAval).trim();
    }

    const rawObs = body.observacoes_instrutor !== undefined ? body.observacoes_instrutor : body.observacoes;
    const observacoesInstrutor = rawObs ? String(rawObs).trim().substring(0, 1000) : null;

    // Equivalentes legados (0..10) apenas para manter colunas antigas NOT NULL consistentes
    const notaClinch = Number((((criteriosSanitizados.dominio_clinch_tatico + criteriosSanitizados.forca_isometrica_clinch + criteriosSanitizados.saidas_clinch) / 15) * 10).toFixed(1));
    const notaSocos = Number((((criteriosSanitizados.precisao + criteriosSanitizados.explosao_combinacoes) / 10) * 10).toFixed(1));
    const notaChutes = Number((((criteriosSanitizados.velocidade_execucao + criteriosSanitizados.potencia_impacto) / 10) * 10).toFixed(1));
    const notaPostura = Number((((criteriosSanitizados.postura_base + criteriosSanitizados.defesas) / 10) * 10).toFixed(1));
    const notaClinchSparring = Number((((pilares.destreza + pilares.inteligencia) / 40) * 10).toFixed(1));
    const notaCondicionamento = Number(((pilares.vitalidade / 20) * 10).toFixed(1));

    return {
        valid: true,
        data: {
            modelo_avaliacao: 'rpg',
            data_avaliacao: dataAval,
            apto_sparring: aptoSparring,
            trava_sparring_aplicada: travaSparringAplicada,
            pilares,
            score_inteligencia: pilares.inteligencia,
            score_destreza: pilares.destreza,
            score_agilidade: pilares.agilidade,
            score_forca: pilares.forca,
            score_vitalidade: pilares.vitalidade,
            score_total: scoreTotal,
            rank,
            rank_combate: rank.codigo,
            rank_titulo: rank.titulo,
            criterios: criteriosSanitizados,
            observacoes_instrutor: observacoesInstrutor,
            legacy: {
                nota_clinch: notaClinch,
                nota_socos: notaSocos,
                nota_chutes: notaChutes,
                nota_postura: notaPostura,
                nota_clinch_sparring: notaClinchSparring,
                nota_condicionamento: notaCondicionamento
            }
        }
    };
}

function safeParseCriteriaJson(rawJson) {
    if (!rawJson) return null;
    if (typeof rawJson === 'object' && !Array.isArray(rawJson)) return rawJson;
    if (typeof rawJson === 'string') {
        try {
            const parsed = JSON.parse(rawJson);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Normaliza registro de aluno_avaliacoes_desempenho (novo RPG ou legado).
 */
function normalizeRpgRow(dbRow = {}) {
    const isRpg = String(dbRow.modelo_avaliacao || '').toLowerCase() === 'rpg';
    const scoreTotal = Number(dbRow.score_total || 0);
    const rankInfo = classifyRpgRank(scoreTotal);
    const criterios = safeParseCriteriaJson(dbRow.criterios_json);

    return {
        ...dbRow,
        is_rpg: isRpg,
        modelo_avaliacao: isRpg ? 'rpg' : 'legado',
        apto_sparring: Boolean(dbRow.apto_sparring),
        pilares: {
            inteligencia: Number(dbRow.score_inteligencia || 0),
            destreza: Number(dbRow.score_destreza || 0),
            agilidade: Number(dbRow.score_agilidade || 0),
            forca: Number(dbRow.score_forca || 0),
            vitalidade: Number(dbRow.score_vitalidade || 0)
        },
        score_total: scoreTotal,
        rank_combate: dbRow.rank_combate || rankInfo.codigo,
        rank_titulo: dbRow.rank_titulo || rankInfo.titulo,
        rank_cor: rankInfo.cor,
        criterios,
        observacoes_instrutor: dbRow.observacoes || null
    };
}

/**
 * Calcula deltas evolutivos entre avaliação atual e anterior.
 */
function computeRpgDeltas(currentEval, previousEval) {
    if (!currentEval || !previousEval || !currentEval.is_rpg || !previousEval.is_rpg) {
        return null;
    }

    const curP = currentEval.pilares || {};
    const prevP = previousEval.pilares || {};

    return {
        score_total: Number(currentEval.score_total || 0) - Number(previousEval.score_total || 0),
        pilares: {
            inteligencia: Number(curP.inteligencia || 0) - Number(prevP.inteligencia || 0),
            destreza: Number(curP.destreza || 0) - Number(prevP.destreza || 0),
            agilidade: Number(curP.agilidade || 0) - Number(prevP.agilidade || 0),
            forca: Number(curP.forca || 0) - Number(prevP.forca || 0),
            vitalidade: Number(curP.vitalidade || 0) - Number(prevP.vitalidade || 0)
        }
    };
}

module.exports = {
    RPG_PILLARS,
    RPG_CRITERIA,
    CRITERIA_BY_ID,
    classifyRpgRank,
    evaluateRpgPayload,
    normalizeRpgRow,
    computeRpgDeltas
};
