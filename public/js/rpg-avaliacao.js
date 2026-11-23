/**
 * PRO COMBATE - Biblioteca de Visualização, Gamificação Avançada e Cálculo da Avaliação Técnica RPG (Muay Thai)
 * Compartilhada entre Admin (Dossiê 360°) e Portal do Aluno.
 */
(function (global) {
    const PILLARS = [
        { id: 'inteligencia', nome: 'Inteligência', sigla: 'INT', subtitulo: 'Leitura tática e controle mental', cor: '#38bdf8' },
        { id: 'destreza', nome: 'Destreza', sigla: 'DES', subtitulo: 'Técnica pura, precisão e postura', cor: '#a855f7' },
        { id: 'agilidade', nome: 'Agilidade', sigla: 'AGI', subtitulo: 'Velocidade, reflexo e mobilidade', cor: '#22c55e' },
        { id: 'forca', nome: 'Força', sigla: 'FOR', subtitulo: 'Potência, controle de impacto e isometria', cor: '#f97316' },
        { id: 'vitalidade', nome: 'Vitalidade', sigla: 'VIT', subtitulo: 'Resistência, fôlego e recuperação', cor: '#ef4444' }
    ];

    const CRITERIA = [
        // Inteligência
        { numero: 1, id: 'controle_emocional_sparring', pilar: 'inteligencia', nome: 'Controle emocional no sparring', isSparring: true, minLabel: 'Afobado / perde a calma', maxLabel: 'Frio e estratégico sob pressão' },
        {
            numero: 2, id: 'controle_distancia', pilar: 'inteligencia', nome: 'Controle de distância', isSparring: false,
            minLabel: 'Não domina', maxLabel: 'Domínio total: longa, média e curta',
            landmarks: { 0: '0: Não domina', 3: '3: 1 distância', 4: '4: 2 distâncias', 5: '5: Longa, média e curta' }
        },
        { numero: 3, id: 'contra_ataques', pilar: 'inteligencia', nome: 'Contra-ataques', isSparring: false, minLabel: 'Nulo ou reativo sem critério', maxLabel: 'Lê o golpe e responde na janela exata' },
        { numero: 4, id: 'dominio_clinch_tatico', pilar: 'inteligencia', nome: 'Domínio do clinch (Tático)', isSparring: false, minLabel: 'Perdido na curta distância', maxLabel: 'Sabe travar, desequilibrar e pontuar' },
        // Destreza
        { numero: 5, id: 'controle_tecnica_sparring', pilar: 'destreza', nome: 'Controle de técnica no sparring', isSparring: true, minLabel: 'Perde a forma na luta', maxLabel: 'Execução limpa compatível com a graduação atual' },
        { numero: 6, id: 'postura_base', pilar: 'destreza', nome: 'Postura e Base', isSparring: false, minLabel: 'Desequilibrado / cruza pernas', maxLabel: 'Base sólida e eixo alinhado' },
        { numero: 7, id: 'precisao', pilar: 'destreza', nome: 'Precisão', isSparring: false, minLabel: 'Golpes no vazio ou na guarda', maxLabel: 'Atinge os alvos limpos com eficiência' },
        { numero: 8, id: 'defesas', pilar: 'destreza', nome: 'Defesas', isSparring: false, minLabel: 'Guarda vazada / aceita golpes', maxLabel: 'Bloqueios, esquivas e aparos eficientes' },
        // Agilidade
        { numero: 9, id: 'velocidade_execucao', pilar: 'agilidade', nome: 'Velocidade de execução', isSparring: false, minLabel: 'Muito lento / telegrafado', maxLabel: 'Rápido e explosivo' },
        { numero: 10, id: 'tempo_reacao', pilar: 'agilidade', nome: 'Tempo de reação', isSparring: false, minLabel: 'Lento para responder', maxLabel: 'Ataca ou defende antes do oponente fechar a guarda' },
        { numero: 11, id: 'saidas_clinch', pilar: 'agilidade', nome: 'Saídas de clinch', isSparring: false, minLabel: 'Fica preso', maxLabel: 'Escapa rápido com giro, esgrima ou empurrão' },
        { numero: 12, id: 'jogo_pernas_footwork', pilar: 'agilidade', nome: 'Jogo de pernas (Footwork e Ângulos)', isSparring: false, minLabel: 'Plantado / anda em linha reta', maxLabel: 'Entra, sai e angula com fluidez' },
        // Força
        { numero: 13, id: 'controle_forca_golpes', pilar: 'forca', nome: 'Controle de força nos golpes', isSparring: true, minLabel: 'Sem controle / machuca o parceiro', maxLabel: 'Total controle; dosa o impacto conforme o colega' },
        { numero: 14, id: 'potencia_impacto', pilar: 'forca', nome: 'Potência de impacto (Aparador / Saco)', isSparring: false, minLabel: 'Golpes empurrados sem peso', maxLabel: 'Transferência máxima de quadril e peso corporal' },
        { numero: 15, id: 'forca_isometrica_clinch', pilar: 'forca', nome: 'Força isométrica no Clinch', isSparring: false, minLabel: 'Cede fácil à pressão na nuca/braços', maxLabel: 'Sustenta a postura e impõe peso físico' },
        { numero: 16, id: 'explosao_combinacoes', pilar: 'forca', nome: 'Explosão em combinações (Cadência)', isSparring: false, minLabel: 'Perde potência após o 1º golpe', maxLabel: 'Mantém impacto pesado do início ao fim' },
        // Vitalidade
        { numero: 17, id: 'resistencia_cardiovascular', pilar: 'vitalidade', nome: 'Resistência cardiovascular (Gás)', isSparring: false, minLabel: 'Exausto no 1º round', maxLabel: 'Mantém volume constante até o fim' },
        { numero: 18, id: 'recuperacao_entre_rounds', pilar: 'vitalidade', nome: 'Recuperação entre rounds', isSparring: false, minLabel: 'Demora a estabilizar a respiração', maxLabel: 'Recupera o fôlego rapidamente nos 60s de intervalo' },
        { numero: 19, id: 'absorcao_resiliencia', pilar: 'vitalidade', nome: 'Absorção e resiliência', isSparring: false, minLabel: 'Recua ou vira de costas ao sentir golpes', maxLabel: 'Mantém guarda fechada e postura sob pressão' },
        { numero: 20, id: 'manutencao_guarda_fadiga', pilar: 'vitalidade', nome: 'Manutenção de guarda sob fadiga', isSparring: false, minLabel: 'Braços caem quando cansa', maxLabel: 'Mantém guarda alta e cotovelos fechados no último round' }
    ];

    const RANK_ORDER = { D: 1, C: 2, B: 3, A: 4, S: 5 };
    const RANK_MIN_SCORE = { D: 0, C: 26, B: 51, A: 76, S: 91 };

    const ARCHETYPE_PAIRS = {
        'destreza+inteligencia': { id: 'estrategista_cirurgico', titulo: 'Estrategista Cirúrgico', subtitulo: 'Combina leitura tática apurada com execução técnica precisa', cor: '#a855f7' },
        'forca+vitalidade': { id: 'tanque_de_pressao', titulo: 'Tanque de Pressão', subtitulo: 'Impõe ritmo pesado, absorve pressão e mantém volume físico', cor: '#ef4444' },
        'agilidade+destreza': { id: 'velocista_francoatirador', titulo: 'Velocista / Francoatirador', subtitulo: 'Entra e sai rápido com precisão cirúrgica nos alvos', cor: '#22c55e' },
        'forca+inteligencia': { id: 'controlador_de_clinch', titulo: 'Controlador de Clinch', subtitulo: 'Domina a curta distância neutralizando o oponente com inteligência e força', cor: '#f97316' },
        'agilidade+inteligencia': { id: 'contra_atacante_fantasma', titulo: 'Contra-Atacante Fantasma', subtitulo: 'Lê as intenções do adversário e responde antes da guarda fechar', cor: '#38bdf8' },
        'agilidade+vitalidade': { id: 'ritmo_incessante', titulo: 'Ritmo Incessante', subtitulo: 'Movimentação contínua com fôlego constante do 1º ao último round', cor: '#10b981' },
        'destreza+forca': { id: 'nocauteador_tecnico', titulo: 'Nocauteador Técnico', subtitulo: 'Une alinhamento biomecânico limpo com potência máxima de impacto', cor: '#f59e0b' },
        'destreza+vitalidade': { id: 'guerreiro_resiliente', titulo: 'Guerreiro Resiliente', subtitulo: 'Mantém técnica limpa, guarda fechada e postura firme mesmo sob fadiga', cor: '#ec4899' },
        'inteligencia+vitalidade': { id: 'mestre_da_cadencia', titulo: 'Mestre da Cadência', subtitulo: 'Administra energia, respiração e distância para vencer nos momentos decisivos', cor: '#06b6d4' },
        'agilidade+forca': { id: 'explosao_pura', titulo: 'Explosão Pura', subtitulo: 'Combina velocidade de execução com combinações pesadas de alto impacto', cor: '#fb7185' }
    };

    const BADGES_CATALOG = [
        {
            id: 'muralha', nome: 'Muralha', icone: '🛡️', cor: '#38bdf8',
            criterios_ids: ['defesas', 'manutencao_guarda_fadiga'],
            requisito: 'Atingir nota 5/5 em Defesas e 5/5 em Manutenção de guarda sob fadiga',
            check: (c) => Number(c.defesas) === 5 && Number(c.manutencao_guarda_fadiga) === 5
        },
        {
            id: 'sniper', nome: 'Sniper', icone: '🎯', cor: '#a855f7',
            criterios_ids: ['precisao', 'contra_ataques'],
            requisito: 'Atingir nota 5/5 em Precisão e 5/5 em Contra-ataques',
            check: (c) => Number(c.precisao) === 5 && Number(c.contra_ataques) === 5
        },
        {
            id: 'pulmao_de_aco', nome: 'Pulmão de Aço', icone: '🫁', cor: '#ef4444',
            criterios_ids: ['resistencia_cardiovascular', 'recuperacao_entre_rounds'],
            requisito: 'Atingir nota 5/5 em Resistência cardiovascular (Gás) e 5/5 em Recuperação entre rounds',
            check: (c) => Number(c.resistencia_cardiovascular) === 5 && Number(c.recuperacao_entre_rounds) === 5
        },
        {
            id: 'parceiro_confianca', nome: 'Parceiro de Confiança', icone: '🤝', cor: '#10b981',
            criterios_ids: ['controle_forca_golpes', 'controle_emocional_sparring'],
            requisito: 'Estar Apto para Sparring e atingir 5/5 em Controle de força nos golpes e 5/5 em Controle emocional no sparring',
            check: (c, aptoSparring) => aptoSparring !== false && Number(c.controle_forca_golpes) === 5 && Number(c.controle_emocional_sparring) === 5
        },
        {
            id: 'rei_do_clinch', nome: 'Rei do Clinch', icone: '👑', cor: '#f59e0b',
            criterios_ids: ['dominio_clinch_tatico', 'saidas_clinch', 'forca_isometrica_clinch'],
            requisito: 'Atingir nota 5/5 em Domínio do clinch (Tático), Saídas de clinch e Força isométrica no Clinch',
            check: (c) => Number(c.dominio_clinch_tatico) === 5 && Number(c.saidas_clinch) === 5 && Number(c.forca_isometrica_clinch) === 5
        },
        {
            id: 'intocavel', nome: 'Intocável', icone: '⚡', cor: '#22c55e',
            criterios_ids: ['jogo_pernas_footwork', 'tempo_reacao'],
            requisito: 'Atingir nota 5/5 em Jogo de pernas (Footwork e Ângulos) e 5/5 em Tempo de reação',
            check: (c) => Number(c.jogo_pernas_footwork) === 5 && Number(c.tempo_reacao) === 5
        }
    ];

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function sanitizeColor(color, fallback = '#38bdf8') {
        if (!color) return fallback;
        const clean = String(color).trim();
        if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(clean)) return clean;
        return fallback;
    }

    function classifyRank(scoreTotal) {
        const s = Math.max(0, Math.min(100, Math.round(Number(scoreTotal) || 0)));
        if (s >= 91) return { codigo: 'S', titulo: 'Elite / Instrutor', cor: '#f43f5e' };
        if (s >= 76) return { codigo: 'A', titulo: 'Competidor', cor: '#f59e0b' };
        if (s >= 51) return { codigo: 'B', titulo: 'Combatente', cor: '#10b981' };
        if (s >= 26) return { codigo: 'C', titulo: 'Praticante', cor: '#38bdf8' };
        return { codigo: 'D', titulo: 'Iniciante', cor: '#94a3b8' };
    }

    function calculateTotals(criteriosMap = {}, aptoSparring = true) {
        const pilares = {
            inteligencia: 0,
            destreza: 0,
            agilidade: 0,
            forca: 0,
            vitalidade: 0
        };
        const sparLocked = aptoSparring === false;

        for (const c of CRITERIA) {
            let val = parseInt(criteriosMap[c.id], 10);
            if (isNaN(val) || val < 0) val = 0;
            if (val > 5) val = 5;
            if (sparLocked && c.isSparring && val > 3) val = 3;
            pilares[c.pilar] += val;
        }

        const total = pilares.inteligencia + pilares.destreza + pilares.agilidade + pilares.forca + pilares.vitalidade;
        return {
            pilares,
            total,
            rank: classifyRank(total),
            arquetipo: computeArchetype(pilares, total)
        };
    }

    function computeArchetype(pilares = {}, scoreTotal = null) {
        const entries = PILLARS.map((pillar, idx) => ({
            id: pillar.id,
            nome: pillar.nome,
            idx,
            score: Math.max(0, Math.min(20, Number(pilares?.[pillar.id] ?? 0) || 0))
        }));
        const total = scoreTotal !== null && scoreTotal !== undefined
            ? (Number(scoreTotal) || 0)
            : entries.reduce((sum, e) => sum + e.score, 0);

        if (total <= 0) {
            return { id: 'em_formacao', titulo: 'Em Formação', subtitulo: 'Aguardando evolução nos atributos técnicos', top_pilares: [], equilibrado: false, cor: '#94a3b8' };
        }

        const scores = entries.map(e => e.score);
        if (Math.max(...scores) - Math.min(...scores) <= 2) {
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
        const matched = ARCHETYPE_PAIRS[pairKey];

        return {
            id: matched ? matched.id : pairKey,
            titulo: matched ? matched.titulo : `${top1.nome} + ${top2.nome}`,
            subtitulo: matched ? matched.subtitulo : `Predominância em ${top1.nome} e ${top2.nome}`,
            top_pilares: [top1.id, top2.id],
            equilibrado: false,
            cor: matched ? matched.cor : '#38bdf8'
        };
    }

    function computeBadges(criteriosMap = null, aptoSparring = true) {
        const hasCriteria = Boolean(criteriosMap && typeof criteriosMap === 'object' && !Array.isArray(criteriosMap));
        const safeMap = hasCriteria ? criteriosMap : {};
        return BADGES_CATALOG.map((badge) => ({
            id: badge.id,
            nome: badge.nome,
            icone: badge.icone,
            cor: badge.cor,
            criterios_ids: [...badge.criterios_ids],
            requisito: badge.requisito,
            desbloqueada: hasCriteria ? Boolean(badge.check(safeMap, aptoSparring)) : false
        }));
    }

    function computeTrainingFocus(criteriosMap = null, pilares = {}) {
        if (!criteriosMap || typeof criteriosMap !== 'object' || Array.isArray(criteriosMap)) return null;
        const ranked = CRITERIA.map((c) => {
            const pObj = PILLARS.find(p => p.id === c.pilar);
            const nota = Math.max(0, Math.min(5, Number(criteriosMap[c.id] ?? 0) || 0));
            const pilarScore = Number(pilares?.[c.pilar] ?? 0) || 0;
            return {
                id: c.id,
                numero: c.numero,
                nome: c.nome,
                pilar: c.pilar,
                pilar_nome: pObj ? pObj.nome : c.pilar,
                pilar_cor: pObj ? pObj.cor : '#94a3b8',
                nota,
                pilar_score: pilarScore
            };
        });
        ranked.sort((a, b) => (a.nota - b.nota) || (a.pilar_score - b.pilar_score) || (a.numero - b.numero));
        const foco = ranked.slice(0, 2);
        if (foco.length < 2) return null;
        const [c1, c2] = foco;
        const mensagem = (c1.nota === 5 && c2.nota === 5)
            ? 'Domínio máximo em todos os 20 critérios técnicos! Foco em consistência de combate.'
            : `Melhorar ${c1.nome} (${c1.nota}/5) e ${c2.nome} (${c2.nota}/5) para a próxima avaliação.`;
        return { titulo: 'Foco de Treino / Missão Atual', criterios: foco, mensagem };
    }

    function evaluateExamLock(avaliacaoAtual = null, proximaGraduacao = null) {
        if (!proximaGraduacao) return null;
        const rankMinRaw = proximaGraduacao.rpg_rank_minimo ? String(proximaGraduacao.rpg_rank_minimo).trim().toUpperCase() : null;
        const rankMinimo = rankMinRaw && RANK_ORDER[rankMinRaw] ? rankMinRaw : null;
        const minAttrRaw = proximaGraduacao.rpg_pontuacao_minima_atributo;
        const minAtributo = (minAttrRaw !== null && minAttrRaw !== undefined && minAttrRaw !== '' && Number(minAttrRaw) > 0)
            ? Math.min(20, Math.max(1, Math.round(Number(minAttrRaw))))
            : null;
        const exigeSparring = Boolean(Number(proximaGraduacao.rpg_exige_apto_sparring));

        if (!rankMinimo && !minAtributo && !exigeSparring) {
            return { possui_requisitos_rpg: false, proxima_graduacao_nome: proximaGraduacao.nome || proximaGraduacao.nivel_nome || 'Próxima Graduação', elegivel: true, progresso_pct: 100, checks: [], pendencias: [] };
        }

        const checks = [];
        const pendencias = [];
        const parts = [];
        const temAval = Boolean(avaliacaoAtual && avaliacaoAtual.is_rpg !== false);

        if (rankMinimo) {
            const curRank = temAval ? String(avaliacaoAtual.rank_combate || 'D').toUpperCase() : null;
            const curScore = temAval ? Number(avaliacaoAtual.score_total || 0) : 0;
            const targetScore = RANK_MIN_SCORE[rankMinimo];
            const atingido = Boolean(temAval && curRank && RANK_ORDER[curRank] >= RANK_ORDER[rankMinimo]);
            parts.push(atingido ? 1 : (temAval && targetScore > 0 ? Math.min(1, curScore / targetScore) : 0));
            const falta = Math.max(1, targetScore - curScore);
            if (!atingido) {
                pendencias.push(temAval
                    ? `Rank ${rankMinimo}: faltam +${falta} pts no total (atual: Rank ${curRank}, ${curScore} pts)`
                    : `Atingir Rank ${rankMinimo} (${targetScore}+ pts)`);
            }
            checks.push({
                tipo: 'rank_minimo',
                label: `Rank Mínimo ${rankMinimo}`,
                atingido,
                detalhe: atingido ? `Atingido: Rank ${curRank} (${curScore}/100 pts)` : (temAval ? `Atual Rank ${curRank} (${curScore}/100) — faltam +${falta} pts` : `Exige Rank ${rankMinimo} (${targetScore}+ pts)`)
            });
        }

        if (minAtributo) {
            const pMap = temAval ? (avaliacaoAtual.pilares || {}) : {};
            let ratios = 0;
            const faltas = [];
            for (const p of PILLARS) {
                const v = temAval ? Number(pMap[p.id] ?? 0) : 0;
                ratios += Math.min(1, v / minAtributo);
                if (!temAval || v < minAtributo) faltas.push(`${p.nome}: ${v}/${minAtributo} pts (faltam +${minAtributo - v})`);
            }
            parts.push(ratios / PILLARS.length);
            const atingido = temAval && faltas.length === 0;
            if (!atingido) faltas.forEach(f => pendencias.push(f));
            checks.push({
                tipo: 'pontuacao_minima_por_atributo',
                label: `Nenhum atributo abaixo de ${minAtributo}/20 pts`,
                atingido,
                detalhe: atingido ? `Todos os 5 atributos >= ${minAtributo} pts` : faltas.join(' • ')
            });
        }

        if (exigeSparring) {
            const atingido = Boolean(temAval && avaliacaoAtual.apto_sparring);
            parts.push(atingido ? 1 : 0);
            if (!atingido) pendencias.push('Necessário estar liberado como "Apto para Sparring"');
            checks.push({
                tipo: 'exige_apto_sparring',
                label: 'Apto para Sparring',
                atingido,
                detalhe: atingido ? 'Liberado para Sparring Livre' : 'Atualmente não apto para sparring livre'
            });
        }

        const pct = parts.length > 0 ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) : 100;
        return {
            possui_requisitos_rpg: true,
            proxima_graduacao_id: proximaGraduacao.id || proximaGraduacao.nivel_id || null,
            proxima_graduacao_nome: proximaGraduacao.nome || proximaGraduacao.nivel_nome || 'Próxima Graduação',
            cor_primaria: proximaGraduacao.cor_hex_primaria || proximaGraduacao.cor_primaria || '#ffffff',
            cor_secundaria: proximaGraduacao.cor_hex_secundaria || proximaGraduacao.cor_secundaria || '#111827',
            elegivel: pendencias.length === 0,
            progresso_pct: Math.min(100, Math.max(0, pct)),
            checks,
            pendencias
        };
    }

    function computeDeltas(atual, anterior) {
        if (!atual || !anterior) return null;
        const pCur = atual.pilares || {};
        const pPrev = anterior.pilares || {};
        return {
            score_total: Number(atual.score_total || 0) - Number(anterior.score_total || 0),
            pilares: {
                inteligencia: Number(pCur.inteligencia || 0) - Number(pPrev.inteligencia || 0),
                destreza: Number(pCur.destreza || 0) - Number(pPrev.destreza || 0),
                agilidade: Number(pCur.agilidade || 0) - Number(pPrev.agilidade || 0),
                forca: Number(pCur.forca || 0) - Number(pPrev.forca || 0),
                vitalidade: Number(pCur.vitalidade || 0) - Number(pPrev.vitalidade || 0)
            }
        };
    }

    function formatDeltaText(delta, suffix = ' pts') {
        const n = Number(delta);
        if (n === 0) return '0';
        const absVal = Math.abs(n);
        const normSuffix = (suffix && suffix.trim() === 'pts')
            ? (absVal === 1 ? ' pt' : ' pts')
            : (suffix || '');
        return `${n > 0 ? '+' : ''}${n}${normSuffix}`;
    }

    function renderDeltaBadgeHtml(delta, suffix = ' pts') {
        if (delta === null || delta === undefined || isNaN(delta)) return '';
        const n = Number(delta);
        const label = formatDeltaText(n, suffix);
        if (n > 0) return `<span class="rpg-delta-pill pos">${escapeHtml(label)}</span>`;
        if (n < 0) return `<span class="rpg-delta-pill neg">${escapeHtml(label)}</span>`;
        return `<span class="rpg-delta-pill zero">${escapeHtml(label)}</span>`;
    }

    function renderRankBadgeHtml(rankCodigo, rankTitulo, size = 'md') {
        const codigo = String(rankCodigo || 'D').toUpperCase().replace(/[^SDABC]/g, '') || 'D';
        const titulo = escapeHtml(rankTitulo || classifyRank(0).titulo);
        return `
            <div class="rpg-rank-badge rpg-rank-${codigo} rpg-rank-size-${escapeHtml(size)}">
                <span class="rpg-rank-letter">${codigo}</span>
                <div class="rpg-rank-meta">
                    <span class="rpg-rank-tag">RANK ${codigo}</span>
                    <strong class="rpg-rank-title">${titulo}</strong>
                </div>
            </div>
        `;
    }

    function renderArchetypePillHtml(arquetipo) {
        if (!arquetipo || !arquetipo.titulo) return '';
        const color = sanitizeColor(arquetipo.cor, '#38bdf8');
        return `
            <div class="rpg-archetype-pill" style="border-color: ${color}55; background: ${color}14;" title="${escapeHtml(arquetipo.subtitulo || arquetipo.titulo)}">
                <span class="rpg-archetype-tag" style="color: ${color};">⚔️ ESTILO / ARQUÉTIPO</span>
                <strong class="rpg-archetype-title">${escapeHtml(arquetipo.titulo)}</strong>
            </div>
        `;
    }

    function renderSparringBadgeHtml(aptoSparring) {
        if (aptoSparring) {
            return `<span class="rpg-sparring-pill apto">✓ Apto para Sparring</span>`;
        }
        return `<span class="rpg-sparring-pill restrito" title="Critérios de sparring limitados ao teto máximo de 3 pontos">⚠ Simulado Controlado (Teto 3)</span>`;
    }

    function renderFocusMissionCardHtml(foco) {
        if (!foco || !Array.isArray(foco.criterios) || foco.criterios.length === 0) return '';
        return `
            <div class="rpg-focus-card">
                <div class="rpg-focus-head">
                    <span class="rpg-focus-badge">🎯 FOCO DE TREINO / MISSÃO ATUAL</span>
                </div>
                <p class="rpg-focus-msg">${escapeHtml(foco.mensagem || '')}</p>
                <div class="rpg-focus-targets">
                    ${foco.criterios.map((c) => {
                        const cColor = sanitizeColor(c.pilar_cor, '#38bdf8');
                        return `
                            <div class="rpg-focus-target-chip">
                                <div class="rpg-focus-target-left">
                                    <span class="rpg-focus-dot" style="background: ${cColor};"></span>
                                    <div>
                                        <strong>${Number(c.numero)}. ${escapeHtml(c.nome)}</strong>
                                        <span>${escapeHtml(c.pilar_nome || c.pilar)}</span>
                                    </div>
                                </div>
                                <span class="rpg-focus-score">${Number(c.nota)}/5</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function renderBadgesGridHtml(badges = []) {
        if (!Array.isArray(badges) || badges.length === 0) return '';
        const unlockedCount = badges.filter(b => b.desbloqueada).length;
        return `
            <div class="rpg-badges-section">
                <div class="rpg-section-head">
                    <div class="rpg-section-title">
                        <span>🏅 Insígnias &amp; Conquistas de Combate</span>
                    </div>
                    <span class="rpg-badges-counter">${unlockedCount}/${badges.length} desbloqueadas</span>
                </div>
                <div class="rpg-badges-grid">
                    ${badges.map((b) => {
                        const unlocked = Boolean(b.desbloqueada);
                        const color = sanitizeColor(b.cor, '#38bdf8');
                        const tooltip = unlocked
                            ? `Desbloqueada! Requisito cumprido: ${b.requisito}`
                            : `Bloqueada — Requisito: ${b.requisito}`;
                        return `
                            <div class="rpg-badge-card ${unlocked ? 'unlocked' : 'locked'}"
                                 style="${unlocked ? `border-color: ${color}66; background: ${color}12;` : ''}"
                                 title="${escapeHtml(tooltip)}">
                                <div class="rpg-badge-icon" style="${unlocked ? `background: ${color}24; border-color: ${color}66;` : ''}">
                                    <span>${escapeHtml(b.icone || '🏅')}</span>
                                </div>
                                <div class="rpg-badge-body">
                                    <div class="rpg-badge-top">
                                        <strong>${escapeHtml(b.nome)}</strong>
                                        <span class="rpg-badge-state ${unlocked ? 'on' : 'off'}">${unlocked ? '✓ Conquistado' : '🔒 Bloqueada'}</span>
                                    </div>
                                    <p class="rpg-badge-req">${escapeHtml(b.requisito || '')}</p>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function renderExamProgressionCardHtml(requisitosExame) {
        if (!requisitosExame || !requisitosExame.possui_requisitos_rpg) return '';
        const elegivel = Boolean(requisitosExame.elegivel);
        const pct = Math.max(0, Math.min(100, Number(requisitosExame.progresso_pct || 0)));
        const pColor = sanitizeColor(requisitosExame.cor_primaria, '#ffffff');
        const sColor = sanitizeColor(requisitosExame.cor_secundaria, '#111827');
        const checks = Array.isArray(requisitosExame.checks) ? requisitosExame.checks : [];
        const pendencias = Array.isArray(requisitosExame.pendencias) ? requisitosExame.pendencias : [];

        return `
            <div class="rpg-exam-lock-card ${elegivel ? 'eligible' : 'locked'}">
                <div class="rpg-exam-lock-head">
                    <div class="rpg-exam-next-belt">
                        <span class="rpg-mini-belt" style="background: ${pColor};">
                            <span style="background: ${sColor};"></span>
                        </span>
                        <div>
                            <span class="rpg-exam-kicker">TRAVA DE PROGRESSÃO P/ EXAME</span>
                            <strong>${escapeHtml(requisitosExame.proxima_graduacao_nome || 'Próxima Graduação')}</strong>
                        </div>
                    </div>
                    <span class="rpg-exam-status-pill ${elegivel ? 'ok' : 'pending'}">
                        ${elegivel ? '✓ Apto nos Requisitos RPG' : `⏳ ${pct}% Concluído`}
                    </span>
                </div>

                <div class="rpg-exam-progress-track">
                    <div class="rpg-exam-progress-fill ${elegivel ? 'ok' : ''}" style="width: ${pct}%;"></div>
                </div>

                <div class="rpg-exam-checks-list">
                    ${checks.map((ck) => `
                        <div class="rpg-exam-check-item ${ck.atingido ? 'done' : 'missing'}">
                            <span class="rpg-exam-check-icon">${ck.atingido ? '✓' : '!'}</span>
                            <div>
                                <strong>${escapeHtml(ck.label)}</strong>
                                <span>${escapeHtml(ck.detalhe || '')}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>

                ${(!elegivel && pendencias.length > 0) ? `
                    <div class="rpg-exam-pendencias">
                        <strong>O que falta pontuar:</strong>
                        <ul>
                            ${pendencias.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderRadarSvg(atualPilares = {}, anteriorPilares = null, deltas = null) {
        const cx = 220;
        const cy = 175;
        const maxR = 96;
        const levels = [5, 10, 15, 20];
        const count = PILLARS.length;
        const startAngle = -Math.PI / 2;

        const pointAt = (index, ratio) => {
            const angle = startAngle + (index * 2 * Math.PI) / count;
            return {
                x: cx + Math.cos(angle) * maxR * ratio,
                y: cy + Math.sin(angle) * maxR * ratio,
                angle
            };
        };

        const gridPolygons = levels.map((lvl) => {
            const ratio = lvl / 20;
            const pts = PILLARS.map((_, idx) => {
                const p = pointAt(idx, ratio);
                return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            }).join(' ');
            const labelPos = pointAt(0, ratio);
            return `
                <polygon points="${pts}" fill="none" stroke="rgba(148, 163, 184, ${lvl === 20 ? '0.32' : '0.16'})" stroke-width="${lvl === 20 ? '1.3' : '1'}" />
                <text x="${(labelPos.x + 6).toFixed(1)}" y="${(labelPos.y + 4).toFixed(1)}" font-size="12" fill="#CBD5E1" font-weight="600">${lvl}</text>
            `;
        }).join('');

        const axesHtml = PILLARS.map((_, idx) => {
            const p = pointAt(idx, 1);
            return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="rgba(148, 163, 184, 0.22)" stroke-width="1" />`;
        }).join('');

        let prevPolygonHtml = '';
        if (anteriorPilares) {
            const prevPts = PILLARS.map((pillar, idx) => {
                const val = Math.max(0, Math.min(20, Number(anteriorPilares[pillar.id] || 0)));
                const p = pointAt(idx, val / 20);
                return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            }).join(' ');
            prevPolygonHtml = `
                <polygon points="${prevPts}" fill="rgba(148, 163, 184, 0.14)" stroke="#94a3b8" stroke-width="1.6" stroke-dasharray="4 3" />
            `;
        }

        const curCoords = PILLARS.map((pillar, idx) => {
            const val = Math.max(0, Math.min(20, Number(atualPilares[pillar.id] || 0)));
            const p = pointAt(idx, val / 20);
            return { ...p, pillar, val };
        });

        const curPts = curCoords.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

        const verticesHtml = curCoords.map(p => `
            <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="${p.pillar.cor}" stroke="#0f172a" stroke-width="1.8">
                <title>${escapeHtml(p.pillar.nome)}: ${p.val}/20</title>
            </circle>
        `).join('');

        const labelsHtml = PILLARS.map((pillar, idx) => {
            const val = Math.max(0, Math.min(20, Number(atualPilares[pillar.id] || 0)));
            const pos = pointAt(idx, 1.25);
            const cosVal = Math.cos(pos.angle);
            let anchor = 'middle';
            if (cosVal > 0.25) anchor = 'start';
            else if (cosVal < -0.25) anchor = 'end';

            const yOffset = idx === 0 ? -8 : (Math.sin(pos.angle) > 0.4 ? 10 : 4);
            let deltaSpan = '';
            if (deltas && deltas.pilares && deltas.pilares[pillar.id] !== undefined && deltas.pilares[pillar.id] !== null) {
                const dVal = Number(deltas.pilares[pillar.id]);
                const dTxt = dVal > 0 ? `+${dVal}` : String(dVal);
                const dColor = dVal > 0 ? '#34d399' : (dVal < 0 ? '#fca5a5' : '#94a3b8');
                deltaSpan = `<tspan fill="${dColor}" font-weight="800"> (${escapeHtml(dTxt)})</tspan>`;
            }

            return `
                <text x="${pos.x.toFixed(1)}" y="${(pos.y + yOffset).toFixed(1)}" text-anchor="${anchor}" font-size="13" font-weight="700" fill="#F8FAFC">
                    ${escapeHtml(pillar.nome)}
                </text>
                <text x="${pos.x.toFixed(1)}" y="${(pos.y + yOffset + 15).toFixed(1)}" text-anchor="${anchor}" font-size="12" font-weight="800" fill="${pillar.cor}">
                    ${val}/20${deltaSpan}
                </text>
            `;
        }).join('');

        const gradId = 'rpgRadarFillGrad';
        return `
            <svg viewBox="0 0 440 350" class="rpg-radar-svg" role="img" aria-label="Gráfico de Radar dos 5 Atributos RPG">
                <defs>
                    <radialGradient id="${gradId}" cx="50%" cy="50%" r="55%">
                        <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.45" />
                        <stop offset="100%" stop-color="#ef4444" stop-opacity="0.22" />
                    </radialGradient>
                </defs>
                ${gridPolygons}
                ${axesHtml}
                ${prevPolygonHtml}
                <polygon points="${curPts}" fill="url(#${gradId})" stroke="#38bdf8" stroke-width="2.2" stroke-linejoin="round" />
                ${verticesHtml}
                ${labelsHtml}
            </svg>
        `;
    }

    function renderPillarBarsHtml(atualPilares = {}, deltas = null) {
        return PILLARS.map((pillar) => {
            const val = Math.max(0, Math.min(20, Number(atualPilares[pillar.id] || 0)));
            const pct = Math.round((val / 20) * 100);
            const deltaHtml = deltas && deltas.pilares
                ? renderDeltaBadgeHtml(deltas.pilares[pillar.id], ' pts')
                : '';

            return `
                <div class="rpg-pillar-bar-row">
                    <div class="rpg-pillar-bar-head">
                        <div class="rpg-pillar-bar-title">
                            <span class="rpg-pillar-dot" style="background: ${pillar.cor};"></span>
                            <span>${escapeHtml(pillar.nome)}</span>
                        </div>
                        <div class="rpg-pillar-bar-values">
                            ${deltaHtml}
                            <strong>${val}<span>/20</span></strong>
                        </div>
                    </div>
                    <div class="rpg-pillar-track">
                        <div class="rpg-pillar-fill" style="width: ${pct}%; background: ${pillar.cor};"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderCriteriaBreakdownHtml(criteriosMap = {}, aptoSparring = true) {
        if (!criteriosMap || typeof criteriosMap !== 'object') {
            return `<div style="font-size: 12px; color: #94a3b8;">Detalhamento de critérios indisponível.</div>`;
        }
        const sparLocked = aptoSparring === false;
        return `
            <div class="rpg-breakdown-grid">
                ${PILLARS.map((pillar) => {
                    const items = CRITERIA.filter(c => c.pilar === pillar.id);
                    return `
                        <div class="rpg-breakdown-card" style="border-top: 2px solid ${pillar.cor};">
                            <div class="rpg-breakdown-title" style="color: ${pillar.cor};">
                                <span>${escapeHtml(pillar.nome)}</span>
                            </div>
                            <div class="rpg-breakdown-list">
                                ${items.map((c) => {
                                    const val = criteriosMap[c.id] !== undefined ? Number(criteriosMap[c.id]) : 0;
                                    const lockNote = sparLocked && c.isSparring ? ' (teto 3)' : '';
                                    return `
                                        <div class="rpg-breakdown-item">
                                            <span class="rpg-breakdown-name">
                                                ${c.numero}. ${escapeHtml(c.nome)}
                                                ${c.isSparring ? '<span class="rpg-sparring-tag mini">SPARRING</span>' : ''}
                                            </span>
                                            <strong class="rpg-breakdown-score">${val}/5${escapeHtml(lockNote)}</strong>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    // =========================================================================
    // GERADOR DE CARD COMPARTILHÁVEL STORIES 9:16 (1080x1920 PURE CANVAS)
    // =========================================================================
    function loadSafeImage(url) {
        return new Promise((resolve) => {
            if (!url || typeof url !== 'string') return resolve(null);
            const clean = url.trim();
            // Evita taint em canvas quando imagem é externa não-CORS; aceita caminhos locais/same-origin
            const isLocal = clean.startsWith('/') || clean.startsWith('./') || clean.startsWith('data:image/');
            let isSameOrigin = isLocal;
            if (!isSameOrigin) {
                try {
                    const parsed = new URL(clean, global.location ? global.location.href : 'https://gestor.procombate.com');
                    isSameOrigin = global.location ? parsed.origin === global.location.origin : false;
                } catch {
                    isSameOrigin = false;
                }
            }

            const img = new Image();
            if (!isSameOrigin) img.crossOrigin = 'anonymous';
            const timer = setTimeout(() => resolve(null), 2800);
            img.onload = () => {
                clearTimeout(timer);
                resolve(img);
            };
            img.onerror = () => {
                clearTimeout(timer);
                resolve(null);
            };
            img.src = clean;
        });
    }

    function drawRoundedRect(ctx, x, y, w, h, r) {
        const radius = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + w, y, x + w, y + h, radius);
        ctx.arcTo(x + w, y + h, x, y + h, radius);
        ctx.arcTo(x, y + h, x, y, radius);
        ctx.arcTo(x, y, x + w, y, radius);
        ctx.closePath();
    }

    function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
        const words = String(text || '').split(/\s+/).filter(Boolean);
        let line = '';
        let curY = y;
        let linesDrawn = 0;
        for (let i = 0; i < words.length; i++) {
            const testLine = line ? `${line} ${words[i]}` : words[i];
            if (ctx.measureText(testLine).width > maxWidth && line) {
                linesDrawn++;
                if (linesDrawn >= maxLines) {
                    ctx.fillText(`${line}...`, x, curY);
                    return curY + lineHeight;
                }
                ctx.fillText(line, x, curY);
                line = words[i];
                curY += lineHeight;
            } else {
                line = testLine;
            }
        }
        if (line) {
            ctx.fillText(line, x, curY);
            curY += lineHeight;
        }
        return curY;
    }

    async function generateStatusCardCanvas(options = {}) {
        const W = 1080;
        const H = 1920;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');

        const atual = options.atual || {};
        const anterior = options.anterior || null;
        const pilares = atual.pilares || {};
        const prevPilares = anterior ? anterior.pilares : null;
        const scoreTotal = Math.round(Number(atual.score_total || 0));
        const rankInfo = classifyRank(scoreTotal);
        const rankCod = String(atual.rank_combate || rankInfo.codigo || 'D').toUpperCase();
        const rankTitulo = String(atual.rank_titulo || rankInfo.titulo);
        const arquetipo = atual.arquetipo || computeArchetype(pilares, scoreTotal);
        const aptoSparring = atual.apto_sparring !== false && atual.apto_sparring !== 0;
        const badges = Array.isArray(atual.badges)
            ? atual.badges
            : computeBadges(atual.criterios, aptoSparring);
        const unlockedBadges = badges.filter(b => b.desbloqueada);

        const nomeAluno = String(options.alunoNome || 'Atleta Pro Combate').trim();
        const graduacaoNome = String(options.graduacaoNome || 'Muay Thai • Atleta').trim();
        const corPrimaria = sanitizeColor(options.corPrimaria, '#ffffff');
        const corSecundaria = sanitizeColor(options.corSecundaria, '#0f172a');
        const academiaNome = String(options.academiaNome || 'PRO COMBATE');
        const dataAvalStr = atual.data_avaliacao
            ? new Date(atual.data_avaliacao).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
            : new Date().toLocaleDateString('pt-BR');

        const [logoImg, fotoImg] = await Promise.all([
            loadSafeImage('/assets/icons/logo.png'),
            loadSafeImage(options.fotoUrl || null)
        ]);

        // 1. Background profundo estilizado
        const bgGrad = ctx.createLinearGradient(0, 0, W, H);
        bgGrad.addColorStop(0, '#050811');
        bgGrad.addColorStop(0.5, '#0b1324');
        bgGrad.addColorStop(1, '#070b14');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        // Glows radiais
        const glow1 = ctx.createRadialGradient(200, 320, 40, 200, 320, 520);
        glow1.addColorStop(0, 'rgba(56, 189, 248, 0.22)');
        glow1.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = glow1;
        ctx.fillRect(0, 0, W, H);

        const glow2 = ctx.createRadialGradient(880, 1280, 40, 880, 1280, 560);
        glow2.addColorStop(0, 'rgba(244, 63, 94, 0.18)');
        glow2.addColorStop(1, 'rgba(244, 63, 94, 0)');
        ctx.fillStyle = glow2;
        ctx.fillRect(0, 0, W, H);

        // Moldura externa
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
        ctx.lineWidth = 3;
        drawRoundedRect(ctx, 36, 36, W - 72, H - 72, 42);
        ctx.stroke();

        // 2. Cabeçalho da Academia (Logotipo + Título + Data)
        if (logoImg) {
            ctx.save();
            drawRoundedRect(ctx, 76, 76, 86, 86, 20);
            ctx.clip();
            ctx.drawImage(logoImg, 76, 76, 86, 86);
            ctx.restore();
        } else {
            ctx.fillStyle = 'rgba(244, 63, 94, 0.2)';
            drawRoundedRect(ctx, 76, 76, 86, 86, 20);
            ctx.fill();
            ctx.font = 'bold 42px sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.fillText('🥋', 119, 134);
        }

        ctx.textAlign = 'left';
        ctx.font = '800 34px "Outfit", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(academiaNome.toUpperCase(), 182, 114);
        ctx.font = '700 20px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText('FICHA TÉCNICA RPG • MUAY THAI', 182, 148);

        ctx.textAlign = 'right';
        ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`Avaliação: ${dataAvalStr}`, W - 78, 128);

        // 3. Bloco do Aluno (Avatar circular + Nome + Graduação Prajied)
        ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.26)';
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, 74, 200, W - 148, 226, 30);
        ctx.fill();
        ctx.stroke();

        const cxAvatar = 192;
        const cyAvatar = 313;
        const rAvatar = 82;

        ctx.save();
        ctx.beginPath();
        ctx.arc(cxAvatar, cyAvatar, rAvatar + 5, 0, Math.PI * 2);
        ctx.fillStyle = '#38bdf8';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cxAvatar, cyAvatar, rAvatar, 0, Math.PI * 2);
        ctx.clip();

        if (fotoImg) {
            const scale = Math.max((rAvatar * 2) / fotoImg.width, (rAvatar * 2) / fotoImg.height);
            const dw = fotoImg.width * scale;
            const dh = fotoImg.height * scale;
            ctx.drawImage(fotoImg, cxAvatar - dw / 2, cyAvatar - dh / 2, dw, dh);
        } else {
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(cxAvatar - rAvatar, cyAvatar - rAvatar, rAvatar * 2, rAvatar * 2);
            const initials = nomeAluno.split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase() || 'PC';
            ctx.font = '800 54px "Outfit", sans-serif';
            ctx.fillStyle = '#7dd3fc';
            ctx.textAlign = 'center';
            ctx.fillText(initials, cxAvatar, cyAvatar + 19);
        }
        ctx.restore();

        ctx.textAlign = 'left';
        ctx.font = '800 38px "Outfit", sans-serif';
        ctx.fillStyle = '#ffffff';
        drawWrappedText(ctx, nomeAluno, 305, 275, W - 405, 44, 2);

        // Faixa / Prajied badge
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        drawRoundedRect(ctx, 305, 344, W - 415, 52, 16);
        ctx.fill();
        ctx.fillStyle = corPrimaria;
        drawRoundedRect(ctx, 322, 359, 44, 22, 6);
        ctx.fill();
        ctx.fillStyle = corSecundaria;
        ctx.fillRect(352, 359, 14, 22);
        ctx.font = '700 23px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(graduacaoNome.slice(0, 34), 382, 378);

        // 4. Rank em destaque + Score Total + Arquétipo + Selo Sparring
        const rankColors = {
            S: '#f43f5e',
            A: '#f59e0b',
            B: '#10b981',
            C: '#38bdf8',
            D: '#94a3b8'
        };
        const rCol = rankColors[rankCod] || '#38bdf8';

        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.strokeStyle = `${rCol}88`;
        ctx.lineWidth = 2.5;
        drawRoundedRect(ctx, 74, 456, W - 148, 250, 30);
        ctx.fill();
        ctx.stroke();

        // Rank Badge quadrado
        ctx.fillStyle = rCol;
        drawRoundedRect(ctx, 108, 492, 134, 134, 28);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.font = '900 84px "Outfit", sans-serif';
        ctx.fillStyle = rankCod === 'S' ? '#ffffff' : '#090d16';
        ctx.fillText(rankCod, 175, 586);

        ctx.textAlign = 'left';
        ctx.font = '800 22px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = rCol;
        ctx.fillText(`RANK ${rankCod} • ${rankTitulo.toUpperCase()}`, 270, 522);

        ctx.font = '900 72px "Outfit", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${scoreTotal}`, 270, 598);
        const numWidth = ctx.measureText(`${scoreTotal}`).width;
        ctx.font = '700 32px "Outfit", sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText('/100 pts', 278 + numWidth, 594);

        // Arquétipo
        ctx.font = '700 26px "Outfit", sans-serif';
        ctx.fillStyle = sanitizeColor(arquetipo?.cor, '#7dd3fc');
        ctx.fillText(`⚔️ ${arquetipo?.titulo || 'Lutador Pro Combate'}`, 270, 646);

        // Selo Sparring
        const sparBg = aptoSparring ? 'rgba(16, 185, 129, 0.18)' : 'rgba(245, 158, 11, 0.18)';
        const sparBorder = aptoSparring ? '#10b981' : '#f59e0b';
        const sparText = aptoSparring ? '✓ APTO PARA SPARRING' : '⚠ SIMULADO CONTROLADO (TETO 3)';
        ctx.fillStyle = sparBg;
        ctx.strokeStyle = sparBorder;
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, W - 492, 488, 386, 48, 24);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.font = '800 21px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = aptoSparring ? '#34d399' : '#fcd34d';
        ctx.fillText(sparText, W - 299, 519);

        // 5. Gráfico Radar de 5 Eixos (High-res Canvas)
        ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, 74, 736, W - 148, 700, 32);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.font = '800 24px "Outfit", sans-serif';
        ctx.fillStyle = '#7dd3fc';
        ctx.fillText('RADAR DE ATRIBUTOS', 112, 788);

        if (prevPilares) {
            ctx.textAlign = 'right';
            ctx.font = '600 20px "Plus Jakarta Sans", sans-serif';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText('━━ Atual   --- Anterior', W - 112, 788);
        }

        const rCx = 540;
        const rCy = 1100;
        const rMax = 215;
        const angleStart = -Math.PI / 2;
        const pointOnCanvas = (idx, ratio) => {
            const ang = angleStart + (idx * 2 * Math.PI) / PILLARS.length;
            return { x: rCx + Math.cos(ang) * rMax * ratio, y: rCy + Math.sin(ang) * rMax * ratio, ang };
        };

        // Pentágonos concêntricos
        for (const lvl of [5, 10, 15, 20]) {
            ctx.beginPath();
            PILLARS.forEach((_, idx) => {
                const pt = pointOnCanvas(idx, lvl / 20);
                if (idx === 0) ctx.moveTo(pt.x, pt.y);
                else ctx.lineTo(pt.x, pt.y);
            });
            ctx.closePath();
            ctx.strokeStyle = lvl === 20 ? 'rgba(148, 163, 184, 0.36)' : 'rgba(148, 163, 184, 0.18)';
            ctx.lineWidth = lvl === 20 ? 2.5 : 1.5;
            ctx.stroke();
        }

        // Eixos
        PILLARS.forEach((_, idx) => {
            const pt = pointOnCanvas(idx, 1);
            ctx.beginPath();
            ctx.moveTo(rCx, rCy);
            ctx.lineTo(pt.x, pt.y);
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });

        // Polígono Anterior (fantasma tracejado)
        if (prevPilares) {
            ctx.save();
            ctx.beginPath();
            PILLARS.forEach((p, idx) => {
                const v = Math.max(0, Math.min(20, Number(prevPilares[p.id] || 0)));
                const pt = pointOnCanvas(idx, v / 20);
                if (idx === 0) ctx.moveTo(pt.x, pt.y);
                else ctx.lineTo(pt.x, pt.y);
            });
            ctx.closePath();
            ctx.fillStyle = 'rgba(148, 163, 184, 0.12)';
            ctx.fill();
            ctx.setLineDash([10, 8]);
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.restore();
        }

        // Polígono Atual (sólido)
        ctx.save();
        ctx.beginPath();
        PILLARS.forEach((p, idx) => {
            const v = Math.max(0, Math.min(20, Number(pilares[p.id] || 0)));
            const pt = pointOnCanvas(idx, v / 20);
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
        });
        ctx.closePath();
        const polyGrad = ctx.createRadialGradient(rCx, rCy, 20, rCx, rCy, rMax);
        polyGrad.addColorStop(0, 'rgba(56, 189, 248, 0.5)');
        polyGrad.addColorStop(1, 'rgba(244, 63, 94, 0.25)');
        ctx.fillStyle = polyGrad;
        ctx.fill();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 4.5;
        ctx.stroke();
        ctx.restore();

        // Vértices + Rótulos
        const deltasObj = prevPilares ? computeDeltas(atual, anterior) : null;
        PILLARS.forEach((p, idx) => {
            const v = Math.max(0, Math.min(20, Number(pilares[p.id] || 0)));
            const pt = pointOnCanvas(idx, v / 20);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
            ctx.fillStyle = p.cor;
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#0f172a';
            ctx.stroke();

            const lblPt = pointOnCanvas(idx, 1.24);
            const cosVal = Math.cos(lblPt.ang);
            ctx.textAlign = cosVal > 0.25 ? 'left' : (cosVal < -0.25 ? 'right' : 'center');
            const yAdj = idx === 0 ? -12 : (Math.sin(lblPt.ang) > 0.4 ? 18 : 6);

            ctx.font = '800 25px "Outfit", sans-serif';
            ctx.fillStyle = '#f8fafc';
            ctx.fillText(p.nome, lblPt.x, lblPt.y + yAdj);

            const dVal = deltasObj?.pilares ? Number(deltasObj.pilares[p.id]) : null;
            const dStr = dVal !== null ? ` (${dVal > 0 ? '+' : ''}${dVal})` : '';
            ctx.font = '800 23px "Plus Jakarta Sans", sans-serif';
            ctx.fillStyle = p.cor;
            ctx.fillText(`${v}/20${dStr}`, lblPt.x, lblPt.y + yAdj + 30);
        });

        // 6. Insígnias Conquistadas
        ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, 74, 1466, W - 148, 284, 30);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.font = '800 24px "Outfit", sans-serif';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(`🏅 INSÍGNIAS CONQUISTADAS (${unlockedBadges.length}/${BADGES_CATALOG.length})`, 112, 1520);

        if (unlockedBadges.length === 0) {
            ctx.textAlign = 'center';
            ctx.font = '600 24px "Plus Jakarta Sans", sans-serif';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText('Em busca da primeira insígnia de excelência 5/5 no tatame!', W / 2, 1630);
        } else {
            const cols = 2;
            const chipW = 418;
            const chipH = 54;
            const gapX = 24;
            const gapY = 16;
            const startX = 110;
            const startY = 1548;
            unlockedBadges.slice(0, 6).forEach((b, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const bx = startX + col * (chipW + gapX);
                const by = startY + row * (chipH + gapY);
                const bCol = sanitizeColor(b.cor, '#38bdf8');
                ctx.fillStyle = `${bCol}22`;
                ctx.strokeStyle = `${bCol}88`;
                ctx.lineWidth = 2;
                drawRoundedRect(ctx, bx, by, chipW, chipH, 16);
                ctx.fill();
                ctx.stroke();

                ctx.textAlign = 'left';
                ctx.font = '700 23px "Plus Jakarta Sans", sans-serif';
                ctx.fillStyle = '#ffffff';
                ctx.fillText(`${b.icone || '🏅'}  ${b.nome}`, bx + 18, by + 35);
            });
        }

        // 7. Rodapé institucional
        ctx.textAlign = 'center';
        ctx.font = '800 26px "Outfit", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${academiaNome.toUpperCase()} • ARTE MARCIAL & EVOLUÇÃO`, W / 2, 1815);
        ctx.font = '600 21px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText('gestor.procombate.com', W / 2, 1852);

        return canvas;
    }

    function ensureStoryModalDom() {
        let modal = document.getElementById('rpg-story-card-modal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'rpg-story-card-modal';
        modal.className = 'rpg-story-modal-overlay';
        modal.innerHTML = `
            <div class="rpg-story-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="rpg-story-modal-title">
                <div class="rpg-story-modal-head">
                    <div>
                        <h3 id="rpg-story-modal-title">Card de Status RPG (Stories 9:16)</h3>
                        <p>Pronto para baixar ou compartilhar no Instagram e WhatsApp</p>
                    </div>
                    <button type="button" class="rpg-story-modal-close" id="btn-close-rpg-story-modal" aria-label="Fechar">&times;</button>
                </div>
                <div class="rpg-story-modal-body">
                    <div id="rpg-story-loading" class="rpg-story-loading">Gerando card em alta resolução (1080×1920)...</div>
                    <img id="rpg-story-preview-img" class="rpg-story-preview-img" alt="Preview do Card de Status RPG 9:16" style="display:none;" />
                </div>
                <div class="rpg-story-modal-foot">
                    <a id="btn-download-rpg-story" class="rpg-story-btn primary" download="ficha-rpg-muay-thai.png" href="#" style="pointer-events:none;opacity:0.5;">
                        ⬇ Baixar PNG (9:16)
                    </a>
                    <button type="button" id="btn-share-rpg-story" class="rpg-story-btn secondary" disabled>
                        📤 Compartilhar
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const closeModal = () => {
            modal.classList.remove('active');
        };
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        const closeBtn = modal.querySelector('#btn-close-rpg-story-modal');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
        });

        return modal;
    }

    async function openStatusCardModal(options = {}) {
        const modal = ensureStoryModalDom();
        const loadingEl = modal.querySelector('#rpg-story-loading');
        const imgEl = modal.querySelector('#rpg-story-preview-img');
        const dlBtn = modal.querySelector('#btn-download-rpg-story');
        const shareBtn = modal.querySelector('#btn-share-rpg-story');

        if (loadingEl) {
            loadingEl.style.display = 'flex';
            loadingEl.textContent = 'Gerando card em alta resolução (1080×1920)...';
        }
        if (imgEl) imgEl.style.display = 'none';
        if (dlBtn) {
            dlBtn.style.pointerEvents = 'none';
            dlBtn.style.opacity = '0.5';
        }
        if (shareBtn) {
            shareBtn.disabled = true;
            shareBtn.onclick = null;
        }
        modal.classList.add('active');

        try {
            const canvas = await generateStatusCardCanvas(options);
            const dataUrl = canvas.toDataURL('image/png');
            const slugNome = String(options.alunoNome || 'atleta')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '') || 'atleta';
            const filename = `card-rpg-${slugNome}.png`;

            if (imgEl) {
                imgEl.src = dataUrl;
                imgEl.style.display = 'block';
            }
            if (loadingEl) loadingEl.style.display = 'none';

            if (dlBtn) {
                dlBtn.href = dataUrl;
                dlBtn.setAttribute('download', filename);
                dlBtn.style.pointerEvents = 'auto';
                dlBtn.style.opacity = '1';
            }

            if (shareBtn) {
                const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof File !== 'undefined';
                shareBtn.disabled = false;
                shareBtn.onclick = async () => {
                    if (canShareFiles) {
                        try {
                            const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
                            if (blob) {
                                const file = new File([blob], filename, { type: 'image/png' });
                                if (!navigator.canShare || navigator.canShare({ files: [file] })) {
                                    await navigator.share({
                                        title: `Ficha Técnica RPG • ${options.alunoNome || 'Atleta'}`,
                                        text: `Confira minha evolução no tatame PRO COMBATE!`,
                                        files: [file]
                                    });
                                    return;
                                }
                            }
                        } catch (err) {
                            if (err && err.name === 'AbortError') return;
                        }
                    }
                    if (dlBtn) dlBtn.click();
                };
            }
        } catch (err) {
            console.error('Erro ao gerar Card de Status RPG:', err);
            if (loadingEl) {
                loadingEl.style.display = 'flex';
                loadingEl.textContent = 'Não foi possível gerar a imagem neste navegador.';
            }
        }
    }

    global.RpgAvaliacaoUI = {
        PILLARS,
        CRITERIA,
        RANK_ORDER,
        RANK_MIN_SCORE,
        ARCHETYPE_PAIRS,
        BADGES_CATALOG,
        classifyRank,
        calculateTotals,
        computeArchetype,
        computeBadges,
        computeTrainingFocus,
        evaluateExamLock,
        computeDeltas,
        renderDeltaBadgeHtml,
        renderRankBadgeHtml,
        renderArchetypePillHtml,
        renderSparringBadgeHtml,
        renderFocusMissionCardHtml,
        renderBadgesGridHtml,
        renderExamProgressionCardHtml,
        renderRadarSvg,
        renderPillarBarsHtml,
        renderCriteriaBreakdownHtml,
        generateStatusCardCanvas,
        openStatusCardModal
    };
})(window);
