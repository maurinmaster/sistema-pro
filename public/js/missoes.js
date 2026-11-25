/**
 * PRO COMBATE - Módulo Admin/Professor: Quadro de Missões & Validação de Entregas
 */
const MissoesModule = {
    missoes: [],
    inscricoes: [],
    activeTab: 'quadro',

    async init() {
        this.bindEvents();
        if (!API.getToken()) return;
        if (window.AuthModule && AuthModule.can('manage_missoes')) {
            await this.loadInscricoesCountBadge();
        }
    },

    bindEvents() {
        document.querySelectorAll('[data-missoes-subtab]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.switchSubTab(btn.dataset.missoesSubtab);
            });
        });

        document.getElementById('btn-nova-missao')?.addEventListener('click', () => {
            this.openModalMissao();
        });

        document.getElementById('form-missao')?.addEventListener('submit', (e) => {
            this.handleSubmitMissao(e);
        });

        document.getElementById('filtro-missoes-validacao-status')?.addEventListener('change', () => {
            this.loadInscricoes();
        });
    },

    switchSubTab(tab) {
        this.activeTab = tab === 'validacoes' ? 'validacoes' : 'quadro';
        const quadroPane = document.getElementById('subtab-missoes-quadro');
        const valPane = document.getElementById('subtab-missoes-validacoes');

        if (quadroPane) quadroPane.style.display = this.activeTab === 'quadro' ? 'block' : 'none';
        if (valPane) valPane.style.display = this.activeTab === 'validacoes' ? 'block' : 'none';

        document.querySelectorAll('[data-missoes-subtab]').forEach((btn) => {
            const active = btn.dataset.missoesSubtab === this.activeTab;
            btn.classList.toggle('btn-primary', active);
            btn.classList.toggle('btn-secondary', !active);
        });

        if (this.activeTab === 'validacoes') {
            this.loadInscricoes();
        } else {
            this.loadQuadro();
        }
    },

    async loadAll() {
        await Promise.all([this.loadQuadro(), this.loadInscricoes()]);
    },

    async loadInscricoesCountBadge() {
        try {
            const res = await API.get('/missoes/inscricoes?status=aguardando_validacao');
            const total = Array.isArray(res.data) ? res.data.length : 0;
            this.updateBadgeCount(total);
        } catch {
            // ignore silently during boot
        }
    },

    updateBadgeCount(total) {
        const count = Number(total || 0);
        const desc = count > 0
            ? `${count} ${count === 1 ? 'entrega de missão aguardando validação' : 'entregas de missão aguardando validação'}`
            : 'Nenhuma entrega aguardando validação';
        const navBadge = document.getElementById('total-missoes-pendentes-count');
        const subBadge = document.getElementById('missoes-validacoes-badge');
        if (navBadge) {
            navBadge.textContent = String(count);
            navBadge.title = desc;
            navBadge.setAttribute('aria-label', desc);
            navBadge.style.display = count > 0 ? 'inline-flex' : 'none';
        }
        if (subBadge) {
            subBadge.textContent = count > 0 ? String(count) : '0';
            subBadge.title = desc;
            subBadge.style.display = count > 0 ? 'inline-flex' : 'none';
        }
    },

    async loadQuadro() {
        const container = document.getElementById('lista-missoes-quadro');
        if (!container) return;

        container.innerHTML = `<div style="grid-column: 1 / -1; text-align:center; padding:32px; color:var(--text-muted);"><div class="spinner"></div> Carregando quadro de missões...</div>`;
        try {
            const res = await API.get('/missoes');
            this.missoes = Array.isArray(res.data) ? res.data : [];
            this.renderQuadro();
        } catch (err) {
            container.innerHTML = `<div style="grid-column: 1 / -1; padding: 24px; color: #ef4444; text-align: center;">Erro ao carregar missões: ${UI.escapeHtml(err.message)}</div>`;
        }
    },

    renderQuadro() {
        const container = document.getElementById('lista-missoes-quadro');
        if (!container) return;

        if (this.missoes.length === 0) {
            container.innerHTML = `
                <div class="stat-card" style="grid-column: 1 / -1; padding: 36px; text-align: center; color: var(--text-muted);">
                    Nenhuma missão cadastrada ainda. Clique em <strong>+ Nova Missão</strong> para disponibilizar desafios no painel dos alunos.
                </div>
            `;
            return;
        }

        const canManage = !window.AuthModule || AuthModule.can('manage_missoes');
        const diffLabels = { facil: 'Fácil', media: 'Média', dificil: 'Difícil', epica: 'Épica' };
        const catLabels = { tecnica: 'Técnica', sparring: 'Sparring', clinch: 'Clinch', condicionamento: 'Condicionamento', frequencia: 'Frequência', disciplina: 'Disciplina' };
        const pilarLabels = { inteligencia: 'Inteligência', destreza: 'Destreza', agilidade: 'Agilidade', forca: 'Força', vitalidade: 'Vitalidade' };

        container.innerHTML = this.missoes.map((m) => {
            const safeId = Number(m.id);
            const encTitulo = encodeURIComponent(m.titulo || '').replace(/'/g, '%27');
            const ativa = Number(m.ativo) === 1;
            const diffKey = ['facil', 'media', 'dificil', 'epica'].includes(m.dificuldade) ? m.dificuldade : 'media';

            return `
                <div class="admin-missao-card ${ativa ? '' : 'inactive'}">
                    <div class="admin-missao-head">
                        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                            <span class="missao-diff-badge ${diffKey}">${UI.escapeHtml(diffLabels[diffKey] || m.dificuldade)}</span>
                            <span class="missao-cat-chip">${UI.escapeHtml(catLabels[m.categoria] || m.categoria)}</span>
                            ${m.pilar_foco ? `<span class="missao-pilar-chip">${UI.escapeHtml(pilarLabels[m.pilar_foco] || m.pilar_foco)}</span>` : ''}
                        </div>
                        <span class="status-badge ${ativa ? 'status-active' : 'status-inactive'}">${ativa ? 'Ativa' : 'Pausada'}</span>
                    </div>

                    <h4 class="admin-missao-title">${UI.escapeHtml(m.titulo)}</h4>
                    <p class="admin-missao-desc">${UI.escapeHtml(m.descricao)}</p>

                    <div class="admin-missao-meta">
                        <span class="missao-xp-chip">⚡ +${Number(m.recompensa_xp || 0)} XP</span>
                        ${m.recompensa_texto ? `<span style="font-size:11px; color:#cbd5e1;">${UI.escapeHtml(m.recompensa_texto)}</span>` : ''}
                        ${m.modalidade_nome ? `<span style="font-size:11px; color:#7dd3fc;">• ${UI.escapeHtml(m.modalidade_nome)}</span>` : '<span style="font-size:11px; color:#94a3b8;">• Todas modalidades</span>'}
                    </div>

                    <div class="admin-missao-stats">
                        <span>Em andamento: <strong>${Number(m.total_em_andamento || 0)}</strong></span>
                        <span>Aguardando: <strong style="color:#fbbf24;">${Number(m.total_aguardando || 0)}</strong></span>
                        <span>Concluídas: <strong style="color:#34d399;">${Number(m.total_concluidas || 0)}</strong></span>
                    </div>

                    ${canManage ? `
                        <div class="admin-missao-actions">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="MissoesModule.openModalMissao(${safeId})">Editar</button>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="MissoesModule.toggleMissao(${safeId})">${ativa ? 'Pausar' : 'Ativar'}</button>
                            <button type="button" class="btn btn-danger btn-sm" onclick="MissoesModule.deleteMissao(${safeId}, '${encTitulo}')">Excluir</button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    },

    async loadInscricoes() {
        const container = document.getElementById('lista-missoes-validacoes');
        const statusSel = document.getElementById('filtro-missoes-validacao-status');
        const status = statusSel ? statusSel.value : 'aguardando_validacao';
        if (!container) return;

        try {
            const res = await API.get(`/missoes/inscricoes?status=${encodeURIComponent(status)}`);
            this.inscricoes = Array.isArray(res.data) ? res.data : [];

            if (status === 'aguardando_validacao') {
                this.updateBadgeCount(this.inscricoes.length);
            } else {
                await this.loadInscricoesCountBadge();
            }

            this.renderInscricoes();
        } catch (err) {
            container.innerHTML = `<div style="padding: 24px; color: #ef4444; text-align: center;">Erro ao carregar entregas dos alunos: ${UI.escapeHtml(err.message)}</div>`;
        }
    },

    renderInscricoes() {
        const container = document.getElementById('lista-missoes-validacoes');
        if (!container) return;

        if (this.inscricoes.length === 0) {
            container.innerHTML = `
                <div class="stat-card" style="padding: 32px; text-align: center; color: var(--text-muted);">
                    Nenhuma missão neste filtro de status no momento.
                </div>
            `;
            return;
        }

        const statusLabels = {
            aguardando_validacao: { cls: 'status-pending', label: 'Aguardando Validação' },
            em_andamento: { cls: 'status-active', label: 'Em Andamento' },
            concluida: { cls: 'status-paid', label: 'Concluída' }
        };

        container.innerHTML = this.inscricoes.map((ins) => {
            const st = statusLabels[ins.status] || { cls: 'status-inactive', label: ins.status };
            const safeId = Number(ins.id);
            const showActions = ins.status === 'aguardando_validacao' || ins.status === 'em_andamento';

            return `
                <div class="missao-validacao-card">
                    <div class="missao-validacao-top">
                        <div>
                            <strong style="color:#ffffff; font-size:14px;">${UI.escapeHtml(ins.aluno_nome)}</strong>
                            <div style="font-size:12px; color:#7dd3fc; margin-top:2px;">
                                🎯 ${UI.escapeHtml(ins.missao_titulo)} <span style="color:#fbbf24; font-weight:700;">(+${Number(ins.recompensa_xp || 0)} XP)</span>
                            </div>
                        </div>
                        <span class="status-badge ${st.cls}">${UI.escapeHtml(st.label)}</span>
                    </div>

                    ${ins.nota_aluno ? `
                        <div style="font-size:12px; color:#cbd5e1; background:rgba(15,23,42,0.7); border:1px solid rgba(148,163,184,0.16); padding:8px 10px; border-radius:8px;">
                            <strong>Relato do Aluno:</strong> ${UI.escapeHtml(ins.nota_aluno)}
                        </div>
                    ` : ''}

                    ${ins.feedback_professor ? `
                        <div style="font-size:11.5px; color:#94a3b8;">
                            <strong>Feedback registrado:</strong> ${UI.escapeHtml(ins.feedback_professor)}
                        </div>
                    ` : ''}

                    ${showActions ? `
                        <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; margin-top:4px;">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="MissoesModule.validarInscricao(${safeId}, 'devolver')">
                                ↩ Devolver com Orientação
                            </button>
                            <button type="button" class="btn btn-primary btn-sm" onclick="MissoesModule.validarInscricao(${safeId}, 'aprovar')">
                                ✓ Aprovar Conclusão
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    },

    async populateModalidadesSelect(selectedVal = '') {
        const select = document.getElementById('missao-modalidade-id');
        if (!select) return;
        let mods = window.AlunosModule?.modalidades || [];
        if (!mods.length) {
            try {
                const res = await API.get('/modalidades');
                mods = res.data || [];
            } catch {
                mods = [];
            }
        }
        select.innerHTML = '<option value="">Todas as Modalidades</option>' +
            mods.map(m => `<option value="${Number(m.id)}">${UI.escapeHtml(m.nome)}</option>`).join('');
        select.value = selectedVal ? String(selectedVal) : '';
    },

    async openModalMissao(id = null) {
        const form = document.getElementById('form-missao');
        if (form) form.reset();
        document.getElementById('missao-id').value = '';

        const titleEl = document.getElementById('modal-missao-title');
        let modSelected = '';

        if (id) {
            const m = this.missoes.find(item => Number(item.id) === Number(id));
            if (m) {
                document.getElementById('missao-id').value = m.id;
                document.getElementById('missao-titulo').value = m.titulo || '';
                document.getElementById('missao-descricao').value = m.descricao || '';
                document.getElementById('missao-categoria').value = m.categoria || 'tecnica';
                document.getElementById('missao-dificuldade').value = m.dificuldade || 'media';
                document.getElementById('missao-pilar').value = m.pilar_foco || '';
                document.getElementById('missao-xp').value = m.recompensa_xp ?? 50;
                document.getElementById('missao-recompensa-texto').value = m.recompensa_texto || '';
                document.getElementById('missao-vagas').value = m.limite_vagas || '';
                document.getElementById('missao-prazo').value = m.prazo_dias || '';
                document.getElementById('missao-ativo').checked = Number(m.ativo) === 1;
                modSelected = m.modalidade_id || '';
                if (titleEl) titleEl.textContent = `Editar Missão: ${m.titulo}`;
            }
        } else {
            document.getElementById('missao-xp').value = 50;
            document.getElementById('missao-ativo').checked = true;
            if (titleEl) titleEl.textContent = 'Nova Missão no Quadro';
        }

        await this.populateModalidadesSelect(modSelected);
        UI.openModal('modal-missao');
    },

    async handleSubmitMissao(e) {
        e.preventDefault();
        const id = document.getElementById('missao-id').value;
        const payload = {
            titulo: document.getElementById('missao-titulo').value,
            descricao: document.getElementById('missao-descricao').value,
            categoria: document.getElementById('missao-categoria').value,
            dificuldade: document.getElementById('missao-dificuldade').value,
            pilar_foco: document.getElementById('missao-pilar').value || null,
            modalidade_id: document.getElementById('missao-modalidade-id').value || null,
            recompensa_xp: parseInt(document.getElementById('missao-xp').value || '50', 10),
            recompensa_texto: document.getElementById('missao-recompensa-texto').value || null,
            limite_vagas: document.getElementById('missao-vagas').value ? parseInt(document.getElementById('missao-vagas').value, 10) : null,
            prazo_dias: document.getElementById('missao-prazo').value ? parseInt(document.getElementById('missao-prazo').value, 10) : null,
            ativo: document.getElementById('missao-ativo').checked ? 1 : 0
        };

        try {
            if (id) {
                const res = await API.put(`/missoes/${id}`, payload);
                UI.showToast(res.message || 'Missão atualizada!', 'success');
            } else {
                const res = await API.post('/missoes', payload);
                UI.showToast(res.message || 'Missão criada!', 'success');
            }
            UI.closeModal('modal-missao');
            await this.loadQuadro();
        } catch (err) {
            UI.showToast(err.message, 'error');
        }
    },

    async toggleMissao(id) {
        try {
            const res = await API.patch(`/missoes/${id}/toggle`, {});
            UI.showToast(res.message || 'Status atualizado!', 'success');
            await this.loadQuadro();
        } catch (err) {
            UI.showToast(err.message, 'error');
        }
    },

    async deleteMissao(id, tituloEnc) {
        const titulo = decodeURIComponent(tituloEnc);
        if (!confirm(`Deseja realmente excluir a missão "${titulo}" do quadro?`)) return;
        try {
            const res = await API.delete(`/missoes/${id}`);
            UI.showToast(res.message || 'Missão removida!', 'success');
            await this.loadAll();
        } catch (err) {
            UI.showToast(err.message, 'error');
        }
    },

    async validarInscricao(inscricaoId, acao) {
        let feedback = null;
        if (acao === 'devolver') {
            const promptRes = prompt('Informe a orientação/feedback para o aluno ajustar antes de concluir:');
            if (promptRes === null) return;
            feedback = promptRes.trim();
        } else {
            const promptRes = prompt('Observação opcional de parabéns ou feedback (deixe em branco para aprovar direto):');
            if (promptRes === null) return;
            feedback = promptRes.trim() || null;
        }

        try {
            const res = await API.patch(`/missoes/inscricoes/${inscricaoId}/validar`, {
                acao,
                feedback_professor: feedback
            });
            UI.showToast(res.message || 'Validação salva!', 'success');
            await this.loadAll();
        } catch (err) {
            UI.showToast(err.message, 'error');
        }
    }
};

window.MissoesModule = MissoesModule;
