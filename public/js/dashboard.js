// Módulo de Estatísticas e Dashboard
const DashboardModule = {
    kpiEventsBound: false,

    async init() {
        this.bindKpiNavigation();
        if (!API.getToken()) return;
        await this.loadDashboard();
    },

    bindKpiNavigation() {
        if (this.kpiEventsBound) return;
        this.kpiEventsBound = true;

        const grid = document.querySelector('#view-dashboard .stats-grid');
        if (!grid) return;

        const handleAction = (card) => {
            const target = card?.getAttribute('data-kpi-nav');
            if (target) this.navigateFromKpi(target);
        };

        grid.addEventListener('click', (e) => {
            const card = e.target.closest('.stat-card-clickable[data-kpi-nav]');
            if (card) handleAction(card);
        });

        grid.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.closest('.stat-card-clickable[data-kpi-nav]');
            if (!card) return;
            e.preventDefault();
            handleAction(card);
        });
    },

    navigateFromKpi(target) {
        const setAlunoFilters = ({ status = 'todos', menor = 'todos' } = {}) => {
            const searchEl = document.getElementById('search-aluno');
            const statusEl = document.getElementById('filter-status');
            const modEl = document.getElementById('filter-modalidade');
            const menorEl = document.getElementById('filter-menor');
            if (searchEl) searchEl.value = '';
            if (statusEl) statusEl.value = status;
            if (modEl) modEl.value = 'todas';
            if (menorEl) menorEl.value = menor;
            document.getElementById('nav-alunos')?.click();
        };

        const setFinanceiroFilter = (statusFatura) => {
            if (window.AuthModule && !AuthModule.can('manage_financeiro')) {
                UI.showToast('Acesso restrito: seu perfil não possui acesso ao módulo financeiro.', 'warning');
                return;
            }
            const statusEl = document.getElementById('filtro-fatura-status');
            if (statusEl) statusEl.value = statusFatura;
            document.getElementById('nav-financeiro')?.click();
        };

        switch (target) {
            case 'alunos-todos':
                setAlunoFilters({ status: 'todos', menor: 'todos' });
                break;
            case 'alunos-ativos':
                setAlunoFilters({ status: 'ativo', menor: 'todos' });
                break;
            case 'alunos-menores':
                setAlunoFilters({ status: 'todos', menor: 'sim' });
                break;
            case 'checkins':
                document.getElementById('nav-checkins')?.click();
                break;
            case 'financeiro-atrasado':
                setFinanceiroFilter('atrasado');
                break;
            case 'financeiro-pago':
                setFinanceiroFilter('pago');
                break;
            default:
                break;
        }
    },

    buildWeekSeries(rawSeries) {
        const list = Array.isArray(rawSeries) ? rawSeries : [];
        if (list.length >= 7) return list.slice(-7);

        const byDia = new Map();
        for (const item of list) {
            if (item?.dia) byDia.set(String(item.dia), Number(item.total) || 0);
        }

        const series = [];
        const hoje = new Date();
        for (let offset = 6; offset >= 0; offset--) {
            const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - offset);
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dia = `${dd}/${mm}`;
            series.push({ dia, total: byDia.get(dia) || 0 });
        }
        return series;
    },

    async loadDashboard() {
        try {
            const res = await API.get('/dashboard/stats');
            const data = res.data;
            this.renderStats(data);
        } catch (err) {
            console.error('Erro ao carregar dashboard:', err);
        }
    },

    renderStats(data) {
        const { alunos, presencas, financeiro, modalidades, frequencia_semanal, top_assiduos, pendencias } = data;

        // KPI Cards
        const totalAlunosNum = Number(alunos.total_alunos || 0);
        document.getElementById('stat-total-alunos').textContent = totalAlunosNum;
        const sidebarTotalAlunos = document.getElementById('total-alunos-count');
        if (sidebarTotalAlunos) {
            sidebarTotalAlunos.textContent = totalAlunosNum;
            sidebarTotalAlunos.title = `${totalAlunosNum} ${totalAlunosNum === 1 ? 'aluno cadastrado' : 'alunos cadastrados'} na base`;
        }

        const inadimplentesNum = Number(pendencias?.financeiro_inadimplentes ?? financeiro?.alunos_inadimplentes ?? 0);
        const sidebarFinPendentes = document.getElementById('total-financeiro-pendentes-count');
        if (sidebarFinPendentes) {
            const podeVerFinanceiro = !window.AuthModule || AuthModule.can('manage_financeiro');
            if (podeVerFinanceiro && inadimplentesNum > 0) {
                const finTitle = `${inadimplentesNum} ${inadimplentesNum === 1 ? 'aluno com mensalidade em atraso' : 'alunos com mensalidade em atraso'}`;
                sidebarFinPendentes.textContent = String(inadimplentesNum);
                sidebarFinPendentes.title = finTitle;
                sidebarFinPendentes.setAttribute('aria-label', finTitle);
                sidebarFinPendentes.style.display = 'inline-flex';
            } else {
                sidebarFinPendentes.style.display = 'none';
            }
        }

        if (pendencias && pendencias.missoes_aguardando_validacao !== undefined) {
            const totalMissoesPend = Number(pendencias.missoes_aguardando_validacao || 0);
            if (window.MissoesModule && typeof MissoesModule.updateBadgeCount === 'function') {
                MissoesModule.updateBadgeCount(totalMissoesPend);
            } else {
                const navMissoes = document.getElementById('total-missoes-pendentes-count');
                if (navMissoes) {
                    navMissoes.textContent = String(totalMissoesPend);
                    navMissoes.style.display = totalMissoesPend > 0 ? 'inline-flex' : 'none';
                }
            }
        }

        document.getElementById('stat-alunos-ativos').textContent = alunos.ativos || 0;
        document.getElementById('stat-checkins-hoje').textContent = presencas.checkins_hoje || 0;
        document.getElementById('stat-menores').textContent = alunos.menores_idade || 0;
        document.getElementById('stat-inadimplentes').textContent = inadimplentesNum;
        document.getElementById('stat-receita').textContent = UI.formatCurrency(financeiro.receita_mes || 0);

        // Gráfico de frequência semanal (sempre exibe 7 dias e usa teto mínimo de 10 para proporção visual)
        const freqContainer = document.getElementById('dashboard-frequencia-bars');
        if (freqContainer) {
            const series = this.buildWeekSeries(frequencia_semanal);
            const maxRef = Math.max(...series.map(f => Number(f.total) || 0), 10);

            freqContainer.innerHTML = series.map(f => {
                const total = Number(f.total) || 0;
                const pct = total > 0 ? Math.max(Math.round((total / maxRef) * 100), 6) : 0;
                const valColor = total > 0 ? 'var(--primary-light)' : 'var(--text-muted)';
                return `
                    <div style="display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 0; gap: 8px;">
                        <span style="font-size: 11px; font-weight: 700; color: ${valColor};">${total}</span>
                        <div style="width: 100%; max-width: 32px; height: 120px; background: rgba(30, 41, 59, 0.6); border-radius: 4px; display: flex; align-items: flex-end; overflow: hidden;">
                            <div style="width: 100%; height: ${pct}%; background: linear-gradient(180deg, var(--primary-light) 0%, var(--primary) 100%); border-radius: 4px 4px 0 0; transition: height 0.5s ease;"></div>
                        </div>
                        <span style="font-size: 11px; color: var(--text-muted); white-space: nowrap;">${UI.escapeHtml(f.dia)}</span>
                    </div>
                `;
            }).join('');
        }

        // Top Assíduos (com pluralização correta e tratamento de empates)
        const topContainer = document.getElementById('dashboard-top-assiduos');
        if (topContainer && top_assiduos) {
            if (top_assiduos.length === 0) {
                topContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 13px; padding: 12px 0;">Nenhum treino registrado nos últimos 30 dias.</div>`;
            } else {
                let currentRank = 1;
                let prevTreinos = null;

                topContainer.innerHTML = top_assiduos.map((a, idx) => {
                    const treinos = Number(a.total_treinos) || 0;
                    if (idx > 0 && treinos !== prevTreinos) {
                        currentRank = idx + 1;
                    }
                    prevTreinos = treinos;

                    const fallbackAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(a.nome_completo || 'Aluno');
                    const safeAvatar = UI.sanitizeUrl(a.foto_perfil_url, fallbackAvatar);
                    const treinoLabel = `${treinos} ${treinos === 1 ? 'treino' : 'treinos'}`;

                    return `
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border-color);">
                            <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                                <span style="font-family: var(--font-heading); font-weight: 800; font-size: 14px; color: ${currentRank === 1 ? 'var(--accent)' : 'var(--text-muted)'}; flex-shrink: 0;">#${currentRank}</span>
                                <img src="${safeAvatar}"
                                     style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0;">
                                <span style="font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${UI.escapeHtml(a.nome_completo)}</span>
                            </div>
                            <span style="font-weight: 700; color: var(--primary-light); font-size: 13px; white-space: nowrap;">${treinoLabel}</span>
                        </div>
                    `;
                }).join('');
            }
        }

        // Distribuição por Modalidade (matrículas ativas)
        const modContainer = document.getElementById('dashboard-modalidades-list');
        if (modContainer && modalidades) {
            const baseAtivos = Math.max(Number(alunos.ativos) || Number(alunos.total_alunos) || 1, 1);
            modContainer.innerHTML = modalidades.map(m => {
                const totalMod = Number(m.total_alunos) || 0;
                const pctWidth = Math.min(Math.round((totalMod / baseAtivos) * 100), 100);
                const labelMod = `${totalMod} ${totalMod === 1 ? 'matrícula ativa' : 'matrículas ativas'}`;
                return `
                    <div style="margin-bottom: 14px;">
                        <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; margin-bottom: 4px;">
                            <span>${UI.escapeHtml(m.nome)}</span>
                            <span style="color: var(--primary-light);">${labelMod}</span>
                        </div>
                        <div style="width: 100%; height: 8px; background: var(--bg-input); border-radius: 4px; overflow: hidden;">
                            <div style="width: ${pctWidth}%; height: 100%; background: linear-gradient(90deg, var(--primary) 0%, var(--primary-light) 100%);"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
};

window.DashboardModule = DashboardModule;
