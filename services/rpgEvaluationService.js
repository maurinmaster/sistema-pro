/**
 * PRO COMBATE - Domínio de Avaliação Técnica Gamificada (Estilo RPG - Muay Thai)
 * Define os 5 pilares, os 20 critérios técnicos (escala 0..10), trava de sparring (teto 6),
 * cálculo de pontuações (0..20 por pilar | 0..100 geral), classificação de Rank (D..S)
 * e comparação evolutiva (deltas), com conversão retroativa automática de registros antigos (0..5).
 */

const RPG_CRITERIA_MAX = 10;
const RPG_SPARRING_CAP = 6;

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
            6: 'Domina 1 distância',
            8: 'Domina 2 distâncias',
            10: 'Domínio total: longa, média e curta'
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
const PILLARS_BY_ID = new Map(RPG_PILLARS.map(p => [p.id, p]));

const RPG_RANK_ORDER = { D: 1, C: 2, B: 3, A: 4, S: 5 };
const RPG_RANK_MIN_SCORE = { D: 0, C: 26, B: 51, A: 76, S: 91 };

const RPG_ARCHETYPE_PAIRS = {
    'destreza+inteligencia': {
        id: 'estrategista_cirurgico',
        titulo: 'Estrategista Cirúrgico',
        subtitulo: 'Combina leitura tática apurada com execução técnica precisa',
        cor: '#a855f7'
    },
    'forca+vitalidade': {
        id: 'tanque_de_pressao',
        titulo: 'Tanque de Pressão',
        subtitulo: 'Impõe ritmo pesado, absorve pressão e mantém volume físico',
        cor: '#ef4444'
    },
    'agilidade+destreza': {
        id: 'velocista_francoatirador',
        titulo: 'Velocista / Francoatirador',
        subtitulo: 'Entra e sai rápido com precisão cirúrgica nos alvos',
        cor: '#22c55e'
    },
    'forca+inteligencia': {
        id: 'controlador_de_clinch',
        titulo: 'Controlador de Clinch',
        subtitulo: 'Domina a curta distância neutralizando o oponente com inteligência e força',
        cor: '#f97316'
    },
    'agilidade+inteligencia': {
        id: 'contra_atacante_fantasma',
        titulo: 'Contra-Atacante Fantasma',
        subtitulo: 'Lê as intenções do adversário e responde antes da guarda fechar',
        cor: '#38bdf8'
    },
    'agilidade+vitalidade': {
        id: 'ritmo_incessante',
        titulo: 'Ritmo Incessante',
        subtitulo: 'Movimentação contínua com fôlego constante do 1º ao último round',
        cor: '#10b981'
    },
    'destreza+forca': {
        id: 'nocauteador_tecnico',
        titulo: 'Nocauteador Técnico',
        subtitulo: 'Une alinhamento biomecânico limpo com potência máxima de impacto',
        cor: '#f59e0b'
    },
    'destreza+vitalidade': {
        id: 'guerreiro_resiliente',
        titulo: 'Guerreiro Resiliente',
        subtitulo: 'Mantém técnica limpa, guarda fechada e postura firme mesmo sob fadiga',
        cor: '#ec4899'
    },
    'inteligencia+vitalidade': {
        id: 'mestre_da_cadencia',
        titulo: 'Mestre da Cadência',
        subtitulo: 'Administra energia, respiração e distância para vencer nos momentos decisivos',
        cor: '#06b6d4'
    },
    'agilidade+forca': {
        id: 'explosao_pura',
        titulo: 'Explosão Pura',
        subtitulo: 'Combina velocidade de execução com combinações pesadas de alto impacto',
        cor: '#fb7185'
    }
};

