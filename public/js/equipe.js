/**
 * PRO COMBATE - Módulo de Gestão de Professores & Equipe (Admin)
 * Cadastro de professores avaliadores, administradores e recepção.
 */

const EquipeModule = {
    membros: [],
    resumo: null,
    buscaTimer: null,

    init() {
        this.bindEvents();
    },

    bindEvents() {
        document.getElementById('btn-novo-membro-equipe')?.addEventListener('click', () => {
            this.openModal();
        });

        document.getElementById('btn-recarregar-equipe')?.addEventListener('click', () => {
            this.loadAll();
        });

        document.getElementById('equipe-busca')?.addEventListener('input', () => {
            clearTimeout(this.buscaTimer);
            this.buscaTimer = setTimeout(() => this.loadAll(), 300);
        });

        document.getElementById('equipe-filtro-cargo')?.addEventListener('change', () => {
            this.loadAll();
        });

        document.getElementById('equipe-filtro-status')?.addEventListener('change', () => {
            this.loadAll();
        });

        document.getElementById('form-equipe')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.salvarMembro();
        });

        document.getElementById('btn-gerar-senha-equipe')?.addEventListener('click', () => {
            this.gerarSenhaAleatoria();
        });
    },

    async loadAll() {
        const tbody = document.getElementById('tabela-equipe-corpo');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 28px; color: var(--text-muted);"><div class="spinner"></div> Carregando equipe...</td></tr>';

        const busca = document.getElementById('equipe-busca')?.value || '';
        const cargo = document.getElementById('equipe-filtro-cargo')?.value || '';
        const status = document.getElementById('equipe-filtro-status')?.value || '';

        const qs = new URLSearchParams();
        if (busca.trim()) qs.set('busca', busca.trim());
        if (cargo && cargo !== 'todos') qs.set('cargo', cargo);
        if (status && status !== 'todos') qs.set('status', status);

        try {
            const res = await API.get(`/equipe?${qs.toString()}`);
            this.membros = res.data || [];
            this.resumo = res.resumo || {};
            this.renderKPIs();
            this.renderTabela();
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px; color: #ef4444;">Erro ao carregar equipe: ${UI.escapeHtml(err.message)}</td></tr>`;
            UI.showToast('Erro ao carregar professores e equipe: ' + err.message, 'error');
        }
    },

    renderKPIs() {
        const r = this.resumo || {};
        const elProf = document.getElementById('kpi-equipe-professores');
        const elAtivos = document.getElementById('kpi-equipe-ativos');
        const elInativos = document.getElementById('kpi-equipe-inativos');

        if (elProf) elProf.textContent = Number(r.professores_ativos || 0);
        if (elAtivos) elAtivos.textContent = Number(r.ativos || 0);
        if (elInativos) elInativos.textContent = Number(r.inativos || 0);
    },

    renderTabela() {
        const tbody = document.getElementById('tabela-equipe-corpo');
        if (!tbody) return;

        if (this.membros.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 36px; color: var(--text-muted);">
                        Nenhum professor ou membro encontrado com os filtros atuais.
                    </td>
                </tr>
            `;
            return;
        }

        const selfId = Number(window.AuthModule?.currentUser?.id || 0);
        const roleMeta = {
            professor: { label: 'Professor', style: 'background: rgba(56, 189, 248, 0.14); color: #38bdf8;' },
            admin: { label: 'Administrador', style: 'background: rgba(245, 158, 11, 0.16); color: #fbbf24;' },
            recepcao: { label: 'Recepção', style: 'background: rgba(168, 85, 247, 0.14); color: #c084fc;' }
        };

        tbody.innerHTML = this.membros.map((m) => {
            const safeId = Number(m.id);
            const isAtivo = Boolean(Number(m.ativo));
            const isSelf = safeId === selfId;
            const cargoInfo = roleMeta[m.cargo] || { label: UI.escapeHtml(m.cargo), style: '' };
            const totalGrads = Number(m.total_graduacoes_avaliadas || 0);
            const totalRpg = Number(m.total_avaliacoes_rpg || 0);

            return `
                <tr>
                    <td>
                        <div style="font-weight: 700; color: var(--text-primary); font-size: 13.5px;">
                            ${UI.escapeHtml(m.nome)}
                            ${isSelf ? '<span class="status-badge" style="margin-left: 6px; font-size: 10px; background: rgba(16, 185, 129, 0.14); color: #34d399;">Você</span>' : ''}
                        </div>
                        <div style="font-size: 11.5px; color: var(--text-muted);">ID #${safeId}</div>
                    </td>
                    <td>
                        <span class="status-badge" style="${cargoInfo.style}">${cargoInfo.label}</span>
                    </td>
                    <td>
                        <div style="font-size: 12.5px; color: var(--text-main);">${UI.escapeHtml(m.email)}</div>
                        <div style="font-size: 11.5px; color: var(--text-muted);">${UI.escapeHtml(m.telefone || 'Sem telefone')}</div>
                    </td>
                    <td>
                        <div style="font-size: 12px; color: var(--text-secondary);">
                            <strong>${totalGrads}</strong> graduações • <strong>${totalRpg}</strong> RPG
                        </div>
                    </td>
                    <td>
                        <span class="badge-status ${isAtivo ? 'ativo' : 'inativo'}">${isAtivo ? 'Ativo' : 'Inativo'}</span>
                    </td>
                    <td>
                        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                            <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11.5px;" onclick="EquipeModule.openModal(${safeId})">
                                Editar
                            </button>
                            ${!isSelf ? `
                                <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11.5px; color: ${isAtivo ? '#f59e0b' : '#34d399'};"
                                    onclick="EquipeModule.toggleStatus(${safeId}, ${isAtivo ? 0 : 1})">
                                    ${isAtivo ? 'Desativar' : 'Reativar'}
                                </button>
                                <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11.5px; color: #fca5a5; border-color: rgba(239, 68, 68, 0.35);"
                                    onclick="EquipeModule.excluirMembro(${safeId})">
                                    Excluir
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    openModal(memberId = null) {
        const form = document.getElementById('form-equipe');
        if (form) form.reset();

        const titleEl = document.getElementById('modal-equipe-titulo');
        const idEl = document.getElementById('equipe-id');
        const nomeEl = document.getElementById('equipe-nome');
        const emailEl = document.getElementById('equipe-email');
        const cargoEl = document.getElementById('equipe-cargo');
        const telEl = document.getElementById('equipe-telefone');
        const senhaEl = document.getElementById('equipe-senha');
        const senhaLabelEl = document.getElementById('equipe-senha-label');
        const ativoEl = document.getElementById('equipe-ativo');

        if (memberId) {
            const member = this.membros.find(m => Number(m.id) === Number(memberId));
            if (!member) {
                UI.showToast('Membro não encontrado na lista.', 'error');
                return;
            }
            if (titleEl) titleEl.textContent = `Editar Cadastro: ${member.nome}`;
            if (idEl) idEl.value = String(member.id);
            if (nomeEl) nomeEl.value = member.nome || '';
            if (emailEl) emailEl.value = member.email || '';
            if (cargoEl) cargoEl.value = member.cargo || 'professor';
            if (telEl) telEl.value = member.telefone || '';
            if (senhaEl) {
                senhaEl.value = '';
                senhaEl.required = false;
                senhaEl.placeholder = 'Deixe em branco para manter a senha atual';
            }
            if (senhaLabelEl) senhaLabelEl.textContent = 'Nova Senha (Opcional na edição)';
            if (ativoEl) ativoEl.checked = Boolean(Number(member.ativo));
        } else {
            if (titleEl) titleEl.textContent = 'Novo Professor / Membro da Equipe';
            if (idEl) idEl.value = '';
            if (cargoEl) cargoEl.value = 'professor';
            if (senhaEl) {
                senhaEl.required = true;
                senhaEl.placeholder = 'Mínimo 6 caracteres';
                this.gerarSenhaAleatoria();
            }
            if (senhaLabelEl) senhaLabelEl.innerHTML = 'Senha de Acesso <span class="required">*</span>';
            if (ativoEl) ativoEl.checked = true;
        }

        UI.openModal('modal-equipe');
    },

    gerarSenhaAleatoria() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
        let pass = 'Pro@';
        for (let i = 0; i < 6; i++) {
            pass += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        const input = document.getElementById('equipe-senha');
        if (input) input.value = pass;
    },

    async salvarMembro() {
        const id = document.getElementById('equipe-id')?.value || '';
        const nome = document.getElementById('equipe-nome')?.value?.trim() || '';
        const email = document.getElementById('equipe-email')?.value?.trim() || '';
        const cargo = document.getElementById('equipe-cargo')?.value || 'professor';
        const telefone = document.getElementById('equipe-telefone')?.value?.trim() || '';
        const senha = document.getElementById('equipe-senha')?.value?.trim() || '';
        const ativo = Boolean(document.getElementById('equipe-ativo')?.checked);

        if (!nome || !email) {
            UI.showToast('Informe o nome e o e-mail do membro.', 'warning');
            return;
        }
        if (!id && senha.length < 6) {
            UI.showToast('Informe uma senha inicial de no mínimo 6 caracteres.', 'warning');
            return;
        }

        const payload = {
            nome,
            email,
            cargo,
            telefone: telefone || null,
            ativo
        };
        if (id) {
            if (senha) payload.nova_senha = senha;
        } else {
            payload.senha = senha;
        }

        const btn = document.getElementById('btn-salvar-equipe');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Salvando...';
        }

        try {
            const res = id
                ? await API.put(`/equipe/${id}`, payload)
                : await API.post('/equipe', payload);

            UI.showToast(res.message || 'Cadastro salvo com sucesso!', 'success');
            UI.closeModal('modal-equipe');
            await this.loadAll();
            if (window.AlunosModule && typeof AlunosModule.loadProfessoresSelect === 'function') {
                AlunosModule.loadProfessoresSelect();
            }
        } catch (err) {
            UI.showToast('Erro ao salvar membro da equipe: ' + err.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Salvar Cadastro';
            }
        }
    },

    async toggleStatus(memberId, nextAtivo) {
        const member = this.membros.find(m => Number(m.id) === Number(memberId));
        const nome = member ? member.nome : 'este membro';
        const acao = nextAtivo ? 'reativar' : 'desativar';
        if (!confirm(`Deseja ${acao} o cadastro de "${nome}"?`)) return;

        try {
            const res = await API.patch(`/equipe/${memberId}/status`, { ativo: nextAtivo });
            UI.showToast(res.message || 'Status atualizado!', 'success');
            await this.loadAll();
            if (window.AlunosModule && typeof AlunosModule.loadProfessoresSelect === 'function') {
                AlunosModule.loadProfessoresSelect();
            }
        } catch (err) {
            UI.showToast('Erro ao alterar status: ' + err.message, 'error');
        }
    },

    async excluirMembro(memberId) {
        const member = this.membros.find(m => Number(m.id) === Number(memberId));
        const nome = member ? member.nome : 'este membro';
        if (!confirm(`Deseja excluir permanentemente o cadastro de "${nome}"? Avaliações antigas permanecerão salvas com avaliador "Não Informado".`)) {
            return;
        }

        try {
            const res = await API.delete(`/equipe/${memberId}`);
            UI.showToast(res.message || 'Membro excluído com sucesso!', 'success');
            await this.loadAll();
            if (window.AlunosModule && typeof AlunosModule.loadProfessoresSelect === 'function') {
                AlunosModule.loadProfessoresSelect();
            }
        } catch (err) {
            UI.showToast('Erro ao excluir membro: ' + err.message, 'error');
        }
    }
};

window.EquipeModule = EquipeModule;
