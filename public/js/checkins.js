// Módulo de Presença / Check-ins
const CheckinsModule = {
    turmas: [],

    async init() {
        this.bindEvents();
        if (!API.getToken()) return;
        await Promise.all([
            this.loadTurmas(),
            this.loadRecentes()
        ]);
    },

    bindEvents() {
        const form = document.getElementById('form-quick-checkin');
        if (form) {
            form.addEventListener('submit', (e) => this.handleSubmitCheckin(e));
        }

        const btnCheckinTopbar = document.getElementById('btn-topbar-checkin');
        if (btnCheckinTopbar) {
            btnCheckinTopbar.addEventListener('click', () => {
                this.openCheckinModal();
            });
        }

        const selectTurma = document.getElementById('checkin-turma-id');
        if (selectTurma) {
            selectTurma.addEventListener('change', () => {
                this.syncTipoAulaWithSelectedTurma();
            });
        }
    },

    syncTipoAulaWithSelectedTurma() {
        const selectTurma = document.getElementById('checkin-turma-id');
        const selectTipo = document.getElementById('checkin-tipo-aula');
        if (!selectTurma || !selectTipo) return;

        const selectedOpt = selectTurma.options[selectTurma.selectedIndex];
        const turmaTipo = selectedOpt ? (selectedOpt.dataset.tipoAula || '') : '';
        if (turmaTipo === 'especial' || turmaTipo === 'regular') {
            selectTipo.value = turmaTipo;
        } else {
            selectTipo.value = 'regular';
        }
    },

    async loadTurmas() {
        try {
            const res = await API.get('/checkins/turmas');
            this.turmas = res.data || [];

            const selectTurma = document.getElementById('checkin-turma-id');
            if (selectTurma) {
                selectTurma.innerHTML = '<option value="" data-tipo-aula="regular">Treino Livre / Sem Turma Fixa (+10 XP)</option>';
                this.turmas.forEach(t => {
                    const isEspecial = String(t.tipo_aula || 'regular').toLowerCase() === 'especial';
                    const xpTag = isEspecial ? '+20 XP Especial' : '+10 XP';
                    selectTurma.innerHTML += `<option value="${Number(t.id)}" data-mod="${Number(t.modalidade_id)}" data-tipo-aula="${isEspecial ? 'especial' : 'regular'}">${UI.escapeHtml(t.nome)} (${UI.escapeHtml(t.dias_semana)} ${UI.escapeHtml((t.horario_inicio || '').slice(0, 5))}) • ${xpTag}</option>`;
                });
            }

            this.renderTurmasXpConfig();
        } catch (err) {
            console.error('Erro ao listar turmas:', err);
        }
    },

    renderTurmasXpConfig() {
        const container = document.getElementById('checkins-turmas-xp-config');
        if (!container) return;

        if (!this.turmas || this.turmas.length === 0) {
            container.innerHTML = '<span style="font-size: 12px; color: var(--text-muted);">Nenhuma turma cadastrada para configurar bônus de XP.</span>';
            return;
        }

        container.innerHTML = this.turmas.map(t => {
            const isEsp = String(t.tipo_aula || 'regular').toLowerCase() === 'especial';
            const safeId = Number(t.id);
            const nextTipo = isEsp ? 'regular' : 'especial';
            return `
                <button type="button" class="turma-xp-chip ${isEsp ? 'is-especial' : ''}"
                    onclick="CheckinsModule.toggleTurmaTipoAula(${safeId}, '${nextTipo}')"
                    title="Clique para alternar entre Aula Regular (+10 XP) e Treino Especial/Sparring/Aulão (+20 XP)">
                    <span class="turma-xp-name">${UI.escapeHtml(t.nome)}</span>
                    <span class="turma-xp-badge">${isEsp ? '🔥 Especial +20 XP' : 'Regular +10 XP'}</span>
                </button>
            `;
        }).join('');
    },

    async toggleTurmaTipoAula(turmaId, nextTipo) {
        try {
            const res = await API.patch(`/checkins/turmas/${Number(turmaId)}/tipo-aula`, {
                tipo_aula: nextTipo,
                xp_base: nextTipo === 'especial' ? 20 : 10
            });
            UI.showToast(res.message || 'Configuração de XP da turma atualizada!', 'success');
            await this.loadTurmas();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao atualizar tipo de aula da turma.', 'error');
        }
    },

    async loadRecentes() {
        const tbody = document.getElementById('checkins-table-body');
        if (!tbody) return;

        try {
            const res = await API.get('/checkins/recentes');
            const list = res.data || [];

            if (list.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 30px; color: var(--text-muted);">Nenhum check-in registrado hoje.</td></tr>`;
                return;
            }

            tbody.innerHTML = list.map(c => {
                const statusColor = c.status === 'aprovado' ? '#10b981' : '#ef4444';
                const fallbackAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(c.aluno_nome || 'Aluno');
                const safeAvatar = UI.sanitizeUrl(c.foto_perfil_url, fallbackAvatar);
                const xpGanho = Number(c.xp_ganho || 0);
                const mult = Number(c.multiplicador_xp || 1);
                const isEsp = String(c.tipo_aula || 'regular') === 'especial';
                const xpBadge = c.status === 'aprovado'
                    ? `<span class="checkin-xp-pill ${isEsp ? 'especial' : ''}">+${xpGanho || (isEsp ? 20 : 10)} XP${mult >= 1.5 ? ' (1.5x)' : ''}</span>`
                    : `<span style="font-size: 11px; color: var(--text-muted);">—</span>`;
                return `
                    <tr>
                        <td>
                            <div class="aluno-cell">
                                <img src="${safeAvatar}" class="aluno-avatar" style="width: 32px; height: 32px;">
                                <div>
                                    <div style="font-weight: 600;">${UI.escapeHtml(c.aluno_nome)}</div>
                                </div>
                            </div>
                        </td>
                        <td><strong style="color: var(--primary-light);">${UI.escapeHtml(c.modalidade_nome)}</strong></td>
                        <td>${UI.escapeHtml(c.turma_nome || 'Treino Livre')}</td>
                        <td>${xpBadge}</td>
                        <td style="font-family: var(--font-mono); font-size: 12px;">${UI.formatDateTime(c.data_hora_checkin)}</td>
                        <td>
                            <span style="color: ${statusColor}; font-weight: 700; text-transform: uppercase; font-size: 11px;">
                                ● ${UI.escapeHtml(c.status)}
                            </span>
                            ${c.motivo_bloqueio ? `<div style="font-size: 10px; color: #ef4444;">${UI.escapeHtml(c.motivo_bloqueio)}</div>` : ''}
                        </td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            console.error('Erro ao carregar check-ins recentes:', err);
        }
    },

    openCheckinModal(preSelectedAlunoId = null) {
        // Popula alunos no select
        const selectAluno = document.getElementById('checkin-aluno-id');
        if (selectAluno && window.AlunosModule && AlunosModule.alunosList) {
            selectAluno.innerHTML = '<option value="">Selecione o aluno</option>';
            AlunosModule.alunosList.forEach(a => {
                const isSel = preSelectedAlunoId == a.id ? 'selected' : '';
                selectAluno.innerHTML += `<option value="${Number(a.id)}" ${isSel}>${UI.escapeHtml(a.nome_completo)} (${UI.escapeHtml(a.modalidade_nome || 'Geral')})</option>`;
            });
        }

        // Popula modalidades
        const selectMod = document.getElementById('checkin-modalidade-id');
        if (selectMod && window.AlunosModule && AlunosModule.modalidades) {
            selectMod.innerHTML = '<option value="">Selecione a modalidade</option>';
            AlunosModule.modalidades.forEach(m => {
                selectMod.innerHTML += `<option value="${Number(m.id)}">${UI.escapeHtml(m.nome)}</option>`;
            });
        }

        const selectTipo = document.getElementById('checkin-tipo-aula');
        if (selectTipo) selectTipo.value = 'regular';
        this.syncTipoAulaWithSelectedTurma();

        UI.openModal('modal-checkin');
    },

    quickCheckin(alunoId) {
        this.openCheckinModal(alunoId);
    },

    async handleSubmitCheckin(e) {
        e.preventDefault();
        const aluno_id = document.getElementById('checkin-aluno-id').value;
        const modalidade_id = document.getElementById('checkin-modalidade-id').value;
        const turma_id = document.getElementById('checkin-turma-id').value || null;
        const metodo = document.getElementById('checkin-metodo').value || 'manual_professor';
        const tipo_aula = document.getElementById('checkin-tipo-aula')?.value || 'regular';

        if (!aluno_id || !modalidade_id) {
            UI.showToast('Selecione o aluno e a modalidade', 'warning');
            return;
        }

        try {
            const res = await API.post('/checkins', {
                aluno_id,
                modalidade_id,
                turma_id,
                metodo,
                tipo_aula
            });

            if (res.status === 'aprovado') {
                UI.showToast(res.message, 'success');
            } else {
                UI.showToast(res.message, 'warning');
            }

            UI.closeModal('modal-checkin');
            await this.loadRecentes();
            if (window.DashboardModule) DashboardModule.loadDashboard();
            if (window.AlunosModule) AlunosModule.loadAlunos();
        } catch (err) {
            UI.showToast(err.message, 'error');
        }
    }
};

window.CheckinsModule = CheckinsModule;