const RPG_BADGES_CATALOG = [
    {
        id: 'muralha',
        nome: 'Muralha',
        icone: '/assets/icones-conquistas/guerreiro-1.webp',
        cor: '#38bdf8',
        criterios_ids: ['defesas', 'manutencao_guarda_fadiga'],
        requisito: 'Atingir nota 10/10 em Defesas e 10/10 em Manutenção de guarda sob fadiga',
        check: (c) => Number(c.defesas) === 10 && Number(c.manutencao_guarda_fadiga) === 10
    },
    {
        id: 'sniper',
        nome: 'Sniper',
        icone: '/assets/icones-conquistas/guerreiro-2.webp',
        cor: '#a855f7',
        criterios_ids: ['precisao', 'contra_ataques'],
        requisito: 'Atingir nota 10/10 em Precisão e 10/10 em Contra-ataques',
        check: (c) => Number(c.precisao) === 10 && Number(c.contra_ataques) === 10
    },
    {
        id: 'pulmao_de_aco',
        nome: 'Pulmão de Aço',
        icone: '/assets/icones-conquistas/guerreiro-3.webp',
        cor: '#ef4444',
        criterios_ids: ['resistencia_cardiovascular', 'recuperacao_entre_rounds'],
        requisito: 'Atingir nota 10/10 em Resistência cardiovascular (Gás) e 10/10 em Recuperação entre rounds',
        check: (c) => Number(c.resistencia_cardiovascular) === 10 && Number(c.recuperacao_entre_rounds) === 10
    },
    {
        id: 'parceiro_confianca',
        nome: 'Parceiro de Confiança',
        icone: '/assets/icones-conquistas/aperto-de-maos.webp',
        cor: '#10b981',
        criterios_ids: ['controle_forca_golpes', 'controle_emocional_sparring'],
        requisito: 'Estar Apto para Sparring e atingir 10/10 em Controle de força nos golpes e 10/10 em Controle emocional no sparring',
        check: (c, aptoSparring) => aptoSparring !== false && Number(c.controle_forca_golpes) === 10 && Number(c.controle_emocional_sparring) === 10
    },
    {
        id: 'rei_do_clinch',
        nome: 'Rei do Clinch',
        icone: '/assets/icones-conquistas/luvas-douradas.webp',
        cor: '#f59e0b',
        criterios_ids: ['dominio_clinch_tatico', 'saidas_clinch', 'forca_isometrica_clinch'],
        requisito: 'Atingir nota 10/10 em Domínio do clinch (Tático), Saídas de clinch e Força isométrica no Clinch',
        check: (c) => Number(c.dominio_clinch_tatico) === 10 && Number(c.saidas_clinch) === 10 && Number(c.forca_isometrica_clinch) === 10
    },
    {
        id: 'intocavel',
        nome: 'Intocável',
        icone: '/assets/icones-conquistas/lutador-5-estrelas.webp',
        cor: '#22c55e',
        criterios_ids: ['jogo_pernas_footwork', 'tempo_reacao'],
        requisito: 'Atingir nota 10/10 em Jogo de pernas (Footwork e Ângulos) e 10/10 em Tempo de reação',
        check: (c) => Number(c.jogo_pernas_footwork) === 10 && Number(c.tempo_reacao) === 10
    }
];

/**
 * Classifica o Arquétipo automático de lutador a partir dos 5 atributos (0..20).
 */
function computeFighterArchetype(pilares = {}, scoreTotal = null) {
    const entries = RPG_PILLARS.map((pillar, idx) => ({
        id: pillar.id,
        nome: pillar.nome,
        sigla: pillar.sigla,
        idx,
        score: Math.max(0, Math.min(20, Number(pilares?.[pillar.id] ?? 0) || 0))
    }));

    const totalCalculado = entries.reduce((sum, e) => sum + e.score, 0);
    const total = scoreTotal !== null && scoreTotal !== undefined ? Number(scoreTotal) || 0 : totalCalculado;

    if (total <= 0) {
        return {
            id: 'em_formacao',
            titulo: 'Em Formação',
            subtitulo: 'Aguardando evolução nos atributos técnicos',
            top_pilares: [],
            equilibrado: false,
            cor: '#94a3b8'
        };
    }

    const scores = entries.map(e => e.score);
    const maxVal = Math.max(...scores);
    const minVal = Math.min(...scores);

    if (maxVal - minVal <= 2) {
        return {
            id: 'lutador_completo',
            titulo: 'Lutador Completo (All-Rounder)',
            subtitulo: 'Atributos equilibrados em todas as dimensões de combate (variação <= 2 pts)',
            top_pilares: [],
            equilibrado: true,
            cor: '#38bdf8'
        };
    }

    const sorted = [...entries].sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
    const top1 = sorted[0];
    const top2 = sorted[1];
    const pairKey = [top1.id, top2.id].sort().join('+');
    const matched = RPG_ARCHETYPE_PAIRS[pairKey];

    return {
        id: matched ? matched.id : pairKey,
        titulo: matched ? matched.titulo : `${top1.nome} + ${top2.nome}`,
        subtitulo: matched ? matched.subtitulo : `Predominância em ${top1.nome} e ${top2.nome}`,
        top_pilares: [top1.id, top2.id],
        equilibrado: false,
        cor: matched ? matched.cor : '#38bdf8'
    };
}

