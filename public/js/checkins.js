// Módulo Inteligente de Presença / Check-ins com Grid Visual & Duplo Clique
const CheckinsModule = {
    turmas: [],
    boardData: null,
    selectedHourFilter: 'auto', // 'auto' | 'primeiro' | number(0..23)
    searchTerm: '',
    selectedDate: '',
    armedPendingId: null,
    armedPendingTimer: null,
    armedUndoId: null,
    armedUndoTimer: null,
    inFlightStudents: new Set(),
    inFlightUndoCheckins: new Set(),

    async init() {
        this.bindEvents();
        if (!API.getToken()) return;
        await Promise.all([
            this.loadTurmas(),
            this.loadSmartBoard()
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

        const searchInput = document.getElementById('checkin-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = String(e.target.value || '').trim().toLowerCase();
                this.renderPendingGrid();
                this.renderRegisteredGrid();
            });
        }

        const dateInput = document.getElementById('checkin-date-input');
        if (dateInput) {
            dateInput.addEventListener('change', (e) => {
                this.selectedDate = e.target.value || '';
                this.loadSmartBoard();
            });
        }

        document.getElementById('btn-refresh-smart-checkins')?.addEventListener('click', () => {
            this.loadSmartBoard();
        });

        const hourFiltersEl = document.getElementById('checkin-hour-filters');
        if (hourFiltersEl) {
            hourFiltersEl.addEventListener('click', (e) => {
                const pill = e.target.closest('.checkin-hour-pill[data-hour]');
                if (!pill) return;
                const val = pill.getAttribute('data-hour');
                if (val === 'auto' || val === 'primeiro') {
                    this.selectedHourFilter = val;
                    this.loadSmartBoard();
                } else {
                    const num = parseInt(val, 10);
                    if (!Number.isNaN(num)) {
                        this.selectedHourFilter = num;
                        this.loadSmartBoard();
                    }
                }
            });
        }

        // Duplo clique / duplo toque no grid de pendentes para confirmar presença
        const pendingGrid = document.getElementById('checkin-pending-grid');
        if (pendingGrid) {
            pendingGrid.addEventListener('click', (e) => {
                const tile = e.target.closest('.checkin-student-tile[data-aluno-id]');
                if (!tile) return;
                const alunoId = Number(tile.getAttribute('data-aluno-id'));
                if (!alunoId || this.inFlightStudents.has(alunoId)) return;

                if (this.armedPendingId === alunoId) {
                    this.clearArmedPending();
                    this.confirmQuickCheckin(alunoId);
                } else {
                    this.armPendingTile(alunoId);
                }
            });

            pendingGrid.addEventListener('dblclick', (e) => {
                const tile = e.target.closest('.checkin-student-tile[data-aluno-id]');
                if (!tile) return;
                e.preventDefault();
                const alunoId = Number(tile.getAttribute('data-aluno-id'));
                if (!alunoId || this.inFlightStudents.has(alunoId)) return;
                this.clearArmedPending();
                this.confirmQuickCheckin(alunoId);
            });
        }

        // Duplo clique / duplo toque no grid de registrados para desfazer check-in
        const registeredGrid = document.getElementById('checkin-registered-grid');
        if (registeredGrid) {
            registeredGrid.addEventListener('click', (e) => {
                const tile = e.target.closest('.checkin-student-tile.registered[data-checkin-id]');
                if (!tile) return;
                const checkinId = Number(tile.getAttribute('data-checkin-id'));
                const alunoId = Number(tile.getAttribute('data-aluno-id'));
                if (!checkinId || this.inFlightUndoCheckins.has(checkinId)) return;

                if (this.armedUndoId === checkinId) {
                    this.clearArmedUndo();
                    this.undoCheckin(checkinId, alunoId);
                } else {
                    this.armUndoTile(checkinId);
                }
            });

            registeredGrid.addEventListener('dblclick', (e) => {
                const tile = e.target.closest('.checkin-student-tile.registered[data-checkin-id]');
                if (!tile) return;
                e.preventDefault();
                const checkinId = Number(tile.getAttribute('data-checkin-id'));
                const alunoId = Number(tile.getAttribute('data-aluno-id'));
                if (!checkinId || this.inFlightUndoCheckins.has(checkinId)) return;
                this.clearArmedUndo();
                this.undoCheckin(checkinId, alunoId);
            });
        }
    },

    armPendingTile(alunoId) {
        this.clearArmedPending();
        this.armedPendingId = alunoId;
        const tile = document.querySelector(`#checkin-pending-grid .checkin-student-tile[data-aluno-id="${alunoId}"]`);
        if (tile) tile.classList.add('armed');
        this.armedPendingTimer = setTimeout(() => {
            this.clearArmedPending();
        }, 1600);
    },

    clearArmedPending() {
        if (this.armedPendingTimer) {
            clearTimeout(this.armedPendingTimer);
            this.armedPendingTimer = null;
        }
        this.armedPendingId = null;
        document.querySelectorAll('#checkin-pending-grid .checkin-student-tile.armed').forEach((el) => {
            el.classList.remove('armed');
        });
    },

    armUndoTile(checkinId) {
        this.clearArmedUndo();
        this.armedUndoId = checkinId;
        const tile = document.querySelector(`#checkin-registered-grid .checkin-student-tile[data-checkin-id="${checkinId}"]`);
        if (tile) tile.classList.add('armed-undo');
        this.armedUndoTimer = setTimeout(() => {
            this.clearArmedUndo();
        }, 1800);
    },

    clearArmedUndo() {
        if (this.armedUndoTimer) {
            clearTimeout(this.armedUndoTimer);
            this.armedUndoTimer = null;
        }
        this.armedUndoId = null;
        document.querySelectorAll('#checkin-registered-grid .checkin-student-tile.armed-undo').forEach((el) => {
            el.classList.remove('armed-undo');
        });
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

    // Mantém assinatura retrocompatível chamada pelo app.js ao navegar para view-checkins
    async loadRecentes() {
        return this.loadSmartBoard();
    },

    async loadSmartBoard() {
        const pendingGrid = document.getElementById('checkin-pending-grid');
        if (!pendingGrid) return;

        try {
            const params = new URLSearchParams();
            if (this.selectedDate) {
                params.set('data', this.selectedDate);
            }
            if (typeof this.selectedHourFilter === 'number') {
                params.set('hora', String(this.selectedHourFilter));
            }

            const qs = params.toString();
            const res = await API.get(`/checkins/painel-inteligente${qs ? `?${qs}` : ''}`);
            this.boardData = res.data || null;

            const dateInput = document.getElementById('checkin-date-input');
            if (dateInput && this.boardData?.data_referencia && !dateInput.value) {
                dateInput.value = this.boardData.data_referencia;
                this.selectedDate = this.boardData.data_referencia;
            }

            const clockEl = document.getElementById('checkin-smart-clock-badge');
            if (clockEl && this.boardData) {
                clockEl.textContent = `🕒 Agora: ${this.boardData.horario_atual_label || '--:--'}`;
            }

            this.renderHourFilters();
            this.renderPendingGrid();
            this.renderRegisteredGrid();
        } catch (err) {
            console.error('Erro ao carregar painel inteligente de check-ins:', err);
            pendingGrid.innerHTML = `<div class="checkin-grid-empty" style="color: #fca5a5;">Erro ao carregar painel de chamadas: ${UI.escapeHtml(err.message)}</div>`;
        }
    },

    renderHourFilters() {
        const wrap = document.getElementById('checkin-hour-filters');
        if (!wrap || !this.boardData) return;

        const detected = Array.isArray(this.boardData.horarios_detectados) ? this.boardData.horarios_detectados : [];
        const primeiroCount = Number(this.boardData.totais?.primeiro_checkin || 0);

        const pillsHtml = [
            `<button type="button" class="checkin-hour-pill ${this.selectedHourFilter === 'auto' ? 'active' : ''}" data-hour="auto">
                ✨ Inteligente (${UI.escapeHtml(this.boardData.horario_atual_label || 'Agora')})
            </button>`,
            `<button type="button" class="checkin-hour-pill ${this.selectedHourFilter === 'primeiro' ? 'active' : ''}" data-hour="primeiro">
                🆕 1º Check-in ${primeiroCount > 0 ? `(${primeiroCount})` : ''}
            </button>`
        ];

        detected.forEach((slot) => {
            const isActive = this.selectedHourFilter === Number(slot.hora);
            pillsHtml.push(`
                <button type="button" class="checkin-hour-pill ${isActive ? 'active' : ''}" data-hour="${Number(slot.hora)}" title="${Number(slot.total)} check-ins registrados neste horário">
                    🕒 ${UI.escapeHtml(slot.label)}
                </button>
            `);
        });

        wrap.innerHTML = pillsHtml.join('');
    },

    getSafeStudentAvatar(fotoUrl, fullName) {
        const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName || 'Atleta')}&background=0f172a&color=f8fafc&bold=true`;
        const safe = UI.getSafeImageUrl(fotoUrl, '');
        return safe || fallback;
    },

    matchesSearch(item) {
        if (!this.searchTerm) return true;
        const nomeFull = String(item.nome_completo || item.aluno_nome || '').toLowerCase();
        const nomeCurto = String(item.nome_curto || '').toLowerCase();
        const mod = String(item.modalidade_nome || '').toLowerCase();
        return nomeFull.includes(this.searchTerm) || nomeCurto.includes(this.searchTerm) || mod.includes(this.searchTerm);
    },

    renderPendingGrid() {
        const grid = document.getElementById('checkin-pending-grid');
        const countEl = document.getElementById('checkin-pending-count');
        if (!grid) return;

        const rawList = Array.isArray(this.boardData?.pendentes) ? this.boardData.pendentes : [];
        let list = rawList.filter(item => this.matchesSearch(item));

        if (this.selectedHourFilter === 'primeiro') {
            list = list.filter(item => item.is_primeiro_checkin);
        }

        if (countEl) {
            countEl.textContent = `${list.length} ${list.length === 1 ? 'aguardando' : 'aguardando'}`;
        }

        if (list.length === 0) {
            grid.innerHTML = `<div class="checkin-grid-empty">${this.searchTerm
                ? 'Nenhum aluno pendente encontrado para essa busca.'
                : (this.selectedHourFilter === 'primeiro'
                    ? 'Todos os alunos de 1º check-in já registraram presença hoje.'
                    : 'Todos os alunos ativos já confirmaram presença na data selecionada!')
            }</div>`;
            return;
        }

        grid.innerHTML = list.map((a) => {
            const aid = Number(a.id);
            const avatarSrc = this.getSafeStudentAvatar(a.foto_perfil_url, a.nome_completo);
            const isFirst = Boolean(a.is_primeiro_checkin);
            const isCurrentSlot = Number(a.prioridade_grupo) === 1;
            const slotClass = isFirst ? 'is-first' : (isCurrentSlot ? 'is-current-slot' : '');
            const tagLabel = isFirst
                ? '1º Check-in'
                : (isCurrentSlot ? `★ ${a.horario_habitual_label || 'Horário'}` : (a.horario_habitual_label || 'Ativo'));
            const tooltip = `${a.nome_completo} • ${a.modalidade_nome || 'Geral'} • Duplo clique para confirmar`;

            return `
                <button type="button" class="checkin-student-tile ${slotClass}" data-aluno-id="${aid}" title="${UI.escapeHtml(tooltip)}">
                    <div class="checkin-tile-avatar-wrap">
                        <img src="${UI.escapeHtml(avatarSrc)}" alt="${UI.escapeHtml(a.nome_curto)}" class="checkin-tile-avatar" loading="lazy">
                        <span class="checkin-tile-badge ${isFirst ? 'first' : (isCurrentSlot ? 'slot' : 'neutral')}">${UI.escapeHtml(tagLabel)}</span>
                        <span class="checkin-tile-arm-overlay">Clique 2x ✓</span>
                    </div>
                    <span class="checkin-tile-name">${UI.escapeHtml(a.nome_curto)}</span>
                </button>
            `;
        }).join('');
    },

    renderRegisteredGrid() {
        const grid = document.getElementById('checkin-registered-grid');
        const countEl = document.getElementById('checkin-registered-count');
        if (!grid) return;

        const rawList = Array.isArray(this.boardData?.registrados) ? this.boardData.registrados : [];
        const list = rawList.filter(item => this.matchesSearch(item));

        if (countEl) {
            countEl.textContent = `${list.length} ${list.length === 1 ? 'confirmado' : 'confirmados'}`;
        }

        if (list.length === 0) {
            grid.innerHTML = `<div class="checkin-grid-empty">Nenhum check-in registrado na data selecionada.</div>`;
            return;
        }

        grid.innerHTML = list.map((r) => {
            const checkinId = Number(r.checkin_id || r.id);
            const alunoId = Number(r.aluno_id || r.id);
            const avatarSrc = this.getSafeStudentAvatar(r.foto_perfil_url, r.nome_completo);
            const isBlocked = r.status && r.status !== 'aprovado';
            const horaBadge = r.hora_checkin ? `✓ ${r.hora_checkin}` : '✓ Hoje';
            const tooltip = `${r.nome_completo} (${r.modalidade_nome || 'Geral'}) às ${r.hora_checkin || '--:--'} • Duplo clique para desfazer`;

            return `
                <button type="button" class="checkin-student-tile registered ${isBlocked ? 'is-blocked' : ''}" data-checkin-id="${checkinId}" data-aluno-id="${alunoId}" title="${UI.escapeHtml(tooltip)}">
                    <div class="checkin-tile-avatar-wrap">
                        <img src="${UI.escapeHtml(avatarSrc)}" alt="${UI.escapeHtml(r.nome_curto)}" class="checkin-tile-avatar" loading="lazy">
                        <span class="checkin-tile-badge ${isBlocked ? 'blocked' : 'done'}">${UI.escapeHtml(horaBadge)}</span>
                        <span class="checkin-tile-arm-overlay undo">Clique 2x ↩</span>
                    </div>
                    <span class="checkin-tile-name">${UI.escapeHtml(r.nome_curto)}</span>
                </button>
            `;
        }).join('');
    },

    async confirmQuickCheckin(alunoId) {
        if (this.inFlightStudents.has(alunoId)) return;
        this.inFlightStudents.add(alunoId);

        const tileEl = document.querySelector(`#checkin-pending-grid .checkin-student-tile[data-aluno-id="${alunoId}"]`);
        if (tileEl) tileEl.classList.add('is-processing');

        try {
            const candidate = (this.boardData?.pendentes || []).find(p => Number(p.id) === Number(alunoId));
            const payload = {
                aluno_id: alunoId,
                rapido: true,
                metodo: 'manual_professor'
            };
            if (candidate && candidate.modalidade_id) {
                payload.modalidade_id = Number(candidate.modalidade_id);
            }

            const res = await API.post('/checkins', payload);
            UI.showToast(res.message || 'Check-in confirmado!', res.status === 'aprovado' ? 'success' : 'warning');

            // Atualiza estado local para mover imediatamente da foto pendente para registrados
            if (this.boardData) {
                const pendingList = Array.isArray(this.boardData.pendentes) ? this.boardData.pendentes : [];
                const idx = pendingList.findIndex(p => Number(p.id) === Number(alunoId));
                const movedStudent = idx >= 0 ? pendingList.splice(idx, 1)[0] : candidate;

                const chk = res.checkin || {};
                const registeredList = Array.isArray(this.boardData.registrados) ? this.boardData.registrados : [];
                const alreadyIdx = registeredList.findIndex(r => Number(r.aluno_id) === Number(alunoId));
                const newEntry = {
                    checkin_id: Number(chk.id || res.id),
                    id: alunoId,
                    aluno_id: alunoId,
                    nome_completo: chk.aluno_nome || movedStudent?.nome_completo || 'Atleta',
                    nome_curto: movedStudent?.nome_curto || String(chk.aluno_nome || 'Atleta').split(/\s+/)[0],
                    foto_perfil_url: chk.foto_perfil_url || movedStudent?.foto_perfil_url || null,
                    modalidade_id: Number(chk.modalidade_id || movedStudent?.modalidade_id || 0),
                    modalidade_nome: chk.modalidade_nome || movedStudent?.modalidade_nome || 'Geral',
                    data_hora_checkin: chk.data_hora_checkin || new Date().toISOString(),
                    hora_checkin: chk.hora_checkin || new Date().toTimeString().slice(0, 5),
                    status: chk.status || res.status || 'aprovado',
                    motivo_bloqueio: chk.motivo_bloqueio || res.motivo_bloqueio || null
                };
                if (alreadyIdx === -1) {
                    registeredList.unshift(newEntry);
                }

                this.renderPendingGrid();
                this.renderRegisteredGrid();
            }

            if (window.DashboardModule) DashboardModule.loadDashboard();
            if (window.AlunosModule) AlunosModule.loadAlunos();
        } catch (err) {
            if (tileEl) tileEl.classList.remove('is-processing');
            UI.showToast(err.message || 'Erro ao confirmar check-in.', 'error');
        } finally {
            this.inFlightStudents.delete(alunoId);
        }
    },

    async undoCheckin(checkinId, alunoId) {
        if (this.inFlightUndoCheckins.has(checkinId)) return;
        this.inFlightUndoCheckins.add(checkinId);

        const tileEl = document.querySelector(`#checkin-registered-grid .checkin-student-tile[data-checkin-id="${checkinId}"]`);
        if (tileEl) tileEl.classList.add('is-processing');

        try {
            const res = await API.delete(`/checkins/${checkinId}`);
            UI.showToast(res.message || 'Check-in desfeito!', 'info');

            // Recarrega o painel inteligente para recolocar o aluno exatamente na posição de horário/1º check-in
            await this.loadSmartBoard();
            if (window.DashboardModule) DashboardModule.loadDashboard();
            if (window.AlunosModule) AlunosModule.loadAlunos();
        } catch (err) {
            if (tileEl) tileEl.classList.remove('is-processing');
            UI.showToast(err.message || 'Erro ao desfazer check-in.', 'error');
        } finally {
            this.inFlightUndoCheckins.delete(checkinId);
        }
    },

    openCheckinModal(preSelectedAlunoId = null) {
        const selectAluno = document.getElementById('checkin-aluno-id');
        if (selectAluno && window.AlunosModule && AlunosModule.alunosList) {
            selectAluno.innerHTML = '<option value="">Selecione o aluno</option>';
            AlunosModule.alunosList.forEach(a => {
                const isSel = preSelectedAlunoId == a.id ? 'selected' : '';
                selectAluno.innerHTML += `<option value="${Number(a.id)}" ${isSel}>${UI.escapeHtml(a.nome_completo)} (${UI.escapeHtml(a.modalidade_nome || 'Geral')})</option>`;
            });
        }

        const selectMod = document.getElementById('checkin-modalidade-id');
        if (selectMod && window.AlunosModule && AlunosModule.modalidades) {
            selectMod.innerHTML = '<option value="">Selecione a modalidade</option>';
            AlunosModule.modalidades.forEach(m => {
                selectMod.innerHTML += `<option value="${Number(m.id)}">${UI.escapeHtml(m.nome)}</option>`;
            });
            if (selectMod.options.length > 1) {
                selectMod.selectedIndex = 1;
            }
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

            UI.showToast(res.message, res.status === 'aprovado' ? 'success' : 'warning');
            UI.closeModal('modal-checkin');
            await this.loadSmartBoard();
            if (window.DashboardModule) DashboardModule.loadDashboard();
            if (window.AlunosModule) AlunosModule.loadAlunos();
            if (window.AlunoDetalhesModule && Number(AlunoDetalhesModule.currentAlunoId) === Number(aluno_id)) {
                AlunoDetalhesModule.openDossier(aluno_id);
            }
        } catch (err) {
            UI.showToast(err.message, 'error');
        }
    }
};

window.CheckinsModule = CheckinsModule;
