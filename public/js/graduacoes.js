// Módulo de Gestão de Modalidades e Catálogo de Graduações (CRUD Completo)
const GraduacoesModule = {
    modalidades: [],
    currentRequisitos: [],
    currentNivelGolpes: [],
    allWikiGolpes: [],

    async init() {
        this.bindEvents();
        if (!API.getToken()) return;
        await this.loadCatalogo();
    },

    bindEvents() {
        // Botão Nova Modalidade
        const btnNovaMod = document.getElementById('btn-nova-modalidade');
        if (btnNovaMod) {
            btnNovaMod.addEventListener('click', () => this.openModalidadeForm());
        }

        // Submissão do formulário de modalidade
        const formMod = document.getElementById('form-modalidade');
        if (formMod) {
            formMod.addEventListener('submit', (e) => this.handleSubmitModalidade(e));
        }

        // Submissão do formulário de nível / faixa
        const formNivel = document.getElementById('form-nivel');
        if (formNivel) {
            formNivel.addEventListener('submit', (e) => this.handleSubmitNivel(e));
        }

        // Adicionar golpe da Wiki à faixa
        const btnAddGolpe = document.getElementById('btn-add-nivel-golpe');
        const selectGolpe = document.getElementById('select-nivel-adicionar-golpe');
        if (btnAddGolpe && selectGolpe) {
            btnAddGolpe.addEventListener('click', () => {
                const golpeId = parseInt(selectGolpe.value, 10);
                if (!golpeId) {
                    UI.showToast('Selecione um golpe da Wiki para vincular.', 'warning');
                    return;
                }
                const golpeObj = this.allWikiGolpes.find(g => g.id === golpeId);
                if (!golpeObj) return;

                if (this.currentNivelGolpes.some(g => (g.id || g.golpe_id) === golpeId)) {
                    UI.showToast('Este golpe já está vinculado a esta faixa.', 'warning');
                    return;
                }

                this.currentNivelGolpes.push(golpeObj);
                this.renderNivelGolpesChips();
                selectGolpe.value = '';
            });
        }

        // Adicionar especificação / requisito na lista da faixa
        const btnAddReq = document.getElementById('btn-add-requisito');
        const inputNovoReq = document.getElementById('input-novo-requisito');
        if (btnAddReq && inputNovoReq) {
            const addReqHandler = () => {
                const val = inputNovoReq.value.trim();
                if (val) {
                    if (!this.currentRequisitos.includes(val)) {
                        this.currentRequisitos.push(val);
                        this.renderRequisitosBadges();
                    }
                    inputNovoReq.value = '';
                    inputNovoReq.focus();
                }
            };
            btnAddReq.addEventListener('click', addReqHandler);
            inputNovoReq.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addReqHandler();
                }
            });
        }

        // Preview dinâmico da faixa ao alterar cores no formulário
        const corPrim = document.getElementById('nivel-cor-primaria');
        const corSec = document.getElementById('nivel-cor-secundaria');
        if (corPrim && corSec) {
            const updatePreview = () => {
                const previewEl = document.getElementById('faixa-live-preview');
                const pColor = corPrim.value;
                const sColor = corSec.value;
                if (previewEl) {
                    previewEl.style.background = pColor;
                    const tip = previewEl.querySelector('.belt-pill-tip');
                    if (tip) tip.style.background = sColor;
                }
            };
            corPrim.addEventListener('input', updatePreview);
            corSec.addEventListener('input', updatePreview);
        }

        // Preview dinâmico do ícone de Prajied no formulário
        const prajiedSelect = document.getElementById('nivel-prajied-icone');
        if (prajiedSelect) {
            const updatePrajiedPreview = () => {
                const img = document.getElementById('prajied-select-preview-img');
                const empty = document.getElementById('prajied-select-preview-empty');
                if (!img || !empty) return;
                if (prajiedSelect.value) {
                    img.src = prajiedSelect.value;
                    img.style.display = 'block';
                    empty.style.display = 'none';
                } else {
                    img.style.display = 'none';
                    empty.style.display = 'inline';
                }
            };
            prajiedSelect.addEventListener('change', updatePrajiedPreview);
        }
    },

    async loadCatalogo() {
        const container = document.getElementById('graduacoes-catalog-grid');
        if (!container) return;

        container.innerHTML = `<div style="text-align: center; padding: 40px;"><div class="spinner"></div> Carregando modalidades e catálogo...</div>`;

        try {
            const res = await API.get('/modalidades');
            this.modalidades = res.data || [];

            if (this.modalidades.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 50px; color: var(--text-muted);">
                        Nenhuma modalidade cadastrada ainda. Clique em "+ Nova Modalidade" para iniciar.
                    </div>
                `;
                return;
            }

            const canManage = !window.AuthModule || AuthModule.can('promote_faixas');

            container.innerHTML = this.modalidades.map(m => {
                const safeModId = Number(m.id);
                const encodedModNome = encodeURIComponent(m.nome || '').replace(/'/g, '%27');
                return `
                <div class="stat-card" style="padding: 24px; margin-bottom: 24px;">
                    <!-- Cabeçalho da Modalidade -->
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 14px; flex-wrap: wrap; gap: 12px;">
                        <div>
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <h3 style="font-family: var(--font-heading); font-size: 20px; color: #ffffff;">${UI.escapeHtml(m.nome)}</h3>
                                <span class="badge-status ativo">${UI.escapeHtml(m.sistema_graduacao || 'Sistema de Faixas')}</span>
                            </div>
                            <p style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">
                                ${UI.escapeHtml(m.descricao || 'Sem descrição cadastrada.')}
                            </p>
                        </div>

                        ${canManage ? `
                            <div style="display: flex; gap: 8px;">
                                <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;" onclick="GraduacoesModule.openNivelForm(${safeModId})">
                                    <svg viewBox="0 0 24 24" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                    <span>+ Adicionar Faixa</span>
                                </button>
                                <button class="btn-icon" title="Editar Modalidade" onclick="GraduacoesModule.openModalidadeForm(${safeModId})">
                                    <svg viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                                </button>
                                <button class="btn-icon" style="color: #ef4444;" title="Excluir/Inativar Modalidade" onclick="GraduacoesModule.deleteModalidade(${safeModId}, '${encodedModNome}')">
                                    <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                </button>
                            </div>
                        ` : ''}
                    </div>

                    <!-- Grade de Níveis / Faixas da Modalidade -->
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px;">
                        ${(m.niveis && m.niveis.length > 0) ? m.niveis.map(n => {
                            const safeNivelId = Number(n.id);
                            const encodedNivelNome = encodeURIComponent(n.nome || '').replace(/'/g, '%27');
                            const pColor = UI.sanitizeColor(n.cor_hex_primaria, '#ffffff');
                            const sColor = UI.sanitizeColor(n.cor_hex_secundaria, '#111827');
                            return `
                            <div class="stat-card" style="padding: 16px; background: var(--bg-input); border-color: var(--border-color); position: relative; overflow: visible;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <div class="belt-pill" style="background: ${pColor}; width: 28px; height: 12px; border: 1px solid rgba(255,255,255,0.3); border-radius: 2px; position: relative;">
                                            <div class="belt-pill-tip" style="background: ${sColor}; width: 8px; height: 100%; margin-left: auto;"></div>
                                        </div>
                                        <span style="font-weight: 700; font-size: 13px; color: #ffffff;">${UI.escapeHtml(n.nome)}</span>
                                    </div>
                                    <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); font-family: var(--font-mono);">
                                        #${Number(n.ordem_hierarquica) || 1}
                                    </span>
                                </div>

                                <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px; display: flex; flex-direction: column; gap: 4px;">
                                    <div><strong>Graus/Khans:</strong> ${Number(n.graus) > 0 ? `Até ${Number(n.graus)} graus` : 'Faixa única'}</div>
                                    <div><strong>Exigência mínima:</strong> ${n.aulas_minimas_exigidas ? `<span>${Number(n.aulas_minimas_exigidas)} treinos</span>` : 'Livre'} • ${n.tempo_minimo_meses ? `<span>${Number(n.tempo_minimo_meses)} meses</span>` : 'Sem carência'}</div>
                                    <div style="color: var(--primary-light);"><strong>Especificações:</strong> ${Number(n.total_itens || 0)} itens • <strong>Mínimo p/ passar:</strong> ${Number(n.porcentagem_minima || 70)}%</div>
                                    ${(n.rpg_rank_minimo || n.rpg_pontuacao_minima_atributo || Number(n.rpg_exige_apto_sparring) === 1) ? `
                                        <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px;">
                                            ${n.rpg_rank_minimo ? `<span style="padding: 1px 7px; font-size: 10.5px; background: rgba(245, 158, 11, 0.14); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 9999px; color: #fcd34d; font-weight: 700;">Rank &ge; ${UI.escapeHtml(n.rpg_rank_minimo)}</span>` : ''}
                                            ${n.rpg_pontuacao_minima_atributo ? `<span style="padding: 1px 7px; font-size: 10.5px; background: rgba(168, 85, 247, 0.14); border: 1px solid rgba(168, 85, 247, 0.35); border-radius: 9999px; color: #d8b4fe; font-weight: 700;">Pilares &ge; ${Number(n.rpg_pontuacao_minima_atributo)}/20</span>` : ''}
                                            ${Number(n.rpg_exige_apto_sparring) === 1 ? `<span style="padding: 1px 7px; font-size: 10.5px; background: rgba(16, 185, 129, 0.14); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 9999px; color: #6ee7b7; font-weight: 700;">Apto Sparring</span>` : ''}
                                        </div>
                                    ` : ''}
                                    <div><strong style="color: #38bdf8;">Golpes da Wiki:</strong> ${(n.golpes && n.golpes.length > 0) ? `<span style="padding: 1px 7px; font-size: 10.5px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 9999px; color: #38bdf8; font-weight: 700;">${n.golpes.length} ${n.golpes.length === 1 ? 'movimento' : 'movimentos'}</span>` : '<span style="color: var(--text-muted); font-size: 11px;">Nenhum vinculado</span>'}</div>
                                </div>

                                ${canManage ? `
                                    <div style="display: flex; justify-content: flex-end; gap: 6px; border-top: 1px solid rgba(148, 163, 184, 0.1); padding-top: 8px;">
                                        <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="GraduacoesModule.openNivelForm(${safeModId}, ${safeNivelId})">
                                            Editar
                                        </button>
                                        <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="GraduacoesModule.deleteNivel(${safeNivelId}, '${encodedNivelNome}')">
                                            Excluir
                                        </button>
                                    </div>
                                ` : ''}
                            </div>
                        `;
                        }).join('') : `
                            <div style="grid-column: 1 / -1; padding: 20px; text-align: center; color: var(--text-muted); background: var(--bg-input); border-radius: var(--radius-md);">
                                Nenhuma faixa cadastrada nesta modalidade. Clique em "+ Adicionar Faixa" para catalogar a evolução.
                            </div>
                        `}
                    </div>
                </div>
            `;
            }).join('');
        } catch (err) {
            console.error('Erro ao carregar catálogo de graduações:', err);
            container.innerHTML = `<div style="color: #ef4444; padding: 30px; text-align: center;">Erro ao carregar catálogo: ${UI.escapeHtml(err.message)}</div>`;
        }
    },

    // Modal de Modalidade (Criar / Editar)
    openModalidadeForm(id = null) {
        const form = document.getElementById('form-modalidade');
        if (form) form.reset();
        document.getElementById('modalidade-id').value = '';

        const titleEl = document.getElementById('modal-modalidade-title');

        if (id) {
            const m = this.modalidades.find(item => item.id == id);
            if (m) {
                document.getElementById('modalidade-id').value = m.id;
                document.getElementById('modalidade-nome').value = m.nome;
                document.getElementById('modalidade-descricao').value = m.descricao || '';
                document.getElementById('modalidade-sistema').value = m.sistema_graduacao || 'Faixas e Graus';
                if (titleEl) titleEl.textContent = `Editar Modalidade: ${m.nome}`;
            }
        } else {
            if (titleEl) titleEl.textContent = 'Nova Modalidade de Luta';
        }

        UI.openModal('modal-modalidade');
    },

    async handleSubmitModalidade(e) {
        e.preventDefault();
        const id = document.getElementById('modalidade-id').value;
        const nome = document.getElementById('modalidade-nome').value;
        const descricao = document.getElementById('modalidade-descricao').value;
        const sistema_graduacao = document.getElementById('modalidade-sistema').value;

        try {
            if (id) {
                await API.put(`/modalidades/${id}`, { nome, descricao, sistema_graduacao });
                UI.showToast('Modalidade atualizada com sucesso!', 'success');
            } else {
                await API.post('/modalidades', { nome, descricao, sistema_graduacao });
                UI.showToast('Modalidade criada com sucesso!', 'success');
            }
            UI.closeModal('modal-modalidade');
            await this.loadCatalogo();
            if (window.AlunosModule) AlunosModule.loadModalidades();
        } catch (err) {
            UI.showToast(err.message, 'error');
        }
    },

    async deleteModalidade(id, nomeEncoded) {
        const nome = decodeURIComponent(nomeEncoded);
        if (!confirm(`Deseja realmente excluir ou inativar a modalidade "${nome}"?`)) return;

        try {
            const res = await API.delete(`/modalidades/${id}`);
            UI.showToast(res.message, 'success');
            await this.loadCatalogo();
            if (window.AlunosModule) AlunosModule.loadModalidades();
        } catch (err) {
            UI.showToast(err.message, 'error');
        }
    },

    renderRequisitosBadges() {
        const container = document.getElementById('nivel-requisitos-badges');
        const countEl = document.getElementById('nivel-requisitos-count');
        if (!container) return;

        if (countEl) {
            countEl.textContent = `${this.currentRequisitos.length} requisito${this.currentRequisitos.length === 1 ? '' : 's'}`;
        }

        if (this.currentRequisitos.length === 0) {
            container.innerHTML = `<span style="font-size: 12px; color: var(--text-muted); font-style: italic;">Nenhuma especificação cadastrada ainda. Adicione acima.</span>`;
            return;
        }

        container.innerHTML = this.currentRequisitos.map((req, idx) => `
            <span style="display: inline-flex; align-items: center; gap: 6px; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600;">
                <span>${idx + 1}. ${UI.escapeHtml(req)}</span>
                <button type="button" onclick="GraduacoesModule.removeRequisito(${idx})" style="background: none; border: none; color: #94a3b8; cursor: pointer; padding: 0; line-height: 1; font-size: 14px; font-weight: 700;" title="Remover item">&times;</button>
            </span>
        `).join('');
    },

    removeRequisito(idx) {
        if (idx >= 0 && idx < this.currentRequisitos.length) {
            this.currentRequisitos.splice(idx, 1);
            this.renderRequisitosBadges();
        }
    },

    async loadWikiGolpesForNivelSelect(modalidadeId = null) {
        try {
            const res = await API.get('/wiki-golpes');
            this.allWikiGolpes = res.golpes || [];
            const select = document.getElementById('select-nivel-adicionar-golpe');
            if (!select) return;

            // Filtra preferencialmente os golpes da mesma modalidade ou sem modalidade
            const filtrados = this.allWikiGolpes.filter(g => 
                !modalidadeId || !g.modalidade_id || String(g.modalidade_id) === String(modalidadeId)
            );

            select.innerHTML = '<option value="">Selecione um golpe da Wiki para vincular...</option>' +
                filtrados.map(g => {
                    const cat = g.categoria ? `[${g.categoria}] ` : '';
                    return `<option value="${g.id}">${cat}${UI.escapeHtml(g.nome)}</option>`;
                }).join('');
        } catch (err) {
            console.warn('Erro ao carregar golpes para o select da faixa:', err);
        }
    },

    renderNivelGolpesChips() {
        const container = document.getElementById('nivel-golpes-chips-container');
        const countEl = document.getElementById('nivel-golpes-count');
        if (!container) return;

        if (countEl) {
            const total = this.currentNivelGolpes.length;
            countEl.textContent = `${total} ${total === 1 ? 'golpe vinculado' : 'golpes vinculados'}`;
        }

        if (this.currentNivelGolpes.length === 0) {
            container.innerHTML = `
                <span style="font-size: 12px; color: var(--text-muted); font-style: italic;">
                    Nenhum golpe da Wiki vinculado a esta graduação ainda.
                </span>
            `;
            return;
        }

        container.innerHTML = this.currentNivelGolpes.map((g, idx) => {
            const nome = UI.escapeHtml(g.nome || g.golpe_nome || 'Golpe');
            const cat = UI.escapeHtml(g.categoria || g.golpe_categoria || 'Técnica');
            return `
                <div class="stat-pill" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 9999px; font-size: 11.5px; color: var(--primary-light);">
                    <span style="font-size: 10px; opacity: 0.8; text-transform: uppercase;">${cat}</span>
                    <strong style="color: #ffffff;">${nome}</strong>
                    <button type="button" onclick="GraduacoesModule.removeNivelGolpe(${idx})" style="background: none; border: none; color: #ef4444; font-weight: bold; cursor: pointer; padding: 0 2px; font-size: 12px;" title="Remover golpe">✕</button>
                </div>
            `;
        }).join('');
    },

    removeNivelGolpe(index) {
        if (index >= 0 && index < this.currentNivelGolpes.length) {
            this.currentNivelGolpes.splice(index, 1);
            this.renderNivelGolpesChips();
        }
    },

    // Modal de Nível / Faixa (Criar / Editar)
    async openNivelForm(modalidadeId, nivelId = null) {
        const form = document.getElementById('form-nivel');
        if (form) form.reset();

        document.getElementById('nivel-modalidade-id').value = modalidadeId;
        document.getElementById('nivel-id').value = '';
        this.currentRequisitos = [];
        this.currentNivelGolpes = [];

        await this.loadWikiGolpesForNivelSelect(modalidadeId);

        const m = this.modalidades.find(item => item.id == modalidadeId);
        document.getElementById('nivel-modalidade-nome').textContent = m ? m.nome : '';

        const titleEl = document.getElementById('modal-nivel-title');

        if (nivelId && m && m.niveis) {
            const n = m.niveis.find(item => item.id == nivelId);
            if (n) {
                document.getElementById('nivel-id').value = n.id;
                document.getElementById('nivel-nome').value = n.nome;
                document.getElementById('nivel-cor-primaria').value = n.cor_hex_primaria || '#FFFFFF';
                document.getElementById('nivel-cor-secundaria').value = n.cor_hex_secundaria || '#1E293B';
                document.getElementById('nivel-graus').value = n.graus || 0;
                document.getElementById('nivel-ordem').value = n.ordem_hierarquica;
                document.getElementById('nivel-aulas').value = n.aulas_minimas_exigidas || '';
                document.getElementById('nivel-meses').value = n.tempo_minimo_meses || '';
                
                const prajiedEl = document.getElementById('nivel-prajied-icone');
                if (prajiedEl) {
                    prajiedEl.value = n.prajied_icone_url || '';
                    prajiedEl.dispatchEvent(new Event('change'));
                }

                const pctEl = document.getElementById('nivel-porcentagem-minima');
                if (pctEl) pctEl.value = n.porcentagem_minima ? Number(n.porcentagem_minima) : 70;

                const rankMinEl = document.getElementById('nivel-rpg-rank-minimo');
                if (rankMinEl) rankMinEl.value = n.rpg_rank_minimo || '';
                const minAttrEl = document.getElementById('nivel-rpg-min-atributo');
                if (minAttrEl) minAttrEl.value = n.rpg_pontuacao_minima_atributo || '';
                const sparEl = document.getElementById('nivel-rpg-exige-sparring');
                if (sparEl) sparEl.checked = Boolean(Number(n.rpg_exige_apto_sparring));

                try {
                    if (n.requisitos_lista_json) {
                        const parsed = typeof n.requisitos_lista_json === 'string'
                            ? JSON.parse(n.requisitos_lista_json)
                            : n.requisitos_lista_json;
                        if (Array.isArray(parsed)) this.currentRequisitos = [...parsed];
                    }
                } catch {
                    this.currentRequisitos = [];
                }

                // Carrega golpes vinculados da faixa
                if (Array.isArray(n.golpes)) {
                    this.currentNivelGolpes = [...n.golpes];
                } else if (Array.isArray(n.golpes_ids)) {
                    this.currentNivelGolpes = this.allWikiGolpes.filter(g => n.golpes_ids.includes(g.id));
                }

                if (titleEl) titleEl.textContent = `Editar Faixa: ${n.nome}`;
            }
        } else {
            // Sugere a próxima ordem hierárquica
            const maxOrdem = m && m.niveis && m.niveis.length > 0 
                ? Math.max(...m.niveis.map(item => item.ordem_hierarquica || 0)) + 1 
                : 1;
            document.getElementById('nivel-ordem').value = maxOrdem;
            const prajiedEl = document.getElementById('nivel-prajied-icone');
            if (prajiedEl) {
                prajiedEl.value = '';
                prajiedEl.dispatchEvent(new Event('change'));
            }
            const pctEl = document.getElementById('nivel-porcentagem-minima');
            if (pctEl) pctEl.value = 70;
            const rankMinEl = document.getElementById('nivel-rpg-rank-minimo');
            if (rankMinEl) rankMinEl.value = '';
            const minAttrEl = document.getElementById('nivel-rpg-min-atributo');
            if (minAttrEl) minAttrEl.value = '';
            const sparEl = document.getElementById('nivel-rpg-exige-sparring');
            if (sparEl) sparEl.checked = false;
            this.currentRequisitos = [];
            this.currentNivelGolpes = [];
            if (titleEl) titleEl.textContent = 'Adicionar Nova Faixa / Nível';
        }

        this.renderRequisitosBadges();
        this.renderNivelGolpesChips();

        // Atualiza preview
        const pColor = document.getElementById('nivel-cor-primaria').value;
        const sColor = document.getElementById('nivel-cor-secundaria').value;
        const previewEl = document.getElementById('faixa-live-preview');
        if (previewEl) {
            previewEl.style.background = pColor;
            const tip = previewEl.querySelector('.belt-pill-tip');
            if (tip) tip.style.background = sColor;
        }

        UI.openModal('modal-nivel');
    },

    async handleSubmitNivel(e) {
        e.preventDefault();
        const modalidadeId = document.getElementById('nivel-modalidade-id').value;
        const id = document.getElementById('nivel-id').value;

        const pctVal = parseFloat(document.getElementById('nivel-porcentagem-minima')?.value || '70');
        const rankMinVal = document.getElementById('nivel-rpg-rank-minimo')?.value || null;
        const minAttrStr = document.getElementById('nivel-rpg-min-atributo')?.value?.trim();
        const minAttrVal = minAttrStr ? parseInt(minAttrStr, 10) : null;
        const exigeSparring = Boolean(document.getElementById('nivel-rpg-exige-sparring')?.checked);

        const body = {
            nome: document.getElementById('nivel-nome').value,
            cor_hex_primaria: document.getElementById('nivel-cor-primaria').value,
            cor_hex_secundaria: document.getElementById('nivel-cor-secundaria').value,
            graus: parseInt(document.getElementById('nivel-graus').value || '0', 10),
            ordem_hierarquica: parseInt(document.getElementById('nivel-ordem').value || '1', 10),
            aulas_minimas_exigidas: document.getElementById('nivel-aulas').value ? parseInt(document.getElementById('nivel-aulas').value, 10) : null,
            tempo_minimo_meses: document.getElementById('nivel-meses').value ? parseInt(document.getElementById('nivel-meses').value, 10) : null,
            porcentagem_minima: Number.isNaN(pctVal) ? 70 : pctVal,
            rpg_rank_minimo: rankMinVal || null,
            rpg_pontuacao_minima_atributo: (minAttrVal && !Number.isNaN(minAttrVal)) ? minAttrVal : null,
            rpg_exige_apto_sparring: exigeSparring ? 1 : 0,
            prajied_icone_url: document.getElementById('nivel-prajied-icone')?.value || null,
            requisitos_lista: this.currentRequisitos,
            golpes_ids: this.currentNivelGolpes.map(g => g.id || g.golpe_id).filter(Boolean)
        };

        try {
            if (id) {
                await API.put(`/modalidades/niveis/${id}`, body);
                UI.showToast('Faixa/Graduação atualizada com sucesso!', 'success');
            } else {
                await API.post(`/modalidades/${modalidadeId}/niveis`, body);
                UI.showToast('Faixa/Graduação cadastrada com sucesso!', 'success');
            }
            UI.closeModal('modal-nivel');
            await this.loadCatalogo();
            if (window.AlunosModule) AlunosModule.loadModalidades();
        } catch (err) {
            UI.showToast(err.message, 'error');
        }
    },

    async deleteNivel(nivelId, nomeEncoded) {
        const nome = decodeURIComponent(nomeEncoded);
        if (!confirm(`Deseja realmente excluir a faixa "${nome}"?`)) return;

        try {
            const res = await API.delete(`/modalidades/niveis/${nivelId}`);
            UI.showToast(res.message, 'success');
            await this.loadCatalogo();
            if (window.AlunosModule) AlunosModule.loadModalidades();
        } catch (err) {
            UI.showToast(err.message, 'error');
        }
    }
};

window.GraduacoesModule = GraduacoesModule;