/**
 * Avalia quais das 6 insígnias RPG estão desbloqueadas pelos critérios.
 */
function computeRpgBadges(criteriosMap = null, aptoSparring = true) {
    const hasCriteria = Boolean(criteriosMap && typeof criteriosMap === 'object' && !Array.isArray(criteriosMap));
    const safeCriteria = hasCriteria ? criteriosMap : {};

    return RPG_BADGES_CATALOG.map((badge) => {
        const desbloqueada = hasCriteria ? Boolean(badge.check(safeCriteria, aptoSparring)) : false;
        return {
            id: badge.id,
            nome: badge.nome,
            icone: badge.icone,
            cor: badge.cor,
            criterios_ids: [...badge.criterios_ids],
            requisito: badge.requisito,
            desbloqueada
        };
    });
}

/**
 * Identifica os 2 critérios de menor pontuação (desempatando pelo pilar com menor nota geral).
 */
function computeTrainingFocus(criteriosMap = null, pilares = {}) {
    if (!criteriosMap || typeof criteriosMap !== 'object' || Array.isArray(criteriosMap)) {
        return null;
    }

    const ranked = RPG_CRITERIA.map((criterion) => {
        const raw = Number(criteriosMap[criterion.id] ?? 0);
        const nota = Number.isFinite(raw) ? Math.max(0, Math.min(RPG_CRITERIA_MAX, raw)) : 0;
        const pilarScore = Number(pilares?.[criterion.pilar] ?? 0) || 0;
        const pillarMeta = PILLARS_BY_ID.get(criterion.pilar);
        return {
            id: criterion.id,
            numero: criterion.numero,
            nome: criterion.nome,
            pilar: criterion.pilar,
            pilar_nome: pillarMeta ? pillarMeta.nome : criterion.pilar,
            pilar_cor: pillarMeta ? pillarMeta.cor : '#94a3b8',
            nota,
            pilar_score: pilarScore
        };
    });

    ranked.sort((a, b) => (a.nota - b.nota) || (a.pilar_score - b.pilar_score) || (a.numero - b.numero));

    const foco = ranked.slice(0, 2);
    if (foco.length < 2) return null;

    const [c1, c2] = foco;
    const todosNoMaximo = c1.nota === RPG_CRITERIA_MAX && c2.nota === RPG_CRITERIA_MAX;
    const mensagem = todosNoMaximo
        ? 'Domínio máximo em todos os 20 critérios técnicos! Foco em consistência de combate.'
        : `Melhorar ${c1.nome} (${c1.nota}/${RPG_CRITERIA_MAX}) e ${c2.nome} (${c2.nota}/${RPG_CRITERIA_MAX}) para a próxima avaliação.`;

    return {
        titulo: 'Foco de Treino / Missão Atual',
        criterios: foco,
        mensagem
    };
}

/**
 * Avalia elegibilidade e pendências da avaliação RPG atual frente à próxima graduação (Trava de Progressão).
 */
