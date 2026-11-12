// Módulo de Estatísticas e Dashboard
const DashboardModule = {
    async init() {
        if (!API.getToken()) return;
        await this.loadDashboard();
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
        const { alunos, presencas, financeiro, modalidades, frequencia_semanal, top_assiduos } = data;

        // KPI Cards
        document.getElementById('stat-total-alunos').textContent = alunos.total_alunos || 0;
        document.getElementById('stat-alunos-ativos').textContent = alunos.ativos || 0;
        document.getElementById('stat-checkins-hoje').textContent = presencas.checkins_hoje || 0;
        document.getElementById('stat-menores').textContent = alunos.menores_idade || 0;
        document.getElementById('stat-inadimplentes').textContent = financeiro.alunos_inadimplentes || 0;
        document.getElementById('stat-receita').textContent = UI.formatCurrency(financeiro.receita_mes || 0);

        // Barra de frequência semanal
        const freqContainer = document.getElementById('dashboard-frequencia-bars');
        if (freqContainer && frequencia_semanal) {
            if (frequencia_semanal.length === 0) {
                freqContainer.innerHTML = `<div style="color: var(--text-muted); padding: 20px; text-align: center;">Nenhum check-in registrado nos últimos 7 dias.</div>`;
            } else {
                const max = Math.max(...frequencia_semanal.map(f => f.total), 1);
                freqContainer.innerHTML = frequencia_semanal.map(f => {
                    const pct = Math.round((f.total / max) * 100);
                    return `
                        <div style="display: flex; flex-direction: column; align-items: center; flex: 1; gap: 8px;">
                            <span style="font-size: 11px; font-weight: 700; color: var(--primary-light);">${Number(f.total) || 0}</span>
                            <div style="width: 100%; max-width: 32px; height: 120px; background: rgba(30, 41, 59, 0.6); border-radius: 4px; display: flex; align-items: flex-end; overflow: hidden;">
                                <div style="width: 100%; height: ${pct}%; background: linear-gradient(180deg, var(--primary-light) 0%, var(--primary) 100%); border-radius: 4px 4px 0 0; transition: height 0.5s ease;"></div>
                            </div>
                            <span style="font-size: 11px; color: var(--text-muted);">${UI.escapeHtml(f.dia)}</span>
                        </div>
                    `;
                }).join('');
            }
        }

        // Top Assíduos
        const topContainer = document.getElementById('dashboard-top-assiduos');
        if (topContainer && top_assiduos) {
            topContainer.innerHTML = top_assiduos.map((a, idx) => {
                const fallbackAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(a.nome_completo || 'Aluno');
                const safeAvatar = UI.sanitizeUrl(a.foto_perfil_url, fallbackAvatar);
                return `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--border-color);">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-family: var(--font-heading); font-weight: 800; font-size: 14px; color: ${idx === 0 ? 'var(--accent)' : 'var(--text-muted)'};">#${idx + 1}</span>
                        <img src="${safeAvatar}" 
                             style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">
                        <span style="font-weight: 600; font-size: 13px;">${UI.escapeHtml(a.nome_completo)}</span>
                    </div>
                    <span style="font-weight: 700; color: var(--primary-light); font-size: 13px;">${Number(a.total_treinos) || 0} treinos</span>
                </div>
            `;
            }).join('');
        }

        // Distribuição por Modalidade
        const modContainer = document.getElementById('dashboard-modalidades-list');
        if (modContainer && modalidades) {
            modContainer.innerHTML = modalidades.map(m => `
                <div style="margin-bottom: 14px;">
                    <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; margin-bottom: 4px;">
                        <span>${UI.escapeHtml(m.nome)}</span>
                        <span style="color: var(--primary-light);">${Number(m.total_alunos) || 0} alunos</span>
                    </div>
                    <div style="width: 100%; height: 8px; background: var(--bg-input); border-radius: 4px; overflow: hidden;">
                        <div style="width: ${alunos.total_alunos > 0 ? (Number(m.total_alunos) / Number(alunos.total_alunos)) * 100 : 0}%; height: 100%; background: linear-gradient(90deg, var(--primary) 0%, var(--primary-light) 100%);"></div>
                    </div>
                </div>
            `).join('');
        }
    }
};

window.DashboardModule = DashboardModule;
