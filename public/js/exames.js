/**
 * PRO COMBATE - Módulo de Gestão de Exames de Graduação & Integração Asaas
 * Criação de eventos de graduação, configuração de datas e valores,
 * identificação automática de alunos aptos e emissão de convites.
 */

const ExamesModule = {
    eventos: [],
    eventoSelecionadoId: null,
    alunosAptos: [],
    alunosSelecionadosIds: new Set(),
    activeTab: 'aptos', // 'aptos' ou 'convites'

    async init() {
        console.log('🥋 [ExamesModule] Inicializando módulo de exames de graduação...');
        this.bindEvents();
    },

    bindEvents() {
        // Botão Novo Evento
        document.getElementById('btn-novo-evento-exame')?.addEventListener('click', () => {
            this.abrirModalNovoEvento();
        });

        // Formulário de Criação/Edição de Evento
        document.getElementById('form-evento-exame')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.salvarEvento();
        });

        // Alternância de Abas no Painel do Evento (Alunos Aptos vs Convites)
        document.getElementById('tab-btn-aptos')?.addEventListener('click', () => {
            this.switchTab('aptos');
        });
        document.getElementById('tab-btn-convites')?.addEventListener('click', () => {
            this.switchTab('convites');
        });

        // Filtro de Modalidade na lista de Aptos
        document.getElementById('filtro-aptos-modalidade')?.addEventListener('change', () => {
            this.carregarAlunosAptos();
        });

        // Checkbox Selecionar Todos os Aptos
        document.getElementById('check-todos-aptos')?.addEventListener('change', (e) => {
            this.toggleSelecionarTodos(e.target.checked);
        });

        // Botão Enviar Convites em Lote
        document.getElementById('btn-enviar-convites-lote')?.addEventListener('click', () => {
            this.enviarConvitesSelecionados();
        });

        // Botão Atualizar Listas
        document.getElementById('btn-recarregar-exames')?.addEventListener('click', () => {
            this.loadAll();
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
            this.renderKPIs();
            this.renderEventosSelect();
            this.renderEventosCards();

            // Se tiver eventos e nenhum selecionado, seleciona o primeiro ativo
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

    renderKPIs() {
        const abertos = this.eventos.filter(e => e.status === 'aberto').length;
        const totalConvidados = this.eventos.reduce((acc, e) => acc + (parseInt(e.total_convidados, 10) || 0), 0);
        const totalConfirmados = this.eventos.reduce((acc, e) => acc + (parseInt(e.total_pagos !== undefined ? e.total_pagos : e.total_confirmados, 10) || 0), 0);
        const totalArrecadado = this.eventos.reduce((acc, e) => acc + (parseFloat(e.total_arrecadado) || 0), 0);

        const elAbertos = document.getElementById('kpi-exames-abertos');
        const elConvidados = document.getElementById('kpi-exames-convidados');
        const elConfirmados = document.getElementById('kpi-exames-confirmados');
        const elArrecadado = document.getElementById('kpi-exames-arrecadado');

        if (elAbertos) elAbertos.textContent = abertos;
        if (elConvidados) elConvidados.textContent = totalConvidados;
        if (elConfirmados) elConfirmados.textContent = totalConfirmados;
        if (elArrecadado) elArrecadado.textContent = `R$ ${totalArrecadado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

        const badgeNav = document.getElementById('total-exames-count');
        if (badgeNav) {
            badgeNav.textContent = abertos;
            badgeNav.style.display = abertos > 0 ? 'inline-block' : 'none';
        }
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
        this.renderEventosCards();
        this.renderEventosSelect();
        const eventoAtual = this.eventos.find(e => e.id === eventoId);
        await this.syncModalidadeFilterVisibility(eventoAtual);
        await this.carregarDetalhesEvento(eventoId);
        await this.carregarAlunosAptos();
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
            const res = await API.get(`/exames/eventos/${eventoId}`);
            const evento = res.data;

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

            this.renderListaConvites(evento.convites || []);

            const painelDetalhes = document.getElementById('painel-evento-detalhes');
            if (painelDetalhes) painelDetalhes.style.display = 'block';

        } catch (err) {
            console.error('Erro ao carregar detalhes do evento:', err);
        }
    },

    /**
     * Carrega os alunos que estão aptos com base nas avaliações e fundamentos
     */
    async carregarAlunosAptos() {
        const tbody = document.getElementById('tabela-alunos-aptos-corpo');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 24px; color: var(--text-muted);">Analisando avaliações e elegibilidade técnica...</td></tr>';

        try {
            let url = `/exames/alunos-aptos?evento_id=${this.eventoSelecionadoId || ''}`;
            const eventoAtual = this.eventos.find(e => e.id === this.eventoSelecionadoId);
            const modFiltro = (eventoAtual && eventoAtual.modalidade_id)
                ? String(eventoAtual.modalidade_id)
                : (document.getElementById('filtro-aptos-modalidade')?.value || '');
            if (modFiltro) url += `&modalidade_id=${encodeURIComponent(modFiltro)}`;

            const res = await API.get(url);
            this.alunosAptos = res.data || [];
            this.alunosSelecionadosIds.clear();
            const chkAll = document.getElementById('check-todos-aptos');
            if (chkAll) chkAll.checked = false;

            const badgeCount = document.getElementById('badge-aptos-count');
            if (badgeCount) badgeCount.textContent = `${this.alunosAptos.length} aptos`;

            if (this.alunosAptos.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align: center; padding: 32px; color: var(--text-muted);">
                            <p style="margin: 0 0 6px 0; font-size: 14px; font-weight: 600;">Nenhum aluno apto pendente encontrado.</p>
                            <span style="font-size: 12px;">Todos os alunos elegíveis já foram convidados ou ainda não atingiram o percentual mínimo de aptidão nas avaliações.</span>
                        </td>
                    </tr>
                `;
                this.atualizarBotaoEnvioLote();
                return;
            }

            tbody.innerHTML = this.alunosAptos.map(al => {
                const fotoUrl = UI.sanitizeUrl(al.foto_perfil_url) || `https://ui-avatars.com/api/?name=${encodeURIComponent(al.nome_completo)}&background=0284c7&color=fff`;
                const isJaConvidado = Boolean(al.ja_convidado);
                const isSelected = this.alunosSelecionadosIds.has(al.aluno_id);
                const conviteStatusRaw = String(al.convite_status || 'convidado').toLowerCase();
                const conviteStatusSafe = UI.escapeHtml(conviteStatusRaw);
                const conviteBadgeClass = conviteStatusRaw === 'pago'
                    ? 'exame-status-pago'
                    : (conviteStatusRaw === 'aceito'
                        ? 'exame-status-aceito'
                        : (conviteStatusRaw === 'recusado' ? 'exame-status-recusado' : 'exame-status-convidado'));

                return `
                    <tr style="${isJaConvidado ? 'opacity: 0.85; background: rgba(255,255,255,0.01);' : ''}">
                        <td style="width: 40px; text-align: center;">
                            <input type="checkbox" class="check-aluno-apto" data-aluno-id="${al.aluno_id}" 
                                   ${isJaConvidado ? 'disabled title="Já convidado para este exame"' : ''}
                                   ${isSelected ? 'checked' : ''}
                                   onchange="ExamesModule.toggleSelecionarAluno(${al.aluno_id}, this.checked)">
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
                            <div style="display: flex; align-items: center; gap: 8px;">
                                ${UI.renderBeltBadge(al.graduacao_atual_nome, al.atual_cor_primaria, null)}
                                <span style="color: var(--text-muted); font-size: 13px;">➜</span>
                                ${UI.renderBeltBadge(al.graduacao_pretendida_nome, al.pretendida_cor_primaria, null)}
                            </div>
                        </td>
                        <td>
                            <div style="display: flex; flex-direction: column; gap: 4px; min-width: 110px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
                                    <strong style="color: #10b981;">${al.percentual_avaliacao}%</strong>
                                    <span style="font-size: 10.5px; color: var(--text-muted);">Aptidão</span>
                                </div>
                                <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden;">
                                    <div style="width: ${Math.min(100, Math.max(0, al.percentual_avaliacao))}%; height: 100%; background: #10b981; border-radius: 999px;"></div>
                                </div>
                            </div>
                        </td>
                        <td>
                            ${isJaConvidado 
                                ? `<span class="status-badge ${conviteBadgeClass}" style="font-size: 11px;">✓ Convidado (${conviteStatusSafe})</span>` 
                                : `<button type="button" class="btn btn-secondary btn-sm" onclick="ExamesModule.convidarAlunoIndividual(${al.aluno_id})">Convidar</button>`}
                        </td>
                    </tr>
                `;
            }).join('');

            this.atualizarBotaoEnvioLote();

        } catch (err) {
            console.error('Erro ao listar alunos aptos:', err);
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger-color); padding: 16px;">Erro ao carregar aptos: ${UI.escapeHtml(err.message)}</td></tr>`;
        }
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
            this.alunosAptos.forEach(al => {
                if (!al.ja_convidado) {
                    this.alunosSelecionadosIds.add(al.aluno_id);
                }
            });
        }
        document.querySelectorAll('.check-aluno-apto:not([disabled])').forEach(chk => {
            chk.checked = isChecked;
        });
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

            // Recarrega o evento selecionado e altera para a aba de convites
            await this.carregarDetalhesEvento(this.eventoSelecionadoId);
            await this.carregarAlunosAptos();
            await this.loadEventos();
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
     * Renderiza a lista de convites do evento (Status, Fatura Asaas, Ações)
     */
    renderListaConvites(convites) {
        const tbody = document.getElementById('tabela-convites-corpo');
        const badgeCount = document.getElementById('badge-convites-count');
        if (!tbody) return;

        if (badgeCount) badgeCount.textContent = `${convites.length} convidados`;

        if (convites.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 32px; color: var(--text-muted);">
                        <p style="margin: 0 0 6px 0; font-size: 14px; font-weight: 600;">Nenhum convite emitido para este exame ainda.</p>
                        <span style="font-size: 12px;">Selecione os atletas aptos na aba ao lado e clique em "Enviar Convite" para iniciar a convocação oficial.</span>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = convites.map(c => {
            const fotoUrl = UI.sanitizeUrl(c.aluno_foto) || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.aluno_nome)}&background=0284c7&color=fff`;
            const valorFmt = parseFloat(c.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
            const dataConvFmt = this.formatarData(c.data_convite);

            let statusBadge = '<span class="status-badge exame-status-convidado">Convidado</span>';
            if (c.convite_status === 'pago') {
                const isPagoManual = c.asaas_billing_type === 'MANUAL' || (!c.asaas_payment_id && !c.asaas_invoice_url);
                const pagoLabel = isPagoManual ? '✓ Pago (Manual)' : '✓ Pago (Online)';
                statusBadge = `<span class="status-badge exame-status-pago">${pagoLabel}</span>`;
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

            // Ações e Cobrança Online
            let asaasAction = '<span style="color: var(--text-muted); font-size: 11.5px;">Aguardando aceite</span>';
            if (c.asaas_invoice_url) {
                asaasAction = `
                    <div style="display: flex; gap: 6px; align-items: center;">
                        <a href="${UI.sanitizeUrl(c.asaas_invoice_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 8px;" title="Abrir Fatura Digital">
                            🔗 Fatura Digital
                        </a>
                    </div>
                `;
            } else if (c.convite_status === 'pago') {
                asaasAction = '<span style="color: var(--text-muted); font-size: 11.5px;">Quitado manualmente</span>';
            } else if (c.convite_status === 'recusado') {
                asaasAction = '<span style="color: var(--text-muted); font-size: 11.5px;">—</span>';
            } else if (c.convite_status === 'aceito') {
                asaasAction = '<span style="color: var(--text-muted); font-size: 11.5px;">Aguardando fatura</span>';
            }

            let actionBtn = '';
            if (c.convite_status === 'recusado') {
                actionBtn = `
                    <button type="button" class="btn btn-secondary btn-sm" style="color: #f59e0b; border-color: rgba(245, 158, 11, 0.4); display: inline-flex; align-items: center; gap: 4px;" 
                            onclick="ExamesModule.reativarConvite(${c.convite_id})" title="Reativar convocação caso o aluno tenha mudado de ideia">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                        <span>Reativar Inscrição</span>
                    </button>
                `;
            } else if (c.convite_status !== 'pago') {
                actionBtn = `
                    <button type="button" class="btn btn-sm btn-exame-baixa" 
                            onclick="ExamesModule.confirmarPagamentoManual(${c.convite_id})" title="Confirmar pagamento em dinheiro/balcão">
                        Baixa Manual
                    </button>
                `;
            } else {
                actionBtn = `<span class="exame-action-done" title="Pagamento já confirmado" aria-label="Inscrição quitada">—</span>`;
            }

            return `
                <tr>
                    <td>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <img src="${fotoUrl}" alt="${UI.escapeHtml(c.aluno_nome)}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover;">
                            <div>
                                <div style="font-weight: 700; color: var(--text-primary); font-size: 13px;">${UI.escapeHtml(c.aluno_nome)}</div>
                                <div style="font-size: 11px; color: var(--text-muted);">${UI.escapeHtml(c.aluno_email || '')}</div>
                            </div>
                        </div>
                    </td>
                    <td>
                        ${UI.renderBeltBadge(c.graduacao_pretendida_nome, c.pretendida_cor_primaria, null)}
                    </td>
                    <td>
                        <span style="font-weight: 700; color: var(--text-primary);">R$ ${valorFmt}</span>
                    </td>
                    <td style="font-size: 12px; color: var(--text-muted);">${dataConvFmt}</td>
                    <td>${statusBadge}</td>
                    <td>${asaasAction}</td>
                    <td>
                        ${actionBtn}
                    </td>
                </tr>
            `;
        }).join('');
    },

    async reativarConvite(conviteId) {
        if (!confirm('O aluno mudou de ideia? Deseja reativar esta inscrição para que ele possa participar do exame?')) {
            return;
        }

        try {
            const res = await API.post(`/exames/convites/${conviteId}/reativar`, {});
            UI.showToast(res.message || 'Inscrição reativada com sucesso!', 'success');
            await this.carregarDetalhesEvento(this.eventoSelecionadoId);
            await this.loadEventos();
        } catch (err) {
            UI.showToast('Erro ao reativar inscrição: ' + err.message, 'error');
        }
    },

    async confirmarPagamentoManual(conviteId) {
        if (!confirm('Deseja confirmar manualmente o pagamento deste exame (ex: recebido em espécie ou balcão)?')) {
            return;
        }

        try {
            const res = await API.post(`/exames/convites/${conviteId}/confirmar-manual`, {});
            UI.showToast(res.message || 'Pagamento confirmado!', 'success');
            await this.carregarDetalhesEvento(this.eventoSelecionadoId);
            await this.loadEventos();
        } catch (err) {
            UI.showToast('Erro ao confirmar pagamento: ' + err.message, 'error');
        }
    },

    switchTab(tab) {
        this.activeTab = tab;
        const btnAptos = document.getElementById('tab-btn-aptos');
        const btnConvites = document.getElementById('tab-btn-convites');
        const painelAptos = document.getElementById('painel-tab-aptos');
        const painelConvites = document.getElementById('painel-tab-convites');

        if (tab === 'aptos') {
            btnAptos?.classList.add('active');
            btnConvites?.classList.remove('active');
            if (painelAptos) painelAptos.style.display = 'block';
            if (painelConvites) painelConvites.style.display = 'none';
        } else {
            btnAptos?.classList.remove('active');
            btnConvites?.classList.add('active');
            if (painelAptos) painelAptos.style.display = 'none';
            if (painelConvites) painelConvites.style.display = 'block';
        }
    },

    abrirModalNovoEvento() {
        const form = document.getElementById('form-evento-exame');
        if (form) form.reset();

        document.getElementById('evento-modal-id').value = '';
        document.getElementById('modal-evento-titulo-header').textContent = 'Iniciar Novo Evento de Exame de Graduação';
        
        // Define data padrão para daqui a 3 semanas
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

