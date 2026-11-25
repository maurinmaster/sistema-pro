// Gerenciamento de Alunos (Listagem, Filtros, CRUD e Modais)
const AlunosModule = {
    alunosList: [],
    modalidades: [],
    planos: [],
    activeActionMenuTrigger: null,
    activeActionMenuAlunoId: null,
    activeActionMenuEncodedNome: '',
    actionMenuEventsBound: false,

    async init() {
        this.bindEvents();
        if (!API.getToken()) return;
        await Promise.all([
            this.loadModalidades(),
            this.loadPlanos(),
            this.loadAlunos(),
            this.atualizarContadorLixeira()
        ]);
    },

    bindEvents() {
        // Busca com debounce
        const searchInput = document.getElementById('search-aluno');
        if (searchInput) {
            let timeout = null;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => this.loadAlunos(), 300);
            });
        }

        // Filtro por status
        const statusFilter = document.getElementById('filter-status');
        if (statusFilter) {
            statusFilter.addEventListener('change', () => {
                this.updateActiveFiltersCount();
                this.loadAlunos();
            });
        }

        // Filtro por modalidade
        const modFilter = document.getElementById('filter-modalidade');
        if (modFilter) {
            modFilter.addEventListener('change', () => {
                this.updateActiveFiltersCount();
                this.loadAlunos();
            });
        }

        // Filtro por menor de idade
        const menorFilter = document.getElementById('filter-menor');
        if (menorFilter) {
            menorFilter.addEventListener('change', () => {
                this.updateActiveFiltersCount();
                this.loadAlunos();
            });
        }

        // Painel retrátil de filtros no mobile
        const btnToggleFiltros = document.getElementById('btn-toggle-filtros-alunos');
        const filtersPanel = document.getElementById('alunos-filters-collapsible');
        if (btnToggleFiltros && filtersPanel) {
            btnToggleFiltros.addEventListener('click', () => {
                const isOpen = filtersPanel.classList.toggle('open');
                btnToggleFiltros.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            });
        }

        // Clique na linha do aluno abre o Dossiê 360° (exceto foto/botões/links de ação)
        const tbodyAlunos = document.getElementById('alunos-table-body');
        if (tbodyAlunos) {
            tbodyAlunos.addEventListener('click', (e) => {
                const avatarZoomTrigger = e.target.closest('[data-avatar-zoom-id]');
                if (avatarZoomTrigger) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openAlunoPhotoZoom(Number(avatarZoomTrigger.getAttribute('data-avatar-zoom-id')));
                    return;
                }

                const menuTrigger = e.target.closest('[data-action-menu-trigger="true"]');
                if (menuTrigger) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleActionMenu(menuTrigger);
                    return;
                }

                if (e.target.closest('button, a, .table-actions')) return;
                const row = e.target.closest('tr.aluno-row-clickable[data-aluno-id]');
                if (!row) return;
                const alunoId = Number(row.getAttribute('data-aluno-id'));
                if (alunoId && window.AlunoDetalhesModule) {
                    AlunoDetalhesModule.openDossier(alunoId);
                }
            });

            tbodyAlunos.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                const avatarZoomTrigger = e.target.closest('[data-avatar-zoom-id]');
                if (!avatarZoomTrigger) return;
                e.preventDefault();
                e.stopPropagation();
                this.openAlunoPhotoZoom(Number(avatarZoomTrigger.getAttribute('data-avatar-zoom-id')));
            });
        }

        const imgPreviewModal = document.getElementById('aluno-foto-preview');
        if (imgPreviewModal) {
            imgPreviewModal.style.cursor = 'zoom-in';
            imgPreviewModal.title = 'Clique para ampliar a foto';
            imgPreviewModal.addEventListener('click', () => {
                const savedUrl = UI.getSafeImageUrl(document.getElementById('aluno-foto')?.value, '');
                if (!savedUrl) return;
                const nome = document.getElementById('aluno-nome')?.value?.trim() || 'Foto do Aluno';
                UI.openPhotoLightbox(savedUrl, nome, { isFallback: false });
            });
        }

        this.bindActionMenuGlobalEvents();

        // Botão de abrir Lixeira
        const btnAbrirLixeira = document.getElementById('btn-abrir-lixeira');
        if (btnAbrirLixeira) {
            btnAbrirLixeira.addEventListener('click', () => this.abrirModalLixeira());
        }

        // Busca dentro da Lixeira com debounce
        const searchLixeira = document.getElementById('search-lixeira');
        if (searchLixeira) {
            let timeoutLixeira = null;
            searchLixeira.addEventListener('input', () => {
                clearTimeout(timeoutLixeira);
                timeoutLixeira = setTimeout(() => this.carregarLixeira(), 300);
            });
        }

        // Botão Esvaziar Lixeira
        const btnEsvaziarLixeira = document.getElementById('btn-esvaziar-lixeira');
        if (btnEsvaziarLixeira) {
            btnEsvaziarLixeira.addEventListener('click', () => this.esvaziarLixeira());
        }

        // Botão Novo Aluno
        const btnNovo = document.getElementById('btn-novo-aluno');
        if (btnNovo) {
            btnNovo.addEventListener('click', () => this.openFormModal());
        }

        // Botão e Formulário de Aviso Avulso por E-mail
        const btnAbrirAviso = document.getElementById('btn-abrir-modal-aviso');
        if (btnAbrirAviso) {
            btnAbrirAviso.addEventListener('click', () => this.openEnviarAvisoModal());
        }

        const formEnviarAviso = document.getElementById('form-enviar-aviso-alunos');
        if (formEnviarAviso) {
            formEnviarAviso.addEventListener('submit', (e) => this.submitEnviarAviso(e));
        }

        // Botões do Modal de WhatsApp (Baileys)
        const btnAbrirWa = document.getElementById('btn-abrir-modal-whatsapp');
        if (btnAbrirWa) {
            btnAbrirWa.addEventListener('click', () => this.openWhatsAppModal());
        }
        const btnFecharWa = document.getElementById('btn-fechar-modal-whatsapp');
        if (btnFecharWa) {
            btnFecharWa.addEventListener('click', () => this.closeWhatsAppModal());
        }
        const btnWaConectar = document.getElementById('btn-wa-conectar');
        if (btnWaConectar) {
            btnWaConectar.addEventListener('click', () => this.conectarWhatsApp());
        }
        const btnWaDesconectar = document.getElementById('btn-wa-desconectar');
        if (btnWaDesconectar) {
            btnWaDesconectar.addEventListener('click', () => this.desconectarWhatsApp());
        }
        const btnWaTeste = document.getElementById('btn-wa-enviar-teste');
        if (btnWaTeste) {
            btnWaTeste.addEventListener('click', () => this.enviarTesteWhatsApp());
        }

        // Data de nascimento - detecção em tempo real de menor de idade
        const inputNasc = document.getElementById('aluno-nascimento');
        if (inputNasc) {
            inputNasc.addEventListener('change', (e) => this.checkMinorCondition(e.target.value));
        }

        // Seleção de modalidade inicial habilita e popula as faixas da modalidade escolhida
        const selectModalidade = document.getElementById('aluno-modalidade-id');
        if (selectModalidade) {
            selectModalidade.addEventListener('change', (e) => this.updateGraduacaoSelect(e.target.value));
        }

        // Form submit
        const formAluno = document.getElementById('form-aluno');
        if (formAluno) {
            formAluno.addEventListener('submit', (e) => this.handleSubmitAluno(e));
        }

        // Formulário de Redefinição de Senha do Aluno
        const formReset = document.getElementById('form-reset-senha-aluno');
        if (formReset) {
            formReset.addEventListener('submit', (e) => this.submitResetSenha(e));
        }

        const btnGerarSenha = document.getElementById('btn-gerar-senha-aluno');
        if (btnGerarSenha) {
            btnGerarSenha.addEventListener('click', () => this.gerarSenhaAleatoria());
        }

        const btnCopiarSenha = document.getElementById('btn-copiar-nova-senha');
        if (btnCopiarSenha) {
            btnCopiarSenha.addEventListener('click', () => this.copiarNovaSenha());
        }

        // Upload de Foto de Perfil
        const btnUploadFoto = document.getElementById('btn-upload-foto');
        const fileInputFoto = document.getElementById('aluno-foto-input');
        const btnRemoveFoto = document.getElementById('btn-remove-foto');

        if (btnUploadFoto && fileInputFoto) {
            btnUploadFoto.addEventListener('click', () => fileInputFoto.click());
            
            fileInputFoto.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                // Validação de tamanho (5MB)
                if (file.size > 5 * 1024 * 1024) {
                    UI.showToast('A imagem selecionada excede o limite máximo de 5MB.', 'warning');
                    fileInputFoto.value = '';
                    return;
                }

                // Preview imediato
                const reader = new FileReader();
                reader.onload = (re) => {
                    const imgPreview = document.getElementById('aluno-foto-preview');
                    const placeholder = document.getElementById('aluno-foto-placeholder');
                    if (imgPreview && placeholder) {
                        imgPreview.src = re.target.result;
                        imgPreview.style.display = 'block';
                        placeholder.style.display = 'none';
                    }
                };
                reader.readAsDataURL(file);

                // Envia para o backend
                const formData = new FormData();
                formData.append('foto', file);

                btnUploadFoto.disabled = true;
                btnUploadFoto.innerHTML = `<div class="spinner"></div> Enviando...`;

                try {
                    const token = API.getToken();
                    const response = await fetch('/api/alunos/upload-foto', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`
                        },
                        body: formData
                    });

                    const data = await response.json();
                    if (!response.ok || !data.success) {
                        throw new Error(data.error || 'Erro no upload da foto.');
                    }

                    document.getElementById('aluno-foto').value = data.url;
                    if (btnRemoveFoto) btnRemoveFoto.style.display = 'inline-flex';
                    UI.showToast('Foto do aluno carregada com sucesso!', 'success');
                } catch (err) {
                    UI.showToast(err.message, 'error');
                } finally {
                    btnUploadFoto.disabled = false;
                    btnUploadFoto.innerHTML = `
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Trocar Foto
                    `;
                }
            });
        }

        if (btnRemoveFoto) {
            btnRemoveFoto.addEventListener('click', () => {
                document.getElementById('aluno-foto').value = '';
                if (fileInputFoto) fileInputFoto.value = '';
                const imgPreview = document.getElementById('aluno-foto-preview');
                const placeholder = document.getElementById('aluno-foto-placeholder');
                if (imgPreview && placeholder) {
                    imgPreview.src = '';
                    imgPreview.style.display = 'none';
                    placeholder.style.display = 'flex';
                }
                btnRemoveFoto.style.display = 'none';
                if (btnUploadFoto) {
                    btnUploadFoto.innerHTML = `
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Carregar Imagem
                    `;
                }
            });
        }
    },

    async loadModalidades() {
        try {
            const res = await API.get('/modalidades');
            this.modalidades = res.data || [];
            
            // Popula filtro
            const filter = document.getElementById('filter-modalidade');
            if (filter) {
                filter.innerHTML = '<option value="todas">Todas as Modalidades</option>';
                this.modalidades.forEach(m => {
                    filter.innerHTML += `<option value="${Number(m.id)}">${UI.escapeHtml(m.nome)}</option>`;
                });
            }

            // Popula select no form de novo aluno
            const selectForm = document.getElementById('aluno-modalidade-id');
            if (selectForm) {
                selectForm.innerHTML = '<option value="">Selecione uma modalidade (opcional)</option>';
                this.modalidades.forEach(m => {
                    selectForm.innerHTML += `<option value="${Number(m.id)}">${UI.escapeHtml(m.nome)}</option>`;
                });
            }

            // Popula select no modal de graduação
            const selectGradMod = document.getElementById('promo-modalidade-id');
            if (selectGradMod) {
                selectGradMod.innerHTML = '<option value="">Selecione a modalidade</option>';
                this.modalidades.forEach(m => {
                    selectGradMod.innerHTML += `<option value="${Number(m.id)}">${UI.escapeHtml(m.nome)}</option>`;
                });
            }
        } catch (err) {
            console.error('Erro ao carregar modalidades:', err);
        }
    },

    async loadPlanos() {
        try {
            const res = await API.get('/planos');
            this.planos = res.data || [];

            const selectPlano = document.getElementById('aluno-plano-id');
            if (selectPlano) {
                selectPlano.innerHTML = '<option value="">Sem plano inicial (cadastrar depois)</option>';
                this.planos.forEach(p => {
                    selectPlano.innerHTML += `<option value="${Number(p.id)}">${UI.escapeHtml(p.nome)} - ${UI.formatCurrency(p.valor_mensal)}/mês</option>`;
                });
            }
        } catch (err) {
            console.error('Erro ao carregar planos:', err);
        }
    },

    updateGraduacaoSelect(modalidadeId, selectedNivelId = null) {
        const selectNivel = document.getElementById('aluno-graduacao-id');
        if (!selectNivel) return;

        if (!modalidadeId) {
            selectNivel.innerHTML = '<option value="">Selecione primeiro a modalidade</option>';
            selectNivel.disabled = true;
            return;
        }

        const modalidade = this.modalidades.find(m => m.id == modalidadeId);
        if (!modalidade || !modalidade.niveis || modalidade.niveis.length === 0) {
            selectNivel.innerHTML = '<option value="">Sem catálogo de faixas</option>';
            selectNivel.disabled = true;
            return;
        }

        selectNivel.disabled = false;
        selectNivel.innerHTML = '<option value="">Selecione a faixa/graduação inicial</option>';
        modalidade.niveis.forEach(n => {
            const isSel = selectedNivelId == n.id ? 'selected' : '';
            selectNivel.innerHTML += `<option value="${Number(n.id)}" ${isSel}>${UI.escapeHtml(n.nome)} (${UI.escapeHtml(modalidade.nome)})</option>`;
        });
    },

    formatNomeDisplay(nome) {
        if (!nome) return '';
        const preposicoes = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
        return String(nome)
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .map((word, idx) => {
                if (idx > 0 && preposicoes.has(word)) return word;
                return word.charAt(0).toUpperCase() + word.slice(1);
            })
            .join(' ');
    },

    updateActiveFiltersCount() {
        const status = document.getElementById('filter-status')?.value || 'todos';
        const modalidade = document.getElementById('filter-modalidade')?.value || 'todas';
        const menor = document.getElementById('filter-menor')?.value || 'todos';

        let activeCount = 0;
        if (status !== 'todos') activeCount++;
        if (modalidade !== 'todas') activeCount++;
        if (menor !== 'todos') activeCount++;

        const btnToggle = document.getElementById('btn-toggle-filtros-alunos');
        const label = document.getElementById('btn-filtros-label');
        if (label) {
            label.textContent = activeCount > 0 ? `Filtros (${activeCount})` : 'Filtros';
        }
        if (btnToggle) {
            btnToggle.classList.toggle('has-active-filters', activeCount > 0);
        }
    },

    bindActionMenuGlobalEvents() {
        if (this.actionMenuEventsBound) return;
        this.actionMenuEventsBound = true;

        document.addEventListener('click', (e) => {
            if (!this.activeActionMenuTrigger) return;
            if (e.target.closest('#aluno-actions-dropdown') || e.target.closest('[data-action-menu-trigger="true"]')) {
                return;
            }
            this.closeActionMenu();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.activeActionMenuTrigger) {
                this.closeActionMenu();
            }
        });

        window.addEventListener('resize', () => {
            if (this.activeActionMenuTrigger) this.closeActionMenu();
        });

        window.addEventListener('scroll', (e) => {
            if (!this.activeActionMenuTrigger) return;
            if (e.target && e.target.id === 'aluno-actions-dropdown') return;
            this.closeActionMenu();
        }, true);
    },

    getOrCreateActionsMenu() {
        let menu = document.getElementById('aluno-actions-dropdown');
        if (menu) return menu;

        menu = document.createElement('div');
        menu.id = 'aluno-actions-dropdown';
        menu.className = 'aluno-actions-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-hidden', 'true');
        document.body.appendChild(menu);

        menu.addEventListener('click', (e) => {
            const linkItem = e.target.closest('a.aluno-actions-item');
            if (linkItem) {
                this.closeActionMenu();
                return;
            }

            const actionBtn = e.target.closest('button[data-menu-action]');
            if (!actionBtn) return;

            const action = actionBtn.getAttribute('data-menu-action');
            const alunoId = this.activeActionMenuAlunoId;
            const encodedNome = this.activeActionMenuEncodedNome;
            this.closeActionMenu();

            if (!alunoId) return;
            if (action === 'promo') {
                this.openPromoModal(alunoId, encodedNome);
            } else if (action === 'reset-senha') {
                this.openResetSenhaModal(alunoId, encodedNome);
            } else if (action === 'delete') {
                this.deleteAluno(alunoId, encodedNome);
            }
        });

        return menu;
    },

    toggleActionMenu(triggerBtn) {
        if (!triggerBtn) return;
        if (this.activeActionMenuTrigger === triggerBtn) {
            this.closeActionMenu();
            return;
        }
        const alunoId = Number(triggerBtn.getAttribute('data-aluno-id'));
        const encodedNome = triggerBtn.getAttribute('data-aluno-nome') || '';
        this.openActionMenu(triggerBtn, alunoId, encodedNome);
    },

    openActionMenu(triggerBtn, alunoId, encodedNome) {
        const safeId = Number(alunoId);
        if (!Number.isInteger(safeId) || safeId <= 0) return;

        this.closeActionMenu();

        const menu = this.getOrCreateActionsMenu();
        const canPromo = !window.AuthModule || AuthModule.can('promote_faixas');
        const canDelete = !window.AuthModule || AuthModule.can('delete_alunos');

        menu.innerHTML = `
            <a class="aluno-actions-item" role="menuitem" href="/painel?aluno_id=${safeId}" target="_blank" rel="noopener noreferrer">
                <svg class="item-icon-portal" viewBox="0 0 24 24" aria-hidden="true">
                    <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                    <line x1="12" y1="18" x2="12.01" y2="18" />
                </svg>
                <span>Portal do Aluno / Acesso</span>
            </a>
            ${canPromo ? `
                <button type="button" class="aluno-actions-item" role="menuitem" data-menu-action="promo">
                    <svg class="item-icon-promo" viewBox="0 0 24 24" aria-hidden="true">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                    <span>Graduações / Exames</span>
                </button>
            ` : ''}
            <button type="button" class="aluno-actions-item" role="menuitem" data-menu-action="reset-senha">
                <svg class="item-icon-reset" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="7.5" cy="15.5" r="5.5" />
                    <path d="m21 2-9.6 9.6M15.5 7.5l3 3M18.5 4.5l2 2" />
                </svg>
                <span>Redefinir Senha / Credenciais</span>
            </button>
            ${canDelete ? `
                <div class="aluno-actions-divider" role="separator"></div>
                <button type="button" class="aluno-actions-item danger" role="menuitem" data-menu-action="delete">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    <span>Mover para Lixeira</span>
                </button>
            ` : ''}
        `;

        menu.style.visibility = 'hidden';
        menu.classList.add('open');
        menu.setAttribute('aria-hidden', 'false');

        const rect = triggerBtn.getBoundingClientRect();
        const menuWidth = menu.offsetWidth || 235;
        const menuHeight = menu.offsetHeight || 190;

        let left = rect.right - menuWidth;
        if (left < 8) left = 8;
        if (left + menuWidth > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - menuWidth - 8);
        }

        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        let top;
        let openUpward = false;
        if (spaceBelow < menuHeight + 12 && spaceAbove > spaceBelow) {
            top = Math.max(8, rect.top - menuHeight - 6);
            openUpward = true;
        } else {
            top = Math.max(8, Math.min(window.innerHeight - menuHeight - 8, rect.bottom + 6));
        }

        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        menu.classList.toggle('open-upward', openUpward);
        menu.style.visibility = 'visible';

        triggerBtn.setAttribute('aria-expanded', 'true');
        this.activeActionMenuTrigger = triggerBtn;
        this.activeActionMenuAlunoId = safeId;
        this.activeActionMenuEncodedNome = encodedNome;
    },

    closeActionMenu() {
        const menu = document.getElementById('aluno-actions-dropdown');
        if (menu) {
            menu.classList.remove('open', 'open-upward');
            menu.setAttribute('aria-hidden', 'true');
            menu.style.visibility = '';
            menu.style.top = '-9999px';
            menu.style.left = '-9999px';
        }
        if (this.activeActionMenuTrigger) {
            this.activeActionMenuTrigger.setAttribute('aria-expanded', 'false');
        }
        this.activeActionMenuTrigger = null;
        this.activeActionMenuAlunoId = null;
        this.activeActionMenuEncodedNome = '';
    },

    async loadAlunos() {
        const tbody = document.getElementById('alunos-table-body');
        const countSpan = document.getElementById('total-alunos-count');
        const lixeiraBadge = document.getElementById('lixeira-contador-badge');
        if (!tbody) return;

        this.closeActionMenu();
        this.updateActiveFiltersCount();
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 30px;"><div class="spinner"></div> Carregando alunos...</td></tr>`;

        const busca = document.getElementById('search-aluno')?.value || '';
        const status = document.getElementById('filter-status')?.value || 'todos';
        const modalidade_id = document.getElementById('filter-modalidade')?.value || 'todas';
        const menor = document.getElementById('filter-menor')?.value || 'todos';

        try {
            const res = await API.get(`/alunos?busca=${encodeURIComponent(busca)}&status=${status}&modalidade_id=${modalidade_id}&menor=${menor}`);
            this.alunosList = res.data || [];

            if (countSpan) {
                const totalBase = res.total_base !== undefined ? Number(res.total_base) : this.alunosList.length;
                countSpan.textContent = totalBase;
                countSpan.title = `${totalBase} ${totalBase === 1 ? 'aluno cadastrado' : 'alunos cadastrados'} na base`;
            }
            if (lixeiraBadge && res.total_lixeira !== undefined) {
                lixeiraBadge.textContent = Number(res.total_lixeira);
            }

            if (this.alunosList.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
                            Nenhum aluno encontrado com os filtros selecionados.
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = this.alunosList.map(a => {
                const safeId = Number(a.id);
                const formattedNome = this.formatNomeDisplay(a.nome_completo);
                const safeNome = UI.escapeHtml(formattedNome);
                const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(formattedNome || 'Aluno')}&background=0284c7&color=fff`;
                const safeAvatar = UI.sanitizeUrl(a.foto_perfil_url, fallbackAvatar);
                const isMenor = a.idade !== null && a.idade < 18;
                const menorBadge = isMenor ? `<span class="minor-tag">MENOR</span>` : '';

                let dotClass = 'status-dot-inativo';
                let dotTitle = 'Inativo';
                if (Number(a.faturas_atrasadas) > 0 || a.status === 'bloqueado') {
                    dotClass = 'status-dot-danger';
                    dotTitle = a.status === 'bloqueado' ? 'Bloqueado' : 'Inadimplente';
                } else if (a.status === 'ativo' || a.status === 'experimental') {
                    dotClass = 'status-dot-ativo';
                    dotTitle = a.status === 'experimental' ? 'Experimental' : 'Ativo';
                } else if (a.status === 'trancado') {
                    dotClass = 'status-dot-inativo';
                    dotTitle = 'Trancado';
                }

                let financeiroIndicator;
                if (Number(a.faturas_atrasadas) > 0) {
                    financeiroIndicator = `<span title="Possui mensalidade atrasada" style="color: #ef4444; font-weight: bold; cursor: help;">⚠️ Atrasado</span>`;
                } else if (Number(a.faturas_pendentes) > 0) {
                    financeiroIndicator = `<span title="Aguardando pagamento da mensalidade" style="color: #f59e0b; font-weight: 600; cursor: help;">⏳ Pendente</span>`;
                } else if (!a.plano_nome && a.matricula_status !== 'ativa') {
                    financeiroIndicator = `<span title="Aluno sem plano ativo contratado" style="color: #94a3b8;">Sem contrato</span>`;
                } else {
                    financeiroIndicator = `<span style="color: #10b981;">Em dia</span>`;
                }
                const encodedNome = encodeURIComponent(a.nome_completo || '').replace(/'/g, '%27');
                const idadeHtml = a.idade !== null ? `<span class="aluno-idade-text">• ${Number(a.idade)} anos</span>` : '';

                const dtUltimaAval = a.ultima_avaliacao_data || a.ultima_avaliacao_graduacao || a.ultima_avaliacao_desempenho || null;
                const tooltipParts = [];
                if (a.ultima_avaliacao_graduacao) tooltipParts.push(`Graduação: ${UI.formatDate(a.ultima_avaliacao_graduacao)}`);
                if (a.ultima_avaliacao_desempenho) tooltipParts.push(`Desempenho: ${UI.formatDate(a.ultima_avaliacao_desempenho)}`);
                if (a.aptidao_exame && a.aptidao_exame.motivo) {
                    tooltipParts.push(`Exame: ${a.aptidao_exame.motivo}`);
                }
                const evalTooltip = tooltipParts.length > 0
                    ? tooltipParts.join(' • ')
                    : 'Nenhuma avaliação registrada para este aluno';

                let aptidaoPillHtml = '';
                if (a.aptidao_exame) {
                    if (a.aptidao_exame.apto) {
                        const proxTxt = a.aptidao_exame.proxima_graduacao_nome
                            ? `Apto para ${a.aptidao_exame.proxima_graduacao_nome}`
                            : 'Apto para próximo exame';
                        aptidaoPillHtml = `<span class="aluno-aptidao-pill apto" title="${UI.escapeHtml(proxTxt + ' • ' + (a.aptidao_exame.motivo || ''))}">✓ Apto p/ exame</span>`;
                    } else if (dtUltimaAval) {
                        aptidaoPillHtml = `<span class="aluno-aptidao-pill evolucao" title="${UI.escapeHtml(a.aptidao_exame.motivo || 'Em evolução técnica')}">Em evolução</span>`;
                    }
                }

                const ultimaAvalHtml = dtUltimaAval
                    ? `<div class="aluno-eval-meta avaliado" title="${UI.escapeHtml(evalTooltip)}">Últ. avaliação: <strong>${UI.escapeHtml(UI.formatDate(dtUltimaAval))}</strong> ${aptidaoPillHtml}</div>`
                    : `<div class="aluno-eval-meta pendente" title="${UI.escapeHtml(evalTooltip)}">Sem avaliação ${aptidaoPillHtml}</div>`;

                return `
                    <tr id="aluno-row-${safeId}" class="aluno-row-clickable" data-aluno-id="${safeId}">
                        <td>
                            <div class="aluno-cell">
                                <div class="aluno-avatar-wrap aluno-avatar-zoomable"
                                     data-avatar-zoom-id="${safeId}"
                                     role="button"
                                     tabindex="0"
                                     title="Clique para ampliar a foto de ${safeNome}"
                                     aria-label="Ampliar foto de ${safeNome}">
                                    <img src="${safeAvatar}" 
                                         alt="${safeNome}" class="aluno-avatar" 
                                         onerror="this.src='${fallbackAvatar}'">
                                    <span class="avatar-status-dot ${dotClass}" title="${UI.escapeHtml(dotTitle)}"></span>
                                </div>
                                <div class="aluno-info-wrap">
                                    <div class="aluno-info-primary">
                                        <a href="javascript:void(0)" class="aluno-nome-link" onclick="AlunoDetalhesModule.openDossier(${safeId})">
                                            ${safeNome}
                                        </a>
                                        ${menorBadge}
                                    </div>
                                    <div class="aluno-info-secondary">
                                        <span class="aluno-cpf-text">CPF: ${UI.escapeHtml(a.cpf || 'Não informado')}</span>${idadeHtml}
                                    </div>
                                </div>
                                <svg class="row-chevron" viewBox="0 0 24 24" aria-hidden="true">
                                    <polyline points="9 18 15 12 9 6" />
                                </svg>
                            </div>
                        </td>
                        <td>
                            ${UI.renderBeltBadge(a.graduacao_nome, a.graduacao_cor_primaria, a.graduacao_cor_secundaria)}
                            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${UI.escapeHtml(a.modalidade_nome || 'Sem modalidade')}</div>
                            ${ultimaAvalHtml}
                        </td>
                        <td>
                            <div style="font-weight: 500;">${UI.escapeHtml(a.telefone_whatsapp)}</div>
                            <div style="font-size: 11px; color: var(--text-muted);">${UI.escapeHtml(a.email || (isMenor ? 'Resp: ' + (a.responsavel_nome || '') : 'Sem e-mail'))}</div>
                        </td>
                        <td>
                            <div style="font-weight: 600;">${UI.escapeHtml(a.plano_nome || 'Sem plano')}</div>
                            <div style="font-size: 11px;">${financeiroIndicator}</div>
                        </td>
                        <td>
                            <span style="font-weight: 700; color: var(--primary-light);">${Number(a.total_presencas) || 0}</span>
                            <span style="font-size: 11px; color: var(--text-muted);"> treinos</span>
                        </td>
                        <td>
                            ${UI.renderStatusBadge(a.status)}
                        </td>
                        <td class="col-actions">
                            <div class="table-actions table-actions-compact">
                                <button type="button" class="btn-icon btn-icon-checkin" title="Check-in Rápido" aria-label="Check-in Rápido" onclick="CheckinsModule.quickCheckin(${safeId})">
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                                </button>
                                ${(!window.AuthModule || AuthModule.can('manage_alunos')) ? `
                                    <button type="button" class="btn-icon btn-icon-edit" title="Editar Cadastro" aria-label="Editar Cadastro" onclick="AlunosModule.openEditModal(${safeId})">
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                                    </button>
                                ` : ''}
                                <button type="button" class="btn-icon btn-icon-more" title="Mais ações" aria-label="Mais ações" aria-haspopup="menu" aria-expanded="false" data-action-menu-trigger="true" data-aluno-id="${safeId}" data-aluno-nome="${UI.escapeHtml(encodedNome)}">
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none"/>
                                        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
                                        <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none"/>
                                    </svg>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px; color:#ef4444;">Erro ao carregar lista de alunos.</td></tr>`;
            UI.showToast('Erro ao carregar alunos: ' + err.message, 'error');
        }
    },

    checkMinorCondition(birthDateString) {
        const age = UI.calculateAge(birthDateString);
        const minorBox = document.getElementById('minor-alert-box');
        const respFields = document.querySelectorAll('.responsavel-required');

        if (age !== null && age < 18) {
            if (minorBox) minorBox.style.display = 'flex';
            respFields.forEach(el => el.setAttribute('required', 'required'));
        } else {
            if (minorBox) minorBox.style.display = 'none';
            respFields.forEach(el => el.removeAttribute('required'));
        }
    },

    openFormModal() {
        const form = document.getElementById('form-aluno');
        if (form) form.reset();
        document.getElementById('aluno-id').value = '';
        document.getElementById('aluno-foto').value = '';

        const senhaGroup = document.getElementById('aluno-senha-group');
        const senhaInput = document.getElementById('aluno-senha');
        if (senhaGroup) senhaGroup.style.display = '';
        if (senhaInput) {
            senhaInput.value = '';
            senhaInput.required = true;
        }

        // Reseta preview de foto
        const imgPreview = document.getElementById('aluno-foto-preview');
        const placeholder = document.getElementById('aluno-foto-placeholder');
        const btnRemoveFoto = document.getElementById('btn-remove-foto');
        const btnUploadFoto = document.getElementById('btn-upload-foto');

        if (imgPreview) {
            imgPreview.src = '';
            imgPreview.style.display = 'none';
        }
        if (placeholder) placeholder.style.display = 'flex';
        if (btnRemoveFoto) btnRemoveFoto.style.display = 'none';
        if (btnUploadFoto) {
            btnUploadFoto.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Carregar Imagem
            `;
        }

        document.getElementById('modal-aluno-title').innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
            Novo Aluno
        `;
        document.getElementById('matricula-initial-section').style.display = 'block';
        document.getElementById('minor-alert-box').style.display = 'none';
        const chkWa = document.getElementById('aluno-receber-whatsapp');
        if (chkWa) chkWa.checked = true;
        this.updateGraduacaoSelect('');
        UI.openModal('modal-aluno');
    },

    async openEditModal(id) {
        try {
            const res = await API.get(`/alunos/${id}`);
            const aluno = res.data.aluno;

            document.getElementById('aluno-id').value = aluno.id;
            document.getElementById('aluno-nome').value = aluno.nome_completo || '';
            document.getElementById('aluno-cpf').value = aluno.cpf || '';
            document.getElementById('aluno-nascimento').value = aluno.data_nascimento ? aluno.data_nascimento.slice(0, 10) : '';
            document.getElementById('aluno-genero').value = aluno.genero || 'M';
            document.getElementById('aluno-whatsapp').value = aluno.telefone_whatsapp || '';
            const chkWa = document.getElementById('aluno-receber-whatsapp');
            if (chkWa) chkWa.checked = aluno.receber_whatsapp !== 0 && aluno.receber_whatsapp !== false;
            document.getElementById('aluno-email').value = aluno.email || '';
            document.getElementById('aluno-status').value = aluno.status || 'ativo';
            document.getElementById('aluno-foto').value = aluno.foto_perfil_url || '';

            const senhaGroup = document.getElementById('aluno-senha-group');
            const senhaInput = document.getElementById('aluno-senha');
            if (senhaGroup) senhaGroup.style.display = 'none';
            if (senhaInput) {
                senhaInput.value = '';
                senhaInput.required = false;
            }

            // Atualiza preview da foto
            const imgPreview = document.getElementById('aluno-foto-preview');
            const placeholder = document.getElementById('aluno-foto-placeholder');
            const btnRemoveFoto = document.getElementById('btn-remove-foto');
            const btnUploadFoto = document.getElementById('btn-upload-foto');

            if (aluno.foto_perfil_url) {
                if (imgPreview) {
                    imgPreview.src = aluno.foto_perfil_url;
                    imgPreview.style.display = 'block';
                }
                if (placeholder) placeholder.style.display = 'none';
                if (btnRemoveFoto) btnRemoveFoto.style.display = 'inline-flex';
                if (btnUploadFoto) {
                    btnUploadFoto.innerHTML = `
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Trocar Foto
                    `;
                }
            } else {
                if (imgPreview) {
                    imgPreview.src = '';
                    imgPreview.style.display = 'none';
                }
                if (placeholder) placeholder.style.display = 'flex';
                if (btnRemoveFoto) btnRemoveFoto.style.display = 'none';
                if (btnUploadFoto) {
                    btnUploadFoto.innerHTML = `
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Carregar Imagem
                    `;
                }
            }

            // Responsável
            document.getElementById('aluno-resp-nome').value = aluno.responsavel_nome || '';
            document.getElementById('aluno-resp-cpf').value = aluno.responsavel_cpf || '';
            document.getElementById('aluno-resp-fone').value = aluno.responsavel_telefone || '';

            // Saúde
            document.getElementById('aluno-emergencia-nome').value = aluno.contato_emergencia_nome || '';
            document.getElementById('aluno-emergencia-fone').value = aluno.contato_emergencia_fone || '';
            document.getElementById('aluno-tipo-sanguineo').value = aluno.tipo_sanguineo || '';
            document.getElementById('aluno-obs-medicas').value = aluno.observacoes_medicas || '';

            // Oculta bloco de graduação inicial na edição (usa o modal de graduação para evoluir)
            document.getElementById('matricula-initial-section').style.display = 'none';

            this.checkMinorCondition(aluno.data_nascimento);

            document.getElementById('modal-aluno-title').innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                Editar Aluno: ${UI.escapeHtml(aluno.nome_completo)}
            `;

            UI.openModal('modal-aluno');
        } catch (err) {
            UI.showToast('Erro ao carregar dados do aluno para edição: ' + err.message, 'error');
        }
    },

    async handleSubmitAluno(e) {
        e.preventDefault();
        const id = document.getElementById('aluno-id').value;
        const fotoUrl = document.getElementById('aluno-foto').value || null;
        const email = (document.getElementById('aluno-email').value || '').trim();
        const senha = (document.getElementById('aluno-senha')?.value || '').trim();

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            UI.showToast('Informe um e-mail válido para o acesso do aluno.', 'warning');
            document.getElementById('aluno-email')?.focus();
            return;
        }

        if (!id && senha.length < 6) {
            UI.showToast('A senha de acesso é obrigatória e deve ter no mínimo 6 caracteres.', 'warning');
            document.getElementById('aluno-senha')?.focus();
            return;
        }

        if (!id && !fotoUrl) {
            UI.showToast('A foto de perfil é obrigatória no momento do cadastro.', 'warning');
            return;
        }

        const btnSubmit = document.getElementById('btn-submit-aluno');
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `<div class="spinner"></div> Salvando...`;

        const body = {
            nome_completo: document.getElementById('aluno-nome').value,
            cpf: document.getElementById('aluno-cpf').value || null,
            data_nascimento: document.getElementById('aluno-nascimento').value,
            genero: document.getElementById('aluno-genero').value,
            telefone_whatsapp: document.getElementById('aluno-whatsapp').value,
            receber_whatsapp: document.getElementById('aluno-receber-whatsapp')?.checked !== false,
            email,
            ...(id ? {} : { senha }),
            status: document.getElementById('aluno-status').value,
            foto_perfil_url: fotoUrl,
            responsavel_nome: document.getElementById('aluno-resp-nome').value || null,
            responsavel_cpf: document.getElementById('aluno-resp-cpf').value || null,
            responsavel_telefone: document.getElementById('aluno-resp-fone').value || null,
            contato_emergencia_nome: document.getElementById('aluno-emergencia-nome').value || null,
            contato_emergencia_fone: document.getElementById('aluno-emergencia-fone').value || null,
            tipo_sanguineo: document.getElementById('aluno-tipo-sanguineo').value || null,
            observacoes_medicas: document.getElementById('aluno-obs-medicas').value || null,
            modalidade_id: document.getElementById('aluno-modalidade-id')?.value || null,
            graduacao_nivel_id: document.getElementById('aluno-graduacao-id')?.value || null,
            plano_id: document.getElementById('aluno-plano-id')?.value || null,
            dia_vencimento: parseInt(document.getElementById('aluno-vencimento')?.value || '10', 10)
        };

        try {
            if (id) {
                await API.put(`/alunos/${id}`, body);
                UI.showToast('Aluno atualizado com sucesso!', 'success');
            } else {
                await API.post('/alunos', body);
                UI.showToast('Aluno cadastrado com sucesso!', 'success');
            }
            UI.closeModal('modal-aluno');
            await this.loadAlunos();
            if (window.DashboardModule) DashboardModule.loadDashboard();
        } catch (err) {
            UI.showToast(err.message, 'error');
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = `Salvar Aluno`;
        }
    },

    openPromoModal(alunoId, alunoNome) {
        document.getElementById('promo-aluno-id').value = alunoId;
        document.getElementById('promo-aluno-nome-display').textContent = decodeURIComponent(alunoNome);
        document.getElementById('promo-data').value = new Date().toISOString().slice(0, 10);
        document.getElementById('promo-obs').value = '';

        // Carrega professores para o avaliador
        this.loadProfessoresSelect();

        UI.openModal('modal-promocao');
    },

    async loadProfessoresSelect() {
        try {
            const res = await API.get('/modalidades/equipe/professores');
            const select = document.getElementById('promo-professor-id');
            if (select) {
                select.innerHTML = '<option value="">Selecione o professor avaliador</option>';
                res.data.forEach(p => {
                    select.innerHTML += `<option value="${Number(p.id)}">${UI.escapeHtml(p.nome)} (${UI.escapeHtml(p.cargo)})</option>`;
                });
            }
        } catch (err) {
            console.error('Erro ao listar professores:', err);
        }
    },

    // ==========================================
    // REDEFINIÇÃO DE SENHA DO ALUNO
    // ==========================================
    openResetSenhaModal(alunoId, alunoNome) {
        const nome = decodeURIComponent(alunoNome);
        const aluno = this.alunosList.find(a => String(a.id) === String(alunoId));
        const email = aluno ? (aluno.email || 'Sem e-mail cadastrado') : 'Consultando...';

        document.getElementById('reset-senha-aluno-id').value = alunoId;
        document.getElementById('reset-senha-aluno-nome').textContent = nome;
        document.getElementById('reset-senha-aluno-email').textContent = `Login / E-mail: ${email}`;

        this.gerarSenhaAleatoria();
        UI.openModal('modal-reset-senha-aluno');
    },

    gerarSenhaAleatoria() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
        let pass = 'Kz@';
        for (let i = 0; i < 5; i++) {
            pass += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        const input = document.getElementById('reset-nova-senha');
        if (input) input.value = pass;
    },

    async copiarNovaSenha() {
        const input = document.getElementById('reset-nova-senha');
        if (!input || !input.value) return;
        try {
            await navigator.clipboard.writeText(input.value);
            UI.showToast('Senha copiada para a área de transferência!', 'success');
        } catch {
            input.select();
            document.execCommand('copy');
            UI.showToast('Senha copiada!', 'success');
        }
    },

    async submitResetSenha(e) {
        e.preventDefault();
        const alunoId = document.getElementById('reset-senha-aluno-id').value;
        const nova_senha = document.getElementById('reset-nova-senha').value.trim();
        const btn = document.getElementById('btn-salvar-nova-senha');

        if (!nova_senha || nova_senha.length < 6) {
            UI.showToast('A senha deve ter no mínimo 6 caracteres.', 'warning');
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<div class="spinner"></div> Salvando...`;
        }

        try {
            const res = await API.post(`/alunos/${alunoId}/resetar-senha`, { nova_senha });
            if (!res.success) throw new Error(res.error || 'Erro ao redefinir senha.');

            await this.copiarNovaSenha();
            UI.showToast(`Senha redefinida com sucesso para "${nova_senha}" (copiada)!`, 'success');
            UI.closeModal('modal-reset-senha-aluno');
        } catch (err) {
            UI.showToast('Erro ao redefinir senha: ' + err.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `💾 Salvar Nova Senha`;
            }
        }
    },

    // ==========================================
    // SOFT DELETE: MOVER ALUNO PARA A LIXEIRA
    // ==========================================
    async deleteAluno(alunoId, alunoNome) {
        if (window.AuthModule && !AuthModule.can('delete_alunos')) {
            UI.showToast('Você não tem permissão para remover cadastros.', 'warning');
            return;
        }

        const nome = decodeURIComponent(alunoNome);
        const confirmMsg = `Deseja mover o cadastro de "${nome}" para a Lixeira?\n\nO aluno deixará de aparecer na lista principal, mas você poderá restaurá-lo ou apagá-lo definitivamente a qualquer momento na Lixeira.`;
        if (!confirm(confirmMsg)) {
            return;
        }

        try {
            const res = await API.delete(`/alunos/${alunoId}`);
            if (!res.success) throw new Error(res.error || 'Erro ao mover aluno para a lixeira.');

            UI.showToast(`Aluno "${nome}" movido para a lixeira com sucesso.`, 'success');
            await this.loadAlunos();
            await this.atualizarContadorLixeira();
            if (window.DashboardModule) DashboardModule.loadDashboard();
        } catch (err) {
            UI.showToast('Erro ao remover aluno: ' + err.message, 'error');
        }
    },

    inativarAluno(alunoId, alunoNome) {
        return this.deleteAluno(alunoId, alunoNome);
    },

    // ==========================================
    // GESTÃO DA LIXEIRA DE CADASTROS
    // ==========================================
    async atualizarContadorLixeira() {
        const badge = document.getElementById('lixeira-contador-badge');
        if (!badge) return;

        try {
            const res = await API.get('/alunos/lixeira');
            if (res.success) {
                badge.textContent = res.count || 0;
            }
        } catch (err) {
            console.error('Erro ao atualizar contador da lixeira:', err);
        }
    },

    abrirModalLixeira() {
        UI.openModal('modal-lixeira');
        this.carregarLixeira();
    },

    async carregarLixeira() {
        const tbody = document.getElementById('lixeira-table-body');
        const infoEl = document.getElementById('lixeira-total-info');
        const btnEsvaziar = document.getElementById('btn-esvaziar-lixeira');
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 28px;"><div class="spinner"></div> Carregando cadastros na lixeira...</td></tr>`;

        const busca = document.getElementById('search-lixeira')?.value || '';
        try {
            const res = await API.get(`/alunos/lixeira?busca=${encodeURIComponent(busca)}`);
            const lista = res.data || [];

            if (infoEl) {
                infoEl.textContent = `${lista.length} cadastro(s) na lixeira`;
            }

            if (btnEsvaziar) {
                btnEsvaziar.disabled = lista.length === 0;
                btnEsvaziar.style.opacity = lista.length === 0 ? '0.5' : '1';
                btnEsvaziar.style.cursor = lista.length === 0 ? 'not-allowed' : 'pointer';
            }

            if (lista.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="4" style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
                            <div style="font-size: 26px; margin-bottom: 8px;">🗑️</div>
                            <div style="font-weight: 600; color: #cbd5e1; font-size: 14px;">A lixeira está vazia</div>
                            <p style="font-size: 12px; margin: 4px 0 0 0; color: #64748b;">Nenhum cadastro de aluno foi enviado para a lixeira.</p>
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = lista.map(item => {
                const safeId = Number(item.id);
                const safeNome = UI.escapeHtml(item.nome_completo);
                const encodedNome = encodeURIComponent(item.nome_completo || '').replace(/'/g, '%27');
                const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(item.nome_completo || 'Aluno')}&background=334155&color=fff`;
                const safeAvatar = UI.sanitizeUrl(item.foto_perfil_url, fallbackAvatar);
                
                const dataExclusaoFmt = item.deleted_at 
                    ? new Date(item.deleted_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                    : 'Data não registrada';

                const diasTexto = item.dias_na_lixeira !== null && item.dias_na_lixeira !== undefined
                    ? (item.dias_na_lixeira === 0 ? 'Hoje' : `Há ${item.dias_na_lixeira} dia(s)`)
                    : '';

                return `
                    <tr id="lixeira-row-${safeId}">
                        <td>
                            <div class="aluno-cell">
                                <img src="${safeAvatar}" alt="${safeNome}" class="aluno-avatar" onerror="this.src='${fallbackAvatar}'" style="opacity: 0.75; filter: grayscale(40%);">
                                <div>
                                    <strong style="color: #f1f5f9; font-size: 13.5px;">${safeNome}</strong>
                                    <div style="font-size: 11px; color: var(--text-muted);">CPF: ${UI.escapeHtml(item.cpf || 'Não informado')}</div>
                                </div>
                            </div>
                        </td>
                        <td>
                            <div style="font-size: 12px; color: #cbd5e1;">${UI.escapeHtml(item.telefone_whatsapp || 'Sem telefone')}</div>
                            <div style="font-size: 11px; color: var(--text-muted);">${UI.escapeHtml(item.email || 'Sem e-mail')}</div>
                        </td>
                        <td>
                            <div style="font-size: 12px; color: #f87171; font-weight: 600;">${dataExclusaoFmt}</div>
                            ${diasTexto ? `<span style="font-size: 10.5px; background: rgba(239,68,68,0.12); color: #fca5a5; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 2px;">${diasTexto}</span>` : ''}
                        </td>
                        <td style="text-align: right;">
                            <div style="display: inline-flex; gap: 8px; justify-content: flex-end;">
                                <button type="button" class="btn btn-secondary btn-sm" 
                                        style="display: inline-flex; align-items: center; gap: 5px; color: #34d399; border-color: rgba(16, 185, 129, 0.35); padding: 5px 10px; font-size: 11.5px; font-weight: 700;"
                                        onclick="AlunosModule.restaurarAluno(${safeId}, '${encodedNome}')" title="Restaurar aluno de volta para a lista ativa">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                                        <polyline points="1 4 1 10 7 10"></polyline>
                                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                                    </svg>
                                    <span>Restaurar</span>
                                </button>
                                ${(!window.AuthModule || AuthModule.can('delete_alunos')) ? `
                                    <button type="button" class="btn btn-secondary btn-sm" 
                                            style="display: inline-flex; align-items: center; gap: 5px; color: #f87171; border-color: rgba(239, 68, 68, 0.35); padding: 5px 10px; font-size: 11.5px; font-weight: 700;"
                                            onclick="AlunosModule.excluirPermanenteAluno(${safeId}, '${encodedNome}')" title="Apagar definitivamente do banco de dados">
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                                            <polyline points="3 6 5 6 21 6"></polyline>
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                        </svg>
                                        <span>Apagar</span>
                                    </button>
                                ` : ''}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 20px; color: #ef4444;">Erro ao carregar lixeira: ${UI.escapeHtml(err.message)}</td></tr>`;
        }
    },

    async restaurarAluno(alunoId, alunoNome) {
        const nome = decodeURIComponent(alunoNome);
        if (!confirm(`Deseja restaurar o cadastro de "${nome}" de volta para a lista ativa de alunos?`)) {
            return;
        }

        try {
            const res = await API.post(`/alunos/${alunoId}/restaurar`);
            if (!res.success) throw new Error(res.error || 'Erro ao restaurar aluno.');

            UI.showToast(`Cadastro de "${nome}" restaurado com sucesso!`, 'success');
            await this.carregarLixeira();
            await this.loadAlunos();
            await this.atualizarContadorLixeira();
            if (window.DashboardModule) DashboardModule.loadDashboard();
        } catch (err) {
            UI.showToast('Erro ao restaurar: ' + err.message, 'error');
        }
    },

    async excluirPermanenteAluno(alunoId, alunoNome) {
        if (window.AuthModule && !AuthModule.can('delete_alunos')) {
            UI.showToast('Apenas administradores podem apagar cadastros permanentemente.', 'warning');
            return;
        }

        const nome = decodeURIComponent(alunoNome);
        const confirmMsg = `⚠️ ATENÇÃO: Esta ação é DEFINITIVA e IRREVERSÍVEL!\n\nDeseja realmente APAGAR PERMANENTEMENTE o aluno "${nome}"?\n\nTodas as faturas, matrículas, presenças, avaliações e login serão destruídos do banco de dados.`;
        if (!confirm(confirmMsg)) {
            return;
        }

        try {
            const res = await API.delete(`/alunos/${alunoId}/permanente`);
            if (!res.success) throw new Error(res.error || 'Erro ao excluir permanentemente.');

            UI.showToast(`Cadastro de "${nome}" excluído permanentemente com sucesso.`, 'success');
            await this.carregarLixeira();
            await this.atualizarContadorLixeira();
        } catch (err) {
            UI.showToast('Erro ao apagar definitivamente: ' + err.message, 'error');
        }
    },

    async esvaziarLixeira() {
        if (window.AuthModule && !AuthModule.can('delete_alunos')) {
            UI.showToast('Apenas administradores podem esvaziar a lixeira.', 'warning');
            return;
        }

        const confirmMsg = `🚨 ATENÇÃO MÁXIMA: Deseja realmente ESVAZIAR A LIXEIRA?\n\nTodos os alunos atualmente na lixeira e seus respectivos históricos (faturas, presenças e avaliações) serão EXCLUÍDOS PERMANENTEMENTE do sistema.\n\nEsta operação NÃO PODE ser desfeita!`;
        if (!confirm(confirmMsg)) {
            return;
        }

        const btn = document.getElementById('btn-esvaziar-lixeira');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<div class="spinner"></div> Esvaziando...`;
        }

        try {
            const res = await API.post('/alunos/lixeira/esvaziar');
            if (!res.success) throw new Error(res.error || 'Erro ao esvaziar lixeira.');

            UI.showToast(res.message || 'Lixeira esvaziada com sucesso.', 'success');
            await this.carregarLixeira();
            await this.atualizarContadorLixeira();
        } catch (err) {
            UI.showToast('Erro ao esvaziar lixeira: ' + err.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `⚠️ Esvaziar Lixeira`;
            }
        }
    },

    async openEnviarAvisoModal() {
        const form = document.getElementById('form-enviar-aviso-alunos');
        if (form) form.reset();

        const selectDest = document.getElementById('aviso-destinatario');
        if (selectDest) {
            selectDest.innerHTML = `<option value="">Todos os alunos ativos (também aparece na caixa de avisos)</option>`;
            try {
                let lista = Array.isArray(this.alunosData) && this.alunosData.length > 0 ? this.alunosData : [];
                if (lista.length === 0) {
                    const res = await API.get('/alunos?status=ativo');
                    if (res?.success && Array.isArray(res.data)) {
                        lista = res.data;
                    }
                }
                const comEmail = lista
                    .filter(a => a && a.status === 'ativo' && a.email && String(a.email).includes('@'))
                    .sort((a, b) => String(a.nome_completo || '').localeCompare(String(b.nome_completo || ''), 'pt-BR'));

                for (const aluno of comEmail) {
                    const opt = document.createElement('option');
                    opt.value = String(aluno.id);
                    opt.textContent = `${aluno.nome_completo} (${aluno.email})`;
                    selectDest.appendChild(opt);
                }
            } catch (err) {
                console.warn('Falha ao carregar lista de alunos para aviso:', err.message);
            }
        }

        UI.openModal('modal-enviar-aviso-alunos');
    },

    async submitEnviarAviso(e) {
        e.preventDefault();
        const btn = document.getElementById('btn-submit-enviar-aviso');
        const alunoId = document.getElementById('aviso-destinatario')?.value || '';
        const tipo = document.getElementById('aviso-tipo')?.value || 'aviso';
        const titulo = document.getElementById('aviso-titulo')?.value?.trim() || '';
        const mensagem = document.getElementById('aviso-mensagem')?.value?.trim() || '';

        if (!titulo || !mensagem) {
            UI.showToast('Preencha o título e a mensagem do aviso.', 'warning');
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Enviando...';
        }

        try {
            const res = await API.post('/alunos/avisos/enviar', {
                aluno_id: alunoId || null,
                tipo,
                titulo,
                mensagem
            });

            if (!res?.success) {
                throw new Error(res?.error || 'Erro ao enviar aviso.');
            }

            UI.showToast(res.message || 'Aviso enviado por e-mail com sucesso!', 'success');
            UI.closeModal('modal-enviar-aviso-alunos');
        } catch (err) {
            UI.showToast(err.message || 'Falha ao enviar aviso por e-mail.', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Enviar Aviso por E-mail';
            }
        }
    },

    waPollTimer: null,

    async openWhatsAppModal() {
        UI.openModal('modal-config-whatsapp');
        await this.refreshWhatsAppStatus();
        if (this.waPollTimer) clearInterval(this.waPollTimer);
        this.waPollTimer = setInterval(() => this.refreshWhatsAppStatus(), 2500);
    },

    closeWhatsAppModal() {
        if (this.waPollTimer) {
            clearInterval(this.waPollTimer);
            this.waPollTimer = null;
        }
        UI.closeModal('modal-config-whatsapp');
    },

    renderWhatsAppStatus(data) {
        const statusText = document.getElementById('wa-status-text');
        const phoneText = document.getElementById('wa-phone-text');
        const btnConectar = document.getElementById('btn-wa-conectar');
        const btnDesconectar = document.getElementById('btn-wa-desconectar');
        const qrContainer = document.getElementById('wa-qr-container');
        const qrImg = document.getElementById('wa-qr-img');
        const testeBox = document.getElementById('wa-teste-box');
        const errBox = document.getElementById('wa-error-box');

        if (!statusText) return;

        const st = data?.status || 'disconnected';
        if (errBox) {
            if (data?.lastError) {
                errBox.textContent = data.lastError;
                errBox.style.display = 'block';
            } else {
                errBox.style.display = 'none';
            }
        }

        if (st === 'connected') {
            statusText.textContent = 'Conectado e pronto para envios';
            statusText.style.color = '#22c55e';
            if (phoneText) phoneText.textContent = data.connectedPhone ? `Número: +${data.connectedPhone}` : '';
            if (btnConectar) btnConectar.style.display = 'none';
            if (btnDesconectar) btnDesconectar.style.display = 'inline-flex';
            if (qrContainer) qrContainer.style.display = 'none';
            if (testeBox) testeBox.style.display = 'block';
        } else if (st === 'qr') {
            statusText.textContent = 'Aguardando leitura do QR Code';
            statusText.style.color = '#f59e0b';
            if (phoneText) phoneText.textContent = '';
            if (btnConectar) btnConectar.style.display = 'none';
            if (btnDesconectar) btnDesconectar.style.display = 'inline-flex';
            if (qrContainer && qrImg && data.qrCodeDataUrl) {
                qrImg.src = data.qrCodeDataUrl;
                qrContainer.style.display = 'block';
            }
            if (testeBox) testeBox.style.display = 'none';
        } else if (st === 'connecting') {
            statusText.textContent = data?.hasSavedSession ? 'Reconectando sessão salva...' : 'Iniciando conexão...';
            statusText.style.color = '#38bdf8';
            if (phoneText) phoneText.textContent = '';
            if (btnConectar) btnConectar.style.display = 'none';
            if (btnDesconectar) btnDesconectar.style.display = 'inline-flex';
            if (qrContainer) qrContainer.style.display = 'none';
            if (testeBox) testeBox.style.display = 'none';
        } else {
            statusText.textContent = 'Desconectado';
            statusText.style.color = '#94a3b8';
            if (phoneText) phoneText.textContent = '';
            if (btnConectar) btnConectar.style.display = 'inline-flex';
            if (btnDesconectar) btnDesconectar.style.display = 'none';
            if (qrContainer) qrContainer.style.display = 'none';
            if (testeBox) testeBox.style.display = 'none';
        }
    },

    async refreshWhatsAppStatus() {
        try {
            const res = await API.get('/whatsapp/status');
            if (res?.success) {
                this.renderWhatsAppStatus(res.data);
            }
        } catch (err) {
            const errBox = document.getElementById('wa-error-box');
            if (errBox) {
                errBox.textContent = err.message || 'Apenas administradores podem configurar o WhatsApp.';
                errBox.style.display = 'block';
            }
        }
    },

    async conectarWhatsApp() {
        const btn = document.getElementById('btn-wa-conectar');
        if (btn) btn.disabled = true;
        try {
            const res = await API.post('/whatsapp/conectar', {});
            if (res?.success) {
                this.renderWhatsAppStatus(res.data);
            }
        } catch (err) {
            UI.showToast(err.message || 'Erro ao conectar WhatsApp.', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    async desconectarWhatsApp() {
        if (!confirm('Deseja desconectar o WhatsApp do sistema?')) return;
        try {
            const res = await API.post('/whatsapp/desconectar', {});
            if (res?.success) {
                this.renderWhatsAppStatus(res.data);
                UI.showToast('WhatsApp desconectado com sucesso.', 'info');
            }
        } catch (err) {
            UI.showToast(err.message || 'Erro ao desconectar WhatsApp.', 'error');
        }
    },

    async enviarTesteWhatsApp() {
        const telefone = document.getElementById('wa-teste-telefone')?.value?.trim() || '';
        const mensagem = document.getElementById('wa-teste-mensagem')?.value?.trim() || '';
        const btn = document.getElementById('btn-wa-enviar-teste');

        if (!telefone) {
            UI.showToast('Informe um número de WhatsApp com DDD para teste.', 'warning');
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Enviando...';
        }

        try {
            const res = await API.post('/whatsapp/teste', { telefone, mensagem });
            if (!res?.success) throw new Error(res?.error || 'Falha ao enviar teste.');
            UI.showToast(res.message || 'Mensagem de teste enviada!', 'success');
        } catch (err) {
            UI.showToast(err.message || 'Erro ao enviar mensagem de teste.', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Enviar Mensagem de Teste';
            }
        }
    },

    openAlunoPhotoZoom(alunoId) {
        const aluno = (this.alunosList || []).find(a => Number(a.id) === Number(alunoId));
        if (!aluno) return;

        const formattedNome = this.formatNomeDisplay(aluno.nome_completo) || 'Aluno';
        const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(formattedNome)}&background=0284c7&color=fff&size=512`;
        const fotoSegura = UI.getSafeImageUrl(aluno.foto_perfil_url, '');

        UI.openPhotoLightbox(fotoSegura || fallbackAvatar, formattedNome, {
            isFallback: !fotoSegura,
            fallbackUrl: fallbackAvatar
        });
    }
};

window.AlunosModule = AlunosModule;