function evaluateExamProgressionLock(avaliacaoAtual = null, proximaGraduacao = null) {
    if (!proximaGraduacao) return null;

    const proxId = proximaGraduacao.id || proximaGraduacao.nivel_id || null;
    const proxNome = proximaGraduacao.nome || proximaGraduacao.nivel_nome || 'Próxima Graduação';
    const rankMinRaw = proximaGraduacao.rpg_rank_minimo ? String(proximaGraduacao.rpg_rank_minimo).trim().toUpperCase() : null;
    const rankMinimo = rankMinRaw && RPG_RANK_ORDER[rankMinRaw] ? rankMinRaw : null;

    const minAttrRaw = proximaGraduacao.rpg_pontuacao_minima_atributo;
    const minAtributo = (minAttrRaw !== null && minAttrRaw !== undefined && minAttrRaw !== '' && Number(minAttrRaw) > 0)
        ? Math.min(20, Math.max(1, Math.round(Number(minAttrRaw))))
        : null;

    const exigeSparring = Boolean(Number(proximaGraduacao.rpg_exige_apto_sparring));

    if (!rankMinimo && !minAtributo && !exigeSparring) {
        return {
            possui_requisitos_rpg: false,
            proxima_graduacao_id: proxId,
            proxima_graduacao_nome: proxNome,
            cor_primaria: proximaGraduacao.cor_hex_primaria || proximaGraduacao.cor_primaria || '#ffffff',
            cor_secundaria: proximaGraduacao.cor_hex_secundaria || proximaGraduacao.cor_secundaria || '#111827',
            requisitos: {
                rank_minimo: null,
                pontuacao_minima_por_atributo: null,
                exige_apto_sparring: false
            },
            elegivel: true,
            progresso_pct: 100,
            checks: [],
            pendencias: [],
            resumo: 'Sem requisitos RPG mínimos configurados para esta graduação.'
        };
    }

    const checks = [];
    const pendencias = [];
    const progressParts = [];
    const temAvaliacao = Boolean(avaliacaoAtual && avaliacaoAtual.is_rpg !== false);

    if (rankMinimo) {
        const currentRank = temAvaliacao ? String(avaliacaoAtual.rank_combate || 'D').toUpperCase() : null;
        const currentScore = temAvaliacao ? Number(avaliacaoAtual.score_total || 0) : 0;
        const targetMinScore = RPG_RANK_MIN_SCORE[rankMinimo];
        const atingido = Boolean(temAvaliacao && currentRank && RPG_RANK_ORDER[currentRank] >= RPG_RANK_ORDER[rankMinimo]);

        let ratio = 0;
        if (atingido) {
            ratio = 1;
        } else if (temAvaliacao && targetMinScore > 0) {
            ratio = Math.min(1, Math.max(0, currentScore / targetMinScore));
        }
        progressParts.push(ratio);

        let detalhe = '';
        if (!temAvaliacao) {
            detalhe = `Rank mínimo ${rankMinimo} (${targetMinScore}+ pts) — aguardando avaliação RPG`;
            pendencias.push(`Atingir Rank ${rankMinimo} (${targetMinScore}+ pts) — nenhuma avaliação RPG registrada`);
        } else if (atingido) {
            detalhe = `Atingido: Rank ${currentRank} (${currentScore}/100 pts)`;
        } else {
            const falta = Math.max(1, targetMinScore - currentScore);
            detalhe = `Atual Rank ${currentRank} (${currentScore}/100) — faltam +${falta} pts para Rank ${rankMinimo}`;
            pendencias.push(`Rank ${rankMinimo}: faltam +${falta} pts no total (atual: Rank ${currentRank}, ${currentScore} pts)`);
        }

        checks.push({
            tipo: 'rank_minimo',
            label: `Rank Mínimo ${rankMinimo}`,
            atingido,
            detalhe
        });
    }

    if (minAtributo) {
        const pilaresMap = temAvaliacao ? (avaliacaoAtual.pilares || {}) : {};
        let ratiosSum = 0;
        const faltasPilares = [];

        for (const p of RPG_PILLARS) {
            const val = temAvaliacao ? Number(pilaresMap[p.id] ?? 0) : 0;
            ratiosSum += Math.min(1, Math.max(0, val / minAtributo));
            if (!temAvaliacao || val < minAtributo) {
                const diff = minAtributo - val;
                faltasPilares.push(`${p.nome}: ${val}/${minAtributo} pts (faltam +${diff})`);
            }
        }

        const avgRatio = ratiosSum / RPG_PILLARS.length;
        progressParts.push(avgRatio);

        const atingido = temAvaliacao && faltasPilares.length === 0;
        if (!atingido) {
            for (const fp of faltasPilares) {
                pendencias.push(fp);
            }
        }

        checks.push({
            tipo: 'pontuacao_minima_por_atributo',
            label: `Nenhum atributo abaixo de ${minAtributo}/20 pts`,
            atingido,
            detalhe: atingido
                ? `Todos os 5 atributos atingiram o piso de ${minAtributo} pts`
                : faltasPilares.join(' • ')
        });
    }

    if (exigeSparring) {
        const atingido = Boolean(temAvaliacao && avaliacaoAtual.apto_sparring);
        progressParts.push(atingido ? 1 : 0);

        if (!atingido) {
            pendencias.push('Necessário estar liberado como "Apto para Sparring"');
        }

        checks.push({
            tipo: 'exige_apto_sparring',
            label: 'Apto para Sparring',
            atingido,
            detalhe: atingido
                ? 'Atleta liberado para Sparring Livre'
                : (temAvaliacao ? 'Atualmente em Simulado Controlado (não apto)' : 'Aguardando avaliação com liberação de sparring')
        });
    }

    const progressoPct = progressParts.length > 0
        ? Math.round((progressParts.reduce((a, b) => a + b, 0) / progressParts.length) * 100)
        : 100;

    return {
        possui_requisitos_rpg: true,
        proxima_graduacao_id: proxId,
        proxima_graduacao_nome: proxNome,
        cor_primaria: proximaGraduacao.cor_hex_primaria || proximaGraduacao.cor_primaria || '#ffffff',
        cor_secundaria: proximaGraduacao.cor_hex_secundaria || proximaGraduacao.cor_secundaria || '#111827',
        requisitos: {
            rank_minimo: rankMinimo,
            pontuacao_minima_por_atributo: minAtributo,
            exige_apto_sparring: exigeSparring
        },
        elegivel: pendencias.length === 0,
        progresso_pct: Math.min(100, Math.max(0, progressoPct)),
        checks,
        pendencias
    };
}

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
 * Normaliza mapa de critérios para a escala atual 0..10, convertendo automaticamente
 * avaliações antigas gravadas na escala legada 0..5.
 */
