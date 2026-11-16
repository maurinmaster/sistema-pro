// Módulo de Gestão de Planos Comerciais e Mensalidades/Faturamento
const PlanosModule = {
    planos: [],
    modalidades: [],
    faturas: [],
    resumoFinanceiro: null,
    currentTab: 'planos',
    selectedFaturaId: null,

    async init() {
        this.bindEvents();
    },

    bindEvents() {
        // Alternância de Abas na View Financeiro
        const tabBtns = document.querySelectorAll('.financeiro-tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this.switchTab(tab);
            });
        });

        // Botão Novo Plano
        const btnNovoPlano = document.getElementById('btn-novo-plano');
        if (btnNovoPlano) {
            btnNovoPlano.addEventListener('click', () => this.openModalPlano());
        }

        // Formulário de Plano (Cadastro / Edição)
        const formPlano = document.getElementById('form-plano');
        if (formPlano) {
            formPlano.addEventListener('submit', (e) => this.savePlano(e));
        }

        // Filtros de Faturas
        const filtroStatus = document.getElementById('filtro-fatura-status');
        const filtroBusca = document.getElementById('filtro-fatura-busca');
        const filtroMes = document.getElementById('filtro-fatura-mes');

        if (filtroStatus) filtroStatus.addEventListener('change', () => this.loadFaturas());
        if (filtroMes) filtroMes.addEventListener('change', () => this.loadFaturas());
        if (filtroBusca) {
            let timeout = null;
            filtroBusca.addEventListener('input', () => {
                clearTimeout(timeout);
                timeout = setTimeout(() => this.filterFaturasClient(), 300);
            });
        }

        // Botão Nova Fatura Avulsa
        const btnNovaFatura = document.getElementById('btn-nova-fatura');
        if (btnNovaFatura) {
            btnNovaFatura.addEventListener('click', () => this.openModalNovaFatura());
        }

        // Formulário Baixa de Pagamento
        const formBaixa = document.getElementById('form-fatura-baixa');
        if (formBaixa) {
            formBaixa.addEventListener('submit', (e) => this.confirmarBaixa(e));
        }

        // Formulário Nova Fatura
        const formNovaFatura = document.getElementById('form-nova-fatura');
        if (formNovaFatura) {
            formNovaFatura.addEventListener('submit', (e) => this.salvarNovaFatura(e));
        }

        // Filtros e ações da aba Logs de Pagamento
        const filtroLogsStatus = document.getElementById('filtro-logs-resolvido');
        const filtroLogsBusca = document.getElementById('filtro-logs-busca');
        const btnAtualizarLogs = document.getElementById('btn-atualizar-logs-pagamento');
        const btnLimparLogs = document.getElementById('btn-limpar-logs-resolvidos');

        if (filtroLogsStatus) filtroLogsStatus.addEventListener('change', () => this.loadLogsFalhas());
        if (btnAtualizarLogs) btnAtualizarLogs.addEventListener('click', () => this.loadLogsFalhas());
        if (btnLimparLogs) btnLimparLogs.addEventListener('click', () => this.limparLogsResolvidos());
        if (filtroLogsBusca) {
            let logTimeout = null;
            filtroLogsBusca.addEventListener('input', () => {
                clearTimeout(logTimeout);
                logTimeout = setTimeout(() => this.loadLogsFalhas(), 300);
            });
        }
    },

    async loadAll() {
        await Promise.all([
            this.loadModalidadesCache(),
            this.loadPlanos(),
            this.loadFaturas(),
            this.loadLogsFalhas()
        ]);
    },

    switchTab(tabName) {
        this.currentTab = tabName;

        // Atualiza botões
        document.querySelectorAll('.financeiro-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // Atualiza painéis
        const tabPlanos = document.getElementById('financeiro-pane-planos');
        const tabFaturas = document.getElementById('financeiro-pane-faturas');
        const tabLogs = document.getElementById('financeiro-pane-logs-pagamento');

        if (tabPlanos) tabPlanos.style.display = tabName === 'planos' ? 'block' : 'none';
        if (tabFaturas) tabFaturas.style.display = tabName === 'faturas' ? 'block' : 'none';
        if (tabLogs) {
            tabLogs.style.display = tabName === 'logs-pagamento' ? 'block' : 'none';
            if (tabName === 'logs-pagamento') {
                this.loadLogsFalhas();
            }
        }
    },

    async loadModalidadesCache() {
        try {
            const res = await API.get('/modalidades');
            this.modalidades = res.data || [];
        } catch (err) {
            console.error('Erro ao buscar modalidades para planos:', err);
        }
    },

    // ========================================================
    // GESTÃO DE PLANOS COMERCIAIS
    // ========================================================
    async loadPlanos() {
        const grid = document.getElementById('planos-grid');
        if (!grid) return;

        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px;">
                <div class="spinner"></div> Carregando planos comerciais...
            </div>
        `;

        try {
            const res = await API.get('/planos?todos=true');
            this.planos = res.data || [];
            this.renderPlanos();
            this.renderPlanosKPIs();
        } catch (err) {
            console.error('Erro ao carregar planos:', err);
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 30px; color: #ef4444;">
                    Erro ao carregar planos comerciais: ${UI.escapeHtml(err.message)}
                </div>
            `;
        }
    },

    renderPlanosKPIs() {
        const totalPlanosEl = document.getElementById('kpi-planos-total');
        const totalAlunosEl = document.getElementById('kpi-planos-alunos');
        const ticketMedioEl = document.getElementById('kpi-planos-ticket');

        const ativos = this.planos.filter(p => p.ativo == 1);
        const totalAlunos = this.planos.reduce((acc, p) => acc + (p.total_alunos_ativos || 0), 0);
        const somaValores = ativos.reduce((acc, p) => acc + parseFloat(p.valor_mensal || 0), 0);
        const ticketMedio = ativos.length > 0 ? somaValores / ativos.length : 0;

        if (totalPlanosEl) totalPlanosEl.textContent = ativos.length;
        if (totalAlunosEl) totalAlunosEl.textContent = totalAlunos;
        if (ticketMedioEl) ticketMedioEl.textContent = UI.formatCurrency(ticketMedio);
    },

    renderPlanos() {
        const grid = document.getElementById('planos-grid');
        if (!grid) return;

        if (this.planos.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; padding: 60px 20px; text-align: center;">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 16px; color: var(--text-muted);"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    <h3 style="margin-bottom: 8px;">Nenhum plano comercial cadastrado</h3>
                    <p style="color: var(--text-muted); margin-bottom: 20px;">Crie o primeiro plano da sua academia com limites de treinos e modalidades inclusas.</p>
                    <button class="btn btn-primary" onclick="PlanosModule.openModalPlano()">+ Criar Novo Plano</button>
                </div>
            `;
            return;
        }

        const periodicidadeLabel = {
            1: 'Mensal',
            3: 'Trimestral',
            6: 'Semestral',
            12: 'Anual'
        };

        grid.innerHTML = this.planos.map(p => {
            const safeId = Number(p.id);
            const encodedNome = encodeURIComponent(p.nome || '').replace(/'/g, '%27');
            const isAtivo = p.ativo == 1;
            const periodoText = periodicidadeLabel[p.periodicidade_meses] || `${Number(p.periodicidade_meses) || 1} meses`;
            const checkinsText = p.limite_checkins_semana ? `${Number(p.limite_checkins_semana)}x por semana` : 'Livre / Ilimitado';
            
            // Tags das modalidades inclusas
            const modalidadesArray = p.modalidades_nomes 
                ? p.modalidades_nomes.split(', ') 
                : ['Nenhuma vinculada'];

            return `
                <div class="plano-card ${!isAtivo ? 'inativo' : ''}">
                    <div class="plano-card-header">
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                <h4 class="plano-card-title">${UI.escapeHtml(p.nome)}</h4>
                                <span class="plano-badge-period">${UI.escapeHtml(periodoText)}</span>
                            </div>
                            <p class="plano-card-desc">${UI.escapeHtml(p.descricao || 'Sem descrição cadastrada.')}</p>
                        </div>
                        <span class="badge-status ${isAtivo ? 'ativo' : 'inativo'}">
                            ${isAtivo ? 'Ativo' : 'Inativo'}
                        </span>
                    </div>

                    <div class="plano-card-price">
                        <span class="currency">R$</span>
                        <span class="value">${parseFloat(p.valor_mensal || 0).toFixed(2).replace('.', ',')}</span>
                        <span class="period">/mês</span>
                    </div>

                    <div class="plano-card-specs">
                        <div class="plano-spec-item">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                            <span><strong>Treinos:</strong> ${UI.escapeHtml(checkinsText)}</span>
                        </div>
                        <div class="plano-spec-item">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                            <span><strong>Carência:</strong> ${Number(p.tolerancia_inadimplencia_dias) || 0} dias de tolerância</span>
                        </div>
                        <div class="plano-spec-item">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                            <span><strong>Matrículas Ativas:</strong> <span style="color: #38bdf8; font-weight: 700;">${Number(p.total_alunos_ativos) || 0} alunos</span></span>
                        </div>
                    </div>

                    <div class="plano-card-modalidades">
                        <div class="plano-mod-label">Modalidades Inclusas:</div>
                        <div class="plano-mod-tags">
                            ${modalidadesArray.map(m => `<span class="mod-tag">${UI.escapeHtml(m)}</span>`).join('')}
                        </div>
                    </div>

                    <div class="plano-card-actions">
                        <button class="btn btn-secondary btn-sm" onclick="PlanosModule.openModalPlano(${safeId})">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            Editar
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="PlanosModule.toggleStatus(${safeId})">
                            ${isAtivo ? 'Pausar' : 'Ativar'}
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="PlanosModule.deletePlano(${safeId}, decodeURIComponent('${encodedNome}'))" title="Excluir Plano">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    async openModalPlano(planoId = null) {
        const modal = document.getElementById('modal-plano');
        const titleEl = document.getElementById('modal-plano-title');
        const form = document.getElementById('form-plano');
        if (!modal || !form) return;

        form.reset();
        document.getElementById('plano-id').value = '';

        // Se não tiver modalidades cacheadas, busca agora
        if (!this.modalidades || this.modalidades.length === 0) {
            await this.loadModalidadesCache();
        }

        // Renderiza lista de checkboxes de modalidades
        const checklist = document.getElementById('plano-modalidades-checklist');
        if (checklist) {
            checklist.innerHTML = this.modalidades.map(m => `
                <label class="modalidade-check-pill">
                    <input type="checkbox" name="modalidades_ids" value="${Number(m.id)}">
                    <span class="mod-icon" style="background: ${UI.sanitizeColor(m.cor_tema, '#38bdf8')};"></span>
                    <span>${UI.escapeHtml(m.nome)}</span>
                </label>
            `).join('');
        }

        if (planoId) {
            const plano = this.planos.find(p => p.id === planoId);
            if (!plano) return;

            titleEl.textContent = 'Editar Plano Comercial';
            document.getElementById('plano-id').value = plano.id;
            document.getElementById('plano-nome').value = plano.nome;
            document.getElementById('plano-descricao').value = plano.descricao || '';
            document.getElementById('plano-valor').value = plano.valor_mensal;
            document.getElementById('plano-periodicidade').value = plano.periodicidade_meses;
            document.getElementById('plano-checkins').value = plano.limite_checkins_semana || '';
            document.getElementById('plano-tolerancia').value = plano.tolerancia_inadimplencia_dias || 5;
            document.getElementById('plano-ativo').value = plano.ativo;

            // Marca checkboxes selecionados
            const ids = plano.modalidades_ids || [];
            document.querySelectorAll('#plano-modalidades-checklist input[type="checkbox"]').forEach(cb => {
                cb.checked = ids.includes(parseInt(cb.value));
            });
        } else {
            titleEl.textContent = 'Novo Plano Comercial';
            document.getElementById('plano-tolerancia').value = 5;
            document.getElementById('plano-periodicidade').value = 1;
            document.getElementById('plano-ativo').value = 1;

            // Por padrão marca a primeira ou todas
            const firstCb = document.querySelector('#plano-modalidades-checklist input[type="checkbox"]');
            if (firstCb) firstCb.checked = true;
        }

        UI.openModal('modal-plano');
    },

    async savePlano(e) {
        e.preventDefault();
        const id = document.getElementById('plano-id').value;
        const nome = document.getElementById('plano-nome').value.trim();
        const descricao = document.getElementById('plano-descricao').value.trim();
        const valor_mensal = parseFloat(document.getElementById('plano-valor').value);
        const periodicidade_meses = parseInt(document.getElementById('plano-periodicidade').value) || 1;
        const limite_checkins_semana = document.getElementById('plano-checkins').value 
            ? parseInt(document.getElementById('plano-checkins').value) 
            : null;
        const tolerancia_inadimplencia_dias = parseInt(document.getElementById('plano-tolerancia').value) || 5;
        const ativo = parseInt(document.getElementById('plano-ativo').value) || 1;

        // Modalidades selecionadas
        const modalidades_ids = Array.from(
            document.querySelectorAll('#plano-modalidades-checklist input[name="modalidades_ids"]:checked')
        ).map(cb => parseInt(cb.value));

        if (!nome || isNaN(valor_mensal) || valor_mensal <= 0) {
            UI.showToast('Preencha o nome do plano e um valor mensal válido.', 'warning');
            return;
        }

        const payload = {
            nome,
            descricao,
            valor_mensal,
            periodicidade_meses,
            limite_checkins_semana,
            tolerancia_inadimplencia_dias,
            ativo,
            modalidades_ids
        };

        const btnSubmit = document.getElementById('btn-save-plano');
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = `<div class="spinner"></div> Salvando...`;
        }

        try {
            if (id) {
                await API.put(`/planos/${id}`, payload);
                UI.showToast('Plano comercial atualizado com sucesso!', 'success');
            } else {
                await API.post('/planos', payload);
                UI.showToast('Plano comercial cadastrado com sucesso!', 'success');
            }

            UI.closeModal('modal-plano');
            await this.loadPlanos();

            // Atualiza cache de planos no módulo de alunos caso aberto
            if (window.AlunosModule && typeof AlunosModule.loadPlanos === 'function') {
                AlunosModule.loadPlanos();
            }
        } catch (err) {
            UI.showToast(err.message || 'Erro ao salvar plano.', 'error');
        } finally {
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.textContent = 'Salvar Plano';
            }
        }
    },

    async toggleStatus(planoId) {
        try {
            const res = await API.patch(`/planos/${planoId}/status`, {});
            UI.showToast(res.message, 'success');
            await this.loadPlanos();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao alternar status do plano.', 'error');
        }
    },

    async deletePlano(planoId, nome) {
        if (!confirm(`Deseja realmente excluir o plano "${nome}"?\nEsta ação não poderá ser desfeita.`)) {
            return;
        }

        try {
            const res = await API.delete(`/planos/${planoId}`);
            UI.showToast(res.message, 'success');
            await this.loadPlanos();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao excluir plano.', 'error');
        }
    },

    // ========================================================
    // GESTÃO DE MENSALIDADES E FATURAS (FINANCEIRO)
    // ========================================================
    async loadFaturas() {
        const tbody = document.getElementById('financeiro-table-body');
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 40px;"><div class="spinner"></div> Carregando faturas...</td></tr>`;

        const status = document.getElementById('filtro-fatura-status')?.value || 'todos';
        const mes = document.getElementById('filtro-fatura-mes')?.value || '';

        try {
            let url = `/faturas?status=${status}`;
            if (mes) url += `&mes=${mes}`;

            const [resFaturas, resResumo] = await Promise.all([
                API.get(url),
                API.get(`/faturas/resumo${mes ? '?mes=' + mes : ''}`)
            ]);

            this.faturas = resFaturas.data || [];
            this.resumoFinanceiro = resResumo.data || {};

            this.renderFaturasKPIs();
            this.renderFaturas();
        } catch (err) {
            console.error('Erro ao listar faturas:', err);
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: #ef4444;">Erro ao consultar faturas: ${UI.escapeHtml(err.message)}</td></tr>`;
        }
    },

    renderFaturasKPIs() {
        const kpiPrevisto = document.getElementById('kpi-faturas-previsto');
        const kpiRecebido = document.getElementById('kpi-faturas-recebido');
        const kpiAtrasado = document.getElementById('kpi-faturas-atrasado');
        const kpiTaxa = document.getElementById('kpi-faturas-taxa');

        if (!this.resumoFinanceiro) return;
        const r = this.resumoFinanceiro;

        if (kpiPrevisto) kpiPrevisto.textContent = UI.formatCurrency(r.total_previsto || 0);
        if (kpiRecebido) kpiRecebido.textContent = UI.formatCurrency(r.total_recebido || 0);
        if (kpiAtrasado) kpiAtrasado.textContent = UI.formatCurrency(r.total_atrasado || 0);
        if (kpiTaxa) kpiTaxa.textContent = `${r.taxa_adimplencia || 100}%`;
    },

    renderFaturas(lista = null) {
        const tbody = document.getElementById('financeiro-table-body');
        if (!tbody) return;

        const faturasToRender = lista || this.faturas;

        if (faturasToRender.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
                        Nenhuma fatura encontrada com os filtros selecionados.
                    </td>
                </tr>
            `;
            return;
        }

        const statusBadges = {
            pago: { label: 'Pago', class: 'ativo', color: '#10b981' },
            pendente: { label: 'Pendente', class: 'trancado', color: '#f59e0b' },
            atrasado: { label: 'Atrasado', class: 'bloqueado', color: '#ef4444' },
            cancelado: { label: 'Cancelado', class: 'inativo', color: '#94a3b8' }
        };

        tbody.innerHTML = faturasToRender.map(f => {
            const safeFatId = Number(f.id);
            const encodedAlunoNome = encodeURIComponent(f.aluno_nome || '').replace(/'/g, '%27');
            const encodedCompetencia = encodeURIComponent(f.competencia || '').replace(/'/g, '%27');
            const st = statusBadges[f.status] || { label: UI.escapeHtml(f.status), color: '#94a3b8', class: 'inativo' };
            const isPago = f.status === 'pago';

            return `
                <tr>
                    <td>
                        <div style="font-weight: 600; color: var(--text-main);">${UI.escapeHtml(f.aluno_nome)}</div>
                        <span style="font-size: 11px; color: var(--text-muted);">${UI.escapeHtml(f.telefone_whatsapp || 'Sem telefone')}</span>
                    </td>
                    <td>
                        <span style="font-size: 12px; font-weight: 500;">${UI.escapeHtml(f.plano_nome)}</span>
                    </td>
                    <td>
                        <code style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-size: 12px;">${UI.escapeHtml(f.competencia)}</code>
                    </td>
                    <td>
                        <span style="font-size: 12px;">${UI.formatDate(f.data_vencimento)}</span>
                    </td>
                    <td>
                        <span style="font-weight: 700; color: var(--text-main);">${UI.formatCurrency(f.valor_original)}</span>
                        ${f.valor_pago && isPago ? `<div style="font-size: 10px; color: #10b981;">Pago: ${UI.formatCurrency(f.valor_pago)}</div>` : ''}
                    </td>
                    <td>
                        <span class="badge-status ${st.class}">
                            ${st.label}
                        </span>
                    </td>
                    <td>
                        <div style="display: flex; gap: 6px; align-items: center;">
                            ${!isPago ? `
                                <button class="btn btn-success btn-sm" onclick="PlanosModule.openModalBaixa(${safeFatId}, ${Number(f.valor_original) || 0}, decodeURIComponent('${encodedAlunoNome}'), decodeURIComponent('${encodedCompetencia}'))">
                                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                                    Baixar
                                </button>
                                <button class="btn btn-secondary btn-sm" onclick="PlanosModule.excluirFatura(${safeFatId})" title="Cancelar / Excluir Fatura">
                                    &times;
                                </button>
                            ` : `
                                <span style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#10b981" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                                    ${UI.escapeHtml(f.metodo_pagamento || 'Quitado')}
                                </span>
                            `}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    filterFaturasClient() {
        const query = (document.getElementById('filtro-fatura-busca')?.value || '').toLowerCase().trim();
        if (!query) {
            this.renderFaturas();
            return;
        }

        const filtered = this.faturas.filter(f => 
            f.aluno_nome.toLowerCase().includes(query) ||
            f.plano_nome.toLowerCase().includes(query) ||
            f.competencia.toLowerCase().includes(query)
        );

        this.renderFaturas(filtered);
    },

    // Modal de Baixa de Pagamento
    openModalBaixa(faturaId, valorOriginal, alunoNome, competencia) {
        this.selectedFaturaId = faturaId;
        const modal = document.getElementById('modal-fatura-baixa');
        if (!modal) return;

        document.getElementById('baixa-aluno-nome').textContent = alunoNome;
        document.getElementById('baixa-competencia').textContent = competencia;
        document.getElementById('baixa-valor-original').textContent = UI.formatCurrency(valorOriginal);
        document.getElementById('baixa-valor-pago').value = parseFloat(valorOriginal).toFixed(2);
        document.getElementById('baixa-metodo').value = 'pix';
        document.getElementById('baixa-obs').value = '';

        UI.openModal('modal-fatura-baixa');
    },

    async confirmarBaixa(e) {
        e.preventDefault();
        if (!this.selectedFaturaId) return;

        const metodo_pagamento = document.getElementById('baixa-metodo').value;
        const valor_pago = parseFloat(document.getElementById('baixa-valor-pago').value);
        const observacoes = document.getElementById('baixa-obs').value.trim();

        const btn = document.getElementById('btn-confirmar-baixa');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<div class="spinner"></div> Confirmando...`;
        }

        try {
            const res = await API.patch(`/faturas/${this.selectedFaturaId}/pagar`, {
                metodo_pagamento,
                valor_pago,
                observacoes
            });

            UI.showToast(res.message, 'success');
            UI.closeModal('modal-fatura-baixa');
            await this.loadFaturas();

            // Atualiza dossiê do aluno se estiver aberto
            if (window.AlunoDetalhesModule && AlunoDetalhesModule.currentAlunoId) {
                AlunoDetalhesModule.openDossier(AlunoDetalhesModule.currentAlunoId);
            }
        } catch (err) {
            UI.showToast(err.message || 'Erro ao registrar pagamento.', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Confirmar Recebimento';
            }
        }
    },

    // Modal de Emissão de Fatura Avulsa
    async openModalNovaFatura() {
        const modal = document.getElementById('modal-nova-fatura');
        const form = document.getElementById('form-nova-fatura');
        const selectAluno = document.getElementById('fatura-aluno-id');
        if (!modal || !form || !selectAluno) return;

        form.reset();

        // Carrega alunos ativos no select
        try {
            selectAluno.innerHTML = `<option value="">Carregando alunos...</option>`;
            const res = await API.get('/alunos?status=ativo');
            const alunos = res.data || [];
            selectAluno.innerHTML = `<option value="">Selecione o aluno...</option>` + 
                alunos.map(a => `<option value="${Number(a.id)}">${UI.escapeHtml(a.nome_completo)} (${UI.escapeHtml(a.plano_nome || 'Sem plano')})</option>`).join('');
        } catch {
            selectAluno.innerHTML = `<option value="">Erro ao carregar alunos</option>`;
        }

        // Sugere competência atual e vencimento em 5 dias
        const hoje = new Date();
        const anoMes = hoje.toISOString().slice(0, 7);
        const vencPadrao = new Date();
        vencPadrao.setDate(hoje.getDate() + 5);

        document.getElementById('fatura-competencia').value = anoMes;
        document.getElementById('fatura-vencimento').value = vencPadrao.toISOString().slice(0, 10);

        UI.openModal('modal-nova-fatura');
    },

    async salvarNovaFatura(e) {
        e.preventDefault();
        const aluno_id = document.getElementById('fatura-aluno-id').value;
        const competencia = document.getElementById('fatura-competencia').value;
        const valor = parseFloat(document.getElementById('fatura-valor').value);
        const data_vencimento = document.getElementById('fatura-vencimento').value;
        const observacoes = document.getElementById('fatura-obs').value.trim();

        if (!aluno_id || !competencia || isNaN(valor) || valor <= 0 || !data_vencimento) {
            UI.showToast('Preencha todos os campos obrigatórios da fatura.', 'warning');
            return;
        }

        const btn = document.getElementById('btn-salvar-nova-fatura');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<div class="spinner"></div> Emitindo...`;
        }

        try {
            const res = await API.post('/faturas', {
                aluno_id,
                competencia,
                valor,
                data_vencimento,
                observacoes
            });

            UI.showToast(res.message, 'success');
            UI.closeModal('modal-nova-fatura');
            await this.loadFaturas();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao emitir fatura.', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Emitir Fatura';
            }
        }
    },

    async excluirFatura(faturaId) {
        if (!confirm('Deseja realmente cancelar/remover esta fatura pendente?')) {
            return;
        }

        try {
            const res = await API.delete(`/faturas/${faturaId}`);
            UI.showToast(res.message, 'success');
            await this.loadFaturas();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao cancelar fatura.', 'error');
        }
    },

    async loadLogsFalhas() {
        const tbody = document.getElementById('logs-pagamento-table-body');
        const badge = document.getElementById('badge-logs-falhas');
        const resolvido = document.getElementById('filtro-logs-resolvido')?.value ?? '0';
        const busca = document.getElementById('filtro-logs-busca')?.value?.trim() || '';

        try {
            const params = new URLSearchParams({ resolvido, limit: '100' });
            if (busca) params.set('busca', busca);

            const res = await API.get(`/faturas/logs-falhas?${params.toString()}`);
            const logs = res.data || [];
            const totalPendentes = Number(res.resumo?.total_pendentes || 0);

            if (badge) {
                badge.textContent = String(totalPendentes);
                badge.style.display = totalPendentes > 0 ? 'inline-block' : 'none';
            }

            if (!tbody) return;

            if (logs.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align: center; padding: 32px; color: var(--text-muted);">
                            Nenhuma falha de pagamento registrada para os filtros selecionados.
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = logs.map(log => {
                const safeId = Number(log.id);
                const dataFmt = log.created_at ? new Date(log.created_at).toLocaleString('pt-BR') : '-';
                const alunoNome = UI.escapeHtml(log.aluno_nome || (log.aluno_id ? `Aluno #${Number(log.aluno_id)}` : 'Não identificado'));
                const alunoSub = UI.escapeHtml(log.aluno_cpf || log.aluno_email || '');
                const opFmt = UI.escapeHtml(log.operacao || '-');
                const refFmt = log.referencia_tipo && log.referencia_id
                    ? `${UI.escapeHtml(log.referencia_tipo)} #${Number(log.referencia_id)}`
                    : '';
                const httpBadge = log.http_status
                    ? `<span style="background: rgba(239,68,68,0.15); color: #ef4444; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 11px;">HTTP ${Number(log.http_status)}</span>`
                    : '';
                const codeText = log.codigo_erro ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">${UI.escapeHtml(log.codigo_erro)}</div>` : '';
                const msgFmt = UI.escapeHtml(log.mensagem_erro || 'Erro sem descrição');
                const isResolvido = Number(log.resolvido) === 1;

                return `
                    <tr>
                        <td style="white-space: nowrap; font-size: 12px;">${UI.escapeHtml(dataFmt)}</td>
                        <td>
                            <div style="font-weight: 600;">${alunoNome}</div>
                            ${alunoSub ? `<div style="font-size: 11px; color: var(--text-muted);">${alunoSub}</div>` : ''}
                        </td>
                        <td>
                            <div style="font-weight: 600; font-size: 12px;">${opFmt}</div>
                            ${refFmt ? `<div style="font-size: 11px; color: var(--text-muted);">${refFmt}</div>` : ''}
                        </td>
                        <td>${httpBadge || '-'}${codeText}</td>
                        <td style="max-width: 340px; white-space: normal; word-break: break-word; font-size: 12px; color: #fca5a5;">${msgFmt}</td>
                        <td>
                            ${isResolvido
                                ? `<span style="color: #10b981; font-size: 12px; font-weight: 600;">Resolvido</span>`
                                : `<button type="button" class="btn btn-secondary btn-sm" onclick="PlanosModule.resolverLogFalha(${safeId})">Marcar Resolvido</button>`}
                        </td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px; color: #ef4444;">Erro ao carregar logs de pagamento.</td></tr>`;
            }
        }
    },

    async resolverLogFalha(logId) {
        try {
            const res = await API.request(`/faturas/logs-falhas/${Number(logId)}/resolver`, {
                method: 'PATCH',
                body: JSON.stringify({ resolvido: true })
            });
            UI.showToast(res.message || 'Log resolvido.', 'success');
            await this.loadLogsFalhas();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao atualizar log.', 'error');
        }
    },

    async limparLogsResolvidos() {
        if (!confirm('Remover permanentemente todos os logs já marcados como resolvidos?')) return;
        try {
            const res = await API.delete('/faturas/logs-falhas/limpar-resolvidos');
            UI.showToast(res.message || 'Logs limpos.', 'success');
            await this.loadLogsFalhas();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao limpar logs.', 'error');
        }
    }
};

// Exporta globalmente
window.PlanosModule = PlanosModule;
