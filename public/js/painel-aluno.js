/**
 * PRO COMBATE - Script do Painel do Aluno
 * Consumo de dados dinâmicos, cálculo de IMC, gráfico de atividade,
 * avatar do lutador, conquistas, avisos e campanhas
 */

const PainelAlunoApp = {
    alunoData: null,
    authToken: null,
    curriculoGolpes: [],
    faixasProgresso: [],
    faixaAtual: null,
    faixasAnteriores: [],
    filtroFaixa: 'atual',
    categoriaFiltroCurriculo: 'todos',
    currentTecnicaVisualizacao: null,
    currentPassoIndex: 0,
    currentView: 'dashboard',
    historicoFinanceiro: null,
    faturasFiltroAtivo: 'todos',
    wikiSpaFiltroFaixa: 'atual',
    wikiSpaFiltroCategoria: 'todos',
    wikiSpaBusca: '',
    meusExames: [],
    modalExameAtivoId: null,

    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    sanitizeUrl(url) {
        if (!url) return '';
        const clean = String(url).trim();
        if (/^(https?:\/\/|\/)/i.test(clean) && !clean.toLowerCase().includes('javascript:')) {
            return clean;
        }
        return '';
    },

    sanitizeColor(color, fallback = '#94a3b8') {
        if (!color) return fallback;
        const clean = String(color).trim();
        if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(clean)) return clean;
        return fallback;
    },

    getAuthToken() {
        return this.authToken || localStorage.getItem('auth_token') || localStorage.getItem('kaizen_token') || localStorage.getItem('token') || null;
    },

    updateHairElement(element, cabeloFile, modeloFile) {
        if (!element) return;
        element.src = `/assets/avatar/${cabeloFile}`;
        element.setAttribute('data-hair', cabeloFile);
        if (modeloFile) element.setAttribute('data-model', modeloFile);
        const hairClass = cabeloFile ? cabeloFile.replace('.png', '') : '';
        element.className = `avatar-layer avatar-layer-hair ${hairClass}`;
        // Limpa quaisquer estilos inline para que as regras do painel-aluno.css tenham controle total
        element.style.top = '';
        element.style.width = '';
        element.style.removeProperty('--hair-top');
        element.style.removeProperty('--hair-width');
    },

    init() {
        this.authToken = localStorage.getItem('auth_token') || localStorage.getItem('kaizen_token');
        this.bindEvents();
        this.initPwaInstall();
        this.loadDashboardData();
    },

    initPwaInstall() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js?v=7').catch(() => {});
        }

        const banners = Array.from(document.querySelectorAll('[data-pwa-banner]'));
        const triggers = Array.from(document.querySelectorAll('.pwa-install-trigger'));
        const closeButtons = Array.from(document.querySelectorAll('[data-close-pwa-banner]'));

        const setBannersHidden = (hidden) => {
            banners.forEach(b => b.classList.toggle('is-hidden', hidden));
        };
        const setTriggersHidden = (hidden) => {
            triggers.forEach(btn => {
                btn.style.display = hidden ? 'none' : '';
            });
        };

        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
        if (isStandalone) {
            setBannersHidden(true);
            setTriggersHidden(true);
            return;
        }

        setTriggersHidden(false);
        if (sessionStorage.getItem('pwa_banner_closed') === '1') {
            setBannersHidden(true);
        } else {
            setBannersHidden(false);
        }

        const handlePromptReady = () => {
            if (!isStandalone && sessionStorage.getItem('pwa_banner_closed') !== '1') {
                setBannersHidden(false);
            }
            setTriggersHidden(false);
        };

        window.addEventListener('pwa-prompt-ready', handlePromptReady);
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            window.__deferredPwaPrompt = e;
            handlePromptReady();
        });

        window.addEventListener('appinstalled', () => {
            window.__deferredPwaPrompt = null;
            setBannersHidden(true);
            setTriggersHidden(true);
            this.showToast('Aplicativo PRO COMBATE instalado com sucesso!', 'success');
        });

        closeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                sessionStorage.setItem('pwa_banner_closed', '1');
                setBannersHidden(true);
            });
        });

        triggers.forEach(btn => {
            btn.addEventListener('click', async () => {
                const promptEvent = window.__deferredPwaPrompt;
                if (promptEvent) {
                    promptEvent.prompt();
                    try {
                        const choice = await promptEvent.userChoice;
                        if (choice && choice.outcome === 'accepted') {
                            setBannersHidden(true);
                            setTriggersHidden(true);
                        }
                    } catch { /* ignore */ }
                    window.__deferredPwaPrompt = null;
                } else {
                    const modalInstall = document.getElementById('modal-ios-install');
                    if (modalInstall) modalInstall.style.display = 'flex';
                }
            });
        });
    },

    bindEvents() {
        // Logout
        document.getElementById('btn-logout')?.addEventListener('click', () => this.handleLogout());

        // Modais: Abertura e Fechamento
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                const modalId = btn.dataset.close;
                const modal = document.getElementById(modalId);
                if (modal) modal.style.display = 'none';
            });
        });

        // Fechar modal ao clicar no backdrop (bloqueado para modais com data-static-backdrop)
        document.querySelectorAll('.modal-backdrop').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    if (modal.dataset.staticBackdrop === 'true' || modal.id === 'modal-convocacao-exame') {
                        return; // O pop-up só sai se marcar expressamente a confirmação!
                    }
                    modal.style.display = 'none';
                }
            });
        });

        // Eventos do Modal de Convocação & Ciência Obrigatória do Exame
        const checkConvocacao = document.getElementById('check-convocacao-ciente');
        const btnConvocacaoCiente = document.getElementById('btn-convocacao-ciente');
        const btnConvocacaoInscrever = document.getElementById('btn-convocacao-inscrever');
        const lockMsg = document.getElementById('convocacao-lock-msg');

        checkConvocacao?.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            if (btnConvocacaoCiente) btnConvocacaoCiente.disabled = !isChecked;
            if (btnConvocacaoInscrever) btnConvocacaoInscrever.disabled = !isChecked;
            if (lockMsg) lockMsg.style.display = isChecked ? 'none' : 'flex';
        });

        btnConvocacaoCiente?.addEventListener('click', () => {
            if (!checkConvocacao || !checkConvocacao.checked) {
                alert('Você precisa marcar a caixa de ciência para continuar.');
                return;
            }
            this.confirmarCienciaExame();
        });

        btnConvocacaoInscrever?.addEventListener('click', () => {
            if (!checkConvocacao || !checkConvocacao.checked) {
                alert('Você precisa marcar a caixa de ciência para continuar.');
                return;
            }
            this.confirmarCienciaExame();
            this.abrirFluxoInscricaoExame();
        });

        document.getElementById('btn-inscrever-exame')?.addEventListener('click', () => {
            this.abrirFluxoInscricaoExame();
        });

        document.getElementById('btn-convocacao-nao-posso')?.addEventListener('click', () => {
            const conviteId = this.alunoData?.exame_proximo?.convite_id || null;
            this.recusarConviteExame(conviteId);
        });

        // Abrir modal de edição de medidas
        document.getElementById('btn-modal-medidas')?.addEventListener('click', () => {
            this.openMedidasModal();
        });

        // Salvar medidas
        document.getElementById('form-edit-medidas')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveMedidas();
        });

        // Abrir página de histórico e comparativo de evolução
        document.getElementById('btn-open-evolution')?.addEventListener('click', () => {
            this.switchView('evolucao');
        });
        document.getElementById('btn-add-eval-from-modal')?.addEventListener('click', () => {
            this.openMedidasModal();
        });
        ['box-meas-torax', 'box-meas-cintura', 'box-meas-quadril'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', () => {
                this.switchView('evolucao');
            });
        });

        // Popup de aviso de mensalidade em atraso
        document.getElementById('btn-popup-atraso-pagar')?.addEventListener('click', () => {
            const popup = document.getElementById('modal-aviso-atraso');
            if (popup) popup.style.display = 'none';
            this.switchView('faturas');
            const fatAberta = this.alunoData?.plano?.fatura_aberta;
            if (fatAberta && fatAberta.id) {
                this.openModalPagamentoMensalidade(fatAberta.id);
            }
        });
        document.getElementById('btn-popup-atraso-depois')?.addEventListener('click', () => {
            const popup = document.getElementById('modal-aviso-atraso');
            if (popup) popup.style.display = 'none';
        });

        // Edição de telefone/WhatsApp na conta do aluno
        document.getElementById('btn-editar-telefone')?.addEventListener('click', () => {
            const wrap = document.getElementById('conta-telefone-edit-wrap');
            const input = document.getElementById('input-conta-telefone');
            if (wrap) wrap.style.display = 'flex';
            if (input) {
                input.value = this.alunoData?.aluno?.telefone || '';
                input.focus();
            }
        });
        document.getElementById('btn-cancelar-telefone')?.addEventListener('click', () => {
            const wrap = document.getElementById('conta-telefone-edit-wrap');
            if (wrap) wrap.style.display = 'none';
        });
        document.getElementById('input-conta-telefone')?.addEventListener('input', (e) => {
            let v = e.target.value.replace(/\D/g, '').slice(0, 11);
            if (v.length > 6) {
                v = v.length === 11
                    ? `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`
                    : `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
            } else if (v.length > 2) {
                v = `(${v.slice(0, 2)}) ${v.slice(2)}`;
            }
            e.target.value = v;
        });
        document.getElementById('btn-salvar-telefone')?.addEventListener('click', () => {
            this.saveTelefoneAluno();
        });

        // Alternar métricas no gráfico de evolução de medidas
        document.getElementById('evolution-metric-pills')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.metric-pill');
            if (!btn) return;
            const metric = btn.dataset.metric;
            if (metric) {
                this.currentEvolutionMetric = metric;
                this.renderEvolutionChart(this.evolutionHistoryData || [], metric);
            }
        });

        // Abrir modal de personalização do avatar / skins
        document.getElementById('btn-select-skin')?.addEventListener('click', () => {
            this.openSkinsModal();
        });
        document.getElementById('fighter-avatar-img')?.addEventListener('click', () => {
            this.openSkinsModal();
        });
        document.getElementById('fighter-avatar-container')?.addEventListener('click', () => {
            this.openSkinsModal();
        });
        document.getElementById('avatar-body-img')?.addEventListener('click', () => {
            this.openSkinsModal();
        });
        document.getElementById('btn-save-avatar')?.addEventListener('click', () => {
            this.saveAvatarCustomization();
        });
        document.getElementById('body-shape-badge')?.addEventListener('click', () => {
            this.openSkinsModal();
        });

        // Abrir modal de avisos
        document.getElementById('btn-open-notices')?.addEventListener('click', () => {
            this.openAvisosModal();
        });
        document.getElementById('btn-view-all-notices')?.addEventListener('click', () => {
            this.openAvisosModal();
        });

        // Controles de Navegação Exclusivos Mobile (Top Header & Bottom Dock)
        document.getElementById('mobile-btn-notices')?.addEventListener('click', () => {
            this.openAvisosModal();
        });
        // 1. Ajustes de Avaliação Física no header mobile
        document.getElementById('mobile-btn-avaliacao')?.addEventListener('click', () => {
            this.openMedidasModal();
        });
        // 2. Ajustes da Conta no header mobile
        document.getElementById('mobile-btn-account')?.addEventListener('click', () => {
            this.openAccountModal();
        });
        // Botão de Ajuste de Skill no Canto Superior Esquerdo do Card do Avatar
        document.getElementById('btn-adjust-skin-topleft')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openSkinsModal();
        });
        // Card de perfil do atleta no header desktop
        document.getElementById('btn-edit-student-profile')?.addEventListener('click', () => {
            this.openAccountModal();
        });
        // Botão de logout no modal de conta
        document.getElementById('btn-conta-logout')?.addEventListener('click', () => {
            this.handleLogout();
        });
        // Alteração de foto de perfil no card e no modal de conta
        document.getElementById('btn-card-change-photo')?.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('input-painel-foto-galeria')?.click();
        });
        document.getElementById('input-painel-foto-camera')?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) this.uploadNovaFotoPerfil(file);
            e.target.value = '';
        });
        document.getElementById('input-painel-foto-galeria')?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) this.uploadNovaFotoPerfil(file);
            e.target.value = '';
        });

        document.getElementById('mob-nav-inicio')?.addEventListener('click', () => {
            this.switchView('dashboard');
        });
        document.getElementById('mob-nav-treinos')?.addEventListener('click', () => {
            this.switchView('wiki');
        });
        document.getElementById('mob-nav-evolucao')?.addEventListener('click', () => {
            this.openEvolutionModal();
        });
        document.getElementById('mob-nav-faturas')?.addEventListener('click', () => {
            this.switchView('faturas');
        });
        document.getElementById('mob-nav-graduacoes')?.addEventListener('click', () => {
            this.switchView('graduacoes');
        });
        document.getElementById('mob-nav-perfil')?.addEventListener('click', () => {
            this.openSkinsModal();
        });

        // Abertura da Área de Pagamento da Mensalidade (Asaas) e Faturas
        document.getElementById('btn-toggle-eval-details')?.addEventListener('click', () => {
            const drawer = document.getElementById('athlete-eval-drawer');
            const btn = document.getElementById('btn-toggle-eval-details');
            if (!drawer || !btn) return;
            const isHidden = drawer.style.display === 'none' || !drawer.style.display;
            drawer.style.display = isHidden ? 'grid' : 'none';
            btn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
            const span = btn.querySelector('span');
            if (span) span.textContent = isHidden ? 'Ocultar Notas ↑' : 'Notas Técnicas ↓';
        });

        document.getElementById('btn-open-plan-payment')?.addEventListener('click', () => {
            this.openModalPagamentoMensalidade();
        });
        document.getElementById('card-plan-status-badge')?.addEventListener('click', () => {
            this.switchView('faturas');
        });
        document.getElementById('modal-conta-btn-pagar')?.addEventListener('click', () => {
            const mc = document.getElementById('modal-conta');
            if (mc) mc.style.display = 'none';
            this.switchView('faturas');
        });

        // Preserva query param nos links da Wiki separada
        const urlParams = new URLSearchParams(window.location.search);
        const queryAlunoId = urlParams.get('aluno_id');
        if (queryAlunoId) {
            const linkWiki = document.getElementById('link-abrir-wiki-separada');
            const dockWiki = document.getElementById('dock-btn-wiki-link');
            if (linkWiki) linkWiki.href = `/wiki-aluno.html?aluno_id=${encodeURIComponent(queryAlunoId)}`;
            if (dockWiki) dockWiki.href = `/wiki-aluno.html?aluno_id=${encodeURIComponent(queryAlunoId)}`;
        }

        // Abas do Dock com alternância dinâmica SPA (Visão Geral, Wiki e Faturas)
        document.querySelectorAll('.dock-btn[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                if (tab === 'tecnicas') {
                    this.switchView('wiki');
                } else if (tab === 'faturas') {
                    this.switchView('faturas');
                } else if (tab === 'graduacoes') {
                    this.switchView('graduacoes');
                } else if (tab === 'visao-geral') {
                    this.switchView('dashboard');
                    this.scrollToSection('.content-header');
                }
            });
        });

        // Filtros da Área de Faturas
        document.querySelectorAll('#faturas-filter-tabs .faturas-tab-btn[data-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#faturas-filter-tabs .faturas-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.faturasFiltroAtivo = btn.dataset.filter || 'todos';
                this.renderFaturasView();
            });
        });

        // Filtros de Categoria da Wiki SPA
        document.querySelectorAll('#wiki-spa-category-pills .curriculum-pill[data-category]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#wiki-spa-category-pills .curriculum-pill[data-category]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.wikiSpaFiltroCategoria = btn.dataset.category || 'todos';
                this.renderWikiSpaGrid();
            });
        });

        // Campo de Busca em Tempo Real da Wiki SPA
        const wikiSearchInput = document.getElementById('wiki-spa-search-input');
        if (wikiSearchInput) {
            let debounceTimer = null;
            wikiSearchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    this.wikiSpaBusca = (e.target.value || '').trim().toLowerCase();
                    this.renderWikiSpaGrid();
                }, 150);
            });
        }

        // Suporte a histórico e navegação por hash (#wiki vs #dashboard vs #faturas vs #graduacoes vs #evolucao)
        window.addEventListener('popstate', () => {
            if (window.location.hash === '#faturas') {
                this.switchView('faturas', false);
            } else if (window.location.hash === '#graduacoes') {
                this.switchView('graduacoes', false);
            } else if (window.location.hash === '#evolucao') {
                this.switchView('evolucao', false);
            } else if (window.location.hash === '#wiki') {
                this.switchView('wiki', false);
            } else {
                this.switchView('dashboard', false);
            }
        });

        if (window.location.hash === '#faturas') {
            this.switchView('faturas', false);
        } else if (window.location.hash === '#graduacoes') {
            this.switchView('graduacoes', false);
        } else if (window.location.hash === '#evolucao') {
            this.switchView('evolucao', false);
        } else if (window.location.hash === '#wiki') {
            this.switchView('wiki', false);
        }

        // Controles de Navegação do Visualizador de Técnica
        document.getElementById('btn-tecnica-anterior')?.addEventListener('click', () => {
            this.passoAnterior();
        });
        document.getElementById('btn-tecnica-proximo')?.addEventListener('click', () => {
            this.passoProximo();
        });

        // Suporte a Teclado (Setas Esquerda e Direita)
        window.addEventListener('keydown', (e) => {
            const modalTec = document.getElementById('modal-visualizar-tecnica');
            if (modalTec && modalTec.style.display !== 'none') {
                if (e.key === 'ArrowLeft') this.passoAnterior();
                else if (e.key === 'ArrowRight') this.passoProximo();
                else if (e.key === 'Escape') modalTec.style.display = 'none';
            }
        });
    },

    scrollToSection(selector) {
        const el = document.querySelector(selector);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    handleLogout() {
        if (confirm('Deseja realmente sair da sua conta?')) {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user');
            window.location.href = '/login';
        }
    },

    async loadDashboardData() {
        try {
            // Suporta query string ?aluno_id=X para visualização/testes
            const urlParams = new URLSearchParams(window.location.search);
            const queryAlunoId = urlParams.get('aluno_id');

            let endpoint = '/api/aluno/meu-painel';
            if (queryAlunoId) {
                endpoint += `?aluno_id=${encodeURIComponent(queryAlunoId)}`;
            }

            const headers = {};
            if (this.authToken && this.authToken !== 'null' && this.authToken !== 'undefined') {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            let res = await fetch(endpoint, { headers });

            // Se for 401/403 e tiver token salvo que expirou, limpa e tenta novamente
            if ((res.status === 401 || res.status === 403) && this.authToken) {
                console.warn('Token expirado ou inválido. Limpando sessão local...');
                localStorage.removeItem('auth_token');
                this.authToken = null;
                res = await fetch(endpoint);
            }

            // Se ainda assim for 401/403 sem dados e sem query param, redireciona ao login
            if ((res.status === 401 || res.status === 403) && !queryAlunoId) {
                window.location.href = '/login';
                return;
            }

            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Erro ao carregar dados do painel.');
            }

            this.alunoData = data;
            this.renderDashboard(data);
            if (this.currentView === 'graduacoes') {
                this.renderGraduacoesView();
            } else if (this.currentView === 'wiki') {
                this.renderWikiSpaView();
            }
            await this.loadMeusExames();

        } catch (err) {
            console.error('Falha ao carregar painel:', err);
        }
    },

    renderDashboard(data) {
        const { aluno, plano, frequencia, graduacao, avisos_campanhas, conquistas } = data;

        // 1. Cabeçalho
        const welcomeTitle = document.getElementById('student-welcome-title');
        const headerName = document.getElementById('header-student-name');
        const headerAvatar = document.getElementById('header-avatar-img');
        const currentDate = document.getElementById('current-formatted-date');
        const headerAthleteTitle = document.getElementById('header-athlete-title');
        const bodyAthleteTitle = document.getElementById('body-athlete-title-badge');

        const tituloAtivo = aluno.titulo_ativo || 'Iniciante Focado';
        if (welcomeTitle) welcomeTitle.textContent = `Olá, ${aluno.primeiro_nome}!`;
        if (headerName) headerName.textContent = aluno.primeiro_nome;
        const mobileStudentName = document.getElementById('mobile-student-name');
        if (mobileStudentName) mobileStudentName.textContent = aluno.primeiro_nome;
        this.applyProfilePhotoUrl(aluno.foto_perfil_url, aluno.nome_completo || aluno.primeiro_nome);
        if (headerAthleteTitle) headerAthleteTitle.textContent = tituloAtivo;
        if (bodyAthleteTitle) bodyAthleteTitle.textContent = tituloAtivo;

        if (currentDate) {
            const now = new Date();
            const dateStr = now.toLocaleDateString('pt-BR', {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
                year: 'numeric'
            });
            currentDate.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
        }

        // 2. Três Cards de Indicadores do Topo
        // Card 1: Frequência
        const presencasNum = document.getElementById('stat-presencas-num');
        const presencasPill = document.getElementById('stat-presencas-pill');
        if (presencasNum) presencasNum.textContent = frequencia.total_mes;
        if (presencasPill) {
            if (frequencia.total_mes >= 16) {
                presencasPill.textContent = 'Frequência Alta';
            } else if (frequencia.total_mes >= 8) {
                presencasPill.textContent = 'Frequência Regular';
            } else {
                presencasPill.textContent = 'Abaixo da Meta';
            }
        }

        // Card 2: Plano
        const planoNome = document.getElementById('stat-plano-nome');
        const planoStatus = document.getElementById('stat-plano-status');
        if (planoNome) planoNome.textContent = plano ? plano.nome : 'Sem Plano Ativo';
        if (planoStatus) {
            if (plano && plano.dias_restantes > 0) {
                planoStatus.textContent = `Ativo • ${plano.dias_restantes} dias`;
                planoStatus.className = 'stat-pill pill-cyan';
            } else if (plano) {
                planoStatus.textContent = 'Vence hoje';
                planoStatus.className = 'stat-pill pill-amber';
            } else {
                planoStatus.textContent = 'Sem matrícula';
                planoStatus.className = 'stat-pill pill-slate';
            }
        }

        // Card 3: Graduação Atual
        const gradNome = document.getElementById('stat-graduacao-nome');
        const gradStatus = document.getElementById('stat-graduacao-status');
        if (gradNome) {
            gradNome.textContent = (graduacao && graduacao.atual) ? graduacao.atual.nivel_nome : 'Iniciante';
        }
        if (gradStatus) {
            if (graduacao?.atual && graduacao?.avaliacao && graduacao?.avaliacao?.apto) {
                gradStatus.textContent = `Apto p/ Exame (${graduacao.avaliacao.percentual_obtido}%)`;
                gradStatus.className = 'stat-pill pill-cyan';
            } else if (graduacao?.atual && graduacao?.avaliacao) {
                gradStatus.textContent = `Em Evolução (${graduacao.avaliacao.percentual_obtido}%)`;
                gradStatus.className = 'stat-pill pill-amber';
            } else if (graduacao?.atual) {
                gradStatus.textContent = 'Aguardando Avaliação';
                gradStatus.className = 'stat-pill pill-slate';
            } else {
                gradStatus.textContent = 'Sem graduação';
                gradStatus.className = 'stat-pill pill-slate';
            }
        }

        // 2.1. Fogo de Frequência & Régua dos 7 Dias (Streak Semanal)
        this.renderStreak(frequencia.streak);

        // 2.2. Barra de Prontidão para o Exame de Faixa (Gamificação da Wiki)
        this.renderReadinessCard(data.prontidao_exame);

        // 3. Gráfico de Atividade (Activity Growth)
        this.renderActivityChart(frequencia.activity_growth);

        // 3.1. Currículo Técnico & Golpes da Faixa Atual
        this.renderCurriculoTecnico(data.graduacao);

        // 4. Card Inferior: Avisos / Próximo Compromisso (Upcoming)
        if (avisos_campanhas && avisos_campanhas.length > 0) {
            const firstAviso = avisos_campanhas[0];
            const upcomingTitle = document.getElementById('upcoming-title');
            const upcomingDesc = document.getElementById('upcoming-desc');
            const upcomingDate = document.getElementById('upcoming-date-badge');

            if (upcomingTitle) upcomingTitle.textContent = firstAviso.titulo;
            if (upcomingDesc) upcomingDesc.textContent = firstAviso.descricao;
            if (upcomingDate) {
                if (firstAviso.data_evento) {
                    const d = new Date(firstAviso.data_evento);
                    upcomingDate.textContent = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
                } else {
                    upcomingDate.textContent = firstAviso.tag_destaque || 'Destaque';
                }
            }
        }
        this.updateNoticesBadgeState();

        // 5. Card Residencial do Atleta: Cabeçalho, Avatar, Métricas Corporais & Status
        const cardAthleteName = document.getElementById('card-athlete-name');
        const cardHeaderAvatar = document.getElementById('card-header-avatar-img');
        const cardDegreeBadge = document.getElementById('card-athlete-degree-badge');
        const cardPrajiedName = document.getElementById('card-prajied-name');
        const cardPrajiedDot = document.getElementById('card-prajied-dot');
        const athleteAvatarRing = document.getElementById('athlete-avatar-ring');

        if (cardAthleteName) cardAthleteName.textContent = aluno.nome_completo || aluno.primeiro_nome;

        const gradMt = (graduacao && (graduacao.muay_thai || graduacao.atual)) || null;
        if (gradMt) {
            if (cardPrajiedName) cardPrajiedName.textContent = gradMt.nivel_nome || 'Prajied Atual';
            const c1 = gradMt.cor_primaria || '#f59e0b';
            const c2 = gradMt.cor_secundaria || c1;
            if (cardPrajiedDot) {
                cardPrajiedDot.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
            }
            if (athleteAvatarRing) {
                athleteAvatarRing.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
            }
            if (cardDegreeBadge) {
                cardDegreeBadge.style.display = 'inline-block';
                const grauNum = gradMt.ordem_hierarquica || 1;
                cardDegreeBadge.textContent = `${grauNum}º G`;
            }
        } else {
            if (cardPrajiedName) cardPrajiedName.textContent = 'Iniciante (Sem graduação)';
            if (cardPrajiedDot) cardPrajiedDot.style.background = '#64748b';
            if (athleteAvatarRing) athleteAvatarRing.style.background = 'rgba(255, 255, 255, 0.1)';
            if (cardDegreeBadge) cardDegreeBadge.style.display = 'none';
        }

        // 5.1. Situação Financeira: removida da tela principal; exibe popup se houver mensalidade em atraso
        if (plano?.has_atraso) {
            this.maybeShowOverduePopup(plano);
        }

        // Métricas Corporais e Régua
        const heightVal = document.getElementById('ruler-height-val');
        const weightVal = document.getElementById('ruler-weight-val');
        const bmiNum = document.getElementById('bmi-number');
        const bmiPill = document.getElementById('bmi-status-pill');
        const bmiThumb = document.getElementById('bmi-slider-thumb');

        const pesoVal = aluno.medidas?.peso_kg;
        const alturaVal = aluno.medidas?.altura_cm;
        const imcVal = aluno.medidas?.imc;

        if (heightVal) heightVal.textContent = (alturaVal !== null && alturaVal !== undefined) ? alturaVal : '--';
        if (weightVal) weightVal.textContent = (pesoVal !== null && pesoVal !== undefined) ? pesoVal : '--';
        if (bmiNum) bmiNum.textContent = (imcVal !== null && imcVal !== undefined) ? imcVal : '--';
        if (bmiPill) {
            bmiPill.textContent = aluno.medidas?.imc_classificacao || 'Não aferido';
            bmiPill.style.color = aluno.medidas?.imc_cor || '#94a3b8';
        }

        // Posiciona o thumb na barra de gradiente de 15 a 40 (se existir)
        if (bmiThumb) {
            if (imcVal !== null && imcVal !== undefined) {
                const clampedImc = Math.max(15, Math.min(40, imcVal));
                const pct = ((clampedImc - 15) / 25) * 100;
                bmiThumb.style.left = `${pct}%`;
            } else {
                bmiThumb.style.left = '0%';
            }
        }

        // Subtítulo de checagem e Shape Badge
        const lastCheckEl = document.getElementById('measurements-last-check');
        const shapeBadgeEl = document.getElementById('body-shape-badge');
        if (lastCheckEl) {
            if (aluno.medidas?.dias_ultima_checagem && aluno.medidas.dias_ultima_checagem !== 'Sem aferição') {
                lastCheckEl.textContent = `Última checagem: ${aluno.medidas.dias_ultima_checagem.toLowerCase()}`;
            } else {
                lastCheckEl.textContent = 'Sem aferição recente';
            }
        }
        if (shapeBadgeEl) {
            shapeBadgeEl.textContent = aluno.medidas?.shape_name || 'Aguardando Avaliação';
        }

        // Medidas Corporais e Deltas Comparativos
        const deltas = aluno.medidas?.deltas || {
            peso: { delta: 0, arrow: 'equal' },
            torax: { delta: 0, arrow: 'equal' },
            cintura: { delta: 0, arrow: 'equal' },
            quadril: { delta: 0, arrow: 'equal' }
        };

        // Variação de Peso (Delta) e Envergadura estimada
        const deltaPesoSub = document.getElementById('delta-peso-sub');
        const deltaPesoArrow = document.getElementById('delta-peso-arrow');
        const deltaPesoVal = document.getElementById('delta-peso-val');
        const wingspanSub = document.getElementById('athlete-wingspan-sub');

        if (deltaPesoSub) {
            const d = deltas.peso ? deltas.peso.delta : 0;
            if (d && d !== 0) {
                deltaPesoSub.style.display = 'inline-flex';
                if (deltaPesoArrow) deltaPesoArrow.textContent = d > 0 ? '↑' : '↓';
                if (deltaPesoVal) deltaPesoVal.textContent = `${d > 0 ? '+' : ''}${d}kg mês`;
                deltaPesoSub.className = `chip-delta-sub ${d < 0 ? 'text-emerald-400' : 'text-amber-400'}`;
            } else {
                deltaPesoSub.style.display = 'none';
            }
        }

        if (wingspanSub) {
            if (alturaVal) {
                const envergadura = aluno.medidas?.envergadura_cm || Math.round(alturaVal * 1.02);
                wingspanSub.textContent = `Envergadura: ${envergadura}cm`;
            } else {
                wingspanSub.textContent = 'Envergadura: --';
            }
        }

        // Linha de Medidas Corporais no Modal de Evolução (Tórax, Cintura, Quadril)
        const measTorax = document.getElementById('meas-torax-val');
        const measCintura = document.getElementById('meas-cintura-val');
        const measQuadril = document.getElementById('meas-quadril-val');

        if (measTorax) measTorax.textContent = (aluno.medidas?.torax_cm !== null && aluno.medidas?.torax_cm !== undefined) ? aluno.medidas.torax_cm : '--';
        if (measCintura) measCintura.textContent = (aluno.medidas?.cintura_cm !== null && aluno.medidas?.cintura_cm !== undefined) ? aluno.medidas.cintura_cm : '--';
        if (measQuadril) measQuadril.textContent = (aluno.medidas?.quadril_cm !== null && aluno.medidas?.quadril_cm !== undefined) ? aluno.medidas.quadril_cm : '--';

        const circumDate = document.getElementById('modal-circumferences-date');
        if (circumDate) {
            circumDate.textContent = (aluno.medidas?.dias_ultima_checagem && aluno.medidas.dias_ultima_checagem !== 'Sem aferição')
                ? `Aferição: ${aluno.medidas.dias_ultima_checagem}`
                : 'Sem aferição registrada';
        }

        // Notas Técnicas do Professor (Clinch, Socos, Chutes, Postura) no Flanco Direito
        const notas = data.notas_tecnicas || (aluno && aluno.notas_tecnicas) || {};
        const setEvalScore = (numId, barId, val) => {
            const numEl = document.getElementById(numId);
            const barEl = document.getElementById(barId);
            if (val !== null && val !== undefined && !isNaN(val)) {
                const n = Number(val);
                if (numEl) numEl.textContent = n.toFixed(1);
                if (barEl) barEl.style.width = `${Math.min(100, Math.max(0, (n / 10) * 100))}%`;
            } else {
                if (numEl) numEl.textContent = '--';
                if (barEl) barEl.style.width = '0%';
            }
        };

        setEvalScore('eval-score-clinch', 'eval-bar-clinch', notas.clinch);
        setEvalScore('eval-score-socos', 'eval-bar-socos', notas.socos);
        setEvalScore('eval-score-chutes', 'eval-bar-chutes', notas.chutes);
        setEvalScore('eval-score-postura', 'eval-bar-postura', notas.postura);

        // Atualização dos tags de variação (Deltas) - oculta se delta for 0 para não exibir "=0"
        const updateDeltaTag = (tagId, arrowId, numId, metric) => {
            const tag = document.getElementById(tagId);
            const arrow = document.getElementById(arrowId);
            const num = document.getElementById(numId);
            if (!tag) return;

            const d = metric ? metric.delta : 0;
            // Se delta for 0, nulo, igual ou inexistente, oculta o badge para não poluir com "=0"
            if (!d || d === 0 || isNaN(d)) {
                tag.style.display = 'none';
                return;
            }

            tag.style.display = 'inline-flex';
            if (arrow) {
                arrow.textContent = d > 0 ? '↑' : '↓';
                arrow.className = `meas-arrow arrow-${metric.arrow || (d > 0 ? 'up' : 'down')}`;
            }
            if (num) {
                num.textContent = `${d > 0 ? '+' : ''}${d}`;
            }
            tag.className = `meas-delta-inline delta-tag-${metric.arrow || (d > 0 ? 'up' : 'down')}`;
        };

        updateDeltaTag('delta-torax-tag', 'arrow-torax', 'delta-torax-num', deltas.torax);
        updateDeltaTag('delta-cintura-tag', 'arrow-cintura', 'delta-cintura-num', deltas.cintura);
        updateDeltaTag('delta-quadril-tag', 'arrow-quadril', 'delta-quadril-num', deltas.quadril);

        // Avatar do Atleta Multicamadas (Corpo Base + Cabelo Superior + Prajied)
        const avatarBody = document.getElementById('avatar-body-img');
        const avatarHair = document.getElementById('avatar-hair-img');

        const isF = String(aluno.genero || '').toUpperCase() === 'F';
        const tom = aluno.avatar_tom || 'branca';
        const modeloFile = isF 
            ? (tom === 'negra' ? 'mulher-negra.png' : 'mulher-branca.png')
            : (tom === 'negra' ? 'homem-negro.png' : 'homem-branco.png');
        const cabeloFile = aluno.avatar_cabelo || (isF ? 'cabelo-mulher-1.png' : 'cabelo-homem-1.png');

        if (avatarBody) {
            avatarBody.src = `/assets/avatar/${modeloFile}`;
            avatarBody.onerror = () => {
                avatarBody.onerror = null;
                avatarBody.src = isF ? '/assets/avatar/mulher-branca.png' : '/assets/avatar/homem-branco.png';
            };
        }

        if (cardHeaderAvatar) {
            const avatarFallbackSrc = `/assets/avatar/${modeloFile}`;
            const safeFotoUrl = this.sanitizeUrl(aluno.foto_perfil_url);
            cardHeaderAvatar.onerror = () => {
                cardHeaderAvatar.onerror = null;
                cardHeaderAvatar.src = avatarFallbackSrc;
            };
            cardHeaderAvatar.src = safeFotoUrl || avatarFallbackSrc;
        }
        this.applyProfilePhotoUrl(aluno.foto_perfil_url, aluno.nome_completo || aluno.primeiro_nome);

        if (avatarHair) {
            this.updateHairElement(avatarHair, cabeloFile, modeloFile);
            avatarHair.onerror = () => {
                avatarHair.onerror = null;
                this.updateHairElement(avatarHair, isF ? 'cabelo-mulher-1.png' : 'cabelo-homem-1.png', modeloFile);
            };
        }

        // Prajied de Muay Thai no Braço Direito do Avatar
        this.renderPrajiedArm(graduacao, isF, modeloFile);

        // Próxima Graduação & Status do Exame
        const nextRankLabel = document.getElementById('card-next-rank-label');
        const eligibilityBadge = document.getElementById('card-eligibility-badge');
        const nextRankBar = document.getElementById('card-next-rank-progress-bar');
        const nextExamDate = document.getElementById('card-next-exam-date');
        const nextExamVenue = document.getElementById('card-next-exam-venue');
        const nextRankIcon = document.getElementById('card-next-rank-icon');

        const proximaGrad = graduacao?.proxima_graduacao;
        if (nextRankLabel) {
            nextRankLabel.textContent = proximaGrad ? `Rumo ao ${proximaGrad.nivel_nome}` : 'Rumo ao Próximo Grau';
        }

        // Determinação do Score de Elegibilidade:
        // Prioridade 1: Avaliação oficial de graduação lançada pelo professor no admin (graduacao.avaliacao)
        // Prioridade 2: Avaliação contínua dos 4 quesitos técnicos (Clinch, Socos, Chutes, Postura)
        // Prioridade 3: Domínio de técnicas cadastradas na Wiki pelo atleta
        const avaliacaoOficial = graduacao?.avaliacao;
        const notasProf = data.notas_tecnicas || (aluno && aluno.notas_tecnicas);
        const prontidaoWiki = data.prontidao_exame || {};

        let scoreElegibilidade = null;
        let isApto = false;
        let temAvaliacao = false;

        if (avaliacaoOficial && avaliacaoOficial.percentual_obtido !== null && avaliacaoOficial.percentual_obtido !== undefined) {
            scoreElegibilidade = Math.round(Number(avaliacaoOficial.percentual_obtido));
            isApto = Boolean(avaliacaoOficial.apto);
            temAvaliacao = true;
        } else if (notasProf && notasProf.clinch !== null && notasProf.clinch !== undefined && !isNaN(notasProf.clinch)) {
            const media = (Number(notasProf.clinch) + Number(notasProf.socos || 0) + Number(notasProf.chutes || 0) + Number(notasProf.postura || 0)) / 4;
            scoreElegibilidade = Math.round(media * 10);
            const meta = Number(graduacao?.atual?.porcentagem_minima || 70);
            isApto = scoreElegibilidade >= meta;
            temAvaliacao = true;
        } else if (prontidaoWiki.total_golpes > 0 && prontidaoWiki.golpes_dominados > 0) {
            scoreElegibilidade = Math.round(Number(prontidaoWiki.percentual_prontidao || 0));
            isApto = Boolean(prontidaoWiki.apto_exame);
            temAvaliacao = true;
        }

        if (eligibilityBadge) {
            if (temAvaliacao && scoreElegibilidade !== null) {
                if (isApto) {
                    eligibilityBadge.textContent = `${scoreElegibilidade}% Elegível`;
                    eligibilityBadge.className = 'eligibility-pill pill-eligible';
                } else {
                    eligibilityBadge.textContent = `${scoreElegibilidade}% Elegível`;
                    eligibilityBadge.className = 'eligibility-pill pill-progress';
                }
            } else {
                eligibilityBadge.textContent = 'Aguardando Avaliação';
                eligibilityBadge.className = 'eligibility-pill pill-pending';
            }
        }

        if (nextRankBar) {
            if (temAvaliacao && scoreElegibilidade !== null) {
                nextRankBar.style.width = `${Math.min(100, Math.max(5, scoreElegibilidade))}%`;
                nextRankBar.className = `next-rank-bar ${isApto ? 'bar-eligible' : 'bar-progress'}`;
            } else {
                nextRankBar.style.width = '0%';
                nextRankBar.className = 'next-rank-bar';
            }
        }

        if (nextRankIcon && proximaGrad && proximaGrad.prajied_icone_url) {
            nextRankIcon.innerHTML = `<img src="${proximaGrad.prajied_icone_url}" alt="Próxima Faixa" style="width: 26px; height: 26px; object-fit: contain;">`;
        }

        const exame = data.exame_proximo;
        if (exame && nextExamDate) {
            const dObj = new Date(exame.data_evento);
            const dStr = !isNaN(dObj.getTime()) ? dObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : exame.data_evento;
            const hStr = exame.horario_inicio ? exame.horario_inicio.substring(0, 5) : '10:00';
            nextExamDate.innerHTML = `Exame: <strong>${dStr} às ${hStr}</strong>`;
            if (nextExamVenue) nextExamVenue.textContent = exame.local_evento || 'Dojo Central - CT';
        } else {
            if (nextExamDate) {
                nextExamDate.innerHTML = isApto ? `Exame: <strong>Elegível p/ convocação</strong>` : `Exame: <strong>Aguardando elegibilidade</strong>`;
            }
            if (nextExamVenue) nextExamVenue.textContent = isApto ? 'Apto p/ próximo exame' : 'Em evolução técnica';
        }

        // 5.2. Botão de Inscrição no Exame & Pop-up Obrigatório de Convocação (quando Elegível + Exame Aberto)
        this.renderBotaoEPopUpExame({ isApto, exame, data, aluno, graduacao });

        // 6. Badges & Conquistas (Carrossel Horizontal Moderno)
        const badgesContainer = document.getElementById('badges-container');
        const achievementsBadge = document.getElementById('achievements-badge');

        if (conquistas && badgesContainer) {
            const unlockedCount = conquistas.filter(c => c.desbloqueada).length;
            if (achievementsBadge) achievementsBadge.textContent = `${unlockedCount} de ${conquistas.length}`;

            badgesContainer.innerHTML = conquistas.map(c => `
                <div class="achievement-carousel-card ${c.desbloqueada ? 'unlocked' : 'locked'}" title="${this.escapeHtml(c.titulo || '')}: ${this.escapeHtml(c.descricao || '')}">
                    <div class="achievement-icon-box">
                        ${c.icone || (c.desbloqueada ? '🏆' : '🔒')}
                    </div>
                    <div>
                        <h4 class="achievement-name">${this.escapeHtml(c.titulo || '')}</h4>
                        <p class="achievement-sub">${c.desbloqueada ? 'Conquistado' : (c.progresso_str || 'Bloqueado')}</p>
                    </div>
                </div>
            `).join('');
        }

        // 7. Histórico de Graduações
        const timelineContainer = document.getElementById('graduations-timeline-container');
        if (graduacao.historico && timelineContainer) {
            timelineContainer.innerHTML = graduacao.historico.map(h => {
                const dateStr = h.data_graduacao ? new Date(h.data_graduacao).toLocaleDateString('pt-BR') : 'Atual';
                return `
                    <div class="timeline-entry">
                        <div class="timeline-dot" style="background-color: ${h.cor_primaria || '#38bdf8'}; border: 1px solid ${h.cor_secundaria || '#ffffff'};"></div>
                        <span class="timeline-name">${this.escapeHtml(h.nivel_nome || '')}</span>
                        <span class="timeline-date">${dateStr}</span>
                    </div>
                `;
            }).join('');
        }
    },

    renderActivityChart(activityData) {
        const container = document.getElementById('activity-chart-bars');
        if (!container) return;

        const data = Array.isArray(activityData) ? activityData : [];

        if (data.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 12px; color: #64748b; font-size: 0.8rem; text-align: center; gap: 6px;">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="opacity: 0.5;">
                        <line x1="18" y1="20" x2="18" y2="10"/>
                        <line x1="12" y1="20" x2="12" y2="4"/>
                        <line x1="6" y1="20" x2="6" y2="14"/>
                    </svg>
                    <span>Nenhuma avaliação técnica lançada ainda.</span>
                    <span style="font-size: 0.72rem; color: #475569;">O gráfico de evolução será preenchido conforme as avaliações dos professores.</span>
                </div>
            `;
            return;
        }

        container.innerHTML = data.map(col => {
            const roseH = Math.max(8, col.rose || (col.tecnica_pct ? Math.round(col.tecnica_pct * 0.45) : 25));
            const cyanH = Math.max(8, col.cyan || (col.clinch_nota ? Math.round(col.clinch_nota * 3.8) : 20));
            const amberH = Math.max(8, col.amber || (col.cond_nota ? Math.round(col.cond_nota * 3.5) : 18));
            const labelStr = this.escapeHtml(col.label || col.data_formatada || '');
            const tecnicaTip = this.escapeHtml(col.tecnica_score || (col.tecnica_pct ? col.tecnica_pct + '%' : roseH + 'px'));
            const clinchTip = this.escapeHtml(col.clinch_score || (col.clinch_nota ? col.clinch_nota + '/10' : cyanH + 'px'));
            const condTip = this.escapeHtml(col.cond_score || (col.cond_nota ? col.cond_nota + '/10' : amberH + 'px'));
            const tip = `${labelStr} • Técnica (Graduação): ${tecnicaTip} | Clinch & Sparring: ${clinchTip} | Condicionamento: ${condTip}`;

            return `
                <div class="chart-bar-col" title="${tip}">
                    <div class="chart-stacked-pill">
                        <div class="bar-segment seg-rose" style="height: ${roseH}px;"></div>
                        <div class="bar-segment seg-cyan" style="height: ${cyanH}px;"></div>
                        <div class="bar-segment seg-amber" style="height: ${amberH}px;"></div>
                    </div>
                    <span class="chart-day-label">${labelStr}</span>
                </div>
            `;
        }).join('');
    },

    /**
     * Renderiza o Card de Fogo de Frequência & Régua Semanal (Streak dos 7 Dias)
     */
    renderStreak(streakData) {
        if (!streakData) return;

        const flameCount = document.getElementById('streak-flame-count');
        const summarySubtitle = document.getElementById('streak-summary-subtitle');
        const metaText = document.getElementById('streak-meta-text');
        const percentText = document.getElementById('streak-percent-text');
        const progressBar = document.getElementById('streak-progress-bar');
        const rulerContainer = document.getElementById('weekly-streak-ruler');

        const semanas = streakData.semanas_consecutivas || 0;
        const treinos = streakData.total_semana || 0;
        const meta = streakData.meta_semana || 3;
        const pct = streakData.percentual_semana || 0;

        if (flameCount) flameCount.textContent = semanas;
        if (summarySubtitle) {
            summarySubtitle.textContent = `${treinos} de ${meta} concluídos nesta semana`;
        }
        if (metaText) metaText.textContent = `Meta: ${meta} treinos`;
        if (percentText) percentText.textContent = `${pct}%`;
        if (progressBar) progressBar.style.width = `${pct}%`;

        if (rulerContainer && Array.isArray(streakData.dias_semana)) {
            // Garante exibição apenas dos 5 dias úteis (Seg a Sex), sem Sáb e Dom
            const diasUteis = streakData.dias_semana.filter(d => {
                const s = (d.dia_sigla || '').toUpperCase();
                return !s.startsWith('SÁB') && !s.startsWith('SAB') && !s.startsWith('DOM');
            });

            rulerContainer.innerHTML = diasUteis.map(d => {
                const isAtivo = Boolean(d.presente);
                const isHoje = Boolean(d.is_hoje);
                const isPassado = Boolean(d.is_passado);
                const isFuturo = Boolean(d.is_futuro);

                const statusClass = [
                    isAtivo ? 'active' : '',
                    isHoje ? 'today' : '',
                    isPassado ? 'past' : '',
                    isFuturo ? 'future' : ''
                ].filter(Boolean).join(' ');

                const diaSigla = this.escapeHtml(d.dia_sigla || '').toUpperCase().substring(0, 3);
                const diaNum = d.dia_numero;
                const diaContent = isAtivo
                    ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
                    : diaNum;

                const diaTitle = isAtivo 
                    ? `Treino Concluído em ${d.data}` 
                    : (isHoje ? `Hoje (${d.data}) - Treine para manter o fogo!` : `${d.data}`);

                return `
                    <div class="streak-day-pill ${statusClass}" title="${this.escapeHtml(diaTitle)}">
                        <span class="streak-day-sigla">${diaSigla}</span>
                        <span class="streak-day-num">${diaContent}</span>
                    </div>
                `;
            }).join('');
        }
    },

    /**
     * Renderiza o Card de Prontidão para o Exame de Graduação
     */
    renderReadinessCard(prontidao) {
        if (!prontidao) return;

        const beltBadge = document.getElementById('readiness-belt-badge');
        const summarySubtitle = document.getElementById('readiness-summary-subtitle');
        const counterText = document.getElementById('readiness-counter-text');
        const percentPill = document.getElementById('readiness-percent-pill');
        const progressBar = document.getElementById('readiness-progress-bar');
        const targetMarker = document.getElementById('readiness-target-marker');
        const statusMsg = document.getElementById('readiness-status-msg');

        const total = prontidao.total_golpes || 0;
        const dominados = prontidao.golpes_dominados || 0;
        const pct = prontidao.percentual_prontidao || 0;
        const metaMin = prontidao.meta_minima || 70;
        const isApto = Boolean(prontidao.apto_exame);

        if (beltBadge) beltBadge.textContent = prontidao.nivel_nome || 'Iniciante (Sem graduação)';

        if (total === 0) {
            if (counterText) counterText.textContent = '0 técnicas vinculadas';
            if (percentPill) {
                percentPill.textContent = '0%';
                percentPill.classList.remove('apto');
            }
            if (progressBar) {
                progressBar.style.width = '0%';
                progressBar.classList.remove('apto');
            }
            if (statusMsg) {
                statusMsg.className = 'readiness-status-msg';
                statusMsg.textContent = 'Aguardando definição de graduação ou técnicas da faixa.';
            }
            if (summarySubtitle) {
                summarySubtitle.textContent = 'Nenhuma técnica vinculada para a graduação atual no momento.';
            }
            return;
        }

        if (counterText) counterText.textContent = `${dominados} de ${total} ${total === 1 ? 'técnica dominada' : 'técnicas dominadas'}`;
        
        if (percentPill) {
            percentPill.textContent = `${pct}%`;
            percentPill.classList.toggle('apto', isApto);
        }
        
        if (progressBar) {
            progressBar.style.width = `${pct}%`;
            progressBar.classList.toggle('apto', isApto);
        }

        if (targetMarker) {
            targetMarker.style.left = `${Math.min(98, Math.max(2, metaMin))}%`;
            targetMarker.title = `Meta mínima para aptidão ao exame: ${metaMin}%`;
        }

        if (statusMsg) {
            if (isApto) {
                statusMsg.className = 'readiness-status-msg apto';
                statusMsg.innerHTML = `<strong style="color: #10b981;">Apto para o Exame!</strong> Meta de ${metaMin}% superada.`;
            } else {
                const necessarios = Math.max(1, Math.ceil((total * metaMin) / 100));
                const faltam = Math.max(1, necessarios - dominados);
                statusMsg.className = 'readiness-status-msg';
                statusMsg.textContent = `Falta dominar ${faltam} ${faltam === 1 ? 'técnica' : 'técnicas'} para atingir a meta mínima (${metaMin}%).`;
            }
        }

        if (summarySubtitle) {
            summarySubtitle.textContent = isApto
                ? 'Currículo técnico dominado com excelência! Você está elegível para prestar exame oficial.'
                : 'Marque as técnicas como dominadas conforme treina para liberar o exame de faixa.';
        }
    },

    // -------------------------------------------------------------------------
    // MODAL MEDIDAS
    // -------------------------------------------------------------------------
    openMedidasModal() {
        if (!this.alunoData) return;
        const { medidas } = this.alunoData.aluno;

        const inputData = document.getElementById('input-edit-data');
        if (inputData) inputData.value = new Date().toISOString().split('T')[0];

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val !== undefined && val !== null ? val : '';
        };

        setVal('input-edit-peso', medidas.peso_kg);
        setVal('input-edit-altura', medidas.altura_cm);
        setVal('input-edit-torax', medidas.torax_cm);
        setVal('input-edit-cintura', medidas.cintura_cm);
        setVal('input-edit-quadril', medidas.quadril_cm);
        setVal('input-edit-braco', '');
        setVal('input-edit-coxa', '');
        setVal('input-edit-obs', 'Reavaliação periódica de medidas');

        document.getElementById('modal-medidas').style.display = 'flex';
    },

    async saveMedidas() {
        try {
            const inputData = document.getElementById('input-edit-data');
            const data_medicao = inputData ? inputData.value : new Date().toISOString().split('T')[0];
            const peso_kg = parseFloat(document.getElementById('input-edit-peso').value);
            const altura_cm = parseInt(document.getElementById('input-edit-altura').value, 10);
            const torax_cm = parseFloat(document.getElementById('input-edit-torax').value) || null;
            const cintura_cm = parseFloat(document.getElementById('input-edit-cintura').value) || null;
            const quadril_cm = parseFloat(document.getElementById('input-edit-quadril').value) || null;
            const braco_cm = parseFloat(document.getElementById('input-edit-braco')?.value) || null;
            const coxa_cm = parseFloat(document.getElementById('input-edit-coxa')?.value) || null;
            const observacoes = document.getElementById('input-edit-obs')?.value || 'Medição periódica do atleta';

            const alunoId = this.alunoData?.aluno?.id || 1;

            const headers = { 'Content-Type': 'application/json' };
            if (this.authToken && this.authToken !== 'null') {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const res = await fetch('/api/aluno/medidas', {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                    aluno_id: alunoId,
                    data_medicao,
                    peso_kg,
                    altura_cm,
                    torax_cm,
                    cintura_cm,
                    quadril_cm,
                    braco_cm,
                    coxa_cm,
                    observacoes
                })
            });

            const data = await res.json();
            if (!data.success) throw new Error(data.error);

            document.getElementById('modal-medidas').style.display = 'none';
            await this.loadDashboardData();

            // Se a página de evolução estiver aberta, atualiza também
            if (this.currentView === 'evolucao') {
                await this.openEvolutionModal();
            }

        } catch (err) {
            alert('Erro ao salvar medidas: ' + err.message);
        }
    },

    // -------------------------------------------------------------------------
    // MODAL HISTÓRICO & COMPARATIVO DE EVOLUÇÃO
    // -------------------------------------------------------------------------
    async openEvolutionModal() {
        const evolucaoView = document.getElementById('spa-view-evolucao');
        if (evolucaoView) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        const summaryContainer = document.getElementById('evolution-summary-cards');
        const tableBody = document.getElementById('evolution-table-body');
        const countEl = document.getElementById('total-evaluations-count');

        if (summaryContainer) summaryContainer.innerHTML = '<div style="color: #94a3b8; font-size: 13px; grid-column: span 4; text-align: center; padding: 20px;">Carregando histórico e evolução...</div>';
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: #94a3b8; padding: 20px;">Consultando dados...</td></tr>';

        try {
            const urlParams = new URLSearchParams(window.location.search);
            const queryAlunoId = urlParams.get('aluno_id') || this.alunoData?.aluno?.id || 1;

            let endpoint = `/api/aluno/historico-medidas?aluno_id=${encodeURIComponent(queryAlunoId)}`;
            const headers = {};
            if (this.authToken && this.authToken !== 'null') {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const res = await fetch(endpoint, { headers });
            const data = await res.json();

            if (!data.success) throw new Error(data.error || 'Erro ao consultar histórico.');

            const { resumo, historico } = data;

            if (countEl) countEl.textContent = historico ? historico.length : 0;

            // 1. Renderiza o Gráfico de Evolução ao Longo das Medidas
            this.evolutionHistoryData = historico || [];
            this.evolutionResumo = resumo || null;
            this.renderEvolutionChart(this.evolutionHistoryData, this.currentEvolutionMetric || 'peso');

            // 2. Renderiza 4 Cards de Resumo Geral
            if (summaryContainer) {
                if (!resumo || !historico || historico.length === 0) {
                    summaryContainer.innerHTML = `
                        <div style="grid-column: span 4; background: #14171d; border-radius: 12px; padding: 18px; text-align: center; color: #94a3b8;">
                            Nenhuma avaliação física registrada ainda. Clique em <strong>"+ Nova Avaliação"</strong> para iniciar o acompanhamento!
                        </div>
                    `;
                } else {
                    const pesoIcon = resumo.evolucao_peso < 0 ? '↓' : resumo.evolucao_peso > 0 ? '↑' : '=';
                    const cinturaIcon = resumo.evolucao_cintura < 0 ? '↓' : resumo.evolucao_cintura > 0 ? '↑' : '=';
                    const toraxIcon = resumo.evolucao_torax > 0 ? '↑' : resumo.evolucao_torax < 0 ? '↓' : '=';
                    const imcIcon = resumo.evolucao_imc < 0 ? '↓' : resumo.evolucao_imc > 0 ? '↑' : '=';

                    const pesoClass = resumo.evolucao_peso <= 0 ? 'sub-positive' : 'sub-negative';
                    const cinturaClass = resumo.evolucao_cintura <= 0 ? 'sub-positive' : 'sub-negative';
                    const toraxClass = resumo.evolucao_torax >= 0 ? 'sub-positive' : 'sub-negative';
                    const imcClass = resumo.evolucao_imc <= 0 ? 'sub-positive' : 'sub-neutral';

                    const ultimo = historico[0]; // mais recente

                    summaryContainer.innerHTML = `
                        <div class="evolution-card">
                            <span class="evolution-card-label">Peso Corporal</span>
                            <div class="evolution-card-val">${ultimo.peso_kg} <small>kg</small></div>
                            <span class="evolution-card-sub ${pesoClass}">
                                ${pesoIcon} ${Math.abs(resumo.evolucao_peso)} kg no total
                            </span>
                        </div>
                        <div class="evolution-card">
                            <span class="evolution-card-label">Cintura</span>
                            <div class="evolution-card-val">${ultimo.cintura_cm || '--'} <small>cm</small></div>
                            <span class="evolution-card-sub ${cinturaClass}">
                                ${cinturaIcon} ${Math.abs(resumo.evolucao_cintura)} cm no total
                            </span>
                        </div>
                        <div class="evolution-card">
                            <span class="evolution-card-label">Tórax</span>
                            <div class="evolution-card-val">${ultimo.torax_cm || '--'} <small>cm</small></div>
                            <span class="evolution-card-sub ${toraxClass}">
                                ${toraxIcon} ${Math.abs(resumo.evolucao_torax)} cm no total
                            </span>
                        </div>
                        <div class="evolution-card">
                            <span class="evolution-card-label">IMC Atual</span>
                            <div class="evolution-card-val">${ultimo.imc}</div>
                            <span class="evolution-card-sub ${imcClass}">
                                ${imcIcon} ${Math.abs(resumo.evolucao_imc)} pts (${ultimo.imc_classificacao})
                            </span>
                        </div>
                    `;
                }
            }

            // 3. Renderiza Tabela Cronológica
            if (tableBody) {
                if (!historico || historico.length === 0) {
                    tableBody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: #94a3b8; padding: 24px;">Sem medições salvas até o momento.</td></tr>';
                    return;
                }

                tableBody.innerHTML = historico.map(h => {
                    const d = new Date(h.data_medicao);
                    const dateFormatted = d.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });

                    const pill = (val, delta, unit = '') => {
                        if (val === null || val === undefined) return '<span style="color:#64748b;">--</span>';
                        if (!delta || delta === 0) return `<span>${val}${unit}</span>`;
                        const isNeg = delta < 0;
                        const cls = isNeg ? 'down' : 'up';
                        const sign = isNeg ? '' : '+';
                        return `<span>${val}${unit}</span> <span class="delta-pill ${cls}">${sign}${delta}</span>`;
                    };

                    return `
                        <tr>
                            <td><strong style="color: #38bdf8;">${dateFormatted}</strong></td>
                            <td>${pill(h.peso_kg, h.delta_peso, 'kg')}</td>
                            <td><span style="font-weight:700;">${h.imc}</span> <small style="color:#94a3b8;">(${h.imc_classificacao})</small></td>
                            <td>${pill(h.torax_cm, h.delta_torax, 'cm')}</td>
                            <td>${pill(h.cintura_cm, h.delta_cintura, 'cm')}</td>
                            <td>${pill(h.quadril_cm, h.delta_quadril, 'cm')}</td>
                            <td>${h.braco_cm ? `${h.braco_cm}cm` : '<span style="color:#64748b;">--</span>'}</td>
                            <td>${h.coxa_cm ? `${h.coxa_cm}cm` : '<span style="color:#64748b;">--</span>'}</td>
                            <td style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; font-size: 11.5px; color: #cbd5e1;">${h.observacoes || '--'}</td>
                            <td>
                                <button type="button" class="btn-del-eval" data-del-id="${h.id}" title="Excluir medição">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                </button>
                            </td>
                        </tr>
                    `;
                }).join('');

                tableBody.querySelectorAll('[data-del-id]').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const id = e.currentTarget.dataset.delId;
                        this.deleteMedicao(id);
                    });
                });
            }

        } catch (err) {
            console.error('Erro ao abrir comparativo de evolução:', err);
            if (summaryContainer) summaryContainer.innerHTML = `<div style="color: #f87171; grid-column: span 4;">Erro ao carregar dados: ${err.message}</div>`;
            const chartWrap = document.getElementById('evolution-chart-canvas-wrap');
            if (chartWrap) chartWrap.innerHTML = `<div style="color: #f87171; padding: 20px; font-size: 13px;">Erro ao carregar gráfico: ${err.message}</div>`;
        }
    },

    async deleteMedicao(id) {
        if (!confirm('Deseja realmente remover esta medição do histórico?')) return;

        try {
            const urlParams = new URLSearchParams(window.location.search);
            const queryAlunoId = urlParams.get('aluno_id') || this.alunoData?.aluno?.id || 1;

            const headers = {};
            if (this.authToken && this.authToken !== 'null') {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const res = await fetch(`/api/aluno/historico-medidas/${id}?aluno_id=${encodeURIComponent(queryAlunoId)}`, {
                method: 'DELETE',
                headers
            });

            const data = await res.json();
            if (!data.success) throw new Error(data.error);

            // Recarrega o modal e o dashboard principal
            await this.openEvolutionModal();
            await this.loadDashboardData();

        } catch (err) {
            alert('Erro ao excluir medição: ' + err.message);
        }
    },

    // -------------------------------------------------------------------------
    // GRÁFICO INTERATIVO DE EVOLUÇÃO DAS MEDIDAS
    // -------------------------------------------------------------------------
    renderEvolutionChart(historico, metricKey = 'peso') {
        const wrap = document.getElementById('evolution-chart-canvas-wrap');
        const titleEl = document.getElementById('evolution-chart-title');
        const statEl = document.getElementById('evolution-chart-stat-badge');
        if (!wrap) return;

        const metricConfigs = {
            peso: {
                label: 'Peso Corporal',
                unit: 'kg',
                color: '#ef4444',
                colorGrad: '#b91c1c',
                title: 'Progresso de Peso Corporal',
                field: 'peso_kg'
            },
            cintura: {
                label: 'Cintura',
                unit: 'cm',
                color: '#38bdf8',
                colorGrad: '#0284c7',
                title: 'Evolução da Linha de Cintura',
                field: 'cintura_cm'
            },
            torax: {
                label: 'Tórax',
                unit: 'cm',
                color: '#a855f7',
                colorGrad: '#9333ea',
                title: 'Evolução da Medida de Tórax',
                field: 'torax_cm'
            },
            quadril: {
                label: 'Quadril',
                unit: 'cm',
                color: '#10b981',
                colorGrad: '#059669',
                title: 'Evolução da Medida de Quadril',
                field: 'quadril_cm'
            },
            imc: {
                label: 'IMC',
                unit: 'pts',
                color: '#f59e0b',
                colorGrad: '#d97706',
                title: 'Evolução do Índice de Massa Corporal (IMC)',
                field: 'imc'
            }
        };

        const config = metricConfigs[metricKey] || metricConfigs.peso;
        if (titleEl) titleEl.textContent = config.title;

        // Atualiza a pílula ativa no DOM
        document.querySelectorAll('.evolution-metric-pills .metric-pill').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.metric === metricKey);
        });

        if (!Array.isArray(historico) || historico.length === 0) {
            wrap.innerHTML = `
                <div style="text-align: center; color: #94a3b8; font-size: 13px; padding: 36px;">
                    <div style="font-size: 28px; margin-bottom: 8px;">📊</div>
                    <strong style="color: #ffffff;">Nenhuma medição física registrada ainda.</strong><br>
                    <span style="font-size: 12px; margin-top: 4px; display: inline-block;">Lance sua primeira medição em <em>"+ Nova Avaliação"</em> para acompanhar a evolução gráfica!</span>
                </div>
            `;
            if (statEl) statEl.textContent = 'Sem dados suficientes';
            return;
        }

        // Ordena cronologicamente da mais antiga para a mais recente
        const chron = [...historico].reverse().filter(item => {
            const val = parseFloat(item[config.field]);
            return !isNaN(val) && val > 0;
        });

        if (chron.length === 0) {
            wrap.innerHTML = `
                <div style="text-align: center; color: #94a3b8; font-size: 13px; padding: 36px;">
                    Nenhum registro de <strong>${config.label}</strong> encontrado nas avaliações salvas.
                </div>
            `;
            if (statEl) statEl.textContent = 'Métrica não aferida';
            return;
        }

        const values = chron.map(c => parseFloat(c[config.field]));
        const firstVal = values[0];
        const lastVal = values[values.length - 1];
        const diffTotal = Number((lastVal - firstVal).toFixed(1));
        const diffSign = diffTotal > 0 ? `+${diffTotal}` : `${diffTotal}`;

        if (statEl) {
            if (chron.length === 1) {
                statEl.textContent = `Ponto inicial: ${lastVal} ${config.unit} (1ª medição)`;
            } else {
                statEl.textContent = `Variação total: ${diffSign} ${config.unit} (Início: ${firstVal} → Atual: ${lastVal} ${config.unit})`;
            }
        }

        // Se tiver apenas 1 ponto:
        if (chron.length === 1) {
            const d = new Date(chron[0].data_medicao);
            const dateStr = d.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
            wrap.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 28px 16px; width: 100%;">
                    <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 999px; padding: 8px 18px; display: inline-flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                        <span style="width: 10px; height: 10px; border-radius: 50%; background: ${config.color}; box-shadow: 0 0 10px ${config.color};"></span>
                        <strong style="color: #ffffff; font-size: 15px;">${lastVal} ${config.unit}</strong>
                        <span style="color: #94a3b8; font-size: 12px;">em ${dateStr}</span>
                    </div>
                    <span style="color: #94a3b8; font-size: 12.5px; text-align: center; max-width: 420px; line-height: 1.45;">
                        🎯 1ª medição de <strong>${config.label}</strong> registrada! Ao adicionar novas avaliações periódicas, sua curva de evolução e comparativos semanais serão traçados automaticamente.
                    </span>
                </div>
            `;
            return;
        }

        // Coordenadas do gráfico SVG (2 ou mais medições)
        const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
        const svgW = 600;
        const svgH = 210;
        const padLeft = isMobile ? 32 : 42;
        const padRight = isMobile ? 18 : 26;
        const padTop = isMobile ? 24 : 32;
        const padBottom = isMobile ? 28 : 36;

        const chartW = svgW - padLeft - padRight;
        const chartH = svgH - padTop - padBottom;

        let minVal = Math.min(...values);
        let maxVal = Math.max(...values);
        let range = maxVal - minVal;

        if (range <= 0.01) {
            minVal -= 2;
            maxVal += 2;
            range = 4;
        } else {
            const padRange = range * 0.25;
            minVal -= padRange;
            maxVal += padRange;
            range = maxVal - minVal;
        }

        const n = chron.length;
        const points = chron.map((c, i) => {
            const val = parseFloat(c[config.field]);
            const x = padLeft + (i / (n - 1)) * chartW;
            const y = padTop + chartH - ((val - minVal) / range) * chartH;
            const d = new Date(c.data_medicao);
            const dateStr = d.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
            return { x, y, val, dateStr, id: c.id };
        });

        // Caminhos de Linha e Área
        const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
        const areaPath = `${linePath} L ${points[n - 1].x.toFixed(1)} ${(padTop + chartH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padTop + chartH).toFixed(1)} Z`;

        // 3 Linhas de Grade Horizontais
        const gridSteps = 3;
        let gridLinesHtml = '';
        for (let g = 0; g <= gridSteps; g++) {
            const gy = padTop + (g / gridSteps) * chartH;
            const gVal = (maxVal - (g / gridSteps) * range).toFixed(1);
            gridLinesHtml += `
                <line x1="${padLeft}" y1="${gy.toFixed(1)}" x2="${svgW - padRight}" y2="${gy.toFixed(1)}" class="chart-grid-line" />
                <text x="${padLeft - 8}" y="${(gy + 3).toFixed(1)}" text-anchor="end" class="chart-grid-val">${gVal}</text>
            `;
        }

        // Círculos e Rótulos em cada Ponto
        const pointsHtml = points.map((p, idx) => {
            const deltaPrev = idx > 0 ? Number((p.val - points[idx - 1].val).toFixed(1)) : 0;
            const deltaTag = idx > 0 && deltaPrev !== 0 ? ` (${deltaPrev > 0 ? '+' : ''}${deltaPrev})` : '';

            return `
                <g class="chart-point-group" tabindex="0">
                    <line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${(padTop + chartH).toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="2 2" />
                    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="7" fill="${config.color}" fill-opacity="0.25" />
                    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="${config.color}" stroke="#0e131f" stroke-width="2" />
                    <text x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}" text-anchor="middle" class="chart-val-label">${p.val}</text>
                    <text x="${p.x.toFixed(1)}" y="${(svgH - 12).toFixed(1)}" text-anchor="middle" class="chart-date-label">${p.dateStr}</text>
                    <title>${config.label}: ${p.val} ${config.unit} em ${p.dateStr}${deltaTag}</title>
                </g>
            `;
        }).join('');

        wrap.innerHTML = `
            <svg viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Gráfico de Evolução">
                <defs>
                    <linearGradient id="metric-area-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="${config.color}" stop-opacity="0.38" />
                        <stop offset="85%" stop-color="${config.colorGrad}" stop-opacity="0.05" />
                        <stop offset="100%" stop-color="${config.colorGrad}" stop-opacity="0.0" />
                    </linearGradient>
                    <filter id="glow-line" x="-10%" y="-10%" width="120%" height="120%">
                        <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="${config.color}" flood-opacity="0.35"/>
                    </filter>
                </defs>

                ${gridLinesHtml}

                <line x1="${padLeft}" y1="${(padTop + chartH).toFixed(1)}" x2="${svgW - padRight}" y2="${(padTop + chartH).toFixed(1)}" stroke="rgba(255,255,255,0.14)" stroke-width="1" />

                <path d="${areaPath}" fill="url(#metric-area-grad)" />
                <path d="${linePath}" fill="none" stroke="${config.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow-line)" />

                ${pointsHtml}
            </svg>
        `;
    },

    // -------------------------------------------------------------------------
    // MODAL DE CUSTOMIZAÇÃO DO AVATAR & SKINS
    // -------------------------------------------------------------------------
    openSkinsModal() {
        const modal = document.getElementById('modal-skins');
        if (!modal || !this.alunoData) return;

        const aluno = this.alunoData.aluno;
        const isF = String(aluno.genero || '').toUpperCase() === 'F';

        // Inicializa o estado de customização temporário
        this.customizerState = {
            isFeminino: isF,
            tom: aluno.avatar_tom || 'branca',
            cabelo: aluno.avatar_cabelo || (isF ? 'cabelo-mulher-1.png' : 'cabelo-homem-1.png'),
            luva: aluno.avatar_luva || 'padrao',
            titulo: aluno.titulo_ativo || 'Iniciante Focado'
        };

        const genderLabel = document.getElementById('modal-gender-label');
        if (genderLabel) {
            genderLabel.textContent = isF ? 'Modelo Feminino' : 'Modelo Masculino';
        }

        // 1. Renderiza tons de pele disponíveis conforme o gênero
        const skinTonesContainer = document.getElementById('skin-tones-options');
        if (skinTonesContainer) {
            const tones = isF ? [
                { tom: 'branca', label: 'Mulher Branca', img: '/assets/avatar/mulher-branca.png' },
                { tom: 'negra', label: 'Mulher Negra', img: '/assets/avatar/mulher-negra.png' }
            ] : [
                { tom: 'branca', label: 'Homem Branco', img: '/assets/avatar/homem-branco.png' },
                { tom: 'negra', label: 'Homem Negro', img: '/assets/avatar/homem-negro.png' }
            ];

            skinTonesContainer.innerHTML = tones.map(t => `
                <div class="skin-tone-choice ${t.tom === this.customizerState.tom ? 'active' : ''}" data-tone="${t.tom}">
                    <img src="${t.img}" alt="${t.label}">
                    <span>${t.label}</span>
                </div>
            `).join('');

            skinTonesContainer.querySelectorAll('.skin-tone-choice').forEach(card => {
                card.addEventListener('click', () => {
                    this.customizerState.tom = card.dataset.tone;
                    skinTonesContainer.querySelectorAll('.skin-tone-choice').forEach(c => c.classList.remove('active'));
                    card.classList.add('active');
                    this.updateCustomizerPreview();
                });
            });
        }

        // 2. Renderiza cabelos disponíveis conforme o gênero
        const hairsContainer = document.getElementById('hair-styles-options');
        if (hairsContainer) {
            const hairs = isF ? [
                { file: 'cabelo-mulher-1.png', name: 'Estilo 1 (Longo Ondulado)' },
                { file: 'cabelo-mulher-2.png', name: 'Estilo 2 (Rabo de Cavalo)' },
                { file: 'cabelo-mulher-3.png', name: 'Estilo 3 (Chanel Curto)' },
                { file: 'cabelo-mulher-4.png', name: 'Estilo 4 (Longo com Franja)' },
                { file: 'cabelo-mulher-5.png', name: 'Estilo 5 (Cacheado Médio)' }
            ] : [
                { file: 'cabelo-homem-1.png', name: 'Estilo 1 (Clássico Curto)' },
                { file: 'cabelo-homem-2.png', name: 'Estilo 2 (Fade Marcial)' },
                { file: 'cabelo-homem-3.png', name: 'Estilo 3 (Afro / Volume)' },
                { file: 'cabelo-homem-4.png', name: 'Estilo 4 (Texturizado)' }
            ];

            hairsContainer.innerHTML = hairs.map(h => `
                <div class="hair-choice-card ${h.file === this.customizerState.cabelo ? 'active' : ''}" data-hair="${h.file}">
                    <div class="hair-thumb-wrap">
                        <img src="/assets/avatar/${h.file}" alt="${h.name}">
                    </div>
                    <span>${h.name}</span>
                </div>
            `).join('');

            hairsContainer.querySelectorAll('.hair-choice-card').forEach(card => {
                card.addEventListener('click', () => {
                    this.customizerState.cabelo = card.dataset.hair;
                    hairsContainer.querySelectorAll('.hair-choice-card').forEach(c => c.classList.remove('active'));
                    card.classList.add('active');
                    this.updateCustomizerPreview();
                });
            });
        }

        // 3. Renderiza Luvas e Equipamentos de Combate
        const glovesContainer = document.getElementById('gloves-options-grid');
        const glovesList = this.alunoData?.recompensas?.luvas || [];
        if (glovesContainer && glovesList.length > 0) {
            glovesContainer.innerHTML = glovesList.map(g => {
                const isSelected = g.id === this.customizerState.luva;
                const isLocked = !g.desbloqueada;
                const lockBadge = isLocked 
                    ? `<span class="glove-lock-badge">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        Faltam ${g.faltam_checkins} treinos
                       </span>`
                    : (isSelected ? `<span style="font-size: 10px; color: #10b981; font-weight: 700;">Equipada</span>` : '');

                return `
                    <div class="glove-choice-card ${isSelected ? 'active' : ''} ${isLocked ? 'locked' : ''}" data-glove-id="${g.id}">
                        <div class="glove-color-pill" style="background-color: ${g.cor || '#ef4444'}; color: #fff;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 5v14M18 5v14M2 9v6M22 9v6M6 12h12"/></svg>
                        </div>
                        <div class="glove-info">
                            <span class="glove-name">${this.escapeHtml(g.nome)}</span>
                            <span class="glove-req">${isLocked ? `Requer ${g.req_checkins} treinos` : 'Desbloqueada'}</span>
                            ${lockBadge}
                        </div>
                    </div>
                `;
            }).join('');

            glovesContainer.querySelectorAll('.glove-choice-card:not(.locked)').forEach(card => {
                card.addEventListener('click', () => {
                    this.customizerState.luva = card.dataset.gloveId;
                    glovesContainer.querySelectorAll('.glove-choice-card').forEach(c => c.classList.remove('active'));
                    card.classList.add('active');
                    this.updateCustomizerPreview();
                });
            });
        }

        // 4. Renderiza Títulos de Honra do Lutador
        const titlesContainer = document.getElementById('titles-options-grid');
        const titlesList = this.alunoData?.recompensas?.titulos || [];
        if (titlesContainer && titlesList.length > 0) {
            titlesContainer.innerHTML = titlesList.map(t => {
                const isActive = t.titulo === this.customizerState.titulo;
                const isLocked = !t.desbloqueado;

                let tagHtml = '';
                if (isActive) tagHtml = '<span class="title-status-tag active">Ativo</span>';
                else if (!isLocked) tagHtml = '<span class="title-status-tag unlocked">Disponível</span>';
                else tagHtml = `<span class="title-status-tag locked">Faltam ${t.faltam_checkins} treinos</span>`;

                return `
                    <div class="title-choice-card ${isActive ? 'active' : ''} ${isLocked ? 'locked' : ''}" data-title-name="${this.escapeHtml(t.titulo)}">
                        <div class="title-info-wrap">
                            <span class="title-name-text">${this.escapeHtml(t.titulo)}</span>
                            <span class="title-desc-text">${this.escapeHtml(t.descricao)}</span>
                        </div>
                        ${tagHtml}
                    </div>
                `;
            }).join('');

            titlesContainer.querySelectorAll('.title-choice-card:not(.locked)').forEach(card => {
                card.addEventListener('click', () => {
                    this.customizerState.titulo = card.dataset.titleName;
                    titlesContainer.querySelectorAll('.title-choice-card').forEach(c => c.classList.remove('active'));
                    card.classList.add('active');
                    this.updateCustomizerPreview();
                });
            });
        }

        // 5. Informações e prévia do Prajied no Modal
        const mt = this.alunoData?.graduacao?.muay_thai;
        const prajiedInfoEl = document.getElementById('modal-prajied-info');
        const prajiedNomeEl = document.getElementById('modal-prajied-nome');
        const previewPrajiedWrap = document.getElementById('modal-preview-prajied-wrap');
        const previewPrajiedImg = document.getElementById('modal-preview-prajied');

        if (mt) {
            const nivelNome = mt.nivel_nome || 'Prajied Muay Thai';
            const prajiedSrc = mt.prajied_icone_url || `/assets/prajied/prajied-${Math.min(12, Math.max(1, mt.ordem_hierarquica || 1))}.png`;
            if (prajiedNomeEl) prajiedNomeEl.textContent = nivelNome;
            if (prajiedInfoEl) prajiedInfoEl.style.display = 'block';
            if (previewPrajiedWrap && previewPrajiedImg) {
                previewPrajiedWrap.style.display = 'block';
                previewPrajiedImg.src = prajiedSrc;
            }
        } else {
            if (prajiedInfoEl) prajiedInfoEl.style.display = 'none';
            if (previewPrajiedWrap) previewPrajiedWrap.style.display = 'none';
        }

        this.updateCustomizerPreview();
        modal.style.display = 'flex';
    },

    updateCustomizerPreview() {
        if (!this.customizerState) return;
        const { isFeminino, tom, cabelo, luva, titulo } = this.customizerState;

        const bodyFile = isFeminino 
            ? (tom === 'negra' ? 'mulher-negra.png' : 'mulher-branca.png')
            : (tom === 'negra' ? 'homem-negro.png' : 'homem-branco.png');

        const bodyImg = document.getElementById('modal-preview-body');
        const hairImg = document.getElementById('modal-preview-hair');

        if (bodyImg) bodyImg.src = `/assets/avatar/${bodyFile}`;
        if (hairImg) {
            this.updateHairElement(hairImg, cabelo, bodyFile);
        }

        const previewPrajiedWrap = document.getElementById('modal-preview-prajied-wrap');
        if (previewPrajiedWrap) {
            const genderClass = isFeminino ? 'prajied-mulher' : 'prajied-homem';
            const genderAttr = isFeminino ? 'F' : 'M';
            previewPrajiedWrap.className = `avatar-layer avatar-layer-prajied ${genderClass}`;
            previewPrajiedWrap.setAttribute('data-gender', genderAttr);
            previewPrajiedWrap.setAttribute('data-model', bodyFile);
        }

        // Atualiza legendas de equipamento e título na prévia
        const gloveLabel = document.getElementById('modal-preview-glove-label');
        const titleLabel = document.getElementById('modal-preview-title-label');
        const luvaItem = (this.alunoData?.recompensas?.luvas || []).find(l => l.id === luva);

        if (gloveLabel) gloveLabel.textContent = `Luva: ${luvaItem ? luvaItem.nome : 'Tradicionais'}`;
        if (titleLabel) titleLabel.textContent = `Título: ${titulo || 'Iniciante Focado'}`;
    },

    async saveAvatarCustomization() {
        if (!this.customizerState) return;
        const { tom, cabelo, luva, titulo } = this.customizerState;
        const alunoId = this.alunoData?.aluno?.id || 1;

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.authToken && this.authToken !== 'null') {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const res = await fetch('/api/aluno/skin', {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                    aluno_id: alunoId,
                    avatar_tom: tom,
                    avatar_cabelo: cabelo,
                    avatar_luva: luva,
                    titulo_ativo: titulo
                })
            });

            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Erro ao salvar avatar.');

            // Atualiza o estado local do aluno
            if (this.alunoData?.aluno) {
                this.alunoData.aluno.avatar_tom = tom;
                this.alunoData.aluno.avatar_cabelo = cabelo;
                this.alunoData.aluno.avatar_luva = luva;
                this.alunoData.aluno.titulo_ativo = titulo;
            }
            if (data.recompensas && this.alunoData) {
                this.alunoData.recompensas = data.recompensas;
            }

            // Atualiza os badges de título do atleta na interface
            const headerAthleteTitle = document.getElementById('header-athlete-title');
            const bodyAthleteTitle = document.getElementById('body-athlete-title-badge');
            if (headerAthleteTitle) headerAthleteTitle.textContent = titulo;
            if (bodyAthleteTitle) bodyAthleteTitle.textContent = titulo;

            // Atualiza imediatamente a visualização do avatar no dashboard
            const isF = this.customizerState.isFeminino;
            const bodyFile = isF 
                ? (tom === 'negra' ? 'mulher-negra.png' : 'mulher-branca.png')
                : (tom === 'negra' ? 'homem-negro.png' : 'homem-branco.png');

            const avatarBody = document.getElementById('avatar-body-img');
            const avatarHair = document.getElementById('avatar-hair-img');
            const prajiedContainer = document.getElementById('prajied-arm-container');

            if (avatarBody) avatarBody.src = `/assets/avatar/${bodyFile}`;
            if (avatarHair) {
                this.updateHairElement(avatarHair, cabelo, bodyFile);
            }
            if (prajiedContainer) {
                const genderClass = isF ? 'prajied-mulher' : 'prajied-homem';
                const genderAttr = isF ? 'F' : 'M';
                prajiedContainer.className = `avatar-layer avatar-layer-prajied ${genderClass}`;
                prajiedContainer.setAttribute('data-gender', genderAttr);
                prajiedContainer.setAttribute('data-model', bodyFile);
            }

            // Fecha o modal suavemente
            const modal = document.getElementById('modal-skins');
            if (modal) modal.style.display = 'none';

        } catch (err) {
            console.error('Erro ao salvar personalização do avatar:', err);
            alert('Erro ao salvar personalização: ' + err.message);
        }
    },

    // -------------------------------------------------------------------------
    // MODAL AVISOS E CAMPANHAS
    // -------------------------------------------------------------------------
    getAvisosSignature(avisos) {
        if (!Array.isArray(avisos) || avisos.length === 0) return '';
        return avisos.map(a => `${a.id || ''}:${a.titulo || ''}:${a.data_evento || ''}`).join('|');
    },

    updateNoticesBadgeState() {
        const avisos = this.alunoData?.avisos_campanhas || [];
        const sig = this.getAvisosSignature(avisos);
        let readSig = '';
        try {
            readSig = localStorage.getItem('pro_combate_avisos_lidos_sig') || '';
        } catch {
            readSig = '';
        }
        const hasUnread = avisos.length > 0 && sig !== readSig;
        document.querySelectorAll('.mobile-badge-dot, .notification-badge').forEach(dot => {
            dot.style.display = hasUnread ? 'block' : 'none';
        });
    },

    openAvisosModal() {
        const modal = document.getElementById('modal-avisos');
        const list = document.getElementById('avisos-full-list');
        if (!modal || !list) return;

        const avisos = this.alunoData?.avisos_campanhas || [];

        // Apaga o ponto vermelho de notificação imediatamente e persiste leitura
        document.querySelectorAll('.mobile-badge-dot, .notification-badge').forEach(dot => {
            dot.style.display = 'none';
        });
        try {
            localStorage.setItem('pro_combate_avisos_lidos_sig', this.getAvisosSignature(avisos));
        } catch { /* ignore */ }

        if (avisos.length === 0) {
            list.innerHTML = `
                <div style="text-align: center; padding: 28px 16px; color: #94a3b8; font-size: 13px;">
                    Nenhum aviso ou comunicado recente no momento.
                </div>
            `;
        } else {
            list.innerHTML = avisos.map(a => {
                const tipoEsc = this.escapeHtml((a.tipo || 'aviso').toUpperCase());
                const tagEsc = this.escapeHtml(a.tag_destaque || 'PRO COMBATE');
                const tituloEsc = this.escapeHtml(a.titulo || '');
                const descEsc = this.escapeHtml(a.descricao || '');
                const dataEsc = a.data_evento ? this.escapeHtml(new Date(a.data_evento).toLocaleDateString('pt-BR')) : '';
                return `
                <div style="background: #14171d; border-radius: 12px; padding: 16px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.08);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 11px; font-weight: 700; color: #38bdf8; text-transform: uppercase;">${tipoEsc} • ${tagEsc}</span>
                        ${dataEsc ? `<span style="font-size: 11px; color: #94a3b8;">Data: ${dataEsc}</span>` : ''}
                    </div>
                    <h4 style="color: #ffffff; font-size: 15px; margin-bottom: 6px;">${tituloEsc}</h4>
                    <p style="color: #cbd5e1; font-size: 13px; line-height: 1.45;">${descEsc}</p>
                </div>
            `;
            }).join('');
        }

        modal.style.display = 'flex';
    },

    // -------------------------------------------------------------------------
    // FOTO DE PERFIL E MODAL AJUSTES DA CONTA DO ATLETA
    // -------------------------------------------------------------------------
    applyProfilePhotoUrl(fotoUrl, fallbackName = 'Atleta') {
        const cleanUrl = this.sanitizeUrl(fotoUrl);
        const defaultCardAvatar = document.getElementById('avatar-body-img')?.getAttribute('src') || '/assets/avatar/homem-branco.png';
        const fallbackUrl = defaultCardAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName || 'Atleta')}&background=dc2626&color=fff`;
        const resolvedUrl = cleanUrl || fallbackUrl;

        const pillImages = new Set([
            'header-avatar-img',
            'wiki-header-avatar-img',
            'faturas-header-avatar-img',
            'graduacoes-header-avatar-img'
        ].map(id => document.getElementById(id)).filter(Boolean));

        document.querySelectorAll('.student-profile-pill img').forEach(img => pillImages.add(img));

        pillImages.forEach(el => {
            el.onerror = () => {
                el.onerror = null;
                el.src = fallbackUrl;
            };
            el.src = resolvedUrl;
        });

        const cardHeaderAvatar = document.getElementById('card-header-avatar-img');
        if (cardHeaderAvatar) {
            cardHeaderAvatar.onerror = () => {
                cardHeaderAvatar.onerror = null;
                cardHeaderAvatar.src = defaultCardAvatar;
            };
            cardHeaderAvatar.src = cleanUrl || defaultCardAvatar;
        }

        const modalContaAvatar = document.getElementById('modal-conta-avatar-img');
        if (modalContaAvatar) {
            modalContaAvatar.onerror = () => {
                modalContaAvatar.onerror = null;
                modalContaAvatar.src = fallbackUrl;
            };
            modalContaAvatar.src = cleanUrl || fallbackUrl;
        }
    },

    async uploadNovaFotoPerfil(file) {
        if (!file) return;
        if (file.size > 6 * 1024 * 1024) {
            this.showToast('A imagem excede o limite máximo de 6MB.', 'error');
            return;
        }

        const labels = [
            document.getElementById('lbl-conta-foto-camera'),
            document.getElementById('lbl-conta-foto-galeria')
        ].filter(Boolean);
        labels.forEach(l => l.classList.add('is-uploading'));

        try {
            this.showToast('Atualizando foto de perfil...', 'info');
            const formData = new FormData();
            formData.append('foto', file, file.name || 'foto-perfil.jpg');

            const headers = {};
            if (this.authToken) {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const params = new URLSearchParams(window.location.search);
            const queryAlunoId = params.get('aluno_id') || this.alunoData?.aluno?.id;
            if (queryAlunoId && !this.authToken) {
                formData.append('aluno_id', String(queryAlunoId));
            }

            const res = await fetch('/api/aluno/foto-perfil', {
                method: 'POST',
                headers,
                body: formData
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Não foi possível atualizar a foto de perfil.');
            }

            const novaUrl = data.foto_perfil_url || data.url;
            if (this.alunoData?.aluno) {
                this.alunoData.aluno.foto_perfil_url = novaUrl;
            }

            try {
                const userRaw = localStorage.getItem('user');
                if (userRaw) {
                    const userObj = JSON.parse(userRaw);
                    userObj.foto_perfil_url = novaUrl;
                    localStorage.setItem('user', JSON.stringify(userObj));
                }
            } catch { /* ignore */ }

            this.applyProfilePhotoUrl(novaUrl, this.alunoData?.aluno?.nome_completo);
            this.showToast('Foto de perfil atualizada com sucesso!', 'success');
        } catch (err) {
            console.error('Erro ao alterar foto de perfil:', err);
            this.showToast(err.message || 'Erro ao atualizar foto de perfil.', 'error');
        } finally {
            labels.forEach(l => l.classList.remove('is-uploading'));
        }
    },

    openAccountModal() {
        const modal = document.getElementById('modal-conta');
        if (!modal) return;

        const aluno = this.alunoData?.aluno || {};
        const plano = this.alunoData?.plano || null;
        const graduacao = this.alunoData?.graduacao || {};

        const nameEl = document.getElementById('modal-conta-nome');
        const emailEl = document.getElementById('modal-conta-email');
        const phoneEl = document.getElementById('modal-conta-telefone');
        const matriculaEl = document.getElementById('modal-conta-matricula');
        const planoEl = document.getElementById('modal-conta-plano');
        const statusEl = document.getElementById('modal-conta-status');
        const prajiedEl = document.getElementById('modal-conta-prajied');
        const avatarImg = document.getElementById('modal-conta-avatar-img');

        if (nameEl) nameEl.textContent = aluno.nome_completo || aluno.primeiro_nome || 'Atleta';
        if (emailEl) emailEl.textContent = aluno.email || 'Não informado';
        if (phoneEl) phoneEl.textContent = aluno.telefone || 'Não informado';
        if (matriculaEl) matriculaEl.textContent = aluno.matricula ? `#${aluno.matricula}` : `#${aluno.id || '--'}`;
        if (planoEl) planoEl.textContent = plano?.nome || 'Muay Thai Geral';
        if (statusEl) {
            statusEl.textContent = plano ? 'Ativa' : 'Sem Plano';
            statusEl.style.color = plano ? '#10b981' : '#f59e0b';
        }
        if (prajiedEl) {
            const gradMt = graduacao.muay_thai || graduacao.atual;
            prajiedEl.textContent = gradMt?.nivel_nome || 'Prajied Atual';
        }
        this.applyProfilePhotoUrl(aluno.foto_perfil_url, aluno.nome_completo || aluno.primeiro_nome);

        const editWrap = document.getElementById('conta-telefone-edit-wrap');
        if (editWrap) editWrap.style.display = 'none';

        modal.style.display = 'flex';
    },

    maybeShowOverduePopup(plano) {
        if (!plano || !plano.has_atraso) return;
        const fatId = plano.fatura_aberta?.id || 'atraso';
        const seenKey = `overdue_popup_seen_${fatId}`;
        if (sessionStorage.getItem(seenKey)) return;
        sessionStorage.setItem(seenKey, '1');

        const popup = document.getElementById('modal-aviso-atraso');
        if (!popup) return;

        const titleEl = document.getElementById('popup-atraso-title');
        const subEl = document.getElementById('popup-atraso-sub');
        const descEl = document.getElementById('popup-atraso-desc');

        const qtd = plano.total_atrasadas || 1;
        if (titleEl) titleEl.textContent = `${qtd} Mensalidade${qtd > 1 ? 's' : ''} em Atraso`;

        const fat = plano.fatura_aberta;
        if (subEl) {
            if (fat && fat.data_vencimento) {
                const dFmt = new Date(fat.data_vencimento).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
                const vFmt = parseFloat(fat.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                subEl.textContent = `Venceu em ${dFmt} • ${vFmt}`;
            } else {
                subEl.textContent = 'Regularize via PIX ou Cartão';
            }
        }
        if (descEl) {
            descEl.textContent = 'Você possui mensalidade vencida em aberto. Acesse a aba de Faturas ou clique em "Pagar Agora" para regularizar.';
        }
        popup.style.display = 'flex';
    },

    async saveTelefoneAluno() {
        const input = document.getElementById('input-conta-telefone');
        const btn = document.getElementById('btn-salvar-telefone');
        const phoneEl = document.getElementById('modal-conta-telefone');
        const wrap = document.getElementById('conta-telefone-edit-wrap');
        if (!input) return;

        const telefone = input.value.trim();
        const digits = telefone.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 11) {
            alert('Informe um telefone/WhatsApp válido com DDD (10 ou 11 dígitos).');
            input.focus();
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Salvando...';
        }

        try {
            const urlParams = new URLSearchParams(window.location.search);
            const queryAlunoId = urlParams.get('aluno_id') || this.alunoData?.aluno?.id || null;
            const headers = { 'Content-Type': 'application/json' };
            const token = this.getAuthToken();
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch('/api/aluno/perfil/telefone', {
                method: 'PUT',
                headers,
                body: JSON.stringify({ telefone, aluno_id: queryAlunoId })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Erro ao atualizar telefone.');
            }

            if (this.alunoData?.aluno) {
                this.alunoData.aluno.telefone = data.telefone;
            }
            if (phoneEl) phoneEl.textContent = data.telefone;
            if (wrap) wrap.style.display = 'none';
        } catch (err) {
            alert(err.message || 'Erro ao atualizar telefone.');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Salvar';
            }
        }
    },

    // -------------------------------------------------------------------------
    // PRAJIED DE MUAY THAI NO BRAÇO DIREITO DO AVATAR
    // -------------------------------------------------------------------------
    renderPrajiedArm(graduacao, isFeminino, modeloFile) {
        const prajiedContainer = document.getElementById('prajied-arm-container');
        const prajiedImg = document.getElementById('avatar-prajied-img');
        const prajiedTooltip = document.getElementById('avatar-prajied-tooltip');
        const prajiedPill = document.getElementById('avatar-prajied-pill');
        const prajiedDot = document.getElementById('prajied-pill-dot');
        const prajiedText = document.getElementById('prajied-pill-text');

        if (!prajiedContainer) return;

        // Configura classe e atributos para diferenciar Homem vs Mulher
        const isF = isFeminino !== undefined 
            ? Boolean(isFeminino) 
            : String(this.alunoData?.aluno?.genero || '').toUpperCase() === 'F';
        const genderClass = isF ? 'prajied-mulher' : 'prajied-homem';
        const genderAttr = isF ? 'F' : 'M';

        prajiedContainer.className = `avatar-layer avatar-layer-prajied ${genderClass}`;
        prajiedContainer.setAttribute('data-gender', genderAttr);
        if (modeloFile) prajiedContainer.setAttribute('data-model', modeloFile);

        // Identifica se a graduação atual ou associada é de Muay Thai
        const mt = graduacao?.muay_thai || 
                   (graduacao?.atual?.modalidade?.toLowerCase().includes('muay') ? graduacao.atual : null);

        if (!mt) {
            prajiedContainer.style.display = 'none';
            if (prajiedPill) prajiedPill.style.display = 'none';
            return;
        }

        const corPrimaria = mt.cor_primaria || '#EAB308';
        const nivelNome = mt.nivel_nome || 'Prajied Muay Thai';
        const prajiedSrc = mt.prajied_icone_url || `/assets/prajied/prajied-${Math.min(12, Math.max(1, mt.ordem_hierarquica || 1))}.png`;

        if (prajiedImg) {
            prajiedImg.src = prajiedSrc;
            prajiedImg.alt = nivelNome;
        }

        if (prajiedTooltip) {
            prajiedTooltip.textContent = `${nivelNome} • Braço Direito`;
        }

        prajiedContainer.style.display = 'block';

        // Atualiza a pílula de rank de Muay Thai no avatar
        if (prajiedPill && prajiedDot && prajiedText) {
            prajiedPill.style.display = 'inline-flex';
            prajiedPill.style.borderColor = `${corPrimaria}66`;
            prajiedPill.style.background = `${corPrimaria}22`;
            prajiedPill.style.color = (corPrimaria === '#F8FAFC' || corPrimaria === '#FFFFFF') ? '#ffffff' : corPrimaria;
            prajiedDot.style.background = corPrimaria;
            prajiedDot.style.boxShadow = `0 0 8px ${corPrimaria}`;
            prajiedText.textContent = nivelNome;
        }

        prajiedContainer.onclick = () => {
            this.scrollToSection('#stat-graduacao-nome');
        };
    },

    /**
     * Renderiza o Currículo Técnico com as técnicas vinculadas à faixa atual e graduações anteriores
     */
    renderCurriculoTecnico(graduacao) {
        this.faixasProgresso = this.alunoData?.faixas_progresso || graduacao?.faixas_progresso || [];
        this.faixaAtual = this.alunoData?.faixa_atual || graduacao?.faixa_atual || null;
        this.faixasAnteriores = this.alunoData?.faixas_anteriores || graduacao?.faixas_anteriores || [];

        this.renderWikiSpaBeltTabs();
        this.renderWikiSpaGrid();
    },

    // -------------------------------------------------------------------------
    // SPA: VISÃO GERAL (DASHBOARD) VS WIKI DEDICADA VS FATURAS (BLACK DESIGN)
    // -------------------------------------------------------------------------

    /**
     * Alterna instantaneamente a visão entre Dashboard, Wiki, Faturas e Graduações (SPA dinâmico sem reload)
     */
    switchView(viewName, updateHash = true) {
        this.currentView = (viewName === 'wiki' || viewName === 'faturas' || viewName === 'graduacoes' || viewName === 'evolucao') ? viewName : 'dashboard';

        const dashboardView = document.getElementById('spa-view-dashboard');
        const wikiView = document.getElementById('spa-view-wiki');
        const faturasView = document.getElementById('spa-view-faturas');
        const graduacoesView = document.getElementById('spa-view-graduacoes');
        const evolucaoView = document.getElementById('spa-view-evolucao');
        const rightPanel = document.querySelector('.right-panel-dark');
        const shell = document.querySelector('.dashboard-shell');

        if (this.currentView === 'evolucao') {
            if (dashboardView) dashboardView.style.display = 'none';
            if (wikiView) wikiView.style.display = 'none';
            if (faturasView) faturasView.style.display = 'none';
            if (graduacoesView) graduacoesView.style.display = 'none';
            if (evolucaoView) evolucaoView.style.display = 'block';
            if (rightPanel) rightPanel.style.display = 'none';
            if (shell) shell.classList.add('wiki-spa-expanded');

            const aluno = this.alunoData?.aluno || {};
            const evName = document.getElementById('evolucao-header-student-name');
            const evAvatar = document.getElementById('evolucao-header-avatar-img');
            if (evName) evName.textContent = aluno.nome_completo || aluno.primeiro_nome || 'Atleta';
            if (evAvatar && aluno.foto_perfil_url) evAvatar.src = aluno.foto_perfil_url;

            this.openEvolutionModal();
        } else if (this.currentView === 'faturas') {
            if (dashboardView) dashboardView.style.display = 'none';
            if (wikiView) wikiView.style.display = 'none';
            if (graduacoesView) graduacoesView.style.display = 'none';
            if (evolucaoView) evolucaoView.style.display = 'none';
            if (faturasView) faturasView.style.display = 'block';
            if (rightPanel) rightPanel.style.display = 'none';
            if (shell) shell.classList.add('wiki-spa-expanded');

            // Atualiza botões do dock lateral
            document.querySelectorAll('.dock-btn[data-tab]').forEach(b => {
                b.classList.toggle('active', b.dataset.tab === 'faturas');
            });
            // Atualiza botões da barra inferior mobile
            document.querySelectorAll('.mobile-nav-item[data-tab]').forEach(b => {
                b.classList.toggle('active', b.dataset.tab === 'faturas');
            });

            this.carregarHistoricoFinanceiro();
        } else if (this.currentView === 'graduacoes') {
            if (dashboardView) dashboardView.style.display = 'none';
            if (wikiView) wikiView.style.display = 'none';
            if (faturasView) faturasView.style.display = 'none';
            if (evolucaoView) evolucaoView.style.display = 'none';
            if (graduacoesView) graduacoesView.style.display = 'block';
            if (rightPanel) rightPanel.style.display = 'none';
            if (shell) shell.classList.add('wiki-spa-expanded');

            document.querySelectorAll('.dock-btn[data-tab]').forEach(b => {
                b.classList.toggle('active', b.dataset.tab === 'graduacoes');
            });
            document.querySelectorAll('.mobile-nav-item[data-tab]').forEach(b => {
                b.classList.toggle('active', b.dataset.tab === 'graduacoes');
            });

            this.renderGraduacoesView();
        } else if (this.currentView === 'wiki') {
            if (dashboardView) dashboardView.style.display = 'none';
            if (faturasView) faturasView.style.display = 'none';
            if (graduacoesView) graduacoesView.style.display = 'none';
            if (evolucaoView) evolucaoView.style.display = 'none';
            if (wikiView) wikiView.style.display = 'block';
            if (rightPanel) rightPanel.style.display = 'none';
            if (shell) shell.classList.add('wiki-spa-expanded');

            // Atualiza botões do dock lateral
            document.querySelectorAll('.dock-btn[data-tab]').forEach(b => {
                b.classList.toggle('active', b.dataset.tab === 'tecnicas');
            });
            // Atualiza botões da barra inferior mobile
            document.querySelectorAll('.mobile-nav-item[data-tab]').forEach(b => {
                b.classList.toggle('active', b.dataset.tab === 'treinos');
            });

            this.renderWikiSpaView();
        } else {
            if (wikiView) wikiView.style.display = 'none';
            if (faturasView) faturasView.style.display = 'none';
            if (graduacoesView) graduacoesView.style.display = 'none';
            if (evolucaoView) evolucaoView.style.display = 'none';
            if (dashboardView) dashboardView.style.display = 'block';
            if (rightPanel) rightPanel.style.display = '';
            if (shell) shell.classList.remove('wiki-spa-expanded');

            // Atualiza botões do dock lateral
            document.querySelectorAll('.dock-btn[data-tab]').forEach(b => {
                b.classList.toggle('active', b.dataset.tab === 'visao-geral');
            });
            // Atualiza botões da barra inferior mobile
            document.querySelectorAll('.mobile-nav-item[data-tab]').forEach(b => {
                b.classList.toggle('active', b.dataset.tab === 'inicio');
            });
        }

        if (updateHash) {
            const hashMap = { faturas: '#faturas', graduacoes: '#graduacoes', evolucao: '#evolucao', wiki: '#wiki', dashboard: '#dashboard' };
            const hash = hashMap[this.currentView] || '#dashboard';
            if (window.location.hash !== hash) {
                history.pushState(null, '', hash);
            }
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    /**
     * Renderiza a seção SPA de Graduações e Avaliações Ponto a Ponto do Professor
     */
    renderGraduacoesView() {
        const aluno = this.alunoData?.aluno;
        if (aluno) {
            this.applyProfilePhotoUrl(aluno.foto_perfil_url || aluno.foto_url, aluno.nome_completo || aluno.nome);
            const nameEl = document.getElementById('graduacoes-header-student-name');
            if (nameEl) {
                nameEl.textContent = (aluno.primeiro_nome || aluno.nome || 'Atleta').split(' ')[0];
            }
        }

        const gradData = this.alunoData?.graduacao || {};
        const avaliacoes = Array.isArray(gradData.avaliacoes) ? gradData.avaliacoes : [];
        const atualNome = gradData.atual?.nivel_nome || 'Não definida';
        const avalAtual = avaliacoes.find(a => a.is_atual) || avaliacoes[0] || gradData.avaliacao || null;

        const elAtual = document.getElementById('grad-summary-atual');
        const elScore = document.getElementById('grad-summary-score');
        const elTotal = document.getElementById('grad-summary-total');

        if (elAtual) elAtual.textContent = atualNome;
        if (elScore) {
            if (avalAtual && avalAtual.total_pontos_possiveis > 0) {
                const pct = Math.round(Number(avalAtual.percentual_obtido) || 0);
                const ptsObt = Number(avalAtual.total_pontos_obtidos ?? avalAtual.pontos_obtidos) || 0;
                const ptsMax = Number(avalAtual.total_pontos_possiveis ?? avalAtual.pontos_possiveis) || 0;
                elScore.textContent = `${pct}% (${ptsObt}/${ptsMax} pts)`;
                elScore.className = `faturas-metric-val ${avalAtual.apto ? 'green' : 'amber'}`;
            } else {
                elScore.textContent = 'Sem avaliação';
                elScore.className = 'faturas-metric-val slate';
            }
        }
        if (elTotal) elTotal.textContent = String(avaliacoes.length);

        const listEl = document.getElementById('graduacoes-avaliacoes-list');
        if (!listEl) return;

        if (avaliacoes.length === 0) {
            listEl.innerHTML = `
                <div class="grad-empty-state">
                    <div class="grad-empty-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <circle cx="12" cy="8" r="6"/>
                            <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>
                        </svg>
                    </div>
                    <h3>Nenhuma avaliação de graduação registrada ainda</h3>
                    <p>Assim que seu professor lançar as notas ponto a ponto e observações da sua graduação, todo o detalhamento aparecerá aqui.</p>
                </div>
            `;
            return;
        }

        listEl.innerHTML = avaliacoes.map(av => {
            const corPrim = this.sanitizeColor(av.cor_primaria, '#38bdf8');
            const corSec = this.sanitizeColor(av.cor_secundaria, corPrim);
            const nivelEsc = this.escapeHtml(av.nivel_nome || 'Graduação');
            const modEsc = this.escapeHtml(av.modalidade_nome || 'Modalidade');
            const profEsc = av.professor_nome ? this.escapeHtml(av.professor_nome) : 'Equipe Técnica';
            const dataFmt = av.data_avaliacao
                ? new Date(av.data_avaliacao).toLocaleDateString('pt-BR')
                : 'Data não informada';

            const pct = Math.min(100, Math.max(0, Math.round(Number(av.percentual_obtido) || 0)));
            const minPct = Math.round(Number(av.porcentagem_minima) || 70);
            const ptsObt = Number(av.total_pontos_obtidos) || 0;
            const ptsMax = Number(av.total_pontos_possiveis) || 0;
            const statusClass = av.apto ? 'apto' : 'evolucao';
            const statusLabel = av.apto ? 'Apto para Graduação' : 'Em Evolução';

            const itens = Array.isArray(av.itens_avaliados) ? av.itens_avaliados : [];
            const itensHtml = itens.length > 0
                ? itens.map(it => {
                    const nota = Math.min(5, Math.max(0, parseInt(it.nota, 10) || 0));
                    const notaPct = Math.round((nota / 5) * 100);
                    const tone = nota >= 4 ? 'high' : (nota >= 3 ? 'mid' : 'low');
                    return `
                        <div class="grad-criterio-item">
                            <div class="grad-criterio-top">
                                <span class="grad-criterio-nome">${this.escapeHtml(it.item || 'Critério Técnico')}</span>
                                <span class="grad-criterio-nota ${tone}">${nota} / 5</span>
                            </div>
                            <div class="grad-criterio-bar-track">
                                <div class="grad-criterio-bar-fill ${tone}" style="width: ${notaPct}%;"></div>
                            </div>
                        </div>
                    `;
                }).join('')
                : `<p class="grad-no-items">Nenhum critério individual cadastrado para esta graduação.</p>`;

            const obsHtml = av.observacoes_professor
                ? `<div class="grad-obs-box">
                        <div class="grad-obs-label">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                            </svg>
                            <span>Observações do Professor</span>
                        </div>
                        <p class="grad-obs-text">${this.escapeHtml(av.observacoes_professor)}</p>
                   </div>`
                : `<div class="grad-obs-box empty">
                        <span class="grad-obs-empty-text">Nenhuma observação adicional registrada pelo professor nesta avaliação.</span>
                   </div>`;

            return `
                <article class="grad-eval-card ${av.is_atual ? 'is-current' : ''}">
                    <header class="grad-eval-header">
                        <div class="grad-eval-title-group">
                            <span class="grad-belt-swatch" style="background: linear-gradient(135deg, ${corPrim}, ${corSec});"></span>
                            <div>
                                <div class="grad-eval-badges">
                                    <span class="grad-mod-badge">${modEsc}</span>
                                    ${av.is_atual ? '<span class="grad-current-badge">Graduação Atual</span>' : ''}
                                </div>
                                <h3 class="grad-eval-nivel">${nivelEsc}</h3>
                                <div class="grad-eval-meta">
                                    <span>Avaliado por: <strong>${profEsc}</strong></span>
                                    <span>•</span>
                                    <span>${this.escapeHtml(dataFmt)}</span>
                                </div>
                            </div>
                        </div>

                        <div class="grad-eval-score-box">
                            <span class="grad-status-pill ${statusClass}">${statusLabel}</span>
                            <div class="grad-score-numbers">
                                <strong>${pct}%</strong>
                                <span>${ptsObt} / ${ptsMax} pts (mín. ${minPct}%)</span>
                            </div>
                        </div>
                    </header>

                    <div class="grad-overall-progress">
                        <div class="grad-overall-track">
                            <div class="grad-overall-fill ${statusClass}" style="width: ${pct}%;"></div>
                        </div>
                    </div>

                    <div class="grad-criterios-section">
                        <h4 class="grad-section-subtitle">Notas Ponto a Ponto</h4>
                        <div class="grad-criterios-grid">
                            ${itensHtml}
                        </div>
                    </div>

                    ${obsHtml}
                </article>
            `;
        }).join('');
    },

    /**
     * Renderiza o cabeçalho e os componentes da Wiki SPA
     */
    renderWikiSpaView() {
        const aluno = this.alunoData?.aluno;
        if (aluno) {
            const wikiName = document.getElementById('wiki-header-student-name');
            this.applyProfilePhotoUrl(aluno.foto_perfil_url, aluno.nome_completo || aluno.primeiro_nome);
            if (wikiName && aluno.primeiro_nome) wikiName.textContent = aluno.primeiro_nome;
        }

        const mt = this.alunoData?.graduacao?.muay_thai;
        const spaTitle = document.getElementById('wiki-spa-title');
        const spaDesc = document.getElementById('wiki-spa-desc');
        if (spaTitle && mt) {
            spaTitle.textContent = `Wiki Marcial • ${mt.nivel_nome || 'Graduação'}`;
        }
        if (spaDesc && mt) {
            spaDesc.textContent = `Currículo técnico oficial do seu nível (${mt.nivel_nome}) e acervo de faixas anteriores.`;
        }

        this.renderWikiSpaBeltTabs();
        this.renderWikiSpaGrid();
    },

    /**
     * Renderiza as abas de seleção de faixas da Wiki SPA
     */
    renderWikiSpaBeltTabs() {
        const container = document.getElementById('wiki-spa-belts-tabs');
        if (!container) return;

        if (this.faixasProgresso.length === 0) {
            container.innerHTML = '';
            return;
        }

        let totalGeral = 0;
        this.faixasProgresso.forEach(f => { totalGeral += (f.total_golpes || 0); });

        let html = '';

        // Aba da Faixa Atual (Destacada em Amarelo/Dourado)
        if (this.faixaAtual) {
            const isSel = this.wikiSpaFiltroFaixa === 'atual' || String(this.wikiSpaFiltroFaixa) === String(this.faixaAtual.nivel_id);
            html += `
                <button type="button" class="belt-tab-btn belt-tab-current ${isSel ? 'active' : ''}" onclick="PainelAlunoApp.selecionarFaixaWikiSpa('atual')">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <span>Faixa Atual: ${this.escapeHtml(this.faixaAtual.nivel_nome)}</span>
                    <span class="belt-badge-pill belt-badge-current">${this.faixaAtual.total_golpes || 0} técnicas</span>
                </button>
            `;
        }

        // Abas das Faixas Anteriores (Concluídas)
        this.faixasAnteriores.forEach(f => {
            const isSel = String(this.wikiSpaFiltroFaixa) === String(f.nivel_id);
            html += `
                <button type="button" class="belt-tab-btn ${isSel ? 'active' : ''}" onclick="PainelAlunoApp.selecionarFaixaWikiSpa(${f.nivel_id})">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    <span>${this.escapeHtml(f.nivel_nome)}</span>
                    <span class="belt-badge-pill belt-badge-past">${f.total_golpes || 0}</span>
                </button>
            `;
        });

        // Aba com todas as graduações
        if (this.faixasProgresso.length > 1) {
            const isSel = this.wikiSpaFiltroFaixa === 'todas';
            html += `
                <button type="button" class="belt-tab-btn ${isSel ? 'active' : ''}" onclick="PainelAlunoApp.selecionarFaixaWikiSpa('todas')">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
                    <span>Todas as Graduações</span>
                    <span class="belt-badge-pill belt-badge-past">${totalGeral} total</span>
                </button>
            `;
        }

        container.innerHTML = html;
    },

    selecionarFaixaWikiSpa(filtro) {
        this.wikiSpaFiltroFaixa = filtro;
        this.renderWikiSpaBeltTabs();
        this.renderWikiSpaGrid();
    },

    /**
     * Obtém a lista de golpes da Wiki SPA aplicando filtros de faixa, categoria e busca
     */
    obterGolpesWikiSpa() {
        let golpes = [];
        if (this.wikiSpaFiltroFaixa === 'atual') {
            golpes = this.faixaAtual ? (this.faixaAtual.golpes || []) : [];
        } else if (this.wikiSpaFiltroFaixa === 'todas') {
            this.faixasProgresso.forEach(f => {
                if (f.golpes && f.golpes.length > 0) {
                    golpes.push(...f.golpes);
                }
            });
        } else {
            const nivelId = parseInt(this.wikiSpaFiltroFaixa, 10);
            const faixa = this.faixasProgresso.find(f => f.nivel_id === nivelId);
            golpes = faixa ? (faixa.golpes || []) : [];
        }

        // Filtro por Categoria
        if (this.wikiSpaFiltroCategoria && this.wikiSpaFiltroCategoria !== 'todos') {
            golpes = golpes.filter(g => (g.categoria || '').toLowerCase() === this.wikiSpaFiltroCategoria.toLowerCase());
        }

        // Filtro por Busca de Texto
        if (this.wikiSpaBusca) {
            const q = this.wikiSpaBusca;
            golpes = golpes.filter(g => {
                const n = (g.nome || '').toLowerCase();
                const d = (g.descricao_geral || '').toLowerCase();
                const c = (g.categoria || '').toLowerCase();
                const niv = (g.nivel_nome || '').toLowerCase();
                return n.includes(q) || d.includes(q) || c.includes(q) || niv.includes(q);
            });
        }

        return golpes;
    },

    /**
     * Renderiza o grid de cards da Wiki SPA com badges explícitos de graduação
     */
    renderWikiSpaGrid() {
        const grid = document.getElementById('wiki-spa-cards-grid');
        if (!grid) return;

        const lista = this.obterGolpesWikiSpa();
        const totalBadge = document.getElementById('wiki-spa-total-badge');
        if (totalBadge) {
            totalBadge.textContent = `${lista.length} ${lista.length === 1 ? 'técnica disponível' : 'técnicas disponíveis'}`;
        }

        if (!lista || lista.length === 0) {
            const isFiltrado = (this.wikiSpaFiltroCategoria && this.wikiSpaFiltroCategoria !== 'todos') || this.wikiSpaBusca;
            let totalGeral = 0;
            this.faixasProgresso.forEach(f => { totalGeral += (f.total_golpes || 0); });

            grid.innerHTML = `
                <div class="curriculum-empty-box" style="grid-column: 1 / -1;">
                    <div class="curriculum-empty-icon">
                        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                            <path d="M12 8v4"/>
                            <path d="M12 16h.01"/>
                        </svg>
                    </div>
                    <h3 class="curriculum-empty-title">
                        ${isFiltrado ? 'Nenhuma técnica encontrada para os filtros selecionados' : 'Nenhuma técnica cadastrada para esta graduação'}
                    </h3>
                    <p class="curriculum-empty-desc">
                        ${isFiltrado 
                            ? 'Experimente alterar o termo de busca, selecionar outra categoria ou alternar para outra faixa.'
                            : 'A equipe técnica ainda está vinculando os movimentos para esta faixa. Você pode consultar as faixas anteriores ou todo o catálogo técnico.'}
                    </p>
                    <div style="margin-top: 16px; display: flex; justify-content: center; gap: 10px;">
                        <button type="button" class="btn-empty-reset" onclick="PainelAlunoApp.selecionarFaixaWikiSpa('todas'); document.querySelectorAll('#wiki-spa-category-pills .curriculum-pill').forEach(b => b.classList.toggle('active', b.dataset.category === 'todos')); PainelAlunoApp.wikiSpaFiltroCategoria='todos'; PainelAlunoApp.renderWikiSpaGrid();">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
                            <span>Ver Todas as Técnicas (${totalGeral})</span>
                        </button>
                    </div>
                </div>
            `;
            return;
        }

        grid.innerHTML = lista.map(g => {
            const nomeEsc = this.escapeHtml(g.nome);
            const catEsc = this.escapeHtml(g.categoria || 'Técnica');
            const descEsc = this.escapeHtml(g.descricao_geral || 'Siga as orientações para biomecânica correta e execução limpa.');
            const diffClass = `curriculum-tag-diff-${(g.nivel_dificuldade || 'iniciante').toLowerCase()}`;
            const diffLabel = (g.nivel_dificuldade || 'iniciante').charAt(0).toUpperCase() + (g.nivel_dificuldade || 'iniciante').slice(1);
            const totalPassos = parseInt(g.total_passos, 10) || 0;
            const capaUrl = this.sanitizeUrl(g.imagem_capa || g.imagem_capa_exibicao);

            // Badge explícito de Faixa Atual vs Faixa Anterior com ícones SVG consistentes
            const isAtual = Boolean(g.is_faixa_atual);
            const beltBadgeHtml = isAtual
                ? `<span class="card-belt-badge card-belt-badge-current" title="Técnica da sua faixa atual">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <span>Faixa Atual: ${this.escapeHtml(g.nivel_nome || 'Atual')}</span>
                   </span>`
                : `<span class="card-belt-badge card-belt-badge-past" title="Técnica de graduação anterior concluída">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    <span>${this.escapeHtml(g.nivel_nome || 'Anterior')}</span>
                   </span>`;

            const mediaHtml = capaUrl
                ? `<img src="${capaUrl}" alt="${nomeEsc}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'curriculum-media-placeholder\\'><svg width=\\'28\\' height=\\'28\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.8\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\' ry=\\'2\\'/><circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'/><polyline points=\\'21 15 16 10 5 21\\'/></svg><span>Sem Capa</span></div>'">`
                : `<div class="curriculum-media-placeholder">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        <span>Técnica da Faixa</span>
                   </div>`;

            const isDominado = Boolean(g.is_dominado);
            const statusToggleHtml = isDominado
                ? `<button type="button" class="btn-golpe-status-toggle is-dominado" onclick="PainelAlunoApp.toggleProgressoGolpe(${g.id}, 'em_treino')" title="Técnica dominada! Clique para alternar para Em Treino">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Dominado</span>
                   </button>`
                : `<button type="button" class="btn-golpe-status-toggle is-em-treino" onclick="PainelAlunoApp.toggleProgressoGolpe(${g.id}, 'dominado')" title="Clique para marcar como Dominado">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    <span>Em Treino</span>
                   </button>`;

            return `
                <div class="curriculum-strike-card">
                    <div class="curriculum-card-media" onclick="PainelAlunoApp.abrirPassoAPassoTecnica(${g.id})">
                        ${beltBadgeHtml}
                        ${mediaHtml}
                        <div class="curriculum-play-overlay">
                            <div class="curriculum-play-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                            </div>
                        </div>
                        <div class="curriculum-badge-steps">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            ${totalPassos} ${totalPassos === 1 ? 'passo' : 'passos'}
                        </div>
                    </div>
                    <div class="curriculum-card-body">
                        <div class="curriculum-card-meta" style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                                <span class="curriculum-tag">${catEsc}</span>
                                <span class="curriculum-tag ${diffClass}">${diffLabel}</span>
                            </div>
                            ${statusToggleHtml}
                        </div>
                        <h3 class="curriculum-card-title">${nomeEsc}</h3>
                        <p class="curriculum-card-desc">${descEsc}</p>
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Alterna o status de treino ou domínio de um golpe técnico com feedback instantâneo
     */
    async toggleProgressoGolpe(golpeId, novoStatus) {
        try {
            const alunoId = this.alunoData?.aluno?.id || 1;
            const headers = { 'Content-Type': 'application/json' };
            if (this.authToken && this.authToken !== 'null') {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const res = await fetch('/api/aluno/golpe-progresso', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    aluno_id: alunoId,
                    golpe_id: golpeId,
                    status: novoStatus
                })
            });

            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Erro ao atualizar progresso da técnica.');
            }

            // Atualiza o golpe na lista local da memória
            const atualizarLista = (lista) => {
                if (!Array.isArray(lista)) return;
                for (const g of lista) {
                    if (g.id === golpeId) {
                        g.status_progresso = novoStatus;
                        g.is_dominado = novoStatus === 'dominado';
                    }
                }
            };

            atualizarLista(this.curriculoGolpes);
            if (this.faixaAtual && Array.isArray(this.faixaAtual.golpes)) {
                atualizarLista(this.faixaAtual.golpes);
            }
            if (Array.isArray(this.faixasProgresso)) {
                this.faixasProgresso.forEach(f => atualizarLista(f.golpes));
            }
            if (this.alunoData?.golpes_faixa_atual) {
                atualizarLista(this.alunoData.golpes_faixa_atual);
            }

            // Atualiza prontidão do exame se retornado
            if (data.prontidao_exame) {
                if (this.alunoData) {
                    this.alunoData.prontidao_exame = data.prontidao_exame;
                }
                this.renderReadinessCard(data.prontidao_exame);
            }

            // Re-renderiza o grid da Wiki SPA
            this.renderWikiSpaGrid();

        } catch (err) {
            console.error('Falha ao alternar status do golpe:', err);
            alert('Não foi possível salvar o progresso: ' + err.message);
        }
    },

    /**
     * Abre o modal com os passos ilustrados da técnica
     */
    async abrirPassoAPassoTecnica(golpeId) {
        try {
            const headers = {};
            if (this.authToken && this.authToken !== 'null') {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const res = await fetch(`/api/aluno/golpe/${golpeId}`, { headers });
            const data = await res.json();

            if (!res.ok || !data.success || !data.golpe) {
                throw new Error(data.error || 'Não foi possível carregar os detalhes da técnica.');
            }

            const g = data.golpe;
            this.currentTecnicaVisualizacao = g;
            this.currentPassoIndex = 0;

            const modalTitle = document.getElementById('modal-tecnica-nome');
            const modalDesc = document.getElementById('modal-tecnica-desc');
            const modalTags = document.getElementById('modal-tecnica-tags');

            if (modalTitle) modalTitle.textContent = g.nome;
            if (modalDesc) modalDesc.textContent = g.descricao_geral || 'Acompanhe a sequência biomecânica para dominar a técnica com perfeição e precisão marcial.';

            if (modalTags) {
                const diffLabel = (g.nivel_dificuldade || 'iniciante').toUpperCase();
                modalTags.innerHTML = `
                    <span class="curriculum-tag">${this.escapeHtml(g.modalidade_nome || 'Livre')}</span>
                    <span class="curriculum-tag">${this.escapeHtml(g.categoria || 'Técnica')}</span>
                    <span class="curriculum-tag curriculum-tag-diff-${(g.nivel_dificuldade || 'iniciante').toLowerCase()}">${diffLabel}</span>
                `;
            }

            this.renderPassoTecnica();

            const modal = document.getElementById('modal-visualizar-tecnica');
            if (modal) modal.style.display = 'flex';

        } catch (err) {
            console.error('Erro ao abrir passo a passo da técnica:', err);
            alert(err.message || 'Erro ao carregar detalhes da técnica.');
        }
    },

    /**
     * Renderiza o passo ativo do visualizador
     */
    renderPassoTecnica() {
        if (!this.currentTecnicaVisualizacao) return;

        const passos = this.currentTecnicaVisualizacao.passos || [];
        const total = passos.length;

        const indicator = document.getElementById('modal-passo-indicator');
        const tituloEl = document.getElementById('modal-passo-titulo');
        const descEl = document.getElementById('modal-passo-descricao');
        const imgWrap = document.getElementById('modal-passo-img-wrap');
        const imgEl = document.getElementById('modal-passo-img');
        const btnAnt = document.getElementById('btn-tecnica-anterior');
        const btnProx = document.getElementById('btn-tecnica-proximo');
        const dotsContainer = document.getElementById('modal-tecnica-dots');

        if (total === 0) {
            if (indicator) indicator.textContent = 'Passo 0 de 0';
            if (tituloEl) tituloEl.textContent = 'Sem passos cadastrados';
            if (descEl) descEl.textContent = 'Esta técnica ainda não possui etapas descritas detalhadamente.';
            if (imgWrap) imgWrap.style.display = 'none';
            if (btnAnt) btnAnt.disabled = true;
            if (btnProx) btnProx.disabled = true;
            if (dotsContainer) dotsContainer.innerHTML = '';
            return;
        }

        const passo = passos[this.currentPassoIndex];

        if (indicator) indicator.textContent = `Passo ${this.currentPassoIndex + 1} de ${total}`;
        if (tituloEl) tituloEl.textContent = passo.titulo || `Etapa ${this.currentPassoIndex + 1}`;
        if (descEl) descEl.textContent = passo.descricao;

        const imgUrl = this.sanitizeUrl(passo.imagem_url);
        if (imgWrap && imgEl) {
            if (imgUrl) {
                imgWrap.style.display = 'flex';
                imgEl.src = imgUrl;
                imgEl.alt = passo.titulo || 'Etapa do Golpe';
            } else {
                imgWrap.style.display = 'none';
                imgEl.src = '';
            }
        }

        if (btnAnt) btnAnt.disabled = this.currentPassoIndex === 0;
        if (btnProx) btnProx.disabled = this.currentPassoIndex === (total - 1);

        if (dotsContainer) {
            dotsContainer.innerHTML = passos.map((_, idx) => `
                <div class="tecnica-dot ${idx === this.currentPassoIndex ? 'active' : ''}" 
                     title="Ir para o Passo ${idx + 1}" 
                     onclick="PainelAlunoApp.irParaPasso(${idx})"></div>
            `).join('');
        }
    },

    passoAnterior() {
        if (this.currentPassoIndex > 0) {
            this.currentPassoIndex--;
            this.renderPassoTecnica();
        }
    },

    passoProximo() {
        if (this.currentTecnicaVisualizacao && this.currentPassoIndex < (this.currentTecnicaVisualizacao.passos.length - 1)) {
            this.currentPassoIndex++;
            this.renderPassoTecnica();
        }
    },

    irParaPasso(idx) {
        if (this.currentTecnicaVisualizacao && idx >= 0 && idx < this.currentTecnicaVisualizacao.passos.length) {
            this.currentPassoIndex = idx;
            this.renderPassoTecnica();
        }
    },

    // =========================================================================
    // MÓDULO DE EXAMES DE GRADUAÇÃO & INTEGRAÇÃO COM GATEWAY ASAAS
    // =========================================================================
    async loadMeusExames() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const queryAlunoId = urlParams.get('aluno_id');
            let endpoint = '/api/aluno/meus-exames';
            if (queryAlunoId) {
                endpoint += `?aluno_id=${encodeURIComponent(queryAlunoId)}`;
            }

            const headers = {};
            if (this.authToken && this.authToken !== 'null') {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const res = await fetch(endpoint, { headers });
            const data = await res.json();
            if (data.success) {
                this.meusExames = data.data || [];
                this.renderExamBanner();
                // Se o modal estiver aberto, atualiza
                if (this.modalExameAtivoId) {
                    this.abrirModalExame(this.modalExameAtivoId);
                }
            }
        } catch (err) {
            console.error('Falha ao carregar exames do atleta:', err);
        }
    },

    renderExamBanner() {
        const container = document.getElementById('exam-invitation-container');
        if (!container) return;

        // Procura primeiro por convite ativo pendente ou aceito, ou pago recentemente
        const ativo = this.meusExames.find(e => ['convidado', 'aceito', 'pago'].includes(e.convite_status));
        if (!ativo) {
            container.style.display = 'none';
            container.innerHTML = '';
            return;
        }

        const dataFmt = ativo.data_evento ? new Date(ativo.data_evento).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '--';
        const valorFmt = parseFloat(ativo.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

        let statusPill = '';
        let actionBtn = '';

        if (ativo.convite_status === 'convidado') {
            statusPill = `<span class="stat-pill pill-amber" style="background: rgba(245, 158, 11, 0.15); color: #d97706; font-weight: 700;">Nova Convocação Oficial</span>`;
            actionBtn = `
                <button type="button" class="btn btn-primary" onclick="PainelAlunoApp.abrirModalExame(${ativo.convite_id})" style="background: linear-gradient(135deg, #d97706, #b45309); border: none; padding: 10px 18px; border-radius: 10px; font-weight: 700; color: #fff; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(217, 119, 6, 0.25);">
                    <span>Confirmar Presença & Inscrição</span>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            `;
        } else if (ativo.convite_status === 'aceito') {
            statusPill = `<span class="stat-pill pill-cyan" style="background: rgba(2, 132, 199, 0.15); color: #0284c7; font-weight: 700;">Aguardando Pagamento</span>`;
            actionBtn = `
                <button type="button" class="btn btn-primary" onclick="PainelAlunoApp.abrirModalExame(${ativo.convite_id})" style="background: linear-gradient(135deg, #0284c7, #0369a1); border: none; padding: 10px 18px; border-radius: 10px; font-weight: 700; color: #fff; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.25);">
                    <span>Concluir Pagamento PIX (R$ ${valorFmt})</span>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            `;
        } else if (ativo.convite_status === 'pago') {
            statusPill = `<span class="stat-pill" style="background: rgba(22, 163, 74, 0.15); color: #16a34a; font-weight: 700;">✓ Inscrição Confirmada & Paga</span>`;
            actionBtn = `
                <button type="button" class="btn btn-secondary" onclick="PainelAlunoApp.abrirModalExame(${ativo.convite_id})" style="padding: 10px 16px; border-radius: 10px; font-weight: 600; cursor: pointer; border: 1px solid #cbd5e1; background: #fff; color: #334155;">
                    Ver Detalhes do Exame
                </button>
            `;
        }

        container.style.display = 'block';
        container.innerHTML = `
            <div class="exam-banner-card" style="background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 50%, #fff 100%); border: 1.5px solid #fde68a; border-radius: 16px; padding: 20px 24px; box-shadow: 0 6px 20px rgba(217, 119, 6, 0.08); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 18px;">
                <div style="display: flex; align-items: center; gap: 16px; flex: 1; min-width: 280px;">
                    <div style="width: 52px; height: 52px; border-radius: 14px; background: linear-gradient(135deg, #d97706, #b45309); display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; box-shadow: 0 4px 12px rgba(217, 119, 6, 0.3);">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="8" r="6" />
                            <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
                        </svg>
                    </div>
                    <div>
                        <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 4px;">
                            ${statusPill}
                            <span style="font-size: 12px; color: #78350f; font-weight: 600;">${this.escapeHtml(ativo.modalidade_nome)}</span>
                        </div>
                        <h3 style="font-size: 17px; font-weight: 800; color: #78350f; margin: 0 0 4px 0;">
                            ${this.escapeHtml(ativo.evento_titulo)}
                        </h3>
                        <p style="font-size: 13px; color: #92400e; margin: 0; line-height: 1.4;">
                            Você foi indicado para a graduação <strong>${this.escapeHtml(ativo.graduacao_pretendida_nome)}</strong>! Data: <strong>${dataFmt}</strong> às <strong>${ativo.horario_inicio ? ativo.horario_inicio.substring(0, 5) : '09:00'}</strong> no <strong>${this.escapeHtml(ativo.local_evento || 'Dojo Central')}</strong>.
                        </p>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    ${actionBtn}
                </div>
            </div>
        `;
    },

    abrirModalExame(conviteId) {
        const convite = this.meusExames.find(c => c.convite_id === conviteId);
        if (!convite) return;

        this.modalExameAtivoId = conviteId;

        const dataFmt = convite.data_evento ? new Date(convite.data_evento).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '--';
        const valorFmt = parseFloat(convite.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

        document.getElementById('modal-exame-titulo').textContent = convite.evento_titulo;
        document.getElementById('modal-exame-subtitulo').textContent = `Convocação Oficial • ${convite.modalidade_nome}`;
        document.getElementById('modal-exame-modalidade-badge').textContent = convite.modalidade_nome;
        document.getElementById('modal-exame-grad-atual').textContent = convite.graduacao_atual_nome;
        document.getElementById('modal-exame-grad-pretendida').textContent = convite.graduacao_pretendida_nome;
        document.getElementById('modal-exame-data').textContent = dataFmt;
        document.getElementById('modal-exame-horario').textContent = convite.horario_inicio ? convite.horario_inicio.substring(0, 5) : '09:00';
        document.getElementById('modal-exame-local').textContent = convite.local_evento || 'Dojo Central - Pro Combate';
        document.getElementById('modal-exame-valor').textContent = `R$ ${valorFmt}`;
        document.getElementById('modal-exame-descricao').textContent = convite.evento_descricao || 'Comparecer com uniforme/kimono oficial e antecedência de 15 minutos.';

        // Status Badge
        const statusBadgeContainer = document.getElementById('modal-exame-status-badge');
        if (convite.convite_status === 'pago') {
            statusBadgeContainer.innerHTML = '<span style="font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 6px; background: rgba(22, 163, 74, 0.15); color: #16a34a;">✓ Inscrição Paga</span>';
        } else if (convite.convite_status === 'aceito') {
            statusBadgeContainer.innerHTML = '<span style="font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 6px; background: rgba(2, 132, 199, 0.15); color: #0284c7;">Aguardando Pagamento</span>';
        } else if (convite.convite_status === 'recusado') {
            statusBadgeContainer.innerHTML = '<span style="font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 6px; background: rgba(239, 68, 68, 0.15); color: #dc2626;">Recusado</span>';
        } else {
            statusBadgeContainer.innerHTML = '<span style="font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 6px; background: rgba(245, 158, 11, 0.15); color: #d97706;">Convocação Pendente</span>';
        }

        // Renderiza Box de Pagamento Asaas
        const cobrancaBox = document.getElementById('modal-exame-cobranca-container');
        if (convite.convite_status === 'pago') {
            cobrancaBox.innerHTML = `
                <div style="background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 14px; padding: 20px; text-align: center;">
                    <div style="width: 50px; height: 50px; border-radius: 50%; background: #22c55e; color: #fff; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto; font-size: 24px; font-weight: 800;">
                        ✓
                    </div>
                    <h4 style="font-size: 16px; font-weight: 800; color: #166534; margin: 0 0 6px 0;">Sua vaga no exame está confirmada!</h4>
                    <p style="font-size: 13px; color: #15803d; margin: 0 0 14px 0; line-height: 1.4;">
                        O pagamento da taxa de exame foi compensado com sucesso. Parabéns pela dedicação aos treinos marciais!
                    </p>
                    <div style="font-size: 12px; color: #64748b;">
                        Data do pagamento: <strong>${convite.data_pagamento ? new Date(convite.data_pagamento).toLocaleString('pt-BR') : 'Hoje'}</strong>
                    </div>
                </div>
            `;
        } else if (convite.convite_status === 'aceito' || (convite.asaas_payment_id && convite.convite_status !== 'recusado')) {
            // Já aceitou ou tem cobrança gerada no Asaas
            const pixQrCodeSrc = convite.asaas_pix_qrcode ? (convite.asaas_pix_qrcode.startsWith('data:') ? convite.asaas_pix_qrcode : `data:image/png;base64,${convite.asaas_pix_qrcode}`) : '';
            const pixCopiaCola = convite.asaas_pix_copia_cola || '00020101021226840014br.gov.bcb.pix2562pro-combate-graduacao';

            cobrancaBox.innerHTML = `
                <div style="background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 14px; padding: 20px;">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 12px;">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                        <h4 style="font-size: 15px; font-weight: 800; color: #0f172a; margin: 0;">Pagamento da Taxa de Graduação</h4>
                    </div>

                    <!-- Seletor de Método de Pagamento -->
                    <div class="pay-methods-tabs" style="margin-bottom: 16px;">
                        <button type="button" class="btn-pay-tab active" id="tab-btn-pay-pix-exame" onclick="PainelAlunoApp.alternarMetodoPagamento('pix', 'exame')">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                            <span>PIX Instantâneo</span>
                        </button>
                        <button type="button" class="btn-pay-tab tab-card" id="tab-btn-pay-card-exame" onclick="PainelAlunoApp.alternarMetodoPagamento('cartao', 'exame')">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="1" y="4" width="22" height="16" rx="3" ry="3"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                            <span>Cartão de Crédito</span>
                        </button>
                    </div>

                    <!-- Box PIX Exame -->
                    <div id="box-pay-pix-exame" style="text-align: center;">
                        <p style="font-size: 13px; color: #64748b; margin: 0 0 16px 0;">
                            Escaneie o QR Code PIX abaixo ou copie o código Copia e Cola para pagar pelo aplicativo do seu banco:
                        </p>

                        ${pixQrCodeSrc ? `
                            <div style="display: flex; justify-content: center; margin-bottom: 16px;">
                                <div style="padding: 10px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                                    <img src="${pixQrCodeSrc}" alt="QR Code Pix" style="width: 180px; height: 180px; display: block; object-fit: contain;">
                                </div>
                            </div>
                        ` : ''}

                        <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                            <input type="text" id="input-pix-copia-cola" readonly value="${this.escapeHtml(pixCopiaCola)}" 
                                   style="flex: 1; padding: 10px 12px; font-size: 12px; font-family: monospace; background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; color: #334155;">
                            <button type="button" id="btn-copiar-pix-code" onclick="PainelAlunoApp.copiarPixCopiaCola()" 
                                    style="padding: 10px 14px; font-size: 12px; font-weight: 700; background: #0284c7; color: #fff; border: none; border-radius: 8px; cursor: pointer; white-space: nowrap;">
                                Copiar PIX
                            </button>
                        </div>

                        <div style="display: flex; justify-content: center; gap: 10px; flex-wrap: wrap;">
                            ${this.sanitizeUrl(convite.asaas_invoice_url) ? `
                                <a href="${this.sanitizeUrl(convite.asaas_invoice_url)}" target="_blank" rel="noopener noreferrer"
                                   style="padding: 10px 16px; border-radius: 8px; background: #fff; border: 1.5px solid #0284c7; color: #0284c7; font-weight: 700; font-size: 12.5px; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
                                    <span>🔗 Abrir Fatura / Cartão</span>
                                </a>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Box Cartão Exame -->
                    <div id="box-pay-card-exame" style="display: none; background: #0f172a; border-radius: 14px; padding: 18px; color: #fff;">
                        <div class="credit-card-preview" style="background: linear-gradient(135deg, #1e293b 0%, #0b1120 100%);">
                            <div class="card-preview-top">
                                <div class="card-chip-sim"></div>
                                <div class="card-brand-badge" id="preview-brand-exame">CARTÃO</div>
                            </div>
                            <div class="card-preview-number" id="preview-number-exame">•••• •••• •••• ••••</div>
                            <div class="card-preview-bottom">
                                <div>
                                    <div class="card-preview-holder-label">Titular</div>
                                    <div class="card-preview-holder-val" id="preview-holder-exame">${this.escapeHtml(this.currentAlunoData?.nome || 'NOME DO TITULAR')}</div>
                                </div>
                                <div>
                                    <div class="card-preview-expiry-label">Validade</div>
                                    <div class="card-preview-expiry-val" id="preview-expiry-exame">MM/AA</div>
                                </div>
                            </div>
                        </div>

                        <form class="credit-card-form" onsubmit="event.preventDefault(); PainelAlunoApp.submeterPagamentoCartaoExame(${convite.convite_id});">
                            <div class="cc-form-group">
                                <label style="color: #cbd5e1;">Número do Cartão</label>
                                <input type="text" id="cc-number-exame" class="cc-input" placeholder="0000 0000 0000 0000" maxlength="19" required
                                       oninput="PainelAlunoApp.onCardNumberInput(this, 'exame')">
                            </div>
                            <div class="cc-form-group">
                                <label style="color: #cbd5e1;">Nome Impresso no Cartão</label>
                                <input type="text" id="cc-holder-exame" class="cc-input" placeholder="Como impresso no cartão" required
                                       value="${this.escapeHtml(this.currentAlunoData?.nome || '')}"
                                       oninput="PainelAlunoApp.onCardHolderInput(this, 'exame')">
                            </div>
                            <div class="cc-form-row">
                                <div class="cc-form-group">
                                    <label style="color: #cbd5e1;">Validade</label>
                                    <input type="text" id="cc-expiry-exame" class="cc-input" placeholder="MM/AA" maxlength="5" required
                                           oninput="PainelAlunoApp.onCardExpiryInput(this, 'exame')">
                                </div>
                                <div class="cc-form-group">
                                    <label style="color: #cbd5e1;">CVV / Cód.</label>
                                    <input type="password" id="cc-cvv-exame" class="cc-input" placeholder="123" maxlength="4" required
                                           oninput="this.value = this.value.replace(/\\D/g, '').slice(0, 4)">
                                </div>
                            </div>
                            <div class="cc-form-row">
                                <div class="cc-form-group">
                                    <label style="color: #cbd5e1;">CPF do Titular</label>
                                    <input type="text" id="cc-cpf-exame" class="cc-input" placeholder="000.000.000-00" maxlength="14"
                                           value="${this.escapeHtml(this.currentAlunoData?.cpf || '')}">
                                </div>
                                <div class="cc-form-group">
                                    <label style="color: #cbd5e1;">Parcelamento</label>
                                    <select id="cc-installments-exame" class="cc-input" style="background: rgba(15, 23, 42, 0.95);">
                                        <option value="1">1x de R$ ${valorFmt} à vista</option>
                                    </select>
                                </div>
                            </div>
                            <button type="submit" class="btn-submit-card-pay" id="btn-submit-cc-exame">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="1" y="4" width="22" height="16" rx="3" ry="3"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                                <span>Pagar R$ ${valorFmt} no Cartão</span>
                            </button>
                            <div class="pay-security-badge">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                <span>Pagamento 100% Criptografado & Seguro PCI-DSS</span>
                            </div>
                        </form>
                    </div>
                </div>
            `;
        } else {
            // Status Convidado
            cobrancaBox.innerHTML = `
                <div style="text-align: center; padding: 12px 0;">
                    <p style="font-size: 13.5px; color: #475569; margin: 0 0 18px 0; line-height: 1.5;">
                        Deseja aceitar a convocação para o exame de graduação? Ao aceitar, o sistema gerará imediatamente o Pix QR Code e a fatura para pagamento da taxa de <strong>R$ ${valorFmt}</strong>.
                    </p>
                    <div style="display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;">
                        <button type="button" onclick="PainelAlunoApp.recusarConviteExame(${convite.convite_id})" 
                                style="padding: 11px 18px; border-radius: 10px; border: 1px solid #cbd5e1; background: #fff; color: #64748b; font-weight: 600; font-size: 13px; cursor: pointer;">
                            Não Posso Participar
                        </button>
                        <button type="button" onclick="PainelAlunoApp.aceitarConviteExame(${convite.convite_id})" 
                                style="padding: 11px 22px; border-radius: 10px; border: none; background: linear-gradient(135deg, #d97706, #b45309); color: #fff; font-weight: 800; font-size: 13.5px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 14px rgba(217, 119, 6, 0.3);">
                            <span>Confirmar e Gerar PIX</span>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                        </button>
                    </div>
                </div>
            `;
        }

        const modal = document.getElementById('modal-exame-aluno');
        if (modal) modal.style.display = 'flex';
    },

    async aceitarConviteExame(conviteId, billingType = 'PIX') {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const queryAlunoId = urlParams.get('aluno_id');

            const headers = { 'Content-Type': 'application/json' };
            if (this.authToken && this.authToken !== 'null') {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const bodyPayload = { billing_type: billingType };
            if (queryAlunoId) bodyPayload.aluno_id = parseInt(queryAlunoId, 10);

            const res = await fetch(`/api/aluno/exames/${conviteId}/aceitar`, {
                method: 'POST',
                headers,
                body: JSON.stringify(bodyPayload)
            });

            const data = await res.json();
            if (!data.success) {
                alert(data.error || 'Erro ao aceitar convite.');
                return;
            }

            await this.loadMeusExames();
            this.abrirModalExame(conviteId);

        } catch (err) {
            console.error('Erro ao aceitar convite:', err);
            alert('Falha ao processar aceite do exame: ' + err.message);
        }
    },

    async recusarConviteExame(conviteId) {
        const motivo = prompt('Por qual motivo você não poderá participar deste exame (ex: viagem, lesão, trabalho)?');
        if (motivo === null) return; // cancelou

        try {
            const urlParams = new URLSearchParams(window.location.search);
            const queryAlunoId = urlParams.get('aluno_id');
            const alunoId = this.alunoData?.aluno?.id || (queryAlunoId ? parseInt(queryAlunoId, 10) : 1);
            const exameId = this.alunoData?.exame_proximo?.id;

            const headers = { 'Content-Type': 'application/json' };
            if (this.authToken && this.authToken !== 'null') {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const bodyPayload = { motivo };
            if (queryAlunoId) bodyPayload.aluno_id = parseInt(queryAlunoId, 10);

            let endpoint = conviteId 
                ? `/api/aluno/exames/${conviteId}/recusar`
                : (exameId ? `/api/aluno/exames/${exameId}/recusar-evento` : null);

            if (!endpoint) {
                alert('Evento de exame não identificado.');
                return;
            }

            const res = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(bodyPayload)
            });

            const data = await res.json();
            if (!data.success) {
                alert(data.error || 'Erro ao registrar recusa.');
                return;
            }

            // Persiste recusa e ciência localmente para JAMAIS reexibir o pop-up
            if (exameId) {
                localStorage.setItem(`graduacao_recusada_${alunoId}_${exameId}`, 'true');
                localStorage.setItem(`graduacao_ciente_${alunoId}_${exameId}`, 'true');
            }

            if (this.alunoData && this.alunoData.exame_proximo) {
                this.alunoData.exame_proximo.convite_status = 'recusado';
            }

            const modalExame = document.getElementById('modal-exame-aluno');
            if (modalExame) modalExame.style.display = 'none';

            const modalConvocacao = document.getElementById('modal-convocacao-exame');
            if (modalConvocacao) modalConvocacao.style.display = 'none';

            this.showToast('Desistência registrada com sucesso. Seu professor foi notificado.', 'info');

            await this.loadMeusExames();
            if (this.alunoData) {
                this.renderDashboard(this.alunoData);
            }

        } catch (err) {
            console.error('Erro ao recusar convite:', err);
            alert('Falha ao registrar recusa: ' + err.message);
        }
    },

    async simularPagamentoExame(conviteId) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.authToken && this.authToken !== 'null') {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const res = await fetch(`/api/aluno/exames/${conviteId}/simular-pagamento`, {
                method: 'POST',
                headers,
                body: JSON.stringify({})
            });

            const data = await res.json();
            if (!data.success) {
                alert(data.error || 'Erro ao simular pagamento.');
                return;
            }

            await this.loadMeusExames();
            this.abrirModalExame(conviteId);

        } catch (err) {
            console.error('Erro ao simular pagamento:', err);
            alert('Falha na simulação: ' + err.message);
        }
    },

    copiarPixCopiaCola() {
        const input = document.getElementById('input-pix-copia-cola');
        if (!input) return;

        input.select();
        input.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(input.value).then(() => {
            const btn = document.getElementById('btn-copiar-pix-code');
            if (btn) {
                const oldText = btn.textContent;
                btn.textContent = '✓ Copiado!';
                btn.style.background = '#16a34a';
                setTimeout(() => {
                    btn.textContent = oldText;
                    btn.style.background = '#0284c7';
                }, 2000);
            }
        }).catch(err => {
            console.error('Erro ao copiar Pix:', err);
        });
    },

    // =========================================================================
    // CONVOCAÇÃO OBRIGATÓRIA & BOTÃO DE INSCRIÇÃO DO EXAME DE GRADUAÇÃO
    // =========================================================================
    renderBotaoEPopUpExame({ isApto, exame, data, aluno, graduacao }) {
        const actionWrap = document.getElementById('card-next-rank-action-wrap');
        const btnInscrever = document.getElementById('btn-inscrever-exame');
        const btnText = document.getElementById('btn-inscrever-exame-text');

        if (!actionWrap || !btnInscrever) return;

        // Condição: Aluno elegível e existe exame de graduação aberto
        const elegivelComExame = Boolean(isApto && exame && exame.id);

        if (!elegivelComExame) {
            actionWrap.style.display = 'none';
            return;
        }

        actionWrap.style.display = 'block';

        const conviteStatus = exame.convite_status;
        if (conviteStatus === 'pago') {
            btnInscrever.className = 'btn-inscrever-exame btn-exame-pago';
            if (btnText) btnText.textContent = '✓ Inscrição Confirmada & Paga';
        } else if (conviteStatus === 'aceito') {
            btnInscrever.className = 'btn-inscrever-exame btn-exame-pendente';
            if (btnText) btnText.textContent = '💳 Concluir Pagamento PIX';
        } else if (conviteStatus === 'recusado') {
            btnInscrever.className = 'btn-inscrever-exame btn-exame-recusado';
            if (btnText) btnText.textContent = '❌ Desistência Registrada • Mudar de Ideia?';
        } else {
            btnInscrever.className = 'btn-inscrever-exame';
            if (btnText) btnText.textContent = '🥋 Inscrever-se no Exame de Graduação';
        }

        // Verifica se o atleta já marcou ciência expressa ou desistência deste exame
        const alunoId = aluno?.id || 1;
        const exameId = exame.id;
        const chaveCiencia = `graduacao_ciente_${alunoId}_${exameId}`;
        const chaveRecusa = `graduacao_recusada_${alunoId}_${exameId}`;
        const jaCiente = localStorage.getItem(chaveCiencia) === 'true';
        const jaRecusou = localStorage.getItem(chaveRecusa) === 'true';

        // Se o atleta recusou (no banco OU localmente) OU já está pago OU já confirmou ciência: NUNCA abre o pop-up!
        if (!jaCiente && !jaRecusou && conviteStatus !== 'pago' && conviteStatus !== 'recusado') {
            this.abrirModalConvocacao(exame, graduacao, aluno);
        }
    },

    abrirModalConvocacao(exame, graduacao, aluno) {
        if (!exame) return;

        const modal = document.getElementById('modal-convocacao-exame');
        if (!modal) return;

        const tituloEl = document.getElementById('modal-convocacao-evento-titulo');
        const modEl = document.getElementById('modal-convocacao-modalidade');
        const atualEl = document.getElementById('modal-convocacao-grad-atual');
        const pretEl = document.getElementById('modal-convocacao-grad-pretendida');
        const dataEl = document.getElementById('modal-convocacao-data');
        const horaEl = document.getElementById('modal-convocacao-horario');
        const localEl = document.getElementById('modal-convocacao-local');
        const taxaEl = document.getElementById('modal-convocacao-taxa');
        const instEl = document.getElementById('modal-convocacao-instrucoes');
        const checkCiente = document.getElementById('check-convocacao-ciente');
        const btnCiente = document.getElementById('btn-convocacao-ciente');
        const btnModalInscrever = document.getElementById('btn-convocacao-inscrever');
        const lockMsg = document.getElementById('convocacao-lock-msg');

        if (tituloEl) tituloEl.textContent = exame.titulo || 'Exame de Graduação Oficial';
        if (modEl) modEl.textContent = graduacao?.atual?.modalidade_nome || 'Muay Thai';
        if (atualEl) atualEl.textContent = graduacao?.atual?.nivel_nome || 'Prajied Atual';
        if (pretEl) pretEl.textContent = graduacao?.proxima_graduacao?.nivel_nome || 'Próximo Grau';

        if (dataEl && exame.data_evento) {
            const dObj = new Date(exame.data_evento);
            dataEl.textContent = !isNaN(dObj.getTime())
                ? dObj.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
                : exame.data_evento;
        }
        if (horaEl) horaEl.textContent = exame.horario_inicio ? exame.horario_inicio.substring(0, 5) : '10:00';
        if (localEl) localEl.textContent = exame.local_evento || 'Tatame Central - Pro Combate';

        const valorTaxa = parseFloat(exame.convite_valor || exame.taxa_inscricao || 0);
        if (taxaEl) {
            taxaEl.textContent = valorTaxa > 0
                ? valorTaxa.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                : 'Gratuito / Incluso';
        }

        if (instEl) {
            instEl.textContent = exame.descricao || 'Compareça com seu uniforme oficial limpo, luvas/proteções e antecedência de 15 minutos.';
        }

        // Reseta estado do checkbox e botões: Pop-up SÓ SAI SE MARCAR!
        if (checkCiente) checkCiente.checked = false;
        if (btnCiente) btnCiente.disabled = true;
        if (btnModalInscrever) btnModalInscrever.disabled = true;
        if (lockMsg) lockMsg.style.display = 'flex';

        modal.style.display = 'flex';
    },

    confirmarCienciaExame() {
        const alunoId = this.alunoData?.aluno?.id || 1;
        const exameId = this.alunoData?.exame_proximo?.id;
        if (exameId) {
            localStorage.setItem(`graduacao_ciente_${alunoId}_${exameId}`, 'true');
        }
        const modal = document.getElementById('modal-convocacao-exame');
        if (modal) modal.style.display = 'none';
        this.showToast('Ciência confirmada com sucesso! Bons treinos.', 'success');
    },

    async abrirFluxoInscricaoExame() {
        const exame = this.alunoData?.exame_proximo;
        if (!exame) return;

        // Se o aluno havia recusado mas clicou no botão para mudar de ideia
        if (exame.convite_status === 'recusado') {
            if (!confirm('Você havia registrado desistência deste exame de graduação. Deseja mudar de ideia e reativar sua inscrição agora?')) {
                return;
            }
            const alunoId = this.alunoData?.aluno?.id || 1;
            localStorage.removeItem(`graduacao_recusada_${alunoId}_${exame.id}`);
        }

        // Se já existe convite gerado no banco e não está recusado, abre o modal do exame com o Asaas
        if (exame.convite_id && exame.convite_status !== 'recusado') {
            this.abrirModalExame(exame.convite_id);
            return;
        }

        // Se ainda não existe convite registrado ou estava recusado, realiza auto-inscrição via API
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const queryAlunoId = urlParams.get('aluno_id');
            const alunoId = this.alunoData?.aluno?.id || (queryAlunoId ? parseInt(queryAlunoId, 10) : null);

            const headers = { 'Content-Type': 'application/json' };
            if (this.authToken && this.authToken !== 'null') {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const bodyPayload = { billing_type: 'PIX' };
            if (alunoId) bodyPayload.aluno_id = alunoId;

            const res = await fetch(`/api/aluno/exames/${exame.id}/inscrever`, {
                method: 'POST',
                headers,
                body: JSON.stringify(bodyPayload)
            });

            const data = await res.json();
            if (!data.success) {
                alert(data.error || 'Erro ao realizar inscrição no exame.');
                return;
            }

            // Atualiza estado e abre a tela de cobrança Asaas
            await this.loadMeusExames();
            if (data.convite_id) {
                this.abrirModalExame(data.convite_id);
            }
        } catch (err) {
            console.error('Erro ao inscrever no exame:', err);
            alert('Falha ao processar inscrição: ' + err.message);
        }
    },

    showToast(message, type = 'info') {
        let toast = document.getElementById('painel-toast-alert');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'painel-toast-alert';
            document.body.appendChild(toast);
        }
        const bgColors = {
            success: 'background: #065f46; color: #a7f3d0; border: 1px solid #059669;',
            error: 'background: #991b1b; color: #fecaca; border: 1px solid #dc2626;',
            info: 'background: #1e293b; color: #f1f5f9; border: 1px solid #334155;'
        };
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 9999;
            padding: 10px 18px;
            border-radius: 12px;
            font-size: 13px;
            font-weight: 700;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
            transition: opacity 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
            max-width: 90vw;
            ${bgColors[type] || bgColors.info}
        `;
        toast.innerHTML = this.escapeHtml(message);
        toast.style.opacity = '1';
        toast.style.display = 'flex';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => { toast.style.display = 'none'; }, 300);
        }, 3000);
    },

    /**
     * Abre a Área de Pagamento da Mensalidade com integração ao Gateway Asaas
     */
    async openModalPagamentoMensalidade(faturaId = null) {
        const modal = document.getElementById('modal-pagamento-mensalidade');
        if (!modal) return;

        const plano = this.alunoData?.plano || null;
        const targetFatId = faturaId || plano?.fatura_aberta?.id || (plano?.faturas && plano.faturas[0]?.id);

        if (!targetFatId) {
            this.showToast('Nenhuma mensalidade em aberto encontrada para pagamento.', 'info');
            return;
        }

        modal.style.display = 'flex';
        const box = document.getElementById('modal-pagamento-conteudo');
        if (!box) return;

        box.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 16px; text-align: center;">
                <div class="spinner" style="width: 32px; height: 32px; margin-bottom: 14px;"></div>
                <strong style="color: #ffffff; font-size: 15px;">Conectando ao sistema de pagamento...</strong>
                <span style="color: #94a3b8; font-size: 12px; margin-top: 4px;">Gerando seu QR Code PIX dinâmico</span>
            </div>
        `;

        try {
            const token = this.getAuthToken();
            const res = await fetch(`/api/aluno/faturas/${targetFatId}/gerar-asaas`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ aluno_id: this.currentAlunoId })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Falha ao gerar cobrança');
            }

            const fat = data.data;
            const vencFmt = fat.data_vencimento ? new Date(fat.data_vencimento).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '--';
            const valFmt = parseFloat(fat.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const pixQrSrc = fat.asaas_pix_qrcode ? (fat.asaas_pix_qrcode.startsWith('data:') ? fat.asaas_pix_qrcode : `data:image/png;base64,${fat.asaas_pix_qrcode}`) : '';
            const pixCopiaCola = fat.asaas_pix_copia_cola || '';

            box.innerHTML = `
                <!-- 1. Resumo da Mensalidade -->
                <div class="asaas-pay-summary-card">
                    <div class="asaas-pay-meta-row">
                        <div>
                            <span style="font-size: 10.5px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px;">Mensalidade</span>
                            <h4 style="margin: 2px 0 0 0; font-size: 14px; font-weight: 800; color: #ffffff;">${this.escapeHtml(fat.plano_nome)}</h4>
                        </div>
                        <span style="font-size: 11px; font-weight: 800; background: rgba(239, 68, 68, 0.16); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); padding: 3px 8px; border-radius: 6px;">
                            ${fat.competencia ? `Ref: ${this.escapeHtml(fat.competencia)}` : 'Em Aberto'}
                        </span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #cbd5e1; margin-bottom: 12px;">
                        <span>📅 Vencimento: <strong>${vencFmt}</strong></span>
                        <span style="font-size: 11px; color: #94a3b8;">Fatura #${fat.fatura_id}</span>
                    </div>

                    <div class="asaas-pay-amount-box">
                        <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px;">Valor Total a Pagar</span>
                        <div class="asaas-pay-amount-val">${valFmt}</div>
                    </div>
                </div>

                <!-- Seletor de Método de Pagamento -->
                <div class="pay-methods-tabs">
                    <button type="button" class="btn-pay-tab active" id="tab-btn-pay-pix-mens" onclick="PainelAlunoApp.alternarMetodoPagamento('pix', 'mens')">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                        <span>PIX Instantâneo</span>
                    </button>
                    <button type="button" class="btn-pay-tab tab-card" id="tab-btn-pay-card-mens" onclick="PainelAlunoApp.alternarMetodoPagamento('cartao', 'mens')">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="1" y="4" width="22" height="16" rx="3" ry="3"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                        <span>Cartão de Crédito</span>
                    </button>
                </div>

                <!-- 2. Box PIX -->
                <div id="box-pay-pix-mens" class="asaas-pix-box">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 8px;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.2">
                            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                        </svg>
                        <h4 style="margin: 0; font-size: 14px; font-weight: 800; color: #ffffff;">Pague via PIX Instantâneo</h4>
                    </div>
                    <p style="font-size: 12px; color: #94a3b8; margin: 0 0 10px 0; line-height: 1.4;">
                        Aponte a câmera do seu banco para o QR Code ou copie a chave Copia e Cola:
                    </p>

                    ${pixQrSrc ? `
                        <div class="asaas-qr-wrap">
                            <img src="${pixQrSrc}" alt="QR Code Pix" class="asaas-qr-img">
                        </div>
                    ` : ''}

                    <div class="asaas-copy-group">
                        <input type="text" id="input-pix-mensalidade" readonly value="${this.escapeHtml(pixCopiaCola)}" class="asaas-copy-input">
                        <button type="button" id="btn-copiar-pix-mensalidade" onclick="PainelAlunoApp.copiarPixMensalidade()" class="btn-asaas-copy">
                            Copiar PIX
                        </button>
                    </div>

                    <!-- Botões de Ação e Liquidação -->
                    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 16px;">
                        <button type="button" onclick="PainelAlunoApp.verificarPagamentoMensalidade(${fat.fatura_id})" 
                                style="width: 100%; padding: 10px 14px; border-radius: 10px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; font-weight: 700; font-size: 12.5px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                            <span>Já paguei, verificar agora</span>
                        </button>

                        ${this.sanitizeUrl(fat.asaas_invoice_url) ? `
                            <a href="${this.sanitizeUrl(fat.asaas_invoice_url)}" target="_blank" rel="noopener noreferrer"
                               style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 14px; border-radius: 10px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); color: #cbd5e1; text-decoration: none; font-size: 12px; font-weight: 600;">
                                <span>🔗 Pagar no Checkout Digital</span>
                            </a>
                        ` : ''}
                    </div>
                </div>

                <!-- 3. Box Cartão de Crédito -->
                <div id="box-pay-card-mens" style="display: none; background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 16px;">
                    <div class="credit-card-preview">
                        <div class="card-preview-top">
                            <div class="card-chip-sim"></div>
                            <div class="card-brand-badge" id="preview-brand-mens">CARTÃO</div>
                        </div>
                        <div class="card-preview-number" id="preview-number-mens">•••• •••• •••• ••••</div>
                        <div class="card-preview-bottom">
                            <div>
                                <div class="card-preview-holder-label">Titular</div>
                                <div class="card-preview-holder-val" id="preview-holder-mens">${this.escapeHtml(this.currentAlunoData?.nome || 'NOME DO TITULAR')}</div>
                            </div>
                            <div>
                                <div class="card-preview-expiry-label">Validade</div>
                                <div class="card-preview-expiry-val" id="preview-expiry-mens">MM/AA</div>
                            </div>
                        </div>
                    </div>

                    <form class="credit-card-form" onsubmit="event.preventDefault(); PainelAlunoApp.submeterPagamentoCartaoMensalidade(${fat.fatura_id});">
                        <div class="cc-form-group">
                            <label>Número do Cartão</label>
                            <input type="text" id="cc-number-mens" class="cc-input" placeholder="0000 0000 0000 0000" maxlength="19" required
                                   oninput="PainelAlunoApp.onCardNumberInput(this, 'mens')">
                        </div>
                        <div class="cc-form-group">
                            <label>Nome Impresso no Cartão</label>
                            <input type="text" id="cc-holder-mens" class="cc-input" placeholder="Como impresso no cartão" required
                                   value="${this.escapeHtml(this.currentAlunoData?.nome || '')}"
                                   oninput="PainelAlunoApp.onCardHolderInput(this, 'mens')">
                        </div>
                        <div class="cc-form-row">
                            <div class="cc-form-group">
                                <label>Validade</label>
                                <input type="text" id="cc-expiry-mens" class="cc-input" placeholder="MM/AA" maxlength="5" required
                                       oninput="PainelAlunoApp.onCardExpiryInput(this, 'mens')">
                            </div>
                            <div class="cc-form-group">
                                <label>CVV / Cód.</label>
                                <input type="password" id="cc-cvv-mens" class="cc-input" placeholder="123" maxlength="4" required
                                       oninput="this.value = this.value.replace(/\\D/g, '').slice(0, 4)">
                            </div>
                        </div>
                        <div class="cc-form-row">
                            <div class="cc-form-group">
                                <label>CPF do Titular</label>
                                <input type="text" id="cc-cpf-mens" class="cc-input" placeholder="000.000.000-00" maxlength="14"
                                       value="${this.escapeHtml(this.currentAlunoData?.cpf || '')}">
                            </div>
                            <div class="cc-form-group">
                                <label>Parcelamento</label>
                                <select id="cc-installments-mens" class="cc-input" style="background: rgba(15, 23, 42, 0.95);">
                                    <option value="1">1x de ${valFmt} à vista</option>
                                </select>
                            </div>
                        </div>
                        <button type="submit" class="btn-submit-card-pay" id="btn-submit-cc-mens">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="1" y="4" width="22" height="16" rx="3" ry="3"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                            <span>Pagar ${valFmt} no Cartão</span>
                        </button>
                        <div class="pay-security-badge">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                            <span>Pagamento 100% Criptografado & Seguro PCI-DSS</span>
                        </div>
                    </form>
                </div>
            `;
        } catch (err) {
            console.error('Erro ao abrir pagamento:', err);
            box.innerHTML = `
                <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 14px; padding: 24px 16px; text-align: center;">
                    <div style="font-size: 28px; margin-bottom: 8px;">⚠️</div>
                    <h4 style="margin: 0 0 6px 0; font-size: 15px; font-weight: 800; color: #fca5a5;">Erro ao Gerar Pagamento</h4>
                    <p style="margin: 0 0 16px 0; font-size: 12.5px; color: #fecaca; line-height: 1.45;">
                        ${this.escapeHtml(err.message || 'Não foi possível gerar a cobrança. Tente novamente.')}
                    </p>
                    <button type="button" onclick="PainelAlunoApp.openModalPagamentoMensalidade(${targetFatId})" 
                            style="padding: 8px 16px; border-radius: 8px; background: #ef4444; border: none; color: #fff; font-weight: 700; font-size: 12px; cursor: pointer;">
                        Tentar Novamente
                    </button>
                </div>
            `;
        }
    },

    copiarPixMensalidade() {
        const input = document.getElementById('input-pix-mensalidade');
        const btn = document.getElementById('btn-copiar-pix-mensalidade');
        if (!input) return;

        input.select();
        input.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(input.value).then(() => {
            if (btn) {
                const originalText = btn.textContent;
                btn.textContent = '✓ Copiado!';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.classList.remove('copied');
                }, 2500);
            }
            this.showToast('Código Copia e Cola PIX copiado com sucesso!', 'success');
        }).catch(() => {
            document.execCommand('copy');
            this.showToast('Código PIX copiado!', 'success');
        });
    },

    async verificarPagamentoMensalidade(faturaId, isSimular = false) {
        try {
            const token = this.getAuthToken();
            const res = await fetch(`/api/aluno/faturas/${faturaId}/verificar-asaas`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    aluno_id: this.currentAlunoId,
                    simular_confirmacao: Boolean(isSimular)
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro ao verificar pagamento');

            if (data.pago) {
                const box = document.getElementById('modal-pagamento-conteudo');
                if (box) {
                    box.innerHTML = `
                        <div style="background: rgba(16, 185, 129, 0.12); border: 1.5px solid rgba(16, 185, 129, 0.4); border-radius: 16px; padding: 28px 16px; text-align: center;">
                            <div style="width: 54px; height: 54px; border-radius: 50%; background: #10b981; color: #ffffff; font-size: 26px; font-weight: 900; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px auto; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
                                ✓
                            </div>
                            <h4 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 800; color: #34d399;">Pagamento Confirmado com Sucesso!</h4>
                            <p style="margin: 0 0 16px 0; font-size: 13px; color: #a7f3d0; line-height: 1.45;">
                                Sua mensalidade foi quitada com sucesso. Seu plano marcial está regularizado e em dia!
                            </p>
                            <button type="button" onclick="document.getElementById('modal-pagamento-mensalidade').style.display='none'"
                                    style="padding: 10px 22px; border-radius: 10px; background: #10b981; border: none; color: #ffffff; font-weight: 800; font-size: 13px; cursor: pointer;">
                                Concluir & Voltar ao Painel
                            </button>
                        </div>
                    `;
                }
                this.showToast('Mensalidade quitada com sucesso!', 'success');
                setTimeout(() => {
                    this.init();
                }, 1200);
            } else {
                this.showToast(data.message || 'Aguardando compensação do banco.', 'info');
            }
        } catch (err) {
            console.error('Erro ao verificar mensalidade:', err);
            this.showToast(err.message || 'Erro ao verificar pagamento.', 'error');
        }
    },

    simularPagamentoMensalidade(faturaId) {
        return this.verificarPagamentoMensalidade(faturaId, true);
    },

    /**
     * Carrega a lista unificada de faturas e histórico de pagamentos (Asaas + Manual)
     */
    async carregarHistoricoFinanceiro() {
        const listContainer = document.getElementById('faturas-cards-list');
        if (listContainer) {
            listContainer.innerHTML = `
                <div style="text-align: center; padding: 48px 20px; color: #94a3b8;">
                    <div class="spinner" style="width: 32px; height: 32px; border: 3px solid rgba(239,68,68,0.2); border-top-color: #ef4444; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px auto;"></div>
                    <div style="font-size: 14px; font-weight: 600;">Carregando histórico financeiro...</div>
                </div>
            `;
        }

        try {
            const token = this.getAuthToken();
            const urlParams = new URLSearchParams(window.location.search);
            const queryAlunoId = urlParams.get('aluno_id') || this.currentAlunoId || (this.alunoData?.aluno?.id);
            const qs = queryAlunoId ? `?aluno_id=${encodeURIComponent(queryAlunoId)}` : '';

            const res = await fetch(`/api/aluno/historico-financeiro${qs}`, {
                headers: {
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                }
            });

            if (!res.ok) throw new Error('Não foi possível carregar as faturas.');

            const data = await res.json();
            if (data.success) {
                this.historicoFinanceiro = data;
                this.renderFaturasView();
            } else {
                throw new Error(data.error || 'Erro ao carregar dados financeiros.');
            }
        } catch (err) {
            console.error('Erro ao carregar histórico financeiro:', err);
            if (listContainer) {
                listContainer.innerHTML = `
                    <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 14px; padding: 32px 20px; text-align: center; color: #fca5a5;">
                        <div style="font-size: 28px; margin-bottom: 8px;">⚠️</div>
                        <h4 style="margin: 0 0 6px 0; font-size: 15px; font-weight: 700; color: #f87171;">Não foi possível carregar suas faturas</h4>
                        <p style="margin: 0 0 16px 0; font-size: 12.5px; color: #fca5a5; line-height: 1.45;">
                            ${this.escapeHtml(err.message || 'Verifique sua conexão ou tente novamente mais tarde.')}
                        </p>
                        <button type="button" onclick="PainelAlunoApp.carregarHistoricoFinanceiro()"
                                style="padding: 8px 18px; border-radius: 8px; background: #ef4444; border: none; color: #ffffff; font-weight: 700; font-size: 12px; cursor: pointer;">
                            Tentar Novamente
                        </button>
                    </div>
                `;
            }
        }
    },

    /**
     * Renderiza o Banner Resumo, Contadores e Lista de Cards de Faturas
     */
    renderFaturasView() {
        const aluno = this.alunoData?.aluno;
        if (aluno) {
            const nameEl = document.getElementById('faturas-header-student-name');
            this.applyProfilePhotoUrl(aluno.foto_perfil_url, aluno.nome_completo || aluno.primeiro_nome);
            if (nameEl && (aluno.primeiro_nome || aluno.nome_completo)) {
                nameEl.textContent = aluno.primeiro_nome || aluno.nome_completo;
            }
        }

        const data = this.historicoFinanceiro;
        if (!data) return;

        const resumo = data.resumo || {};
        const itens = Array.isArray(data.itens) ? data.itens : [];

        // Atualiza Resumo no Banner
        const statusEl = document.getElementById('faturas-summary-status');
        const pagoEl = document.getElementById('faturas-summary-pago');
        const pendenteEl = document.getElementById('faturas-summary-pendente');

        if (statusEl) {
            if (resumo.has_atraso) {
                statusEl.innerHTML = `<span class="status-pulse-dot" style="background: #ef4444;"></span> Em atraso`;
                statusEl.className = 'faturas-metric-val red';
            } else if (resumo.status_financeiro === 'pendente') {
                statusEl.innerHTML = `<span class="status-pulse-dot" style="background: #f59e0b;"></span> Pendente`;
                statusEl.className = 'faturas-metric-val amber';
            } else if (resumo.status_financeiro === 'sem_faturas' || itens.length === 0) {
                statusEl.innerHTML = `<span class="status-pulse-dot" style="background: #94a3b8;"></span> Sem faturas`;
                statusEl.className = 'faturas-metric-val slate';
            } else {
                statusEl.innerHTML = `<span class="status-pulse-dot" style="background: #10b981;"></span> Em dia`;
                statusEl.className = 'faturas-metric-val green';
            }
        }

        if (pagoEl) {
            pagoEl.textContent = (resumo.total_pago || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        }
        if (pendenteEl) {
            pendenteEl.textContent = (resumo.total_pendente || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            pendenteEl.className = `faturas-metric-val ${resumo.total_pendente > 0 ? (resumo.has_atraso ? 'red' : 'amber') : 'slate'}`;
        }

        // Contadores das Abas
        const countTodos = document.getElementById('count-faturas-todos');
        const countMensalidades = document.getElementById('count-faturas-mensalidades');
        const countGraduacoes = document.getElementById('count-faturas-graduacoes');
        const countPagos = document.getElementById('count-faturas-pagos');
        const countPendentes = document.getElementById('count-faturas-pendentes');

        if (countTodos) countTodos.textContent = itens.length;
        if (countMensalidades) countMensalidades.textContent = itens.filter(i => i.tipo === 'mensalidade').length;
        if (countGraduacoes) countGraduacoes.textContent = itens.filter(i => i.tipo === 'graduacao').length;
        if (countPagos) countPagos.textContent = itens.filter(i => i.status === 'pago').length;
        if (countPendentes) countPendentes.textContent = itens.filter(i => ['pendente', 'atrasado'].includes(i.status)).length;

        // Filtro Ativo
        const filtro = this.faturasFiltroAtivo || 'todos';
        const filtrados = itens.filter(item => {
            if (filtro === 'mensalidade') return item.tipo === 'mensalidade';
            if (filtro === 'graduacao') return item.tipo === 'graduacao';
            if (filtro === 'pago') return item.status === 'pago';
            if (filtro === 'pendente') return ['pendente', 'atrasado'].includes(item.status);
            return true;
        });

        const listContainer = document.getElementById('faturas-cards-list');
        if (!listContainer) return;

        if (filtrados.length === 0) {
            listContainer.innerHTML = `
                <div style="background: rgba(14, 19, 31, 0.6); border: 1px dashed rgba(255, 255, 255, 0.08); border-radius: 16px; padding: 48px 24px; text-align: center; color: #64748b;">
                    <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(255, 255, 255, 0.04); display: flex; align-items: center; justify-content: center; margin: 0 auto 14px auto;">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="1" y="4" width="22" height="16" rx="3" ry="3"/>
                            <line x1="1" y1="10" x2="23" y2="10"/>
                        </svg>
                    </div>
                    <div style="font-size: 14px; font-weight: 700; color: #cbd5e1; margin-bottom: 4px;">Nenhuma fatura encontrada</div>
                    <p style="font-size: 12px; margin: 0; color: #64748b;">Nenhum lançamento corresponde ao filtro selecionado no momento.</p>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = filtrados.map(item => {
            const isPago = item.status === 'pago';
            const isAtrasado = item.status === 'atrasado';
            const isManual = item.origem_pagamento === 'manual';
            const valorFmt = (item.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const valorPagoFmt = item.valor_pago ? (item.valor_pago).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : valorFmt;

            // Formatação clara e amigável da data
            let dataTexto = '';
            let dateClass = '';
            if (isPago) {
                const dt = item.data_pagamento ? new Date(item.data_pagamento).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '--';
                const canal = isManual ? 'Balcão' : 'PIX';
                dataTexto = `Pago em ${dt} • ${canal}`;
                dateClass = 'paid';
            } else if (isAtrasado) {
                const dt = item.data_referencia ? new Date(item.data_referencia).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '--';
                dataTexto = `Venceu em ${dt}`;
                dateClass = 'overdue';
            } else {
                const dt = item.data_referencia ? new Date(item.data_referencia).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '--';
                dataTexto = `Vencimento: ${dt}`;
                dateClass = '';
            }

            // Ícone limpo por categoria
            const iconSvg = item.tipo === 'graduacao'
                ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>`
                : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="1" y="4" width="22" height="16" rx="3" ry="3"/><line x1="1" y1="10" x2="23" y2="10"/><line x1="5" y1="15" x2="9" y2="15"/></svg>`;

            // Badge único de Status
            let statusPillClass = 'pendente';
            let statusIcon = '⏳';
            if (isPago) {
                statusPillClass = 'pago';
                statusIcon = '✓';
            } else if (isAtrasado) {
                statusPillClass = 'atrasado';
                statusIcon = '⚠️';
            } else if (item.status === 'cancelado') {
                statusPillClass = 'cancelado';
                statusIcon = '✕';
            }

            // Botão de ação intuitivo
            let botaoAcaoHtml = '';
            if (isPago) {
                botaoAcaoHtml = `
                    <button type="button" class="btn-card-receipt" onclick="PainelAlunoApp.abrirComprovanteFatura('${this.escapeHtml(item.id)}')">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                        </svg>
                        <span>Comprovante</span>
                    </button>
                `;
            } else if (item.status !== 'cancelado') {
                if (item.tipo === 'mensalidade') {
                    botaoAcaoHtml = `
                        <button type="button" class="btn-card-pay" onclick="PainelAlunoApp.openModalPagamentoMensalidade(${item.fatura_id})">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                            </svg>
                            <span>Pagar PIX</span>
                        </button>
                    `;
                } else if (item.tipo === 'graduacao') {
                    botaoAcaoHtml = `
                        <button type="button" class="btn-card-pay" onclick="PainelAlunoApp.abrirModalExame(${item.convite_id})">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                            </svg>
                            <span>Pagar Exame</span>
                        </button>
                    `;
                }
            }

            const cardStatusClass = isPago ? 'pago' : (isAtrasado ? 'atrasado' : 'pendente');

            return `
                <div class="fatura-item-card ${cardStatusClass}">
                    <div class="fatura-card-header">
                        <div class="fatura-header-left">
                            <div class="fatura-category-icon ${item.tipo}">
                                ${iconSvg}
                            </div>
                            <div class="fatura-header-texts">
                                <h4 class="fatura-title">${this.escapeHtml(item.titulo)}</h4>
                                <div class="fatura-sub">${this.escapeHtml(item.subtitulo)}</div>
                            </div>
                        </div>
                        <span class="fatura-status-pill ${statusPillClass}">
                            <span>${statusIcon}</span>
                            <span>${this.escapeHtml(item.status_label)}</span>
                        </span>
                    </div>

                    <div class="fatura-card-footer">
                        <div class="fatura-footer-info">
                            <span class="fatura-date-text ${dateClass}">
                                ${this.escapeHtml(dataTexto)}
                            </span>
                            <div class="fatura-price-val ${cardStatusClass}">
                                ${isPago ? valorPagoFmt : valorFmt}
                            </div>
                        </div>
                        <div class="fatura-footer-action">
                            ${botaoAcaoHtml}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Abre Modal com Comprovante Detalhado de Quitação (Asaas ou Balcão)
     */
    abrirComprovanteFatura(itemId) {
        const modal = document.getElementById('modal-comprovante-fatura');
        const content = document.getElementById('modal-comprovante-conteudo');
        if (!modal || !content) return;

        const itens = this.historicoFinanceiro?.itens || [];
        const item = itens.find(i => String(i.id) === String(itemId));
        if (!item) {
            this.showToast('Lançamento não localizado.', 'error');
            return;
        }

        const isManual = item.origem_pagamento === 'manual';
        const valorFmt = (item.valor_pago || item.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const dataPagamentoFmt = item.data_pagamento 
            ? new Date(item.data_pagamento).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
            : 'Data confirmada em sistema';

        content.innerHTML = `
            <div style="background: rgba(16, 185, 129, 0.08); border: 1.5px solid rgba(16, 185, 129, 0.3); border-radius: 16px; padding: 22px 18px; text-align: center; margin-bottom: 20px;">
                <div style="width: 48px; height: 48px; border-radius: 50%; background: #10b981; color: #ffffff; font-size: 24px; font-weight: 900; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
                    ✓
                </div>
                <h4 style="margin: 0 0 4px 0; font-size: 17px; font-weight: 800; color: #34d399;">Pagamento Liquidado</h4>
                <div style="font-size: 24px; font-weight: 900; color: #ffffff; margin: 8px 0;">${valorFmt}</div>
                <span class="fatura-badge ${isManual ? 'badge-origem-manual' : 'badge-origem-asaas'}" style="display: inline-block;">
                    ${this.escapeHtml(item.origem_label)}
                </span>
            </div>

            <div style="background: rgba(14, 19, 31, 0.7); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 12px; padding: 16px; margin-bottom: 18px; display: flex; flex-direction: column; gap: 10px; font-size: 13px;">
                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding-bottom: 8px;">
                    <span style="color: #94a3b8;">Item / Categoria:</span>
                    <strong style="color: #f8fafc;">${this.escapeHtml(item.tipo_label)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding-bottom: 8px;">
                    <span style="color: #94a3b8;">Descrição:</span>
                    <strong style="color: #f8fafc; text-align: right; max-width: 65%;">${this.escapeHtml(item.titulo)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding-bottom: 8px;">
                    <span style="color: #94a3b8;">Data de Quitação:</span>
                    <strong style="color: #34d399;">${this.escapeHtml(dataPagamentoFmt)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding-bottom: 8px;">
                    <span style="color: #94a3b8;">Forma de Pagamento:</span>
                    <strong style="color: #f8fafc; text-transform: uppercase;">${this.escapeHtml(item.metodo_pagamento || (isManual ? 'Dinheiro / Balcão' : 'PIX / Pagamento Online'))}</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #94a3b8;">Canal de Processamento:</span>
                    <strong style="color: #cbd5e1;">${isManual ? 'Baixa Manual na Recepção / Balcão' : 'Pagamento Online (PIX / Boleto / Cartão)'}</strong>
                </div>
            </div>

            ${item.asaas_payment_id ? `
                <div style="background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 10px; padding: 10px 14px; margin-bottom: 18px; font-size: 11.5px; color: #93c5fd; word-break: break-all;">
                    <strong>Cód. Transação:</strong> ${this.escapeHtml(item.asaas_payment_id)}
                </div>
            ` : ''}

            <div style="display: flex; gap: 10px;">
                <button type="button" onclick="document.getElementById('modal-comprovante-fatura').style.display='none'"
                        style="flex: 1; padding: 12px; border-radius: 10px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.12); color: #ffffff; font-weight: 700; font-size: 13px; cursor: pointer;">
                    Fechar
                </button>
            </div>
        `;

        modal.style.display = 'flex';
    },

    // =========================================================================
    // MÉTODOS DE PAGAMENTO COM CARTÃO DE CRÉDITO
    // =========================================================================
    detectCardBrand(number) {
        const clean = String(number || '').replace(/\D/g, '');
        if (/^4/.test(clean)) return 'VISA';
        if (/^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[0-1]|2720)/.test(clean)) return 'MASTERCARD';
        if (/^(4011|4312|4389|4514|4576|5041|5066|5067|5090|6277|6362|6363|6504|6505|6506|6507|6509|6516|6550)/.test(clean)) return 'ELO';
        if (/^3[47]/.test(clean)) return 'AMEX';
        if (/^(606282|3841)/.test(clean)) return 'HIPERCARD';
        return 'CARTÃO';
    },

    formatCardNumber(val) {
        const clean = String(val || '').replace(/\D/g, '').slice(0, 16);
        return clean.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
    },

    formatCardExpiry(val) {
        const clean = String(val || '').replace(/\D/g, '').slice(0, 4);
        if (clean.length >= 3) {
            return clean.slice(0, 2) + '/' + clean.slice(2);
        }
        return clean;
    },

    onCardNumberInput(input, prefix) {
        const formatted = this.formatCardNumber(input.value);
        input.value = formatted;
        const brand = this.detectCardBrand(formatted);
        const previewNum = document.getElementById(`preview-number-${prefix}`);
        const previewBrand = document.getElementById(`preview-brand-${prefix}`);
        if (previewNum) {
            previewNum.textContent = formatted ? formatted.padEnd(19, '•') : '•••• •••• •••• ••••';
        }
        if (previewBrand) {
            previewBrand.textContent = brand;
        }
    },

    onCardHolderInput(input, prefix) {
        input.value = input.value.toUpperCase();
        const preview = document.getElementById(`preview-holder-${prefix}`);
        if (preview) {
            preview.textContent = input.value.trim() || 'NOME DO TITULAR';
        }
    },

    onCardExpiryInput(input, prefix) {
        const formatted = this.formatCardExpiry(input.value);
        input.value = formatted;
        const preview = document.getElementById(`preview-expiry-${prefix}`);
        if (preview) {
            preview.textContent = formatted || 'MM/AA';
        }
    },

    alternarMetodoPagamento(metodo, prefix) {
        const btnPix = document.getElementById(`tab-btn-pay-pix-${prefix}`);
        const btnCard = document.getElementById(`tab-btn-pay-card-${prefix}`);
        const boxPix = document.getElementById(`box-pay-pix-${prefix}`);
        const boxCard = document.getElementById(`box-pay-card-${prefix}`);

        if (metodo === 'cartao') {
            if (btnPix) btnPix.classList.remove('active');
            if (btnCard) btnCard.classList.add('active');
            if (boxPix) boxPix.style.display = 'none';
            if (boxCard) boxCard.style.display = 'block';
        } else {
            if (btnCard) btnCard.classList.remove('active');
            if (btnPix) btnPix.classList.add('active');
            if (boxCard) boxCard.style.display = 'none';
            if (boxPix) boxPix.style.display = 'block';
        }
    },

    async submeterPagamentoCartaoMensalidade(faturaId) {
        const numInput = document.getElementById('cc-number-mens');
        const holderInput = document.getElementById('cc-holder-mens');
        const expiryInput = document.getElementById('cc-expiry-mens');
        const cvvInput = document.getElementById('cc-cvv-mens');
        const cpfInput = document.getElementById('cc-cpf-mens');
        const submitBtn = document.getElementById('btn-submit-cc-mens');

        if (!numInput || !holderInput || !expiryInput || !cvvInput) return;

        const rawNum = numInput.value.replace(/\D/g, '');
        if (rawNum.length < 13 || rawNum.length > 19) {
            this.showToast('Por favor, informe um número de cartão de crédito válido.', 'error');
            numInput.focus();
            return;
        }

        const holder = holderInput.value.trim();
        if (holder.length < 3) {
            this.showToast('Informe o nome impresso no cartão de crédito.', 'error');
            holderInput.focus();
            return;
        }

        const expParts = expiryInput.value.split('/');
        if (expParts.length !== 2 || expParts[0].length !== 2 || expParts[1].length !== 2) {
            this.showToast('Informe a validade no formato MM/AA.', 'error');
            expiryInput.focus();
            return;
        }

        const rawCvv = cvvInput.value.replace(/\D/g, '');
        if (rawCvv.length < 3) {
            this.showToast('Informe um código CVV válido com 3 ou 4 dígitos.', 'error');
            cvvInput.focus();
            return;
        }

        try {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = `
                    <div class="spinner" style="width: 16px; height: 16px; border-width: 2px;"></div>
                    <span>Processando pagamento com cartão...</span>
                `;
            }

            const token = this.getAuthToken();
            const res = await fetch(`/api/aluno/faturas/${faturaId}/pagar-cartao`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    aluno_id: this.currentAlunoId,
                    numero_cartao: rawNum,
                    nome_impresso: holder,
                    mes_validade: expParts[0],
                    ano_validade: expParts[1],
                    cvv: rawCvv,
                    cpf_titular: cpfInput ? cpfInput.value.replace(/\D/g, '') : null
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Não foi possível autorizar o cartão.');
            }

            const box = document.getElementById('modal-pagamento-conteudo');
            if (box) {
                box.innerHTML = `
                    <div style="background: rgba(16, 185, 129, 0.12); border: 1.5px solid rgba(16, 185, 129, 0.4); border-radius: 16px; padding: 28px 16px; text-align: center;">
                        <div style="width: 54px; height: 54px; border-radius: 50%; background: #10b981; color: #ffffff; font-size: 26px; font-weight: 900; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px auto; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
                            ✓
                        </div>
                        <h4 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 800; color: #34d399;">Pagamento Aprovado no Cartão!</h4>
                        <p style="margin: 0 0 8px 0; font-size: 13px; color: #a7f3d0; line-height: 1.45;">
                            Sua mensalidade foi quitada com sucesso. Comprovante emitido e seu plano marcial está em dia!
                        </p>
                        <div style="font-size: 11.5px; color: #94a3b8; margin-bottom: 16px;">
                            ${this.escapeHtml(data.detalhes?.bandeira || 'Cartão')} final •••• ${this.escapeHtml(data.detalhes?.ultimos4 || '••••')}
                        </div>
                        <button type="button" onclick="document.getElementById('modal-pagamento-mensalidade').style.display='none'"
                                style="padding: 10px 22px; border-radius: 10px; background: #10b981; border: none; color: #ffffff; font-weight: 800; font-size: 13px; cursor: pointer;">
                            Concluir & Voltar ao Painel
                        </button>
                    </div>
                `;
            }
            this.showToast('Mensalidade paga com sucesso no cartão de crédito!', 'success');
            setTimeout(() => {
                this.init();
            }, 1200);

        } catch (err) {
            console.error('Erro ao pagar mensalidade com cartão:', err);
            this.showToast(err.message || 'Erro ao processar pagamento por cartão.', 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="1" y="4" width="22" height="16" rx="3" ry="3"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                    <span>Tentar Novamente</span>
                `;
            }
        }
    },

    async submeterPagamentoCartaoExame(conviteId) {
        const numInput = document.getElementById('cc-number-exame');
        const holderInput = document.getElementById('cc-holder-exame');
        const expiryInput = document.getElementById('cc-expiry-exame');
        const cvvInput = document.getElementById('cc-cvv-exame');
        const cpfInput = document.getElementById('cc-cpf-exame');
        const submitBtn = document.getElementById('btn-submit-cc-exame');

        if (!numInput || !holderInput || !expiryInput || !cvvInput) return;

        const rawNum = numInput.value.replace(/\D/g, '');
        if (rawNum.length < 13 || rawNum.length > 19) {
            this.showToast('Por favor, informe um número de cartão de crédito válido.', 'error');
            numInput.focus();
            return;
        }

        const holder = holderInput.value.trim();
        if (holder.length < 3) {
            this.showToast('Informe o nome impresso no cartão de crédito.', 'error');
            holderInput.focus();
            return;
        }

        const expParts = expiryInput.value.split('/');
        if (expParts.length !== 2 || expParts[0].length !== 2 || expParts[1].length !== 2) {
            this.showToast('Informe a validade no formato MM/AA.', 'error');
            expiryInput.focus();
            return;
        }

        const rawCvv = cvvInput.value.replace(/\D/g, '');
        if (rawCvv.length < 3) {
            this.showToast('Informe um código CVV válido com 3 ou 4 dígitos.', 'error');
            cvvInput.focus();
            return;
        }

        try {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = `
                    <div class="spinner" style="width: 16px; height: 16px; border-width: 2px;"></div>
                    <span>Processando pagamento com cartão...</span>
                `;
            }

            const token = this.getAuthToken();
            const res = await fetch(`/api/aluno/exames/convites/${conviteId}/pagar-cartao`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    aluno_id: this.currentAlunoId,
                    numero_cartao: rawNum,
                    nome_impresso: holder,
                    mes_validade: expParts[0],
                    ano_validade: expParts[1],
                    cvv: rawCvv,
                    cpf_titular: cpfInput ? cpfInput.value.replace(/\D/g, '') : null
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Não foi possível autorizar o cartão.');
            }

            this.showToast('Taxa de exame paga com sucesso no cartão de crédito!', 'success');
            await this.loadMeusExames();
            this.abrirModalExame(conviteId);
            setTimeout(() => {
                this.init();
            }, 1000);

        } catch (err) {
            console.error('Erro ao pagar taxa de exame com cartão:', err);
            this.showToast(err.message || 'Erro ao processar pagamento por cartão.', 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="1" y="4" width="22" height="16" rx="3" ry="3"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                    <span>Tentar Novamente</span>
                `;
            }
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    PainelAlunoApp.init();
});