function normalizeCriteriaToScale10(rawCriteria, scoreTotal = null) {
    if (!rawCriteria || typeof rawCriteria !== 'object' || Array.isArray(rawCriteria)) {
        return null;
    }

    const explicitMax = Number(rawCriteria._escala_max);
    let maxVal = 0;
    let sumVal = 0;
    const clean = {};

    for (const c of RPG_CRITERIA) {
        const raw = Number(rawCriteria[c.id] ?? 0);
        const val = Number.isFinite(raw) ? Math.max(0, Math.min(RPG_CRITERIA_MAX, Math.round(raw))) : 0;
        clean[c.id] = val;
        if (val > maxVal) maxVal = val;
        sumVal += val;
    }

    const parsedScore = (scoreTotal !== null && scoreTotal !== undefined && scoreTotal !== '')
        ? Number(scoreTotal)
        : null;

    const isLegacyScale5 = (
        explicitMax !== RPG_CRITERIA_MAX &&
        maxVal <= 5 &&
        sumVal > 0 &&
        parsedScore !== null &&
        Number.isFinite(parsedScore) &&
        Math.abs(sumVal - parsedScore) <= Math.abs((sumVal / 2) - parsedScore)
    );

    if (isLegacyScale5) {
        for (const c of RPG_CRITERIA) {
            clean[c.id] = Math.min(RPG_CRITERIA_MAX, clean[c.id] * 2);
        }
    }

    return clean;
}

