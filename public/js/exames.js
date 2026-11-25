/**
 * PRO COMBATE - Módulo de Gestão de Exames de Graduação & Integração Asaas
 * Fluxo linear em 3 Etapas:
 * 1) Aguardando Convite (Elegibilidade Unificada: RPG + Avaliação Formal + Wiki)
 * 2) Convocados & Financeiro (Asaas Online vs Baixa Manual, Estorno, Reenvio, Alertas de Faixa)
 * 3) Dia do Exame & Promoção de Faixas em Lote
 */

const ExamesModule = {
    eventos: [],
    eventoSelecionadoId: null,
    eventoDetalhesAtual: null,
    alunosAptos: [],
    alunosInelegiveis: [],
    resumoAptos: null,
    alunosSelecionadosIds: new Set(),
    activeTab: 'aptos', // 'aptos' | 'convites' | 'execucao'
    mostrarJaConvidados: false,
    mostrarInelegiveis: false,
    buscaAptos: '',
    buscaConvites: '',
    filtroStatusConvite: 'todos',
    faixasCompraScope: 'todos_ativos', // 'pagos' | 'pagos_aceitos' | 'todos_ativos'
    resultadosExecucao: {}, // { [conviteId]: 'aprovado' | 'reprovado' | 'ausente' }

    async init() {
        console.log('🥋 [ExamesModule] Inicializando módulo de exames de graduação...');
        this.bindEvents();
    },

    bindEvents() {
        document.getElementById('btn-novo-evento-exame')?.addEventListener('click', () => {
            this.abrirModalNovoEvento();
        });

        document.getElementById('form-evento-exame')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.salvarEvento();
        });

        document.getElementById('form-baixa-manual-exame')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submeterBaixaManual();
        });

        // Abas do funil em 3 etapas
        document.getElementById('tab-btn-aptos')?.addEventListener('click', () => this.switchTab('aptos'));
        document.getElementById('tab-btn-convites')?.addEventListener('click', () => this.switchTab('convites'));
        document.getElementById('tab-btn-execucao')?.addEventListener('click', () => this.switchTab('execucao'));

        // Controles da Etapa 1 (Aguardando Convite)
        document.getElementById('filtro-aptos-modalidade')?.addEventListener('change', () => {
            this.carregarAlunosAptos();
        });
        document.getElementById('busca-aptos-exame')?.addEventListener('input', (e) => {
            this.buscaAptos = String(e.target.value || '').trim().toLowerCase();
            this.renderTabelaAptos();
            this.renderTabelaInelegiveis();
        });
        document.getElementById('toggle-mostrar-ja-convidados')?.addEventListener('change', (e) => {
            this.mostrarJaConvidados = Boolean(e.target.checked);
            this.alunosSelecionadosIds.clear();
            const chkAll = document.getElementById('check-todos-aptos');
            if (chkAll) chkAll.checked = false;
            this.renderTabelaAptos();
        });
        document.getElementById('btn-toggle-inelegiveis')?.addEventListener('click', () => {
            this.mostrarInelegiveis = !this.mostrarInelegiveis;
            const painel = document.getElementById('painel-inelegiveis-exame');
            if (painel) painel.style.display = this.mostrarInelegiveis ? 'block' : 'none';
        });
        document.getElementById('check-todos-aptos')?.addEventListener('change', (e) => {
            this.toggleSelecionarTodos(e.target.checked);
        });
        document.getElementById('btn-enviar-convites-lote')?.addEventListener('click', () => {
            this.enviarConvitesSelecionados();
        });

        // Controles da Etapa 2 (Convocados & Financeiro)
        document.getElementById('busca-convites-exame')?.addEventListener('input', (e) => {
            this.buscaConvites = String(e.target.value || '').trim().toLowerCase();
            this.renderListaConvites();
        });
        document.getElementById('convites-status-pills')?.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-status-filter]');
            if (!btn) return;
            this.filtroStatusConvite = btn.getAttribute('data-status-filter') || 'todos';
            document.querySelectorAll('#convites-status-pills .exame-status-pill').forEach((p) => {
                p.classList.toggle('active', p === btn);
            });
            this.renderListaConvites();
        });

        // Controles da Etapa 3 (Dia do Exame & Promoção)
        document.getElementById('btn-marcar-todos-aprovados')?.addEventListener('click', () => {
            this.marcarTodosPendentesAprovados();
        });
        document.getElementById('btn-salvar-promocoes-exame')?.addEventListener('click', () => {
            this.submeterPromocoes();
        });

        // Contagem de Faixas para Compras
        document.getElementById('compra-faixas-scope-pills')?.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-purchase-scope]');
            if (!btn) return;
            this.faixasCompraScope = btn.getAttribute('data-purchase-scope') || 'todos_ativos';
            document.querySelectorAll('#compra-faixas-scope-pills .exame-status-pill').forEach((p) => {
                p.classList.toggle('active', p === btn);
            });
            this.renderCardCompraFaixas();
        });
        document.getElementById('btn-copiar-lista-faixas')?.addEventListener('click', () => {
            this.copiarListaCompraFaixas();
        });

        // Recarregar & Conciliar Asaas
        document.getElementById('btn-recarregar-exames')?.addEventListener('click', async () => {
            if (this.eventoSelecionadoId) {
                try {
                    const syncRes = await API.post(`/exames/eventos/${this.eventoSelecionadoId}/sincronizar-asaas`, {});
                    if (syncRes && (syncRes.atualizados_online > 0 || syncRes.ajustados_manual > 0)) {
                        UI.showToast(syncRes.message, 'success');
                    }
                } catch (syncErr) {
                    console.warn('Falha ao conciliar exame no Asaas:', syncErr.message);
                }
            }
            await this.loadAll();
        });
    },

    async loadAll() {
        try {
            const hadSelected = Boolean(this.eventoSelecionadoId);
            await this.loadEventos();
            if (hadSelected && this.eventoSelecionadoId) {
                const eventoAtual = this.eventos.find(e => e.id === this.eventoSelecionadoId);
                if (eventoAtual) {
                    await this.syncModalidadeFilterVisibility(eventoAtual);
                    await Promise.all([
                        this.carregarDetalhesEvento(this.eventoSelecionadoId),
                        this.carregarAlunosAptos()
                    ]);
                }
            }
        } catch (err) {
            console.error('Erro ao carregar dados de exames:', err);
            UI.showToast('Erro ao carregar exames: ' + err.message, 'error');
        }
    },

    async loadEventos() {
        try {
            const res = await API.get('/exames/eventos');
            this.eventos = res.data || [];
            this.updateEventScopedKpis();
            this.renderEventosSelect();
            this.renderEventosCards();

            if (this.eventos.length > 0 && !this.eventoSelecionadoId) {
                const ativo = this.eventos.find(e => e.status === 'aberto') || this.eventos[0];
                this.selecionarEvento(ativo.id);
            } else if (this.eventos.length === 0) {
                this.renderEmptyState();
            }
        } catch (err) {
            console.error('Falha ao buscar eventos de exame:', err);
            throw err;
        }
    },

    /**
     * Atualiza os KPIs do topo refletindo prioritariamente o evento selecionado,
     * com fallback global caso nenhum evento esteja aberto/selecionado.
     */
    updateEventScopedKpis() {
        const abertosCount = this.eventos.filter(e => e.status === 'aberto').length;
        const badgeNav = document.getElementById('total-exames-count');
        if (badgeNav) {
            badgeNav.textContent = abertosCount;
            badgeNav.style.display = abertosCount > 0 ? 'inline-block' : 'none';
        }

        const elAbertos = document.getElementById('kpi-exames-abertos');
        const elAbertosMeta = document.getElementById('kpi-exames-abertos-meta');
        const elConvidados = document.getElementById('kpi-exames-convidados');
        const elConvidadosMeta = document.getElementById('kpi-exames-convidados-meta');
        const elConfirmados = document.getElementById('kpi-exames-confirmados');
        const elConfirmadosMeta = document.getElementById('kpi-exames-confirmados-meta');
        const elArrecadado = document.getElementById('kpi-exames-arrecadado');
        const elArrecadadoMeta = document.getElementById('kpi-exames-arrecadado-meta');

        const ev = this.eventoDetalhesAtual || this.eventos.find(e => e.id === this.eventoSelecionadoId) || null;
        if (ev) {
            const resumoEv = ev.resumo || {};
            const pendentesConvite = this.resumoAptos
                ? Number(this.resumoAptos.pendentes_convite || 0)
                : this.alunosAptos.filter(a => !a.ja_convidado).length;
            const semResposta = resumoEv.sem_resposta !== undefined
                ? Number(resumoEv.sem_resposta)
                : Number(ev.total_convidados_pendentes || 0);
            const aguardandoPgto = resumoEv.aguardando_pagamento !== undefined
                ? Number(resumoEv.aguardando_pagamento)
                : Number(ev.total_aguardando_pagamento || 0);
            const pagosOnline = resumoEv.pagos_online !== undefined
                ? Number(resumoEv.pagos_online)
                : Number(ev.total_pagos_online || 0);
            const pagosManual = resumoEv.pagos_manual !== undefined
                ? Number(resumoEv.pagos_manual)
                : Number(ev.total_pagos_manual || 0);
            const totalPagos = resumoEv.pagos !== undefined
                ? Number(resumoEv.pagos)
                : Number(ev.total_pagos !== undefined ? ev.total_pagos : (ev.total_confirmados || 0));
            const arrOnline = resumoEv.arrecadado_online !== undefined
                ? Number(resumoEv.arrecadado_online)
                : Number(ev.valor_arrecadado_online || 0);
            const arrManual = resumoEv.arrecadado_manual !== undefined
                ? Number(resumoEv.arrecadado_manual)
                : Number(ev.valor_arrecadado_manual || 0);
            const arrTotal = resumoEv.arrecadado_total !== undefined
                ? Number(resumoEv.arrecadado_total)
                : (Number(ev.total_arrecadado) || (arrOnline + arrManual));

            if (elAbertos) elAbertos.textContent = pendentesConvite;
            if (elAbertosMeta) {
                elAbertosMeta.textContent = pendentesConvite === 1
                    ? '1 atleta apto aguardando convite'
                    : `${pendentesConvite} aptos aguardando convite`;
            }

            if (elConvidados) elConvidados.textContent = semResposta + aguardandoPgto;
            if (elConvidadosMeta) {
                elConvidadosMeta.textContent = `${semResposta} sem resposta • ${aguardandoPgto} aguardando pgto`;
            }

            if (elConfirmados) elConfirmados.textContent = totalPagos;
            if (elConfirmadosMeta) {
                elConfirmadosMeta.textContent = `${pagosOnline} online • ${pagosManual} manual`;
            }

            if (elArrecadado) elArrecadado.textContent = `R$ ${arrTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
            if (elArrecadadoMeta) {
                elArrecadadoMeta.textContent = `Online R$ ${arrOnline.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} • Manual R$ ${arrManual.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
            }
            return;
        }

        // Fallback global se não houver evento selecionado
        const totalConvidados = this.eventos.reduce((acc, e) => acc + (parseInt(e.total_convidados, 10) || 0), 0);
        const totalConfirmados = this.eventos.reduce((acc, e) => acc + (parseInt(e.total_pagos !== undefined ? e.total_pagos : e.total_confirmados, 10) || 0), 0);
        const totalArrecadado = this.eventos.reduce((acc, e) => acc + (parseFloat(e.total_arrecadado) || 0), 0);

        if (elAbertos) elAbertos.textContent = abertosCount;
        if (elAbertosMeta) elAbertosMeta.textContent = 'Exames com inscrições abertas';
        if (elConvidados) elConvidados.textContent = totalConvidados;
        if (elConvidadosMeta) elConvidadosMeta.textContent = 'Convites emitidos no histórico';
        if (elConfirmados) elConfirmados.textContent = totalConfirmados;
        if (elConfirmadosMeta) elConfirmadosMeta.textContent = 'Taxas pagas / quitadas';
        if (elArrecadado) elArrecadado.textContent = `R$ ${totalArrecadado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        if (elArrecadadoMeta) elArrecadadoMeta.textContent = 'Online (Gateway) e Baixas Manuais';
    },

    renderEventosSelect() {
        const select = document.getElementById('select-evento-ativo');
        if (!select) return;

        if (this.eventos.length === 0) {
            select.innerHTML = '<option value="">Nenhum evento criado</option>';
            return;
        }

        select.innerHTML = this.eventos.map(e => {
            const dataFmt = this.formatarData(e.data_evento);
            const statusLabel = e.status === 'aberto' ? '🟢 Aberto' : (e.status === 'concluido' ? '🏁 Concluído' : '⚪ ' + e.status);
            return `<option value="${e.id}" ${e.id === this.eventoSelecionadoId ? 'selected' : ''}>
                ${UI.escapeHtml(e.titulo)} (${dataFmt} - ${statusLabel})
            </option>`;
        }).join('');

        select.onchange = (e) => {
            const id = parseInt(e.target.value, 10);
            if (id) this.selecionarEvento(id);
        };
    },

    renderEventosCards() {
        const container = document.getElementById('eventos-cards-container');
        if (!container) return;

        if (this.eventos.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 32px 16px; color: var(--text-muted);">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 12px; opacity: 0.5;">
                        <circle cx="12" cy="8" r="6" />
                        <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
                    </svg>
                    <p style="font-size: 14px; margin: 0 0 12px 0;">Nenhum exame de graduação iniciado ainda.</p>
                    <button class="btn btn-primary" onclick="ExamesModule.abrirModalNovoEvento()">
                        + Iniciar Primeiro Exame
                    </button>
                </div>
            `;
            return;
        }

        container.innerHTML = this.eventos.map(e => {
            const isSelected = e.id === this.eventoSelecionadoId;
            const dataFmt = this.formatarData(e.data_evento);
            const taxaFmt = parseFloat(e.taxa_inscricao || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
            const totalPagos = parseInt(e.total_pagos !== undefined ? e.total_pagos : e.total_confirmados, 10) || 0;
            const totalConv = parseInt(e.total_convidados, 10) || 0;

            const statusBadges = {
                'aberto': '<span class="status-badge status-active">Inscrições Abertas</span>',
                'rascunho': '<span class="status-badge status-pending">Rascunho</span>',
                'em_andamento': '<span class="status-badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b;">Em Andamento</span>',
                'concluido': '<span class="status-badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">Concluído</span>',
                'cancelado': '<span class="status-badge status-danger">Cancelado</span>'
            };

            return `
                <div class="evento-exame-card ${isSelected ? 'card-selected' : ''}" 
                     onclick="ExamesModule.selecionarEvento(${e.id})">
                    <div class="evento-card-top">
                        <span class="badge-modality">
                            ${UI.escapeHtml(e.modalidade_nome || 'Todas as Modalidades')}
                        </span>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            ${isSelected ? '<span class="badge-selected-pill">✓ Ativo</span>' : ''}
                            ${statusBadges[e.status] || ''}
                        </div>
                    </div>

                    <h4 class="evento-card-title">
                        ${UI.escapeHtml(e.titulo)}
                    </h4>

                    <div class="evento-chips-row">
                        <span class="evento-chip">
                            📅 <strong>${dataFmt}</strong> às ${e.horario_inicio ? e.horario_inicio.substring(0, 5) : '09:00'}
                        </span>
                        <span class="evento-chip taxa">
                            💰 Taxa: R$ ${taxaFmt}
                        </span>
                    </div>

                    <div class="evento-card-footer">
                        <div style="display: flex; gap: 12px; align-items: center; font-size: 11.5px;">
                            <span style="color: var(--text-muted);">
                                ✉️ Convocados: <strong style="color: #ffffff;">${totalConv}</strong>
                            </span>
                            <span style="color: var(--text-muted);">
                                ✅ Confirmados: <strong style="color: #10b981;">${totalPagos}</strong>
                            </span>
                        </div>
                        <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 11px;"
                                onclick="event.stopPropagation(); ExamesModule.abrirModalEditarEvento(${e.id})">
                            ✏️ Editar
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    async selecionarEvento(eventoId) {
        this.eventoSelecionadoId = eventoId;
        this.resultadosExecucao = {};
        this.renderEventosCards();
        this.renderEventosSelect();
        const eventoAtual = this.eventos.find(e => e.id === eventoId);
        await this.syncModalidadeFilterVisibility(eventoAtual);
        await Promise.all([
            this.carregarDetalhesEvento(eventoId),
            this.carregarAlunosAptos()
        ]);
    },

    async syncModalidadeFilterVisibility(evento) {
        const wrap = document.getElementById('filtro-aptos-modalidade-wrap');
        const select = document.getElementById('filtro-aptos-modalidade');
        if (!wrap || !select) return;

        if (evento && evento.modalidade_id) {
            wrap.style.display = 'none';
            select.value = '';
        } else {
            wrap.style.display = 'flex';
            if (select.options.length <= 1) {
                const selectedVal = select.value ? parseInt(select.value, 10) : null;
                await this.carregarModalidadesSelect('filtro-aptos-modalidade', selectedVal);
            }
        }
    },

    async carregarDetalhesEvento(eventoId) {
        try {
            const res = await API.get(`/exames/eventos/${eventoId}?sync_asaas=1`);
            const evento = res.data;
            this.eventoDetalhesAtual = evento;

            const tituloEl = document.getElementById('detalhe-evento-titulo');
            const dataEl = document.getElementById('detalhe-evento-data');
            const taxaEl = document.getElementById('detalhe-evento-taxa');
            const localEl = document.getElementById('detalhe-evento-local');
            const descEl = document.getElementById('detalhe-evento-desc');

            if (tituloEl) tituloEl.textContent = evento.titulo;
            if (dataEl) dataEl.textContent = `${this.formatarData(evento.data_evento)} às ${evento.horario_inicio ? evento.horario_inicio.substring(0, 5) : '09:00'}`;
            if (taxaEl) taxaEl.textContent = `R$ ${parseFloat(evento.taxa_inscricao || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
            if (localEl) localEl.textContent = evento.local_evento || 'Tatame Principal - Pro Combate';
            if (descEl) descEl.textContent = evento.descricao || 'Sem orientações complementares cadastradas.';

            this.renderCardCompraFaixas();
            this.renderListaConvites();
            this.renderTabelaExecucao();
            this.updateEventScopedKpis();

            const painelDetalhes = document.getElementById('painel-evento-detalhes');
            if (painelDetalhes) painelDetalhes.style.display = 'block';

            if (evento.sync_atualizou) {
                await this.loadEventos();
            }
        } catch (err) {
            console.error('Erro ao carregar detalhes do evento:', err);
        }
    },

    getContagemFaixasCompra() {
        const backendResumo = this.eventoDetalhesAtual?.contagem_faixas_compra;
        if (backendResumo && Array.isArray(backendResumo.faixas)) {
            return backendResumo;
        }
        const convites = this.eventoDetalhesAtual?.convites || [];
        const groups = new Map();
        const totais = {
            pagos: 0,
            aceitos: 0,
            convidados: 0,
            total_pagos_e_aceitos: 0,
            total_ativos: 0,
            ignorados_recusados_ou_excluidos: 0,
            com_divergencia: 0
        };
        convites.forEach((c) => {
            if (c.convite_status === 'recusado' || c.aluno_excluido || c.aluno_deleted_at) {
                totais.ignorados_recusados_ou_excluidos++;
                return;
            }
            const key = c.graduacao_pretendida_id ? `id:${c.graduacao_pretendida_id}` : `nome:${c.graduacao_pretendida_nome || ''}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    graduacao_id: c.graduacao_pretendida_id || null,
                    nome: c.graduacao_pretendida_nome || 'Graduação não informada',
                    cor_primaria: c.pretendida_cor_primaria || '#94a3b8',
                    cor_secundaria: c.pretendida_cor_secundaria || null,
                    ordem: Number(c.pretendida_ordem) || 999,
                    pagos: 0,
                    aceitos: 0,
                    convidados: 0,
                    total_pagos_e_aceitos: 0,
                    total_ativos: 0,
                    com_divergencia: 0
                });
            }
            const item = groups.get(key);
            if (c.convite_status === 'pago') { item.pagos++; totais.pagos++; }
            else if (c.convite_status === 'aceito') { item.aceitos++; totais.aceitos++; }
            else { item.convidados++; totais.convidados++; }
            item.total_pagos_e_aceitos = item.pagos + item.aceitos;
            item.total_ativos = item.pagos + item.aceitos + item.convidados;
            totais.total_ativos++;
            if (c.faixa_divergente) { item.com_divergencia++; totais.com_divergencia++; }
        });
        totais.total_pagos_e_aceitos = totais.pagos + totais.aceitos;
        const faixas = Array.from(groups.values()).sort((a, b) => (a.ordem - b.ordem) || a.nome.localeCompare(b.nome, 'pt-BR'));
        return { faixas, totais };
    },

    getQuantidadeByScope(faixaItem) {
        if (this.faixasCompraScope === 'pagos') return Number(faixaItem.pagos || 0);
        if (this.faixasCompraScope === 'pagos_aceitos') return Number(faixaItem.total_pagos_e_aceitos || 0);
        return Number(faixaItem.total_ativos || 0);
    },

    renderCardCompraFaixas() {
        const card = document.getElementById('card-compra-faixas-exame');
        const grid = document.getElementById('compra-faixas-grid');
        const resumoEl = document.getElementById('compra-faixas-resumo-texto');
        const alertaEl = document.getElementById('compra-faixas-alerta-divergencia');
        if (!card || !grid) return;

        if (!this.eventoDetalhesAtual) {
            card.style.display = 'none';
            return;
        }

        card.style.display = 'block';
        const resumo = this.getContagemFaixasCompra();
        const faixas = (resumo.faixas || []).map(f => ({
            ...f,
            qty: this.getQuantidadeByScope(f)
        })).filter(f => f.qty > 0);

        const totalUnidades = faixas.reduce((acc, f) => acc + f.qty, 0);
        const ignorados = Number(resumo.totais?.ignorados_recusados_ou_excluidos || 0);
        const scopeDescMap = {
            pagos: 'somente inscrições pagas',
            pagos_aceitos: 'pagos + aguardando pagamento',
            todos_ativos: 'todos os convocados ativos'
        };
        const scopeDesc = scopeDescMap[this.faixasCompraScope] || 'convocados ativos';

        if (resumoEl) {
            const ignTexto = ignorados > 0
                ? ` • ${ignorados} recusado(s)/removido(s) desconsiderado(s)`
                : '';
            resumoEl.textContent = `Total para compra (${scopeDesc}): ${totalUnidades} faixa(s) em ${faixas.length} graduação(ões)${ignTexto}`;
        }

        if (alertaEl) {
            const divCount = Number(resumo.totais?.com_divergencia || 0);
            if (divCount > 0) {
                alertaEl.style.display = 'flex';
                alertaEl.innerHTML = `
                    <div>
                        <strong>⚠️ Atenção antes de comprar:</strong> Há <strong>${divCount}</strong> convite(s) com faixa pretendida divergente. Revise em <strong>2. Convocados &amp; Financeiro</strong> para evitar compra errada.
                    </div>
                `;
            } else {
                alertaEl.style.display = 'none';
                alertaEl.innerHTML = '';
            }
        }

        if (faixas.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 16px; color: var(--text-muted); font-size: 12.5px;">
                    Nenhuma faixa pretendida contabilizada para o filtro "${UI.escapeHtml(scopeDesc)}".
                </div>
            `;
            return;
        }

        grid.innerHTML = faixas.map(f => {
            const pendentes = Number(f.aceitos || 0) + Number(f.convidados || 0);
            const divTag = Number(f.com_divergencia || 0) > 0
                ? `<span style="color: #fbbf24;">• ${Number(f.com_divergencia)} diverg.</span>`
                : '';
            return `
                <div class="exame-purchase-item">
                    <div class="exame-purchase-top">
                        ${UI.renderBeltBadge(f.nome, f.cor_primaria, f.cor_secundaria)}
                        <span class="exame-purchase-qty">${f.qty} un.</span>
                    </div>
                    <div class="exame-purchase-breakdown">
                        <span>✅ ${Number(f.pagos || 0)} pagas</span>
                        <span>⏳ ${pendentes} pend.</span>
                        ${divTag}
                    </div>
                </div>
            `;
        }).join('');
    },

    async copiarListaCompraFaixas() {
        if (!this.eventoDetalhesAtual) return;
        const resumo = this.getContagemFaixasCompra();
        const faixas = (resumo.faixas || []).map(f => ({
            ...f,
            qty: this.getQuantidadeByScope(f)
        })).filter(f => f.qty > 0);

        if (faixas.length === 0) {
            UI.showToast('Não há faixas para copiar neste filtro.', 'warning');
            return;
        }

        const scopeLabel = this.faixasCompraScope === 'pagos'
            ? 'Somente Pagos'
            : (this.faixasCompraScope === 'pagos_aceitos' ? 'Pagos + Aguard. Pgto' : 'Todos Convocados Ativos');
        const total = faixas.reduce((acc, f) => acc + f.qty, 0);
        const dataFmt = this.formatarData(this.eventoDetalhesAtual.data_evento);
        const linhas = [
            `Lista de Compra de Faixas - ${this.eventoDetalhesAtual.titulo} (${dataFmt})`,
            `Filtro: ${scopeLabel}`,
            '',
            ...faixas.map(f => `• ${f.nome}: ${f.qty} un. (${f.pagos} pagas, ${f.aceitos + f.convidados} pendentes)`),
            '',
            `Total Geral: ${total} unidade(s)`
        ];
        const texto = linhas.join('\n');

        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(texto);
            } else {
                const ta = document.createElement('textarea');
                ta.value = texto;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            UI.showToast('Lista de compras copiada para a área de transferência!', 'success');
        } catch (err) {
            UI.showToast('Não foi possível copiar automaticamente: ' + err.message, 'error');
        }
    },

    /**
     * Carrega alunos aptos e inelegíveis pelo motor unificado
     */
    async carregarAlunosAptos() {
        const tbody = document.getElementById('tabela-alunos-aptos-corpo');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 24px; color: var(--text-muted);">Analisando avaliações RPG, graduais e domínio técnico...</td></tr>';

        try {
            let url = `/exames/alunos-aptos?evento_id=${this.eventoSelecionadoId || ''}&incluir_inelegiveis=1`;
            const eventoAtual = this.eventos.find(e => e.id === this.eventoSelecionadoId);
            const modFiltro = (eventoAtual && eventoAtual.modalidade_id)
                ? String(eventoAtual.modalidade_id)
                : (document.getElementById('filtro-aptos-modalidade')?.value || '');
            if (modFiltro) url += `&modalidade_id=${encodeURIComponent(modFiltro)}`;

            const res = await API.get(url);
            this.alunosAptos = res.data || [];
            this.alunosInelegiveis = res.inelegiveis || [];
            this.resumoAptos = res.resumo || null;
            this.alunosSelecionadosIds.clear();

            const chkAll = document.getElementById('check-todos-aptos');
            if (chkAll) chkAll.checked = false;

            const btnIneg = document.getElementById('btn-toggle-inelegiveis');
            if (btnIneg) {
                btnIneg.textContent = `Ver em evolução / inelegíveis (${this.alunosInelegiveis.length})`;
            }

            this.renderTabelaAptos();
            this.renderTabelaInelegiveis();
            this.updateEventScopedKpis();
        } catch (err) {
            console.error('Erro ao listar alunos aptos:', err);
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger-color); padding: 16px;">Erro ao carregar aptos: ${UI.escapeHtml(err.message)}</td></tr>`;
        }
    },

    renderTabelaAptos() {
        const tbody = document.getElementById('tabela-alunos-aptos-corpo');
        if (!tbody) return;

        const totalAptos = this.alunosAptos.length;
        const pendentes = this.alunosAptos.filter(a => !a.ja_convidado);
        const badgeCount = document.getElementById('badge-aptos-count');
        if (badgeCount) {
            badgeCount.textContent = `${pendentes.length} ${pendentes.length === 1 ? 'pendente' : 'pendentes'}`;
        }

        let lista = this.mostrarJaConvidados ? this.alunosAptos : pendentes;
        if (this.buscaAptos) {
            lista = lista.filter(a => {
                const hay = `${a.nome_completo || ''} ${a.email || ''} ${a.graduacao_atual_nome || ''} ${a.graduacao_pretendida_nome || ''}`.toLowerCase();
                return hay.includes(this.buscaAptos);
            });
        }

        if (lista.length === 0) {
            if (!this.mostrarJaConvidados && totalAptos > 0 && pendentes.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align: center; padding: 32px; color: var(--text-muted);">
                            <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 700; color: #34d399;">✓ Todos os ${totalAptos} atletas aptos já foram convidados para este exame!</p>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="ExamesModule.switchTab('convites')">
                                Acompanhar respostas e pagamentos na Etapa 2 &rarr;
                            </button>
                        </td>
                    </tr>
                `;
            } else {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align: center; padding: 32px; color: var(--text-muted);">
                            <p style="margin: 0 0 6px 0; font-size: 14px; font-weight: 600;">Nenhum atleta apto pendente encontrado.</p>
                            <span style="font-size: 12px;">Confira a lista "Ver em evolução / inelegíveis" para entender o que falta para cada aluno.</span>
                        </td>
                    </tr>
                `;
            }
            this.atualizarBotaoEnvioLote();
            return;
        }

        tbody.innerHTML = lista.map(al => {
            const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(al.nome_completo || 'Atleta')}&background=0284c7&color=fff`;
            const fotoUrl = UI.sanitizeUrl(al.foto_perfil_url, fallbackAvatar);
            const isJaConvidado = Boolean(al.ja_convidado);
            const isSelected = this.alunosSelecionadosIds.has(al.aluno_id);
            const conviteStatusRaw = String(al.convite_status || 'convidado').toLowerCase();
            const conviteStatusSafe = UI.escapeHtml(conviteStatusRaw);
            const conviteBadgeClass = conviteStatusRaw === 'pago'
                ? 'exame-status-pago'
                : (conviteStatusRaw === 'aceito'
                    ? 'exame-status-aceito'
                    : (conviteStatusRaw === 'recusado' ? 'exame-status-recusado' : 'exame-status-convidado'));

            const pct = Math.min(100, Math.max(0, Math.round(Number(al.percentual_avaliacao || 0))));
            const motivoSafe = UI.escapeHtml(al.motivo_elegibilidade || al.apto_motivo || 'Apto');

            return `
                <tr style="${isJaConvidado ? 'opacity: 0.85; background: rgba(255,255,255,0.015);' : ''}">
                    <td style="width: 40px; text-align: center;">
                        <input type="checkbox" class="check-aluno-apto" data-aluno-id="${Number(al.aluno_id)}" 
                               ${isJaConvidado ? 'disabled title="Já convidado para este exame"' : ''}
                               ${isSelected ? 'checked' : ''}
                               onchange="ExamesModule.toggleSelecionarAluno(${Number(al.aluno_id)}, this.checked)">
                    </td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <img src="${fotoUrl}" alt="${UI.escapeHtml(al.nome_completo)}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(255,255,255,0.1);">
                            <div>
                                <div style="font-weight: 700; color: var(--text-primary); font-size: 13.5px;">${UI.escapeHtml(al.nome_completo)}</div>
                                <div style="font-size: 11.5px; color: var(--text-muted);">${UI.escapeHtml(al.email || al.telefone_whatsapp || 'Sem contato')}</div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span class="status-badge" style="background: rgba(14, 165, 233, 0.12); color: #38bdf8;">
                            ${UI.escapeHtml(al.modalidade_nome)}
                        </span>
                    </td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            ${UI.renderBeltBadge(al.graduacao_atual_nome, al.atual_cor_primaria, al.atual_cor_secundaria)}
                            <span style="color: var(--text-muted); font-size: 13px;">➜</span>
                            ${UI.renderBeltBadge(al.graduacao_pretendida_nome, al.pretendida_cor_primaria, al.pretendida_cor_secundaria)}
                        </div>
                    </td>
                    <td>
                        <div style="display: flex; flex-direction: column; gap: 4px; min-width: 150px;" title="${motivoSafe}">
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; gap: 6px;">
                                <strong style="color: #10b981;">${pct}%</strong>
                                <span style="font-size: 10.5px; color: #94a3b8;">${motivoSafe}</span>
                            </div>
                            <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden;">
                                <div style="width: ${pct}%; height: 100%; background: #10b981; border-radius: 999px;"></div>
                            </div>
                        </div>
                    </td>
                    <td>
                        ${isJaConvidado 
                            ? `<span class="status-badge ${conviteBadgeClass}" style="font-size: 11px;">✓ Convidado (${conviteStatusSafe})</span>` 
                            : `<button type="button" class="btn btn-secondary btn-sm" onclick="ExamesModule.convidarAlunoIndividual(${Number(al.aluno_id)})">Convidar</button>`}
                    </td>
                </tr>
            `;
        }).join('');

        this.atualizarBotaoEnvioLote();
    },

    renderTabelaInelegiveis() {
        const tbody = document.getElementById('tabela-inelegiveis-corpo');
        if (!tbody) return;

        let lista = this.alunosInelegiveis || [];
        if (this.buscaAptos) {
            lista = lista.filter(a => {
                const hay = `${a.nome_completo || ''} ${a.graduacao_atual_nome || ''} ${a.motivo_inelegibilidade || ''}`.toLowerCase();
                return hay.includes(this.buscaAptos);
            });
        }

        if (lista.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 18px; color: var(--text-muted);">Nenhum atleta em evolução para os filtros atuais.</td></tr>';
            return;
        }

        tbody.innerHTML = lista.map(a => {
            const pct = Math.min(100, Math.max(0, Math.round(Number(a.percentual_avaliacao || 0))));
            const proxBadge = a.graduacao_pretendida_nome
                ? UI.renderBeltBadge(a.graduacao_pretendida_nome, a.pretendida_cor_primaria, a.pretendida_cor_secundaria)
                : '<span style="font-size: 11px; color: var(--text-muted);">Nível Máximo</span>';
            return `
                <tr>
                    <td>
                        <div style="font-weight: 700; color: var(--text-primary); font-size: 13px;">${UI.escapeHtml(a.nome_completo)}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${UI.escapeHtml(a.modalidade_nome || '')}</div>
                    </td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            ${UI.renderBeltBadge(a.graduacao_atual_nome, a.atual_cor_primaria, a.atual_cor_secundaria)}
                            <span style="color: var(--text-muted);">➜</span>
                            ${proxBadge}
                        </div>
                    </td>
                    <td><strong>${pct}%</strong></td>
                    <td style="font-size: 12px; color: #fbbf24;">${UI.escapeHtml(a.motivo_inelegibilidade || 'Em evolução')}</td>
                </tr>
            `;
        }).join('');
    },

    toggleSelecionarAluno(alunoId, isChecked) {
        if (isChecked) {
            this.alunosSelecionadosIds.add(alunoId);
        } else {
            this.alunosSelecionadosIds.delete(alunoId);
        }
        this.atualizarBotaoEnvioLote();
    },

    toggleSelecionarTodos(isChecked) {
        this.alunosSelecionadosIds.clear();
        if (isChecked) {
            document.querySelectorAll('#tabela-alunos-aptos-corpo .check-aluno-apto:not([disabled])').forEach(chk => {
                const aId = Number(chk.getAttribute('data-aluno-id'));
                if (aId) {
                    this.alunosSelecionadosIds.add(aId);
                    chk.checked = true;
                }
            });
        } else {
            document.querySelectorAll('#tabela-alunos-aptos-corpo .check-aluno-apto:not([disabled])').forEach(chk => {
                chk.checked = false;
            });
        }
        this.atualizarBotaoEnvioLote();
    },

    atualizarBotaoEnvioLote() {
        const btn = document.getElementById('btn-enviar-convites-lote');
        const count = this.alunosSelecionadosIds.size;
        if (btn) {
            btn.disabled = count === 0;
            btn.classList.toggle('is-disabled', count === 0);
            const labelCount = count === 1 ? '1 selecionado' : `${count} selecionados`;
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                <span>Enviar Convite de Exame (${labelCount})</span>
            `;
        }
    },

    async enviarConvitesSelecionados() {
        if (!this.eventoSelecionadoId) {
            UI.showToast('Selecione um evento de exame primeiro.', 'warning');
            return;
        }

        if (this.alunosSelecionadosIds.size === 0) {
            UI.showToast('Selecione ao menos um aluno apto para convidar.', 'warning');
            return;
        }

        const alunosPayload = [];
        for (const alunoId of this.alunosSelecionadosIds) {
            const alunoObj = this.alunosAptos.find(a => a.aluno_id === alunoId);
            if (alunoObj) {
                alunosPayload.push({
                    aluno_id: alunoObj.aluno_id,
                    modalidade_id: alunoObj.modalidade_id,
                    graduacao_atual_id: alunoObj.graduacao_atual_id,
                    graduacao_pretendida_id: alunoObj.graduacao_pretendida_id,
                    percentual_avaliacao: alunoObj.percentual_avaliacao,
                    apto_motivo: alunoObj.apto_motivo
                });
            }
        }

        try {
            UI.showToast('Enviando convites de exame...', 'info');
            const res = await API.post(`/exames/eventos/${this.eventoSelecionadoId}/convidar`, {
                alunos: alunosPayload
            });

            UI.showToast(res.message || 'Convites enviados com sucesso!', 'success');
            this.alunosSelecionadosIds.clear();
            const chkAll = document.getElementById('check-todos-aptos');
            if (chkAll) chkAll.checked = false;

            await Promise.all([
                this.carregarDetalhesEvento(this.eventoSelecionadoId),
                this.carregarAlunosAptos(),
                this.loadEventos()
            ]);
            this.switchTab('convites');
        } catch (err) {
            console.error('Erro ao enviar convites:', err);
            UI.showToast('Erro ao convidar alunos: ' + err.message, 'error');
        }
    },

    async convidarAlunoIndividual(alunoId) {
        this.alunosSelecionadosIds.clear();
        this.alunosSelecionadosIds.add(alunoId);
        await this.enviarConvitesSelecionados();
    },

    /**
     * Etapa 2: Renderiza a lista de convocados, financeiro e anomalias (faixa divergente / aluno excluído)
     */
    renderListaConvites() {
        const convitesAll = this.eventoDetalhesAtual?.convites || [];
        const tbody = document.getElementById('tabela-convites-corpo');
        const badgeCount = document.getElementById('badge-convites-count');
        const badgeAlertas = document.getElementById('badge-convites-alertas');
        const bannerAlertas = document.getElementById('convites-alertas-banner');
        if (!tbody) return;

        if (badgeCount) badgeCount.textContent = `${convitesAll.length} convocados`;

        const divergenciasCount = convitesAll.filter(c => c.faixa_divergente || c.aluno_inativo_ou_excluido).length;
        if (badgeAlertas) {
            badgeAlertas.style.display = divergenciasCount > 0 ? 'inline-block' : 'none';
            badgeAlertas.textContent = `${divergenciasCount} ${divergenciasCount === 1 ? 'alerta' : 'alertas'}`;
        }
        if (bannerAlertas) {
            if (divergenciasCount > 0) {
                bannerAlertas.style.display = 'flex';
                bannerAlertas.innerHTML = `
                    <div>
                        <strong>⚠️ Atenção:</strong> Existem <strong>${divergenciasCount}</strong> convocações com faixa desatualizada ou atleta inativo/excluído.
                        Use o filtro <strong>Alertas</strong> para revisar e sincronizar com segurança.
                    </div>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="ExamesModule.filtrarConvitesAlertas()">
                        Ver Alertas
                    </button>
                `;
            } else {
                bannerAlertas.style.display = 'none';
                bannerAlertas.innerHTML = '';
            }
        }

        let convites = convitesAll.filter((c) => {
            const origin = c.pagamento_origem || c.origem_pagamento || 'online';
            if (this.filtroStatusConvite === 'convidado' && c.convite_status !== 'convidado') return false;
            if (this.filtroStatusConvite === 'aceito' && c.convite_status !== 'aceito') return false;
            if (this.filtroStatusConvite === 'pago_online' && !(c.convite_status === 'pago' && origin === 'online')) return false;
            if (this.filtroStatusConvite === 'pago_manual' && !(c.convite_status === 'pago' && origin === 'manual')) return false;
            if (this.filtroStatusConvite === 'recusado' && c.convite_status !== 'recusado') return false;
            if (this.filtroStatusConvite === 'alertas' && !(c.faixa_divergente || c.aluno_inativo_ou_excluido)) return false;

            if (this.buscaConvites) {
                const hay = `${c.aluno_nome || ''} ${c.aluno_email || ''} ${c.graduacao_pretendida_nome || ''}`.toLowerCase();
                if (!hay.includes(this.buscaConvites)) return false;
            }
            return true;
        });

        if (convites.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 32px; color: var(--text-muted);">
                        <p style="margin: 0 0 6px 0; font-size: 14px; font-weight: 600;">Nenhum convite encontrado para este filtro.</p>
                        <span style="font-size: 12px;">Ajuste os filtros acima ou envie convocações na Etapa 1.</span>
                    </td>
                </tr>
            `;
            return;
        }

        const metodoLabels = {
            dinheiro: 'Dinheiro',
            pix_direto: 'Pix Direto',
            cartao_maquininha: 'Maquininha',
            outro: 'Manual'
        };

        tbody.innerHTML = convites.map(c => {
            const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(c.aluno_nome || 'Atleta')}&background=0284c7&color=fff`;
            const fotoUrl = UI.sanitizeUrl(c.aluno_foto, fallbackAvatar);
            const valorFmt = parseFloat(c.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
            const dataConvFmt = this.formatarData(c.data_convite);

            const isPagoManual = (c.pagamento_origem || c.origem_pagamento) === 'manual';

            let statusBadge = '<span class="status-badge exame-status-convidado">Sem resposta</span>';
            if (c.convite_status === 'pago') {
                const methodSuffix = isPagoManual && c.metodo_pagamento_manual && metodoLabels[c.metodo_pagamento_manual]
                    ? ` • ${metodoLabels[c.metodo_pagamento_manual]}`
                    : '';
                const pagoLabel = isPagoManual ? `✓ Pago (Manual${methodSuffix})` : '✓ Pago (Online)';
                statusBadge = `<span class="status-badge exame-status-pago">${UI.escapeHtml(pagoLabel)}</span>`;
            } else if (c.convite_status === 'aceito') {
                statusBadge = '<span class="status-badge exame-status-aceito">Aceito (Aguardando Pgto)</span>';
            } else if (c.convite_status === 'recusado') {
                const motivoSafe = c.motivo_recusa ? UI.escapeHtml(c.motivo_recusa) : '';
                statusBadge = `
                    <div class="exame-status-cell">
                        <span class="status-badge exame-status-recusado" title="${motivoSafe || 'Desistência informada pelo atleta'}">
                            Recusado pelo Aluno
                        </span>
                        ${motivoSafe ? `<span class="exame-recusa-motivo" title="Motivo: ${motivoSafe}">Motivo: ${motivoSafe}</span>` : ''}
                    </div>
                `;
            }

            // BUG FIX: recusado deve ocultar Fatura Digital mesmo que asaas_invoice_url tenha sido gerada antes da desistência
            let asaasAction = '<span style="color: var(--text-muted); font-size: 11.5px;">Aguardando aceite</span>';
            if (c.convite_status === 'recusado') {
                asaasAction = '<span style="color: #fca5a5; font-size: 11.5px;">Cancelado (Recusado)</span>';
            } else if (c.convite_status === 'pago' && isPagoManual) {
                asaasAction = '<span style="color: var(--text-muted); font-size: 11.5px;">Quitado manualmente</span>';
            } else if (c.asaas_invoice_url) {
                asaasAction = `
                    <div style="display: flex; gap: 6px; align-items: center;">
                        <a href="${UI.sanitizeUrl(c.asaas_invoice_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 8px;" title="Abrir Fatura Digital">
                            🔗 Fatura Digital
                        </a>
                    </div>
                `;
            } else if (c.convite_status === 'pago') {
                asaasAction = '<span style="color: var(--text-muted); font-size: 11.5px;">Pago via Gateway</span>';
            } else if (c.convite_status === 'aceito') {
                asaasAction = '<span style="color: var(--text-muted); font-size: 11.5px;">Aguardando fatura</span>';
            }

            // Alertas de anomalia (faixa divergente / aluno excluído ou inativo)
            let anomalyBadges = '';
            if (c.aluno_excluido) {
                anomalyBadges += `<span class="exame-anomaly-tag danger">⚠️ Cadastro na Lixeira</span> `;
            } else if (c.aluno_inativo) {
                anomalyBadges += `<span class="exame-anomaly-tag">⚠️ Aluno Inativo (${UI.escapeHtml(c.aluno_status)})</span> `;
            }
            if (c.faixa_divergente) {
                anomalyBadges += `<span class="exame-anomaly-tag" title="${UI.escapeHtml(c.faixa_divergente_motivo || '')}">⚠️ ${UI.escapeHtml(c.faixa_divergente_motivo || 'Faixa divergente')}</span>`;
            }

            // Ações contextuais
            const cid = Number(c.convite_id);
            const canReenviar = c.convite_status !== 'pago' && !c.aluno_excluido;
            const actions = [];

            if (c.faixa_divergente && c.grad_real_proxima_id && !c.promovido_em) {
                actions.push(`<button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; color: #38bdf8; border-color: rgba(56,189,248,0.4);" onclick="ExamesModule.sincronizarFaixaConvite(${cid})">Sincronizar Faixa</button>`);
            }

            if (c.convite_status === 'recusado') {
                actions.push(`<button type="button" class="btn btn-secondary btn-sm" style="color: #f59e0b; border-color: rgba(245, 158, 11, 0.4); font-size: 11px;" onclick="ExamesModule.reativarConvite(${cid})">Reativar</button>`);
                actions.push(`<button type="button" class="btn btn-secondary btn-sm" style="color: #fca5a5; border-color: rgba(239, 68, 68, 0.35); font-size: 11px;" onclick="ExamesModule.cancelarConvite(${cid})">Remover</button>`);
            } else if (c.convite_status === 'pago') {
                if (isPagoManual && !c.promovido_em) {
                    actions.push(`<button type="button" class="btn btn-secondary btn-sm" style="color: #fbbf24; border-color: rgba(245,158,11,0.35); font-size: 11px;" onclick="ExamesModule.estornarBaixaManual(${cid})" title="Estornar pagamento manual">Estornar</button>`);
                } else if (c.promovido_em) {
                    actions.push(`<span class="status-badge" style="background: rgba(168,85,247,0.16); color: #c084fc; font-size: 10.5px;">✓ Promovido</span>`);
                } else {
                    actions.push(`<span class="exame-action-done" title="Quitado via Gateway Asaas">—</span>`);
                }
            } else {
                actions.push(`<button type="button" class="btn btn-sm btn-exame-baixa" onclick="ExamesModule.abrirModalBaixaManual(${cid})">Baixa Manual</button>`);
                if (canReenviar) {
                    actions.push(`<button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px;" onclick="ExamesModule.reenviarConvite(${cid})" title="Reenviar WhatsApp / E-mail">Reenviar</button>`);
                }
                actions.push(`<button type="button" class="btn btn-secondary btn-sm" style="color: #fca5a5; border-color: rgba(239, 68, 68, 0.35); font-size: 11px;" onclick="ExamesModule.cancelarConvite(${cid})" title="Cancelar convite">Cancelar</button>`);
            }

            return `
                <tr>
                    <td>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <img src="${fotoUrl}" alt="${UI.escapeHtml(c.aluno_nome)}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover;">
                            <div>
                                <div style="font-weight: 700; color: var(--text-primary); font-size: 13px;">${UI.escapeHtml(c.aluno_nome)}</div>
                                <div style="font-size: 11px; color: var(--text-muted);">${UI.escapeHtml(c.aluno_email || '')}</div>
                                ${anomalyBadges ? `<div>${anomalyBadges}</div>` : ''}
                            </div>
                        </div>
                    </td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            ${UI.renderBeltBadge(c.graduacao_atual_nome, c.atual_cor_primaria, c.atual_cor_secundaria)}
                            <span style="color: var(--text-muted); font-size: 12px;">➜</span>
                            ${UI.renderBeltBadge(c.graduacao_pretendida_nome, c.pretendida_cor_primaria, c.pretendida_cor_secundaria)}
                        </div>
                    </td>
                    <td>
                        <span style="font-weight: 700; color: var(--text-primary);">R$ ${valorFmt}</span>
                    </td>
                    <td style="font-size: 12px; color: var(--text-muted);">${dataConvFmt}</td>
                    <td>${statusBadge}</td>
                    <td>${asaasAction}</td>
                    <td>
                        <div class="exame-actions-group">
                            ${actions.join('')}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    filtrarConvitesAlertas() {
        this.filtroStatusConvite = 'alertas';
        document.querySelectorAll('#convites-status-pills .exame-status-pill').forEach((p) => {
            p.classList.toggle('active', p.getAttribute('data-status-filter') === 'alertas');
        });
        this.renderListaConvites();
    },

    /**
     * Etapa 3: Renderiza atletas confirmados (pagos) para registro de banca e promoção de faixa
     */
    renderTabelaExecucao() {
        const convites = this.eventoDetalhesAtual?.convites || [];
        const pagos = convites.filter(c => c.convite_status === 'pago');

        const badgeExec = document.getElementById('badge-execucao-count');
        if (badgeExec) {
            badgeExec.textContent = `${pagos.length} ${pagos.length === 1 ? 'confirmado' : 'confirmados'}`;
        }

        const tbody = document.getElementById('tabela-execucao-corpo');
        if (!tbody) return;

        if (pagos.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; padding: 32px; color: var(--text-muted);">
                        Nenhum atleta com pagamento confirmado neste evento ainda.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = pagos.map(c => {
            const cid = Number(c.convite_id);
            const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(c.aluno_nome || 'Atleta')}&background=0284c7&color=fff`;
            const fotoUrl = UI.sanitizeUrl(c.aluno_foto, fallbackAvatar);
            const jaPromovido = Boolean(c.promovido_em);
            const savedResult = (c.resultado_exame && c.resultado_exame !== 'pendente')
                ? c.resultado_exame
                : (this.resultadosExecucao[cid] || 'aprovado');
            if (!jaPromovido) {
                this.resultadosExecucao[cid] = savedResult;
            }

            const statusPromocaoHtml = jaPromovido
                ? `<span class="status-badge exame-status-pago">✓ Promovido em ${this.formatarData(c.promovido_em)}</span>`
                : (c.aluno_excluido
                    ? '<span class="exame-anomaly-tag danger">Aluno excluído (não promovível)</span>'
                    : '<span style="font-size: 12px; color: var(--text-muted);">Aguardando confirmação da banca</span>');

            return `
                <tr>
                    <td>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <img src="${fotoUrl}" alt="${UI.escapeHtml(c.aluno_nome)}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover;">
                            <div>
                                <div style="font-weight: 700; color: var(--text-primary); font-size: 13px;">${UI.escapeHtml(c.aluno_nome)}</div>
                                <div style="font-size: 11px; color: var(--text-muted);">${UI.escapeHtml(c.modalidade_nome || '')}</div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            ${UI.renderBeltBadge(c.graduacao_atual_nome, c.atual_cor_primaria, c.atual_cor_secundaria)}
                            <span style="color: var(--text-muted); font-size: 12px;">➜</span>
                            ${UI.renderBeltBadge(c.graduacao_pretendida_nome, c.pretendida_cor_primaria, c.pretendida_cor_secundaria)}
                        </div>
                    </td>
                    <td>
                        <select class="form-select select-resultado-exame" data-convite-id="${cid}"
                                style="max-width: 190px; padding: 6px 10px; font-size: 12.5px;"
                                ${jaPromovido ? 'disabled' : ''}
                                onchange="ExamesModule.setResultadoExecucao(${cid}, this.value)">
                            <option value="aprovado" ${savedResult === 'aprovado' ? 'selected' : ''}>✅ Aprovado</option>
                            <option value="reprovado" ${savedResult === 'reprovado' ? 'selected' : ''}>❌ Reprovado</option>
                            <option value="ausente" ${savedResult === 'ausente' ? 'selected' : ''}>⚪ Ausente</option>
                        </select>
                    </td>
                    <td>${statusPromocaoHtml}</td>
                </tr>
            `;
        }).join('');
    },

    setResultadoExecucao(conviteId, valor) {
        this.resultadosExecucao[Number(conviteId)] = valor;
    },

    marcarTodosPendentesAprovados() {
        const convites = (this.eventoDetalhesAtual?.convites || []).filter(c => c.convite_status === 'pago' && !c.promovido_em);
        convites.forEach(c => {
            this.resultadosExecucao[Number(c.convite_id)] = 'aprovado';
        });
        document.querySelectorAll('#tabela-execucao-corpo .select-resultado-exame:not([disabled])').forEach(sel => {
            sel.value = 'aprovado';
        });
        UI.showToast('Todos os atletas pendentes marcados como Aprovado.', 'info');
    },

    async submeterPromocoes() {
        if (!this.eventoSelecionadoId) return;

        const convites = (this.eventoDetalhesAtual?.convites || []).filter(c => c.convite_status === 'pago' && !c.promovido_em);
        if (convites.length === 0) {
            UI.showToast('Não há inscrições confirmadas pendentes de promoção.', 'warning');
            return;
        }

        const resultados = convites.map(c => ({
            convite_id: Number(c.convite_id),
            resultado: this.resultadosExecucao[Number(c.convite_id)] || 'aprovado'
        }));
        const aprovadosCount = resultados.filter(r => r.resultado === 'aprovado').length;
        const concluirEvento = Boolean(document.getElementById('check-concluir-evento-exame')?.checked);

        if (!confirm(`Confirmar resultados para ${resultados.length} atleta(s)? (${aprovadosCount} serão promovidos para a próxima faixa).`)) {
            return;
        }

        try {
            const res = await API.post(`/exames/eventos/${this.eventoSelecionadoId}/concluir-promocoes`, {
                resultados,
                concluir_evento: concluirEvento
            });
            UI.showToast(res.message || 'Promoções concluídas com sucesso!', 'success');
            await this.loadAll();
        } catch (err) {
            UI.showToast('Erro ao processar promoções: ' + err.message, 'error');
        }
    },

    abrirModalBaixaManual(conviteId) {
        const conv = (this.eventoDetalhesAtual?.convites || []).find(c => Number(c.convite_id) === Number(conviteId));
        if (!conv) return;

        const idInput = document.getElementById('baixa-manual-convite-id');
        const infoEl = document.getElementById('baixa-manual-aluno-info');
        const metodoEl = document.getElementById('baixa-manual-metodo');
        if (idInput) idInput.value = String(conv.convite_id);
        if (metodoEl) metodoEl.value = 'dinheiro';
        if (infoEl) {
            const valorFmt = parseFloat(conv.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
            infoEl.textContent = `${conv.aluno_nome} • Taxa R$ ${valorFmt}`;
        }

        UI.openModal('modal-baixa-manual-exame');
    },

    async submeterBaixaManual() {
        const conviteId = document.getElementById('baixa-manual-convite-id')?.value;
        const metodoManual = document.getElementById('baixa-manual-metodo')?.value || 'dinheiro';
        if (!conviteId) return;

        try {
            const res = await API.post(`/exames/convites/${conviteId}/confirmar-manual`, {
                metodo_manual: metodoManual
            });
            UI.closeModal('modal-baixa-manual-exame');
            UI.showToast(res.message || 'Pagamento confirmado!', 'success');
            await Promise.all([
                this.carregarDetalhesEvento(this.eventoSelecionadoId),
                this.loadEventos()
            ]);
        } catch (err) {
            UI.showToast('Erro ao confirmar pagamento: ' + err.message, 'error');
        }
    },

    async estornarBaixaManual(conviteId) {
        if (!confirm('Deseja estornar esta baixa manual e retornar a inscrição para pendente?')) {
            return;
        }
        try {
            const res = await API.post(`/exames/convites/${conviteId}/estornar-manual`, {});
            UI.showToast(res.message || 'Baixa manual estornada!', 'success');
            await Promise.all([
                this.carregarDetalhesEvento(this.eventoSelecionadoId),
                this.loadEventos()
            ]);
        } catch (err) {
            UI.showToast('Erro ao estornar pagamento: ' + err.message, 'error');
        }
    },

    async sincronizarFaixaConvite(conviteId) {
        try {
            const res = await API.post(`/exames/convites/${conviteId}/atualizar-faixa`, {});
            UI.showToast(res.message || 'Faixa do convite sincronizada!', 'success');
            await this.carregarDetalhesEvento(this.eventoSelecionadoId);
        } catch (err) {
            UI.showToast('Erro ao sincronizar faixa: ' + err.message, 'error');
        }
    },

    async reenviarConvite(conviteId) {
        try {
            const res = await API.post(`/exames/convites/${conviteId}/reenviar`, {});
            UI.showToast(res.message || 'Notificação reenviada!', 'success');
        } catch (err) {
            UI.showToast('Erro ao reenviar notificação: ' + err.message, 'error');
        }
    },

    async cancelarConvite(conviteId) {
        if (!confirm('Deseja cancelar e remover este convite do evento? Se houver cobrança Asaas em aberto, ela também será cancelada.')) {
            return;
        }
        try {
            const res = await API.delete(`/exames/convites/${conviteId}`);
            UI.showToast(res.message || 'Convite cancelado!', 'success');
            await Promise.all([
                this.carregarDetalhesEvento(this.eventoSelecionadoId),
                this.carregarAlunosAptos(),
                this.loadEventos()
            ]);
        } catch (err) {
            UI.showToast('Erro ao cancelar convite: ' + err.message, 'error');
        }
    },

    async reativarConvite(conviteId) {
        if (!confirm('O aluno mudou de ideia? Deseja reativar esta inscrição para que ele possa participar do exame?')) {
            return;
        }

        try {
            const res = await API.post(`/exames/convites/${conviteId}/reativar`, {});
            UI.showToast(res.message || 'Inscrição reativada com sucesso!', 'success');
            await Promise.all([
                this.carregarDetalhesEvento(this.eventoSelecionadoId),
                this.loadEventos()
            ]);
        } catch (err) {
            UI.showToast('Erro ao reativar inscrição: ' + err.message, 'error');
        }
    },

    async confirmarPagamentoManual(conviteId) {
        this.abrirModalBaixaManual(conviteId);
    },

    switchTab(tab) {
        this.activeTab = tab;
        const tabs = [
            { key: 'aptos', btn: 'tab-btn-aptos', panel: 'painel-tab-aptos' },
            { key: 'convites', btn: 'tab-btn-convites', panel: 'painel-tab-convites' },
            { key: 'execucao', btn: 'tab-btn-execucao', panel: 'painel-tab-execucao' }
        ];
        tabs.forEach(t => {
            const isTarget = t.key === tab;
            document.getElementById(t.btn)?.classList.toggle('active', isTarget);
            const panelEl = document.getElementById(t.panel);
            if (panelEl) panelEl.style.display = isTarget ? 'block' : 'none';
        });
    },

    abrirModalNovoEvento() {
        const form = document.getElementById('form-evento-exame');
        if (form) form.reset();

        document.getElementById('evento-modal-id').value = '';
        document.getElementById('modal-evento-titulo-header').textContent = 'Iniciar Novo Evento de Exame de Graduação';
        
        const d = new Date();
        d.setDate(d.getDate() + 21);
        const dataStr = d.toISOString().split('T')[0];
        document.getElementById('evento-data').value = dataStr;
        document.getElementById('evento-taxa').value = '150.00';
        document.getElementById('evento-horario').value = '09:00';
        document.getElementById('evento-local').value = 'Dojo Central - Pro Combate';

        this.carregarModalidadesSelect('evento-modalidade');
        UI.openModal('modal-evento-exame');
    },

    async abrirModalEditarEvento(eventoId) {
        const evento = this.eventos.find(e => e.id === eventoId);
        if (!evento) return;

        document.getElementById('evento-modal-id').value = evento.id;
        document.getElementById('modal-evento-titulo-header').textContent = 'Editar Evento de Exame';
        document.getElementById('evento-titulo').value = evento.titulo || '';
        document.getElementById('evento-data').value = evento.data_evento ? evento.data_evento.split('T')[0] : '';
        document.getElementById('evento-horario').value = evento.horario_inicio ? evento.horario_inicio.substring(0, 5) : '09:00';
        document.getElementById('evento-data-limite').value = evento.data_limite_inscricao ? evento.data_limite_inscricao.split('T')[0] : '';
        document.getElementById('evento-local').value = evento.local_evento || 'Dojo Central - Pro Combate';
        document.getElementById('evento-taxa').value = parseFloat(evento.taxa_inscricao || 150).toFixed(2);
        document.getElementById('evento-status').value = evento.status || 'aberto';
        document.getElementById('evento-descricao').value = evento.descricao || '';

        await this.carregarModalidadesSelect('evento-modalidade', evento.modalidade_id);
        UI.openModal('modal-evento-exame');
    },

    async carregarModalidadesSelect(elementId, selectedId = null) {
        const select = document.getElementById(elementId);
        if (!select) return;

        try {
            const res = await API.get('/modalidades');
            const modalidades = res.data || [];
            select.innerHTML = '<option value="">Geral (Todas as Modalidades)</option>' +
                modalidades.map(m => `<option value="${m.id}" ${m.id === selectedId ? 'selected' : ''}>${UI.escapeHtml(m.nome)}</option>`).join('');
        } catch (err) {
            console.error('Erro ao carregar modalidades para select:', err);
        }
    },

    async salvarEvento() {
        const id = document.getElementById('evento-modal-id').value;
        const titulo = document.getElementById('evento-titulo').value;
        const modalidadeId = document.getElementById('evento-modalidade').value;
        const dataEvento = document.getElementById('evento-data').value;
        const horarioInicio = document.getElementById('evento-horario').value;
        const dataLimite = document.getElementById('evento-data-limite').value;
        const local = document.getElementById('evento-local').value;
        const taxa = document.getElementById('evento-taxa').value;
        const status = document.getElementById('evento-status').value;
        const descricao = document.getElementById('evento-descricao').value;

        if (!titulo || !dataEvento || !taxa) {
            UI.showToast('Preencha os campos obrigatórios (Título, Data e Taxa).', 'warning');
            return;
        }

        const payload = {
            titulo,
            modalidade_id: modalidadeId ? parseInt(modalidadeId, 10) : null,
            data_evento: dataEvento,
            horario_inicio: horarioInicio,
            data_limite_inscricao: dataLimite || null,
            local_evento: local,
            taxa_inscricao: parseFloat(taxa),
            status,
            descricao
        };

        try {
            if (id) {
                await API.put(`/exames/eventos/${id}`, payload);
                UI.showToast('Evento de exame atualizado com sucesso!', 'success');
            } else {
                const res = await API.post('/exames/eventos', payload);
                UI.showToast('Novo evento de exame iniciado com sucesso!', 'success');
                if (res.evento_id) this.eventoSelecionadoId = res.evento_id;
            }

            UI.closeModal('modal-evento-exame');
            await this.loadAll();
        } catch (err) {
            console.error('Erro ao salvar evento:', err);
            UI.showToast('Erro ao salvar evento: ' + err.message, 'error');
        }
    },

    renderEmptyState() {
        const painelDetalhes = document.getElementById('painel-evento-detalhes');
        if (painelDetalhes) painelDetalhes.style.display = 'none';
    },

    formatarData(dateStr) {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
        } catch {
            return String(dateStr);
        }
    }
};

window.ExamesModule = ExamesModule;
