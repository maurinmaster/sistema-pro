/**
 * PRO COMBATE - Biblioteca de Visualização e Cálculo da Avaliação Técnica RPG (Muay Thai)
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

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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
            rank: classifyRank(total)
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

    function renderDeltaBadgeHtml(delta, suffix = ' pts') {
        if (delta === null || delta === undefined || isNaN(delta)) return '';
        const n = Number(delta);
        if (n > 0) return `<span class="rpg-delta-pill pos">+${n}${escapeHtml(suffix)}</span>`;
        if (n < 0) return `<span class="rpg-delta-pill neg">${n}${escapeHtml(suffix)}</span>`;
        return `<span class="rpg-delta-pill zero">0${escapeHtml(suffix)}</span>`;
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

    function renderSparringBadgeHtml(aptoSparring) {
        if (aptoSparring) {
            return `<span class="rpg-sparring-pill apto">✓ Apto para Sparring</span>`;
        }
        return `<span class="rpg-sparring-pill restrito" title="Critérios de sparring limitados ao teto máximo de 3 pontos">⚠ Simulado Controlado (Teto 3)</span>`;
    }

    function renderRadarSvg(atualPilares = {}, anteriorPilares = null) {
        const cx = 190;
        const cy = 160;
        const maxR = 102;
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
                <text x="${(labelPos.x + 5).toFixed(1)}" y="${(labelPos.y + 3).toFixed(1)}" font-size="9" fill="#64748b" font-weight="600">${lvl}</text>
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
                <polygon points="${prevPts}" fill="rgba(148, 163, 184, 0.12)" stroke="#94a3b8" stroke-width="1.6" stroke-dasharray="4 3" />
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
            const pos = pointAt(idx, 1.24);
            const cosVal = Math.cos(pos.angle);
            let anchor = 'middle';
            if (cosVal > 0.25) anchor = 'start';
            else if (cosVal < -0.25) anchor = 'end';

            const yOffset = idx === 0 ? -4 : (Math.sin(pos.angle) > 0.4 ? 10 : 4);
            return `
                <text x="${pos.x.toFixed(1)}" y="${(pos.y + yOffset).toFixed(1)}" text-anchor="${anchor}" font-size="11.5" font-weight="700" fill="#f8fafc">
                    ${escapeHtml(pillar.nome)}
                </text>
                <text x="${pos.x.toFixed(1)}" y="${(pos.y + yOffset + 13).toFixed(1)}" text-anchor="${anchor}" font-size="10.5" font-weight="800" fill="${pillar.cor}">
                    ${val}/20
                </text>
            `;
        }).join('');

        return `
            <svg viewBox="0 0 380 320" class="rpg-radar-svg" role="img" aria-label="Gráfico de Radar dos 5 Atributos RPG">
                <defs>
                    <radialGradient id="rpgRadarFillGrad" cx="50%" cy="50%" r="55%">
                        <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.45" />
                        <stop offset="100%" stop-color="#ef4444" stop-opacity="0.22" />
                    </radialGradient>
                </defs>
                ${gridPolygons}
                ${axesHtml}
                ${prevPolygonHtml}
                <polygon points="${curPts}" fill="url(#rpgRadarFillGrad)" stroke="#38bdf8" stroke-width="2.2" stroke-linejoin="round" />
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
                ? renderDeltaBadgeHtml(deltas.pilares[pillar.id], '')
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

    global.RpgAvaliacaoUI = {
        PILLARS,
        CRITERIA,
        classifyRank,
        calculateTotals,
        computeDeltas,
        renderDeltaBadgeHtml,
        renderRankBadgeHtml,
        renderSparringBadgeHtml,
        renderRadarSvg,
        renderPillarBarsHtml,
        renderCriteriaBreakdownHtml
    };
})(window);
