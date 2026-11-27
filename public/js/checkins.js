// Módulo Inteligente de Presença / Check-ins com Grid Visual, Busca Digitável e Gestão de Turmas
const CheckinsModule = {
    turmas: [],
    professoresCache: [],
    boardData: null,
    lastHoje: '',
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

        // Autocomplete digitável no Modal Manual
        const alunoSearchInput = document.getElementById('checkin-aluno-search');
        const alunoListEl = document.getElementById('checkin-aluno-autocomplete');
        if (alunoSearchInput) {
            alunoSearchInput.addEventListener('input', (e) => {
                document.getElementById('checkin-aluno-id').value = '';
                this.updateManualSelectedHint('');
                this.renderAlunoAutocomplete(e.target.value);
            });
            alunoSearchInput.addEventListener('focus', (e) => {
                this.renderAlunoAutocomplete(e.target.value);
            });
        }

        if (alunoListEl) {
            alunoListEl.addEventListener('click', (e) => {
                const item = e.target.closest('.checkin-autocomplete-item[data-aluno-id]');
                if (!item) return;
                const aid = Number(item.getAttribute('data-aluno-id'));
                const nome = item.getAttribute('data-nome') || '';
                const modId = Number(item.getAttribute('data-mod-id')) || 0;
                this.selectManualAluno(aid, nome, modId);
            });
        }

        document.getElementById('btn-clear-checkin-aluno')?.addEventListener('click', () => {
            this.clearManualAluno();
            document.getElementById('checkin-aluno-search')?.focus();
        });

        document.addEventListener('click', (e) => {
            if (alunoListEl && !e.target.closest('.checkin-autocomplete-wrap')) {
                alunoListEl.style.display = 'none';
            }
        });

        // Formulário de cadastro/edição de turmas
        document.getElementById('form-turma')?.addEventListener('submit', (e) => this.handleSubmitTurma(e));

        // Filtros do modal de exportação atualizam a prévia ao vivo
        ['export-checkin-inicio', 'export-checkin-fim', 'export-checkin-tipo', 'export-checkin-status', 'export-checkin-modalidade', 'export-checkin-turma'].forEach((elId) => {
            document.getElementById(elId)?.addEventListener('change', () => {
                this.loadExportPreview();
            });
        });

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
                const currentVal = selectTurma.value;
                selectTurma.innerHTML = '<option value="">Treino Livre / Sem Turma Fixa</option>';
                this.turmas.forEach(t => {
                    const ini = t.horario_inicio_hm || String(t.horario_inicio || '').slice(0, 5);
                    const fim = t.horario_fim_hm || String(t.horario_fim || '').slice(0, 5);
                    const horaLabel = fim ? `${ini}–${fim}` : ini;
                    selectTurma.innerHTML += `<option value="${Number(t.id)}" data-mod="${Number(t.modalidade_id)}">${UI.escapeHtml(t.nome)} (${UI.escapeHtml(t.dias_semana)} ${UI.escapeHtml(horaLabel)})</option>`;
                });
                if (currentVal) selectTurma.value = currentVal;
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
            // Detecta automaticamente a virada do dia se a aba ficou aberta na data anterior
            if (this.selectedDate && (!this.lastHoje || this.selectedDate !== this.lastHoje)) {
                params.set('data', this.selectedDate);
            }

            const qs = params.toString();
            const res = await API.get(`/checkins/painel-inteligente${qs ? `?${qs}` : ''}`);
            const payload = res.data || null;

            // Se estava acompanhando o "hoje" e virou o dia no servidor, avança automaticamente para o novo hoje
            if (payload?.hoje) {
                if (!this.selectedDate || (this.lastHoje && this.selectedDate === this.lastHoje && payload.hoje !== this.lastHoje)) {
                    this.selectedDate = payload.hoje;
                }
                this.lastHoje = payload.hoje;
            }

            this.boardData = payload;

            const dateInput = document.getElementById('checkin-date-input');
            if (dateInput && payload?.data_referencia) {
                dateInput.value = payload.data_referencia;
                this.selectedDate = payload.data_referencia;
            }

            const clockEl = document.getElementById('checkin-smart-clock-badge');
            if (clockEl && payload) {
                clockEl.textContent = `🕒 Agora: ${payload.horario_atual_label || '--:--'}`;
            }

            this.renderPendingGrid();
            this.renderRegisteredGrid();
        } catch (err) {
            console.error('Erro ao carregar painel inteligente de check-ins:', err);
            pendingGrid.innerHTML = `<div class="checkin-grid-empty" style="color: #fca5a5;">Erro ao carregar painel de chamadas: ${UI.escapeHtml(err.message)}</div>`;
        }
    },

    getSafeStudentAvatar(fotoUrl, fullName) {
        const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName || 'Atleta')}&background=0f172a&color=f8fafc&bold=true`;
        const safe = UI.getSafeImageUrl(fotoUrl, '');
        return safe || fallback;
    },

    normalizeSearchStr(str) {
        return String(str || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    },

    matchesSearch(item) {
        if (!this.searchTerm) return true;
        const term = this.normalizeSearchStr(this.searchTerm);
        const nomeFull = this.normalizeSearchStr(item.nome_completo || item.aluno_nome);
        const nomeCurto = this.normalizeSearchStr(item.nome_curto);
        const mod = this.normalizeSearchStr(item.modalidade_nome);
        return nomeFull.includes(term) || nomeCurto.includes(term) || mod.includes(term);
    },

    renderPendingTileHtml(a) {
        const aid = Number(a.id);
        const avatarSrc = this.getSafeStudentAvatar(a.foto_perfil_url, a.nome_completo);
        const isFirst = Boolean(a.is_primeiro_checkin);
        const isCurrentSlot = Number(a.prioridade_grupo) === 1;
        const slotClass = isFirst ? 'is-first' : (isCurrentSlot ? 'is-current-slot' : '');
        const subHora = isFirst
            ? '1º check-in'
            : (a.horario_habitual_hora !== null && a.horario_habitual_hora !== undefined
                ? `~${String(a.horario_habitual_hora).padStart(2, '0')}h`
                : 'Ativo');
        const ultimoTxt = a.ultimo_checkin_data
            ? ` • Último treino: ${UI.formatDate(a.ultimo_checkin_data)} às ${a.ultimo_checkin_hora || '--:--'}`
            : '';
        const tooltip = `${a.nome_completo} • ${a.modalidade_nome || 'Geral'}${ultimoTxt} • Duplo clique para confirmar`;

        return `
            <button type="button" class="checkin-student-tile ${slotClass}" data-aluno-id="${aid}" title="${UI.escapeHtml(tooltip)}">
                <div class="checkin-tile-avatar-wrap">
                    <img src="${UI.escapeHtml(avatarSrc)}" alt="${UI.escapeHtml(a.nome_curto)}" class="checkin-tile-avatar" loading="lazy">
                    ${isFirst ? `<span class="checkin-tile-badge first">NOVO</span>` : ''}
                    <span class="checkin-tile-arm-overlay">Clique 2x ✓</span>
                </div>
                <span class="checkin-tile-name">${UI.escapeHtml(a.nome_curto)}</span>
                <span class="checkin-tile-subtime">${UI.escapeHtml(subHora)}</span>
            </button>
        `;
    },

    renderPendingGrid() {
        const grid = document.getElementById('checkin-pending-grid');
        const countEl = document.getElementById('checkin-pending-count');
        if (!grid) return;

        const rawList = Array.isArray(this.boardData?.pendentes) ? this.boardData.pendentes : [];
        const list = rawList.filter(item => this.matchesSearch(item));

        if (countEl) {
            countEl.textContent = `${list.length} aguardando`;
        }

        if (list.length === 0) {
            grid.innerHTML = `<div class="checkin-grid-empty">${this.searchTerm
                ? 'Nenhum aluno pendente encontrado para essa busca.'
                : 'Todos os alunos ativos já confirmaram presença na data selecionada!'
            }</div>`;
            return;
        }

        const firstGroup = list.filter(a => a.is_primeiro_checkin);
        const currentGroup = list.filter(a => !a.is_primeiro_checkin && Number(a.prioridade_grupo) === 1);
        const othersGroup = list.filter(a => !a.is_primeiro_checkin && Number(a.prioridade_grupo) !== 1);

        const sections = [];
        if (firstGroup.length > 0) {
            sections.push({
                cls: 'first',
                title: `🆕 Primeiro Check-in (${firstGroup.length})`,
                items: firstGroup
            });
        }
        if (currentGroup.length > 0) {
            sections.push({
                cls: 'current',
                title: `⚡ Costumam treinar neste horário (${currentGroup.length})`,
                items: currentGroup
            });
        }
        if (othersGroup.length > 0) {
            sections.push({
                cls: 'others',
                title: currentGroup.length > 0 || firstGroup.length > 0
                    ? `👥 Demais alunos ativos (${othersGroup.length})`
                    : `👥 Alunos ativos (${othersGroup.length})`,
                items: othersGroup
            });
        }

        grid.innerHTML = sections.map(sec => `
            <div class="checkin-group-section">
                <div class="checkin-group-label ${sec.cls}">${UI.escapeHtml(sec.title)}</div>
                <div class="checkin-photo-grid">
                    ${sec.items.map(a => this.renderPendingTileHtml(a)).join('')}
                </div>
            </div>
        `).join('');
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
                    hora_checkin: chk.hora_checkin || '',
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

    async undoCheckin(checkinId) {
        if (this.inFlightUndoCheckins.has(checkinId)) return;
        this.inFlightUndoCheckins.add(checkinId);

        const tileEl = document.querySelector(`#checkin-registered-grid .checkin-student-tile[data-checkin-id="${checkinId}"]`);
        if (tileEl) tileEl.classList.add('is-processing');

        try {
            const res = await API.delete(`/checkins/${checkinId}`);
            UI.showToast(res.message || 'Check-in desfeito!', 'info');

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

    getSelectableAlunosList() {
        if (window.AlunosModule && Array.isArray(AlunosModule.alunosList) && AlunosModule.alunosList.length > 0) {
            return AlunosModule.alunosList;
        }
        const pending = Array.isArray(this.boardData?.pendentes) ? this.boardData.pendentes : [];
        const registered = Array.isArray(this.boardData?.registrados) ? this.boardData.registrados : [];
        const map = new Map();
        [...pending, ...registered].forEach((a) => {
            const id = Number(a.aluno_id || a.id);
            if (id && !map.has(id)) {
                map.set(id, {
                    id,
                    nome_completo: a.nome_completo,
                    foto_perfil_url: a.foto_perfil_url,
                    modalidade_id: a.modalidade_id || null,
                    modalidade_nome: a.modalidade_nome || 'Geral'
                });
            }
        });
        return Array.from(map.values());
    },

    updateManualSelectedHint(nomeSelecionado) {
        const hintEl = document.getElementById('checkin-aluno-selected-hint');
        const clearBtn = document.getElementById('btn-clear-checkin-aluno');
        if (clearBtn) {
            const searchVal = document.getElementById('checkin-aluno-search')?.value || '';
            clearBtn.style.display = (nomeSelecionado || searchVal) ? 'inline-flex' : 'none';
        }
        if (hintEl) {
            if (nomeSelecionado) {
                hintEl.textContent = `✓ Selecionado: ${nomeSelecionado}`;
                hintEl.style.color = '#10b981';
            } else {
                hintEl.textContent = 'Digite o nome e clique no aluno desejado';
                hintEl.style.color = 'var(--text-muted)';
            }
        }
    },

    renderAlunoAutocomplete(query = '') {
        const listEl = document.getElementById('checkin-aluno-autocomplete');
        if (!listEl) return;

        const normQuery = this.normalizeSearchStr(query);
        const alunos = this.getSelectableAlunosList();
        const filtered = alunos
            .filter(a => !normQuery || this.normalizeSearchStr(a.nome_completo).includes(normQuery))
            .slice(0, 12);

        if (filtered.length === 0) {
            listEl.innerHTML = `<div class="checkin-autocomplete-empty">Nenhum aluno encontrado para "${UI.escapeHtml(query)}".</div>`;
            listEl.style.display = 'block';
            return;
        }

        listEl.innerHTML = filtered.map((a) => {
            const aid = Number(a.id);
            const avatar = this.getSafeStudentAvatar(a.foto_perfil_url, a.nome_completo);
            const modId = Number(a.modalidade_id || 0);
            return `
                <button type="button" class="checkin-autocomplete-item"
                    data-aluno-id="${aid}"
                    data-nome="${UI.escapeHtml(a.nome_completo)}"
                    data-mod-id="${modId}">
                    <img src="${UI.escapeHtml(avatar)}" alt="" class="checkin-autocomplete-avatar">
                    <div class="checkin-autocomplete-meta">
                        <strong>${UI.escapeHtml(a.nome_completo)}</strong>
                        <span>${UI.escapeHtml(a.modalidade_nome || 'Geral')}</span>
                    </div>
                </button>
            `;
        }).join('');
        listEl.style.display = 'block';
    },

    selectManualAluno(alunoId, nome, modalidadeId = 0) {
        const hiddenEl = document.getElementById('checkin-aluno-id');
        const searchEl = document.getElementById('checkin-aluno-search');
        const listEl = document.getElementById('checkin-aluno-autocomplete');
        const modEl = document.getElementById('checkin-modalidade-id');

        if (hiddenEl) hiddenEl.value = String(alunoId);
        if (searchEl) searchEl.value = nome;
        if (listEl) listEl.style.display = 'none';
        if (modEl && modalidadeId > 0) {
            const hasOption = Array.from(modEl.options).some(opt => Number(opt.value) === Number(modalidadeId));
            if (hasOption) modEl.value = String(modalidadeId);
        }
        this.updateManualSelectedHint(nome);
    },

    clearManualAluno() {
        const hiddenEl = document.getElementById('checkin-aluno-id');
        const searchEl = document.getElementById('checkin-aluno-search');
        const listEl = document.getElementById('checkin-aluno-autocomplete');
        if (hiddenEl) hiddenEl.value = '';
        if (searchEl) searchEl.value = '';
        if (listEl) listEl.style.display = 'none';
        this.updateManualSelectedHint('');
    },

    openCheckinModal(preSelectedAlunoId = null) {
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

        const selectTurma = document.getElementById('checkin-turma-id');
        if (selectTurma) {
            selectTurma.value = '';
        }

        if (preSelectedAlunoId) {
            const alunos = this.getSelectableAlunosList();
            const found = alunos.find(a => Number(a.id) === Number(preSelectedAlunoId));
            if (found) {
                this.selectManualAluno(Number(found.id), found.nome_completo, Number(found.modalidade_id || 0));
            } else {
                this.clearManualAluno();
            }
        } else {
            this.clearManualAluno();
        }

        UI.openModal('modal-checkin');
        if (!preSelectedAlunoId) {
            setTimeout(() => document.getElementById('checkin-aluno-search')?.focus(), 80);
        }
    },

    quickCheckin(alunoId) {
        this.openCheckinModal(alunoId);
    },

    async handleSubmitCheckin(e) {
        e.preventDefault();
        let aluno_id = document.getElementById('checkin-aluno-id')?.value || '';
        const searchTexto = (document.getElementById('checkin-aluno-search')?.value || '').trim();

        // Caso o usuário tenha digitado o nome exato sem clicar no dropdown, tenta casar automaticamente
        if (!aluno_id && searchTexto) {
            const norm = this.normalizeSearchStr(searchTexto);
            const matches = this.getSelectableAlunosList().filter(a => this.normalizeSearchStr(a.nome_completo) === norm);
            if (matches.length === 1) {
                aluno_id = String(matches[0].id);
            }
        }

        const modalidade_id = document.getElementById('checkin-modalidade-id')?.value || '';
        const turma_id = document.getElementById('checkin-turma-id')?.value || null;

        if (!aluno_id) {
            UI.showToast('Digite o nome e selecione o aluno na lista.', 'warning');
            document.getElementById('checkin-aluno-search')?.focus();
            return;
        }
        if (!modalidade_id) {
            UI.showToast('Selecione a modalidade do treino.', 'warning');
            return;
        }

        try {
            const res = await API.post('/checkins', {
                aluno_id,
                modalidade_id,
                turma_id,
                metodo: 'manual_professor'
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
    },

    // =========================================================================
    // GESTÃO DE TURMAS, DIAS DA SEMANA E HORÁRIOS
    // =========================================================================
    async openTurmasModal() {
        await Promise.all([
            this.populateTurmaFormSelects(),
            this.loadTurmas()
        ]);
        this.resetTurmaForm();
        this.renderTurmasList();
        UI.openModal('modal-gerenciar-turmas');
    },

    async populateTurmaFormSelects() {
        let modalidadesList = (window.AlunosModule && Array.isArray(AlunosModule.modalidades) && AlunosModule.modalidades.length > 0)
            ? AlunosModule.modalidades
            : [];
        if (modalidadesList.length === 0) {
            try {
                const modRes = await API.get('/modalidades');
                modalidadesList = modRes.data || [];
            } catch { /* ignore */ }
        }

        const modSelect = document.getElementById('turma-modalidade-id');
        if (modSelect) {
            const cur = modSelect.value;
            modSelect.innerHTML = '<option value="">Selecione a modalidade</option>';
            modalidadesList.forEach((m) => {
                modSelect.innerHTML += `<option value="${Number(m.id)}">${UI.escapeHtml(m.nome)}</option>`;
            });
            if (cur) modSelect.value = cur;
            else if (modSelect.options.length > 1) modSelect.selectedIndex = 1;
        }

        if (this.professoresCache.length === 0) {
            try {
                const profRes = await API.get('/modalidades/equipe/professores');
                this.professoresCache = profRes.data || [];
            } catch {
                this.professoresCache = [];
            }
        }

        const profSelect = document.getElementById('turma-professor-id');
        if (profSelect) {
            const curP = profSelect.value;
            profSelect.innerHTML = '<option value="">Sem professor fixo</option>';
            this.professoresCache.forEach((p) => {
                profSelect.innerHTML += `<option value="${Number(p.id)}">${UI.escapeHtml(p.nome)}</option>`;
            });
            if (curP) profSelect.value = curP;
        }
    },

    resetTurmaForm() {
        document.getElementById('turma-edit-id').value = '';
        document.getElementById('turma-nome').value = '';
        document.getElementById('turma-horario-inicio').value = '';
        document.getElementById('turma-horario-fim').value = '';
        document.getElementById('turma-capacidade').value = '';
        const profSelect = document.getElementById('turma-professor-id');
        if (profSelect) profSelect.value = '';

        document.querySelectorAll('#turma-days-picker input[type="checkbox"]').forEach((chk) => {
            chk.checked = false;
        });

        const titleEl = document.getElementById('turma-form-title');
        if (titleEl) titleEl.textContent = 'Nova Turma';
        const cancelBtn = document.getElementById('btn-cancel-edit-turma');
        if (cancelBtn) cancelBtn.style.display = 'none';
        const saveBtn = document.getElementById('btn-salvar-turma');
        if (saveBtn) saveBtn.textContent = 'Salvar Turma';
    },

    startEditTurma(turmaId) {
        const turma = this.turmas.find(t => Number(t.id) === Number(turmaId));
        if (!turma) return;

        document.getElementById('turma-edit-id').value = String(turma.id);
        document.getElementById('turma-nome').value = turma.nome || '';
        document.getElementById('turma-modalidade-id').value = String(turma.modalidade_id || '');
        document.getElementById('turma-professor-id').value = turma.professor_id ? String(turma.professor_id) : '';
        document.getElementById('turma-horario-inicio').value = turma.horario_inicio_hm || String(turma.horario_inicio || '').slice(0, 5);
        document.getElementById('turma-horario-fim').value = turma.horario_fim_hm || String(turma.horario_fim || '').slice(0, 5);
        document.getElementById('turma-capacidade').value = turma.capacidade_maxima ? String(turma.capacidade_maxima) : '';

        const diasSet = new Set(
            String(turma.dias_semana || '')
                .split(',')
                .map(d => d.trim().toUpperCase())
                .filter(Boolean)
        );
        document.querySelectorAll('#turma-days-picker input[type="checkbox"]').forEach((chk) => {
            chk.checked = diasSet.has(chk.value.toUpperCase());
        });

        const titleEl = document.getElementById('turma-form-title');
        if (titleEl) titleEl.textContent = `Editando Turma: ${turma.nome}`;
        const cancelBtn = document.getElementById('btn-cancel-edit-turma');
        if (cancelBtn) cancelBtn.style.display = 'inline-flex';
        const saveBtn = document.getElementById('btn-salvar-turma');
        if (saveBtn) saveBtn.textContent = 'Atualizar Turma';
    },

    renderTurmasList() {
        const container = document.getElementById('turmas-gerenciar-list');
        if (!container) return;

        if (!Array.isArray(this.turmas) || this.turmas.length === 0) {
            container.innerHTML = `<div class="checkin-grid-empty">Nenhuma turma cadastrada ainda. Use o formulário acima para criar a primeira turma.</div>`;
            return;
        }

        container.innerHTML = this.turmas.map((t) => {
            const tid = Number(t.id);
            const ini = t.horario_inicio_hm || String(t.horario_inicio || '').slice(0, 5);
            const fim = t.horario_fim_hm || String(t.horario_fim || '').slice(0, 5);
            const diasTags = String(t.dias_semana || '')
                .split(',')
                .map(d => d.trim())
                .filter(Boolean)
                .map(d => `<span class="turma-day-tag">${UI.escapeHtml(d)}</span>`)
                .join('');

            return `
                <div class="turma-item-card">
                    <div class="turma-item-info">
                        <div class="turma-item-title-row">
                            <strong>${UI.escapeHtml(t.nome)}</strong>
                            <span class="turma-mod-pill">${UI.escapeHtml(t.modalidade_nome)}</span>
                        </div>
                        <div class="turma-item-meta">
                            <span>🕒 ${UI.escapeHtml(ini)} – ${UI.escapeHtml(fim)}</span>
                            ${t.professor_nome ? `<span>👨‍🏫 ${UI.escapeHtml(t.professor_nome)}</span>` : ''}
                            ${t.capacidade_maxima ? `<span>👥 Máx. ${Number(t.capacidade_maxima)}</span>` : ''}
                        </div>
                        <div class="turma-item-days">${diasTags}</div>
                    </div>
                    <div class="turma-item-actions">
                        <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 9px; font-size: 11px; color: #38bdf8; border-color: rgba(56,189,248,0.35);" onclick="CheckinsModule.startEditTurma(${tid})">
                            ✏️ Editar
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 9px; font-size: 11px; color: #fca5a5; border-color: rgba(239,68,68,0.35);" onclick="CheckinsModule.deleteTurma(${tid})">
                            Remover
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    async handleSubmitTurma(e) {
        e.preventDefault();
        const editId = document.getElementById('turma-edit-id')?.value || '';
        const diasSelecionados = Array.from(document.querySelectorAll('#turma-days-picker input[type="checkbox"]:checked'))
            .map(chk => chk.value);

        if (diasSelecionados.length === 0) {
            UI.showToast('Selecione pelo menos um dia da semana para a turma.', 'warning');
            return;
        }

        const payload = {
            nome: document.getElementById('turma-nome')?.value || '',
            modalidade_id: document.getElementById('turma-modalidade-id')?.value || '',
            professor_id: document.getElementById('turma-professor-id')?.value || null,
            dias_semana: diasSelecionados,
            horario_inicio: document.getElementById('turma-horario-inicio')?.value || '',
            horario_fim: document.getElementById('turma-horario-fim')?.value || '',
            capacidade_maxima: document.getElementById('turma-capacidade')?.value || null
        };

        const btn = document.getElementById('btn-salvar-turma');
        const origText = btn ? btn.textContent : 'Salvar Turma';
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Salvando...';
        }

        try {
            const res = editId
                ? await API.put(`/checkins/turmas/${editId}`, payload)
                : await API.post('/checkins/turmas', payload);

            UI.showToast(res.message || 'Turma salva com sucesso!', 'success');
            await this.loadTurmas();
            this.resetTurmaForm();
            this.renderTurmasList();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao salvar turma.', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = origText;
            }
        }
    },

    async deleteTurma(turmaId) {
        if (!confirm('Deseja remover esta turma da lista de seleção de horários? O histórico de check-ins anteriores será mantido.')) {
            return;
        }
        try {
            const res = await API.delete(`/checkins/turmas/${turmaId}`);
            UI.showToast(res.message || 'Turma removida!', 'success');
            await this.loadTurmas();
            this.renderTurmasList();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao remover turma.', 'error');
        }
    },

    // =========================================================================
    // EXTRAÇÃO DE DADOS DE PRESENÇAS (CSV EXCEL & RELATÓRIO IMPRIMÍVEL/PDF)
    // =========================================================================
    exportPreviewData: null,

    getLocalDateIso(offsetDays = 0) {
        const dt = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const d = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },

    async openExportModal() {
        await this.populateExportSelects();

        const iniEl = document.getElementById('export-checkin-inicio');
        const fimEl = document.getElementById('export-checkin-fim');
        if (iniEl && fimEl && (!iniEl.value || !fimEl.value)) {
            this.applyExportDatePreset('mes');
        } else {
            this.loadExportPreview();
        }

        UI.openModal('modal-exportar-checkins');
    },

    async populateExportSelects() {
        let modalidadesList = (window.AlunosModule && Array.isArray(AlunosModule.modalidades) && AlunosModule.modalidades.length > 0)
            ? AlunosModule.modalidades
            : [];
        if (modalidadesList.length === 0) {
            try {
                const modRes = await API.get('/modalidades');
                modalidadesList = modRes.data || [];
            } catch { /* ignore */ }
        }

        const modEl = document.getElementById('export-checkin-modalidade');
        if (modEl) {
            const curM = modEl.value || 'todas';
            modEl.innerHTML = '<option value="todas">Todas as modalidades</option>';
            modalidadesList.forEach((m) => {
                modEl.innerHTML += `<option value="${Number(m.id)}">${UI.escapeHtml(m.nome)}</option>`;
            });
            modEl.value = curM;
        }

        if (this.turmas.length === 0) {
            await this.loadTurmas();
        }
        const turmaEl = document.getElementById('export-checkin-turma');
        if (turmaEl) {
            const curT = turmaEl.value || 'todas';
            turmaEl.innerHTML = '<option value="todas">Todas as turmas</option>';
            this.turmas.forEach((t) => {
                turmaEl.innerHTML += `<option value="${Number(t.id)}">${UI.escapeHtml(t.nome)} (${UI.escapeHtml(t.dias_semana)})</option>`;
            });
            turmaEl.value = curT;
        }
    },

    applyExportDatePreset(preset) {
        const hojeIso = this.lastHoje || this.getLocalDateIso(0);
        const [yStr, mStr] = hojeIso.split('-');
        const year = parseInt(yStr, 10);
        const month = parseInt(mStr, 10);

        let inicio = hojeIso;
        let fim = hojeIso;

        if (preset === '7dias') {
            inicio = this.getLocalDateIso(-6);
            fim = hojeIso;
        } else if (preset === 'mes') {
            inicio = `${year}-${String(month).padStart(2, '0')}-01`;
            fim = hojeIso;
        } else if (preset === 'mes_anterior') {
            const prevMonth = month === 1 ? 12 : month - 1;
            const prevYear = month === 1 ? year - 1 : year;
            const lastDay = new Date(prevYear, prevMonth, 0).getDate();
            inicio = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
            fim = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        }

        const iniEl = document.getElementById('export-checkin-inicio');
        const fimEl = document.getElementById('export-checkin-fim');
        if (iniEl) iniEl.value = inicio;
        if (fimEl) fimEl.value = fim;

        this.loadExportPreview();
    },

    getExportFilterParams(formato = 'json') {
        const params = new URLSearchParams();
        const inicio = document.getElementById('export-checkin-inicio')?.value || '';
        const fim = document.getElementById('export-checkin-fim')?.value || '';
        const tipo = document.getElementById('export-checkin-tipo')?.value || 'detalhado';
        const status = document.getElementById('export-checkin-status')?.value || 'todos';
        const mod = document.getElementById('export-checkin-modalidade')?.value || 'todas';
        const turma = document.getElementById('export-checkin-turma')?.value || 'todas';

        if (inicio) params.set('data_inicio', inicio);
        if (fim) params.set('data_fim', fim);
        params.set('tipo', tipo);
        params.set('status', status);
        if (mod && mod !== 'todas') params.set('modalidade_id', mod);
        if (turma && turma !== 'todas') params.set('turma_id', turma);
        params.set('formato', formato);

        return params;
    },

    async loadExportPreview() {
        const box = document.getElementById('export-checkin-preview');
        if (!box) return;

        box.innerHTML = `<div class="checkin-grid-empty" style="padding: 12px;">Calculando prévia do relatório...</div>`;

        try {
            const qs = this.getExportFilterParams('json').toString();
            const res = await API.get(`/checkins/exportar?${qs}`);
            this.exportPreviewData = res.data || null;

            const resumo = res.data?.resumo || {};
            const tipo = res.data?.tipo || 'detalhado';
            box.innerHTML = `
                <div class="export-preview-kpis">
                    <div class="dossie-cal-kpi rate">
                        <span class="kpi-label">${tipo === 'resumo_alunos' ? 'Total Presenças' : 'Check-ins no Período'}</span>
                        <strong class="kpi-val">${Number(resumo.total_registros || 0)}</strong>
                    </div>
                    <div class="dossie-cal-kpi ok">
                        <span class="kpi-label">Alunos Presentes</span>
                        <strong class="kpi-val">${Number(resumo.alunos_unicos || 0)}</strong>
                    </div>
                    <div class="dossie-cal-kpi">
                        <span class="kpi-label">${tipo === 'resumo_alunos' ? 'Alunos na Base' : 'Horário de Pico'}</span>
                        <strong class="kpi-val" style="color: #fbbf24;">${UI.escapeHtml(tipo === 'resumo_alunos' ? String(Number(resumo.total_alunos_base || 0)) : (resumo.horario_pico || '--'))}</strong>
                    </div>
                </div>
            `;
        } catch (err) {
            this.exportPreviewData = null;
            box.innerHTML = `<div class="checkin-grid-empty" style="padding: 12px; color: #fca5a5;">${UI.escapeHtml(err.message || 'Erro ao carregar prévia.')}</div>`;
        }
    },

    async downloadCheckinsCsv() {
        const btn = document.getElementById('btn-export-checkin-csv');
        const origHtml = btn ? btn.innerHTML : '📥 Baixar Planilha (CSV)';
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Gerando CSV...';
        }

        try {
            const params = this.getExportFilterParams('csv');
            const token = typeof API !== 'undefined' && API.getToken ? API.getToken() : localStorage.getItem('procombate_token');
            const res = await fetch(`/api/checkins/exportar?${params.toString()}`, {
                method: 'GET',
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });

            if (!res.ok) {
                let errMsg = 'Falha ao exportar planilha.';
                try {
                    const errJson = await res.json();
                    if (errJson.error) errMsg = errJson.error;
                } catch { /* ignore */ }
                throw new Error(errMsg);
            }

            const blob = await res.blob();
            const inicio = params.get('data_inicio') || 'inicio';
            const fim = params.get('data_fim') || 'fim';
            const tipo = params.get('tipo') || 'detalhado';
            const filename = `presencas-${tipo}-${inicio}-a-${fim}.csv`;

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            UI.showToast('Planilha CSV baixada com sucesso!', 'success');
        } catch (err) {
            UI.showToast(err.message || 'Erro ao baixar planilha.', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origHtml;
            }
        }
    },

    async printCheckinsReport() {
        try {
            const qs = this.getExportFilterParams('json').toString();
            const res = await API.get(`/checkins/exportar?${qs}`);
            const data = res.data || {};
            const registros = Array.isArray(data.registros) ? data.registros : [];
            const tipo = data.tipo || 'detalhado';
            const pIni = UI.formatDate(data.periodo?.data_inicio);
            const pFim = UI.formatDate(data.periodo?.data_fim);

            const headers = tipo === 'resumo_alunos'
                ? ['Aluno', 'Status', 'Modalidade', 'Total Presenças', 'Horário Habitual', 'Último Check-in', 'Dias s/ Treinar']
                : ['Data', 'Horário', 'Aluno', 'Modalidade', 'Turma', 'Status'];

            const bodyRows = registros.map((r) => {
                if (tipo === 'resumo_alunos') {
                    const ult = r.ultimo_checkin_data
                        ? `${UI.formatDate(r.ultimo_checkin_data)} ${r.ultimo_checkin_hora || ''}`.trim()
                        : 'Nunca registrou';
                    const habit = (r.horario_habitual_hora !== null && r.horario_habitual_hora !== undefined)
                        ? `${String(r.horario_habitual_hora).padStart(2, '0')}h`
                        : '-';
                    return `<tr>
                        <td><strong>${UI.escapeHtml(r.aluno_nome)}</strong></td>
                        <td>${UI.escapeHtml(r.status_cadastro || 'ativo')}</td>
                        <td>${UI.escapeHtml(r.modalidade_nome || 'Geral')}</td>
                        <td style="text-align:center;"><strong>${Number(r.total_presencas || 0)}</strong></td>
                        <td style="text-align:center;">${UI.escapeHtml(habit)}</td>
                        <td>${UI.escapeHtml(ult)}</td>
                        <td style="text-align:center;">${r.dias_sem_treinar !== null && r.dias_sem_treinar !== undefined ? Number(r.dias_sem_treinar) : '-'}</td>
                    </tr>`;
                }
                return `<tr>
                    <td>${UI.escapeHtml(UI.formatDate(r.data_local))}</td>
                    <td><strong>${UI.escapeHtml(r.hora_checkin || '')}</strong></td>
                    <td><strong>${UI.escapeHtml(r.aluno_nome)}</strong></td>
                    <td>${UI.escapeHtml(r.modalidade_nome || '')}</td>
                    <td>${UI.escapeHtml(r.turma_nome || 'Treino Livre')}</td>
                    <td>${UI.escapeHtml(r.status || 'aprovado')}</td>
                </tr>`;
            }).join('');

            const printWin = window.open('', '_blank', 'width=980,height=720');
            if (!printWin) {
                UI.showToast('Permita pop-ups para visualizar e imprimir o relatório em PDF.', 'warning');
                return;
            }

            const html = `<!DOCTYPE html>
                <html lang="pt-BR">
                <head>
                    <meta charset="UTF-8">
                    <title>Relatório de Presenças — PRO COMBATE</title>
                    <style>
                        body { font-family: Arial, sans-serif; color: #0f172a; padding: 24px; }
                        h1 { margin: 0 0 6px 0; font-size: 20px; }
                        .meta { font-size: 12.5px; color: #475569; margin-bottom: 16px; }
                        .kpis { display: flex; gap: 16px; margin-bottom: 16px; font-size: 13px; }
                        .kpi { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 14px; background: #f8fafc; }
                        table { width: 100%; border-collapse: collapse; font-size: 12px; }
                        th, td { border: 1px solid #cbd5e1; padding: 7px 9px; text-align: left; }
                        th { background: #e2e8f0; font-weight: 700; }
                        tr:nth-child(even) td { background: #f8fafc; }
                        @media print { .no-print { display: none; } }
                    </style>
                </head>
                <body>
                    <h1>PRO COMBATE • Relatório de Presenças (${UI.escapeHtml(tipo === 'resumo_alunos' ? 'Resumo por Aluno' : 'Histórico Detalhado')})</h1>
                    <div class="meta">Período: ${UI.escapeHtml(pIni)} a ${UI.escapeHtml(pFim)} • Fuso horário: Feira de Santana, BA (GMT-3)</div>
                    <div class="kpis">
                        <div class="kpi"><strong>Total de Registros:</strong> ${Number(data.resumo?.total_registros || 0)}</div>
                        <div class="kpi"><strong>Alunos Presentes:</strong> ${Number(data.resumo?.alunos_unicos || 0)}</div>
                        ${data.resumo?.horario_pico ? `<div class="kpi"><strong>Horário de Pico:</strong> ${UI.escapeHtml(data.resumo.horario_pico)}</div>` : ''}
                    </div>
                    <table>
                        <thead><tr>${headers.map(h => `<th>${UI.escapeHtml(h)}</th>`).join('')}</tr></thead>
                        <tbody>${bodyRows || `<tr><td colspan="${headers.length}" style="text-align:center; padding: 20px;">Nenhum registro encontrado no período.</td></tr>`}</tbody>
                    </table>
                    <script>window.onload = function() { window.print(); };</script>
                </body>
                </html>`;

            printWin.document.open();
            printWin.document.write(html);
            printWin.document.close();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao gerar relatório para impressão.', 'error');
        }
    }
};

window.CheckinsModule = CheckinsModule;
