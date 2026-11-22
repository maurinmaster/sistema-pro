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
    },

    async loadTurmas() {
        try {
            const res = await API.get('/checkins/turmas');
            this.turmas = res.data || [];

            const selectTurma = document.getElementById('checkin-turma-id');
            if (selectTurma) {
                selectTurma.innerHTML = '<option value="">Treino Livre / Sem Turma Fixa</option>';
                this.turmas.forEach(t => {
                    selectTurma.innerHTML += `<option value="${Number(t.id)}" data-mod="${Number(t.modalidade_id)}">${UI.escapeHtml(t.nome)} (${UI.escapeHtml(t.dias_semana)} ${UI.escapeHtml((t.horario_inicio || '').slice(0, 5))})</option>`;
                });
            }
        } catch (err) {
            console.error('Erro ao listar turmas:', err);
        }
    },

    async loadRecentes() {
        const tbody = document.getElementById('checkins-table-body');
        if (!tbody) return;

        try {
            const res = await API.get('/checkins/recentes');
            const list = res.data || [];

            if (list.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 30px; color: var(--text-muted);">Nenhum check-in registrado hoje.</td></tr>`;
                return;
            }

            tbody.innerHTML = list.map(c => {
                const statusColor = c.status === 'aprovado' ? '#10b981' : '#ef4444';
                const fallbackAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(c.aluno_nome || 'Aluno');
                const safeAvatar = UI.sanitizeUrl(c.foto_perfil_url, fallbackAvatar);
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

        if (!aluno_id || !modalidade_id) {
            UI.showToast('Selecione o aluno e a modalidade', 'warning');
            return;
        }

        try {
            const res = await API.post('/checkins', {
                aluno_id,
                modalidade_id,
                turma_id,
                metodo
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
