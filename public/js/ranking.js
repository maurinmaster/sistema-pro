/**
 * PRO COMBATE - Mural de Líderes Saudável (Visão Administrativa & Instrutor)
 */
const RankingModule = {
    currentTab: 'assiduidade',
    prajiedId: '',
    atributo: 'score_total',
    data: null,

    async init() {
        document.querySelectorAll('#admin-ranking-tabs [data-ranking-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#admin-ranking-tabs [data-ranking-tab]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentTab = btn.dataset.rankingTab || 'assiduidade';
                this.syncFiltersVisibility();
                this.loadRanking();
            });
        });

        document.getElementById('admin-ranking-prajied')?.addEventListener('change', (e) => {
            this.prajiedId = e.target.value || '';
            this.loadRanking();
        });

        document.getElementById('admin-ranking-atributo')?.addEventListener('change', (e) => {
            this.atributo = e.target.value || 'score_total';
            this.loadRanking();
        });
    },

    syncFiltersVisibility() {
        const filtersEl = document.getElementById('admin-ranking-atributos-filters');
        if (filtersEl) {
            filtersEl.style.display = this.currentTab === 'atributos' ? 'flex' : 'none';
        }
    },

    async loadRanking() {
        this.syncFiltersVisibility();
        const container = document.getElementById('admin-ranking-content');
        if (!container) return;

        container.innerHTML = `<div style="text-align:center; padding: 36px; color: var(--text-muted);"><div class="spinner"></div> Carregando ranking...</div>`;

        try {
            const params = new URLSearchParams({ tab: this.currentTab });
            if (this.currentTab === 'atributos') {
                if (this.prajiedId) params.set('graduacao_nivel_id', this.prajiedId);
                if (this.atributo) params.set('atributo', this.atributo);
            }
            const res = await API.get(`/ranking?${params.toString()}`);
            if (!res || !res.success) {
                throw new Error(res?.error || 'Erro ao carregar ranking.');
            }
            this.data = res.data;
            this.populatePrajiedSelect(res.data.niveis_disponiveis || []);
            this.render(res.data);
        } catch (err) {
            console.error('Erro ao carregar Mural de Líderes admin:', err);
            container.innerHTML = `<div style="text-align:center; padding: 28px; color: #fca5a5;">${UI.escapeHtml(err.message || 'Falha ao carregar mural de líderes.')}</div>`;
        }
    },

    populatePrajiedSelect(prajieds) {
        const sel = document.getElementById('admin-ranking-prajied');
        if (!sel || !Array.isArray(prajieds)) return;
        const currentVal = this.prajiedId === 'todas'
            ? 'todas'
            : (this.prajiedId || (this.data?.graduacao_selecionada_id ? String(this.data.graduacao_selecionada_id) : 'todas'));
        sel.innerHTML = `<option value="todas" ${currentVal === 'todas' ? 'selected' : ''}>Todas as Graduações (Prajieds)</option>` + prajieds.map(p =>
            `<option value="${Number(p.id)}" ${String(p.id) === String(currentVal) ? 'selected' : ''}>${UI.escapeHtml(p.nome)}</option>`
        ).join('');
    },

    formatMetric(item) {
        if (this.currentTab === 'assiduidade') {
            return `${Number(item.xp_30d || item.valor || 0)} XP (${Number(item.checkins_30d || 0)} treinos)`;
        }
        if (this.currentTab === 'evolucao') {
            return `+${Number(item.delta_pts || item.valor || 0)} pts (${Number(item.score_anterior || 0)} -> ${Number(item.score_atual || 0)})`;
        }
        return `${Number(item.valor || 0)} / ${Number(item.atributo_max || 100)} pts`;
    },

    render(payload) {
        const container = document.getElementById('admin-ranking-content');
        if (!container) return;

        const top3 = payload.top3 || [];
        const lista = payload.lista || [];

        if (lista.length === 0) {
            const msg = this.currentTab === 'evolucao'
                ? 'Nenhum aluno elegível possui 2 ou mais avaliações técnicas RPG com evolução positiva ainda.'
                : 'Nenhum aluno elegível encontrado neste recorte do ranking.';
            container.innerHTML = `
                <div class="card" style="padding: 36px; text-align: center; color: var(--text-muted);">
                    ${UI.escapeHtml(msg)}
                </div>
            `;
            return;
        }

        const medals = ['🥇', '🥈', '🥉'];
        const podiumHtml = top3.length > 0 ? `
            <div class="admin-ranking-podium">
                ${top3.map((item, idx) => {
                    const safeName = UI.escapeHtml(item.nome_completo || 'Atleta');
                    const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(item.nome_completo || 'Atleta')}&background=0284c7&color=fff`;
                    const avatar = UI.sanitizeUrl(item.foto_perfil_url, fallback);
                    const streak = Number(item.streak_semanas || 0);
                    return `
                        <div class="admin-podium-card pos-${idx + 1}" onclick="AlunoDetalhesModule.openDossier(${Number(item.aluno_id)})">
                            <span style="font-size: 24px;">${medals[idx] || `#${idx + 1}`}</span>
                            <img src="${avatar}" alt="${safeName}" onerror="this.src='${fallback}'">
                            <div class="admin-podium-name">${safeName}</div>
                            <div style="font-size: 11.5px; color: var(--text-muted);">
                                ${UI.escapeHtml(item.nivel_nome || 'Sem graduação')} • Nível ${Number(item.xp_level?.nivel || 1)}
                                ${streak >= 1 ? `<span class="streak-flame-inline">🔥 ${streak} sem</span>` : ''}
                            </div>
                            <div class="admin-podium-metric">${UI.escapeHtml(this.formatMetric(item))}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        ` : '';

        const tableHtml = `
            <div class="card" style="padding: 0; overflow: hidden;">
                <div class="table-responsive">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th style="width: 70px;">Posição</th>
                                <th>Aluno</th>
                                <th>Graduação</th>
                                <th>Nível / Ofensiva</th>
                                <th style="text-align: right;">Resultado</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${lista.map(item => {
                                const safeName = UI.escapeHtml(item.nome_completo || 'Atleta');
                                const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(item.nome_completo || 'Atleta')}&background=0284c7&color=fff`;
                                const avatar = UI.sanitizeUrl(item.foto_perfil_url, fallback);
                                const streak = Number(item.streak_semanas || 0);
                                return `
                                    <tr style="cursor: pointer;" onclick="AlunoDetalhesModule.openDossier(${Number(item.aluno_id)})">
                                        <td><strong>#${Number(item.posicao)}</strong></td>
                                        <td>
                                            <div style="display: flex; align-items: center; gap: 10px;">
                                                <img src="${avatar}" alt="${safeName}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover;" onerror="this.src='${fallback}'">
                                                <strong>${safeName}</strong>
                                            </div>
                                        </td>
                                        <td>${UI.escapeHtml(item.nivel_nome || 'Iniciante')}</td>
                                        <td>
                                            <span style="font-size: 12px; color: #38bdf8; font-weight: 700;">Nível ${Number(item.xp_level?.nivel || 1)}</span>
                                            ${streak >= 1 ? `<span class="streak-flame-inline" style="margin-left: 6px;">🔥 ${streak} sem</span>` : ''}
                                        </td>
                                        <td style="text-align: right; font-weight: 800; color: #fbbf24;">${UI.escapeHtml(this.formatMetric(item))}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        container.innerHTML = podiumHtml + tableHtml;
    }
};