/**
 * Valida, aplica a trava de sparring (máx 6 nos critérios [SPARRING] quando apto_sparring = false),
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
            error: 'Informe as notas (0 a 10) para todos os 20 critérios técnicos RPG.'
        };
    }

    const criteriosSanitizados = {};
    const pilaresRaw = {
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
        if (!Number.isInteger(num) || num < 0 || num > RPG_CRITERIA_MAX) {
            return {
                valid: false,
                error: `A nota do critério "${criterion.nome}" deve ser um número inteiro de 0 a ${RPG_CRITERIA_MAX}.`
            };
        }

        let finalVal = num;
        if (!aptoSparring && criterion.isSparring && finalVal > RPG_SPARRING_CAP) {
            finalVal = RPG_SPARRING_CAP;
            travaSparringAplicada = true;
        }

        criteriosSanitizados[criterion.id] = finalVal;
        pilaresRaw[criterion.pilar] += finalVal;
    }

    const pilares = {
        inteligencia: Math.round(pilaresRaw.inteligencia / 2),
        destreza: Math.round(pilaresRaw.destreza / 2),
        agilidade: Math.round(pilaresRaw.agilidade / 2),
        forca: Math.round(pilaresRaw.forca / 2),
        vitalidade: Math.round(pilaresRaw.vitalidade / 2)
    };

    const scoreTotal = (
        pilares.inteligencia +
        pilares.destreza +
        pilares.agilidade +
        pilares.forca +
        pilares.vitalidade
    );
    const rank = classifyRpgRank(scoreTotal);
    const arquetipo = computeFighterArchetype(pilares, scoreTotal);
    const badges = computeRpgBadges(criteriosSanitizados, aptoSparring);
    const badgesDesbloqueadas = badges.filter(b => b.desbloqueada);
    const focoEvolucao = computeTrainingFocus(criteriosSanitizados, pilares);

    let dataAval = body.data_avaliacao;
    if (!dataAval || !/^\d{4}-\d{2}-\d{2}$/.test(String(dataAval).trim())) {
        dataAval = new Date().toISOString().split('T')[0];
    } else {
        dataAval = String(dataAval).trim();
    }

    const rawObs = body.observacoes_instrutor !== undefined ? body.observacoes_instrutor : body.observacoes;
    const observacoesInstrutor = rawObs ? String(rawObs).trim().substring(0, 1000) : null;

    // Equivalentes legados (0..10) apenas para manter colunas antigas NOT NULL consistentes
    const notaClinch = Number((((criteriosSanitizados.dominio_clinch_tatico + criteriosSanitizados.forca_isometrica_clinch + criteriosSanitizados.saidas_clinch) / 30) * 10).toFixed(1));
    const notaSocos = Number((((criteriosSanitizados.precisao + criteriosSanitizados.explosao_combinacoes) / 20) * 10).toFixed(1));
    const notaChutes = Number((((criteriosSanitizados.velocidade_execucao + criteriosSanitizados.potencia_impacto) / 20) * 10).toFixed(1));
    const notaPostura = Number((((criteriosSanitizados.postura_base + criteriosSanitizados.defesas) / 20) * 10).toFixed(1));
    const notaClinchSparring = Number((((pilares.destreza + pilares.inteligencia) / 40) * 10).toFixed(1));
    const notaCondicionamento = Number(((pilares.vitalidade / 20) * 10).toFixed(1));

    return {
        valid: true,
        data: {
            modelo_avaliacao: 'rpg',
            escala_criterios: RPG_CRITERIA_MAX,
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
            arquetipo,
            badges,
            badges_desbloqueadas: badgesDesbloqueadas,
            foco_evolucao: focoEvolucao,
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
    const criteriosRaw = safeParseCriteriaJson(dbRow.criterios_json || dbRow.criterios);
    const criterios = isRpg ? normalizeCriteriaToScale10(criteriosRaw, scoreTotal) : criteriosRaw;
    const pilares = {
        inteligencia: Number(dbRow.score_inteligencia || 0),
        destreza: Number(dbRow.score_destreza || 0),
        agilidade: Number(dbRow.score_agilidade || 0),
        forca: Number(dbRow.score_forca || 0),
        vitalidade: Number(dbRow.score_vitalidade || 0)
    };
    const aptoSparring = Boolean(dbRow.apto_sparring);
    const arquetipo = isRpg ? computeFighterArchetype(pilares, scoreTotal) : null;
    const badges = isRpg ? computeRpgBadges(criterios, aptoSparring) : computeRpgBadges(null, false);
    const badgesDesbloqueadas = badges.filter(b => b.desbloqueada);
    const focoEvolucao = isRpg ? computeTrainingFocus(criterios, pilares) : null;

    return {
        ...dbRow,
        is_rpg: isRpg,
        escala_criterios: RPG_CRITERIA_MAX,
        modelo_avaliacao: isRpg ? 'rpg' : 'legado',
        apto_sparring: aptoSparring,
        pilares,
        score_total: scoreTotal,
        rank_combate: dbRow.rank_combate || rankInfo.codigo,
        rank_titulo: dbRow.rank_titulo || rankInfo.titulo,
        rank_cor: rankInfo.cor,
        arquetipo,
        badges,
        badges_desbloqueadas: badgesDesbloqueadas,
        foco_evolucao: focoEvolucao,
        criterios,
        observacoes_instrutor: dbRow.observacoes || dbRow.observacoes_instrutor || null
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
    RPG_CRITERIA_MAX,
    RPG_SPARRING_CAP,
    RPG_PILLARS,
    RPG_CRITERIA,
    CRITERIA_BY_ID,
    RPG_RANK_ORDER,
    RPG_RANK_MIN_SCORE,
    RPG_ARCHETYPE_PAIRS,
    RPG_BADGES_CATALOG,
    classifyRpgRank,
    computeFighterArchetype,
    computeRpgBadges,
    computeTrainingFocus,
    evaluateExamProgressionLock,
    normalizeCriteriaToScale10,
    evaluateRpgPayload,
    normalizeRpgRow,
    computeRpgDeltas
};
