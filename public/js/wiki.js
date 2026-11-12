/**
 * KAIZEN CT PRO - Módulo da Wiki de Golpes e Movimentos Técnicos
 * Gestão no Painel Administrativo: cadastro, passos com fotos, instruções e visualizador
 */

const WikiModule = {
    golpes: [],
    modalidades: [],
    currentGolpeVisualizacao: null,
    currentPassoIndex: 0,

    init() {
        this.bindEvents();
    },

    bindEvents() {
        // Botão Novo Golpe
        document.getElementById('btn-novo-golpe')?.addEventListener('click', () => {
            this.openModalNovoGolpe();
        });

        // Formulário de Cadastro/Edição
        document.getElementById('form-golpe')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.salvarGolpe();
        });

        // Botão Adicionar Passo
        document.getElementById('btn-adicionar-passo')?.addEventListener('click', () => {
            this.adicionarPassoCard();
        });

        // Botão Ajustar Quantidade Rápida de Passos
        document.getElementById('btn-aplicar-qtd-passos')?.addEventListener('click', () => {
            const inputQtd = document.getElementById('input-qtd-passos-rapido');
            const qtd = parseInt(inputQtd ? inputQtd.value : 3, 10);
            if (isNaN(qtd) || qtd < 1 || qtd > 15) {
                UI.showToast('Defina uma quantidade entre 1 e 15 passos.', 'warning');
                return;
            }
            this.definirQuantidadePassos(qtd);
        });

        // Filtros e Busca
        const searchInput = document.getElementById('wiki-search-input');
        if (searchInput) {
            let debounceTimer;
            searchInput.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => this.filtrarGolpes(), 300);
            });
        }

        document.getElementById('wiki-filter-modalidade')?.addEventListener('change', () => this.filtrarGolpes());
        document.getElementById('wiki-filter-categoria')?.addEventListener('change', () => this.filtrarGolpes());

        document.getElementById('btn-wiki-limpar-filtros')?.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            const filterMod = document.getElementById('wiki-filter-modalidade');
            const filterCat = document.getElementById('wiki-filter-categoria');
            if (filterMod) filterMod.value = '';
            if (filterCat) filterCat.value = '';
            this.filtrarGolpes();
        });

        // Upload da Imagem/GIF de Capa
        const btnUploadCapa = document.getElementById('btn-upload-capa-trigger');
        const previewBoxCapa = document.getElementById('golpe-capa-preview-box');
        const fileInputCapa = document.getElementById('golpe-capa-file');
        const btnRemoverCapa = document.getElementById('btn-remover-capa');

        const triggerCapaUpload = () => fileInputCapa?.click();
        btnUploadCapa?.addEventListener('click', triggerCapaUpload);
        previewBoxCapa?.addEventListener('click', triggerCapaUpload);

        fileInputCapa?.addEventListener('change', async () => {
            if (!fileInputCapa.files || fileInputCapa.files.length === 0) return;
            const file = fileInputCapa.files[0];

            if (file.size > 15 * 1024 * 1024) {
                UI.showToast('A imagem ou GIF de capa excede o limite de 15MB.', 'error');
                return;
            }

            const statusText = document.getElementById('golpe-capa-status-text');
            if (statusText) statusText.textContent = 'Enviando imagem/GIF de capa...';

            try {
                const formData = new FormData();
                formData.append('capa', file);
                formData.append('foto', file);

                const res = await fetch('/api/wiki-golpes/upload-capa', {
                    method: 'POST',
                    headers: API.getHeaders(),
                    body: formData
                });

                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'Erro no envio da capa');
                }

                const hiddenCapa = document.getElementById('golpe-imagem-capa');
                if (hiddenCapa) hiddenCapa.value = data.url;

                if (previewBoxCapa) {
                    previewBoxCapa.innerHTML = `<img src="${UI.sanitizeUrl(data.url)}" alt="Capa" style="width: 100%; height: 100%; object-fit: cover; border-radius: var(--radius-md);">`;
                }

                if (btnRemoverCapa) btnRemoverCapa.style.display = 'inline-flex';
                if (statusText) statusText.textContent = 'Capa atualizada com sucesso!';
                UI.showToast('Foto/GIF de capa carregado!', 'success');
            } catch (err) {
                console.error('Erro no upload de capa do golpe:', err);
                if (statusText) statusText.textContent = 'Falha no envio da capa.';
                UI.showToast(err.message || 'Falha ao enviar a foto de capa.', 'error');
            } finally {
                fileInputCapa.value = '';
            }
        });

        btnRemoverCapa?.addEventListener('click', () => {
            const hiddenCapa = document.getElementById('golpe-imagem-capa');
            if (hiddenCapa) hiddenCapa.value = '';
            if (previewBoxCapa) {
                previewBoxCapa.innerHTML = `
                    <div class="passo-img-uploader-placeholder">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        <span>Imagem / GIF</span>
                    </div>
                `;
            }
            btnRemoverCapa.style.display = 'none';
            const statusText = document.getElementById('golpe-capa-status-text');
            if (statusText) statusText.textContent = 'Capa removida. Salve para confirmar.';
        });

        // Controles do Visualizador Passo a Passo
        document.getElementById('btn-vis-passo-anterior')?.addEventListener('click', () => {
            if (this.currentPassoIndex > 0) {
                this.currentPassoIndex--;
                this.renderPassoVisualizacao();
            }
        });

        document.getElementById('btn-vis-passo-proximo')?.addEventListener('click', () => {
            if (this.currentGolpeVisualizacao && this.currentPassoIndex < (this.currentGolpeVisualizacao.passos.length - 1)) {
                this.currentPassoIndex++;
                this.renderPassoVisualizacao();
            }
        });
    },

    /**
     * Carrega a lista completa de golpes da Wiki e as modalidades para os selects
     */
    async loadGolpes() {
        try {
            await this.loadModalidadesSelect();

            const res = await API.get('/wiki-golpes');
            if (res && res.success) {
                this.golpes = res.golpes || [];
                this.renderGrid(this.golpes);
                this.atualizarContador(this.golpes.length);
            }
        } catch (err) {
            console.error('Erro ao carregar golpes da Wiki:', err);
            UI.showToast('Não foi possível carregar a biblioteca de golpes.', 'error');
        }
    },

    async loadModalidadesSelect() {
        try {
            const res = await API.get('/modalidades');
            if (res && res.success) {
                this.modalidades = res.data || res.modalidades || [];

                const selectModal = document.getElementById('golpe-modalidade');
                const selectFilter = document.getElementById('wiki-filter-modalidade');

                const optionsModal = `<option value="">Sem modalidade específica</option>` +
                    this.modalidades.map(m => `<option value="${m.id}">${UI.escapeHtml(m.nome)}</option>`).join('');

                const optionsFilter = `<option value="">Todas as Modalidades</option>` +
                    this.modalidades.map(m => `<option value="${m.id}">${UI.escapeHtml(m.nome)}</option>`).join('');

                if (selectModal) selectModal.innerHTML = optionsModal;
                if (selectFilter) selectFilter.innerHTML = optionsFilter;
            }
        } catch (err) {
            console.warn('Erro ao carregar modalidades para wiki:', err);
        }
    },

    atualizarContador(total) {
        const badge = document.getElementById('total-golpes-count');
        if (badge) {
            badge.textContent = total;
            badge.style.display = total > 0 ? 'inline-block' : 'none';
        }
    },

    filtrarGolpes() {
        const termo = (document.getElementById('wiki-search-input')?.value || '').toLowerCase().trim();
        const modId = document.getElementById('wiki-filter-modalidade')?.value || '';
        const categoria = document.getElementById('wiki-filter-categoria')?.value || '';

        const filtrados = this.golpes.filter(g => {
            const matchNome = !termo || g.nome.toLowerCase().includes(termo) ||
                (g.descricao_geral && g.descricao_geral.toLowerCase().includes(termo)) ||
                (g.categoria && g.categoria.toLowerCase().includes(termo));
            
            const matchMod = !modId || String(g.modalidade_id) === String(modId);
            const matchCat = !categoria || (g.categoria && g.categoria.toLowerCase() === categoria.toLowerCase());

            return matchNome && matchMod && matchCat;
        });

        this.renderGrid(filtrados);
    },

    renderGrid(lista) {
        const container = document.getElementById('wiki-golpes-grid');
        if (!container) return;

        if (!lista || lista.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 48px 20px; text-align: center; background: var(--bg-surface); border: 1px dashed var(--border-color); border-radius: var(--radius-lg);">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--text-muted); margin-bottom: 12px;">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                    </svg>
                    <h3 style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">Nenhum golpe encontrado</h3>
                    <p style="font-size: 13px; color: var(--text-muted); max-width: 400px; margin: 0 auto 16px auto;">Cadastre novos golpes e movimentos técnicos para formar a biblioteca de conhecimento dos atletas.</p>
                    <button class="btn btn-primary btn-sm" onclick="WikiModule.openModalNovoGolpe()">+ Cadastrar Primeiro Golpe</button>
                </div>
            `;
            return;
        }

        container.innerHTML = lista.map(g => {
            const nomeEsc = UI.escapeHtml(g.nome);
            const modEsc = UI.escapeHtml(g.modalidade_nome || 'Livre');
            const catEsc = UI.escapeHtml(g.categoria || 'Técnica');
            const descEsc = UI.escapeHtml(g.descricao_geral || 'Nenhuma descrição técnica informada.');
            const diffClass = `wiki-tag-diff-${g.nivel_dificuldade || 'iniciante'}`;
            const diffLabel = (g.nivel_dificuldade || 'iniciante').charAt(0).toUpperCase() + (g.nivel_dificuldade || 'iniciante').slice(1);
            const totalPassos = parseInt(g.total_passos, 10) || 0;
            const capaUrl = UI.sanitizeUrl(g.imagem_capa);

            const capaHtml = capaUrl
                ? `<img src="${capaUrl}" alt="${nomeEsc}" onerror="this.parentElement.innerHTML='<div class=\\'wiki-card-cover-placeholder\\'>🥊 Sem Imagem</div>'">`
                : `<div class="wiki-card-cover-placeholder">
                        <svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                        <span>Sem Foto de Capa</span>
                   </div>`;

            return `
                <div class="wiki-card">
                    <div class="wiki-card-cover">
                        ${capaHtml}
                        <div class="wiki-steps-badge">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                            ${totalPassos} ${totalPassos === 1 ? 'passo' : 'passos'}
                        </div>
                    </div>
                    <div class="wiki-card-content">
                        <div class="wiki-card-header">
                            <h3 class="wiki-card-title">${nomeEsc}</h3>
                        </div>
                        <div class="wiki-card-meta">
                            <span class="wiki-tag">${modEsc}</span>
                            <span class="wiki-tag">${catEsc}</span>
                            <span class="wiki-tag ${diffClass}">${diffLabel}</span>
                        </div>
                        <p class="wiki-card-desc">${descEsc}</p>
                        <div class="wiki-card-footer">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="WikiModule.visualizarGolpe(${g.id})" style="display: inline-flex; align-items: center; gap: 5px;">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                <span>Ver Passos</span>
                            </button>
                            <div class="table-actions">
                                <button type="button" class="btn-icon" title="Editar Golpe" onclick="WikiModule.openModalEditarGolpe(${g.id})">
                                    <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </button>
                                <button type="button" class="btn-icon" title="Excluir Golpe" onclick="WikiModule.deleteGolpe(${g.id}, '${nomeEsc}')" style="color: #ef4444;">
                                    <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    openModalNovoGolpe() {
        document.getElementById('modal-golpe-title').textContent = 'Cadastrar Novo Golpe / Movimento';
        document.getElementById('golpe-id').value = '';
        document.getElementById('golpe-nome').value = '';
        document.getElementById('golpe-modalidade').value = '';
        document.getElementById('golpe-categoria').value = 'Movimentação';
        document.getElementById('golpe-nivel').value = 'iniciante';
        document.getElementById('golpe-descricao').value = '';
        document.getElementById('input-qtd-passos-rapido').value = '3';

        // Reseta imagem/GIF de capa
        const hiddenCapa = document.getElementById('golpe-imagem-capa');
        if (hiddenCapa) hiddenCapa.value = '';
        const previewBoxCapa = document.getElementById('golpe-capa-preview-box');
        if (previewBoxCapa) {
            previewBoxCapa.innerHTML = `
                <div class="passo-img-uploader-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    <span>Imagem / GIF</span>
                </div>
            `;
        }
        const btnRemoverCapa = document.getElementById('btn-remover-capa');
        if (btnRemoverCapa) btnRemoverCapa.style.display = 'none';
        const statusText = document.getElementById('golpe-capa-status-text');
        if (statusText) statusText.textContent = 'Formatos suportados: JPG, PNG, WEBP e GIF (máx. 15MB)';

        // Inicializa com 3 passos por padrão
        this.definirQuantidadePassos(3);

        UI.openModal('modal-golpe');
    },

    async openModalEditarGolpe(id) {
        try {
            const res = await API.get(`/wiki-golpes/${id}`);
            if (!res || !res.success || !res.golpe) {
                UI.showToast('Golpe não encontrado.', 'error');
                return;
            }

            const g = res.golpe;
            document.getElementById('modal-golpe-title').textContent = `Editar Golpe: ${g.nome}`;
            document.getElementById('golpe-id').value = g.id;
            document.getElementById('golpe-nome').value = g.nome || '';
            document.getElementById('golpe-modalidade').value = g.modalidade_id || '';
            document.getElementById('golpe-categoria').value = g.categoria || 'Movimentação';
            document.getElementById('golpe-nivel').value = g.nivel_dificuldade || 'iniciante';
            document.getElementById('golpe-descricao').value = g.descricao_geral || '';

            // Capa
            const hiddenCapa = document.getElementById('golpe-imagem-capa');
            const previewBoxCapa = document.getElementById('golpe-capa-preview-box');
            const btnRemoverCapa = document.getElementById('btn-remover-capa');
            const statusText = document.getElementById('golpe-capa-status-text');

            if (hiddenCapa) hiddenCapa.value = g.imagem_capa || '';
            if (g.imagem_capa && previewBoxCapa) {
                previewBoxCapa.innerHTML = `<img src="${UI.sanitizeUrl(g.imagem_capa)}" alt="Capa" style="width: 100%; height: 100%; object-fit: cover; border-radius: var(--radius-md);">`;
                if (btnRemoverCapa) btnRemoverCapa.style.display = 'inline-flex';
                if (statusText) statusText.textContent = 'Capa definida';
            } else {
                if (previewBoxCapa) {
                    previewBoxCapa.innerHTML = `
                        <div class="passo-img-uploader-placeholder">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                            <span>Imagem / GIF</span>
                        </div>
                    `;
                }
                if (btnRemoverCapa) btnRemoverCapa.style.display = 'none';
                if (statusText) statusText.textContent = 'Formatos suportados: JPG, PNG, WEBP e GIF (máx. 15MB)';
            }

            const passos = g.passos || [];
            document.getElementById('input-qtd-passos-rapido').value = passos.length || 1;

            const container = document.getElementById('passos-container');
            container.innerHTML = '';

            if (passos.length === 0) {
                this.adicionarPassoCard();
            } else {
                passos.forEach((p, idx) => {
                    this.adicionarPassoCard({
                        ordem: idx + 1,
                        titulo: p.titulo || '',
                        descricao: p.descricao || '',
                        imagem_url: p.imagem_url || ''
                    });
                });
            }

            UI.openModal('modal-golpe');
        } catch (err) {
            console.error('Erro ao abrir edição de golpe:', err);
            UI.showToast('Erro ao carregar detalhes do golpe para edição.', 'error');
        }
    },

    definirQuantidadePassos(qtd) {
        const container = document.getElementById('passos-container');
        if (!container) return;

        // Preserva valores dos passos já preenchidos
        const passosAtuais = this.coletarPassosDoFormulario();
        container.innerHTML = '';

        for (let i = 0; i < qtd; i++) {
            const existente = passosAtuais[i] || null;
            this.adicionarPassoCard(existente ? {
                ordem: i + 1,
                titulo: existente.titulo || '',
                descricao: existente.descricao || '',
                imagem_url: existente.imagem_url || ''
            } : null);
        }
    },

    adicionarPassoCard(dados = null) {
        const container = document.getElementById('passos-container');
        if (!container) return;

        const passosExistentes = container.querySelectorAll('.passo-builder-card');
        const ordem = dados && dados.ordem ? dados.ordem : (passosExistentes.length + 1);

        const card = document.createElement('div');
        card.className = 'passo-builder-card';
        card.dataset.ordem = ordem;

        const tituloEsc = UI.escapeHtml(dados?.titulo || `Passo ${ordem}`);
        const descEsc = UI.escapeHtml(dados?.descricao || '');
        const imgUrl = UI.sanitizeUrl(dados?.imagem_url || '');

        const previewContent = imgUrl
            ? `<img src="${imgUrl}" alt="Foto Passo ${ordem}">`
            : `<div class="passo-img-uploader-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    <span>Clique para Foto</span>
               </div>`;

        card.innerHTML = `
            <div class="passo-builder-header">
                <span class="passo-builder-number">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                    Passo <span class="passo-index-text">${ordem}</span>
                </span>
                <button type="button" class="btn btn-secondary btn-sm btn-remover-passo" title="Remover este passo" style="color: #ef4444; padding: 2px 8px; font-size: 11px;">
                    ✕ Remover
                </button>
            </div>
            <div class="passo-builder-body">
                <div>
                    <label style="font-size: 11.5px; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 4px;">Foto Ilustrativa</label>
                    <div class="passo-img-uploader" title="Clique para selecionar uma foto deste passo">
                        ${previewContent}
                    </div>
                    <input type="file" class="passo-file-input" accept="image/jpeg,image/png,image/webp" style="display: none;">
                    <input type="hidden" class="passo-img-url-input" value="${imgUrl}">
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <div class="form-group" style="margin: 0;">
                        <label style="font-size: 11.5px; font-weight: 600; color: var(--text-muted);">Título da Etapa</label>
                        <input type="text" class="form-input passo-titulo-input" value="${tituloEsc}" placeholder="Ex: Base e Posicionamento Inicial" style="padding: 6px 10px; font-size: 13px;">
                    </div>
                    <div class="form-group" style="margin: 0; flex: 1;">
                        <label style="font-size: 11.5px; font-weight: 600; color: var(--text-muted);">Descrição da Execução <span class="required">*</span></label>
                        <textarea class="form-textarea passo-desc-input" rows="2" placeholder="Descreva os movimentos de rotação, ângulo, guarda e impacto..." required style="padding: 6px 10px; font-size: 12.5px;">${descEsc}</textarea>
                    </div>
                </div>
            </div>
        `;

        // Evento de Remoção de Passo
        card.querySelector('.btn-remover-passo').addEventListener('click', () => {
            const totalAtual = container.querySelectorAll('.passo-builder-card').length;
            if (totalAtual <= 1) {
                UI.showToast('O golpe deve conter ao menos um passo.', 'warning');
                return;
            }
            card.remove();
            this.reordenarIndicesPassos();
        });

        // Evento de Seleção e Upload da Imagem
        const uploaderBox = card.querySelector('.passo-img-uploader');
        const fileInput = card.querySelector('.passo-file-input');
        const urlInput = card.querySelector('.passo-img-url-input');

        uploaderBox.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', async () => {
            if (!fileInput.files || fileInput.files.length === 0) return;
            const file = fileInput.files[0];

            if (file.size > 5 * 1024 * 1024) {
                UI.showToast('A imagem selecionada excede o limite de 5MB.', 'error');
                return;
            }

            uploaderBox.innerHTML = `<span style="font-size: 11px; color: var(--primary-light);">Enviando foto...</span>`;

            try {
                const formData = new FormData();
                formData.append('foto', file);

                const res = await fetch('/api/wiki-golpes/upload-passo', {
                    method: 'POST',
                    headers: API.getHeaders(),
                    body: formData
                });

                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'Erro no envio da imagem');
                }

                urlInput.value = data.url;
                uploaderBox.innerHTML = `<img src="${UI.sanitizeUrl(data.url)}" alt="Foto do Passo">`;
                UI.showToast('Foto do passo carregada com sucesso!', 'success');
            } catch (err) {
                console.error('Erro no upload de foto do passo:', err);
                uploaderBox.innerHTML = `
                    <div class="passo-img-uploader-placeholder">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        <span>Tentar Novamente</span>
                    </div>
                `;
                UI.showToast(err.message || 'Falha ao enviar a foto do passo.', 'error');
            }
        });

        container.appendChild(card);
        this.reordenarIndicesPassos();
    },

    reordenarIndicesPassos() {
        const container = document.getElementById('passos-container');
        if (!container) return;

        const cards = container.querySelectorAll('.passo-builder-card');
        cards.forEach((card, idx) => {
            const index = idx + 1;
            card.dataset.ordem = index;
            const textEl = card.querySelector('.passo-index-text');
            if (textEl) textEl.textContent = index;
        });

        const inputQtd = document.getElementById('input-qtd-passos-rapido');
        if (inputQtd) inputQtd.value = cards.length;
    },

    coletarPassosDoFormulario() {
        const container = document.getElementById('passos-container');
        if (!container) return [];

        const cards = container.querySelectorAll('.passo-builder-card');
        const passos = [];

        cards.forEach((card, idx) => {
            const titulo = card.querySelector('.passo-titulo-input')?.value.trim() || `Passo ${idx + 1}`;
            const descricao = card.querySelector('.passo-desc-input')?.value.trim() || '';
            const imagem_url = card.querySelector('.passo-img-url-input')?.value.trim() || null;

            passos.push({
                ordem: idx + 1,
                titulo,
                descricao,
                imagem_url
            });
        });

        return passos;
    },

    async salvarGolpe() {
        const golpeId = document.getElementById('golpe-id').value;
        const nome = document.getElementById('golpe-nome').value.trim();
        const modalidade_id = document.getElementById('golpe-modalidade').value || null;
        const categoria = document.getElementById('golpe-categoria').value || 'Movimentação';
        const nivel_dificuldade = document.getElementById('golpe-nivel').value || 'iniciante';
        const descricao_geral = document.getElementById('golpe-descricao').value.trim();
        const imagem_capa = document.getElementById('golpe-imagem-capa')?.value.trim() || null;

        if (!nome) {
            UI.showToast('Informe o nome do golpe ou movimento.', 'warning');
            return;
        }

        const passos = this.coletarPassosDoFormulario();
        if (passos.length === 0) {
            UI.showToast('Cadastre ao menos um passo para a execução do golpe.', 'warning');
            return;
        }

        for (let i = 0; i < passos.length; i++) {
            if (!passos[i].descricao) {
                UI.showToast(`Preencha a descrição da execução do Passo ${i + 1}.`, 'warning');
                return;
            }
        }

        const payload = {
            nome,
            modalidade_id,
            categoria,
            nivel_dificuldade,
            descricao_geral,
            imagem_capa,
            passos
        };

        const btnSubmit = document.getElementById('btn-salvar-golpe');
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.textContent = 'Salvando na Wiki...';
        }

        try {
            let res;
            if (golpeId) {
                res = await API.put(`/wiki-golpes/${golpeId}`, payload);
            } else {
                res = await API.post('/wiki-golpes', payload);
            }

            if (res && res.success) {
                UI.showToast(res.message || 'Golpe salvo com sucesso!', 'success');
                UI.closeModal('modal-golpe');
                await this.loadGolpes();
            }
        } catch (err) {
            console.error('Erro ao salvar golpe:', err);
            UI.showToast(err.message || 'Não foi possível salvar o golpe.', 'error');
        } finally {
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.textContent = 'Salvar Golpe na Wiki';
            }
        }
    },

    async visualizarGolpe(id) {
        try {
            const res = await API.get(`/wiki-golpes/${id}`);
            if (!res || !res.success || !res.golpe) {
                UI.showToast('Detalhes do golpe não encontrados.', 'error');
                return;
            }

            const g = res.golpe;
            this.currentGolpeVisualizacao = g;
            this.currentPassoIndex = 0;

            document.getElementById('vis-golpe-nome').textContent = g.nome;
            document.getElementById('vis-golpe-desc').textContent = g.descricao_geral || 'Siga as instruções técnicas abaixo para a correta biomecânica e execução do movimento.';

            const badgesContainer = document.getElementById('vis-golpe-badges');
            if (badgesContainer) {
                const diffLabel = (g.nivel_dificuldade || 'iniciante').toUpperCase();
                badgesContainer.innerHTML = `
                    <span class="wiki-tag">${UI.escapeHtml(g.modalidade_nome || 'Livre')}</span>
                    <span class="wiki-tag">${UI.escapeHtml(g.categoria || 'Técnica')}</span>
                    <span class="wiki-tag wiki-tag-diff-${g.nivel_dificuldade || 'iniciante'}">${diffLabel}</span>
                `;
            }

            this.renderPassoVisualizacao();
            UI.openModal('modal-visualizar-golpe');
        } catch (err) {
            console.error('Erro ao abrir visualizador do golpe:', err);
            UI.showToast('Erro ao carregar o passo a passo do golpe.', 'error');
        }
    },

    renderPassoVisualizacao() {
        if (!this.currentGolpeVisualizacao) return;

        const passos = this.currentGolpeVisualizacao.passos || [];
        const total = passos.length;

        if (total === 0) {
            document.getElementById('vis-passo-indicator').textContent = 'Passo 0 de 0';
            document.getElementById('vis-passo-titulo').textContent = 'Nenhum passo cadastrado';
            document.getElementById('vis-passo-descricao').textContent = 'Nenhum detalhe técnico cadastrado para este golpe.';
            document.getElementById('vis-passo-img-wrap').style.display = 'none';
            return;
        }

        const passo = passos[this.currentPassoIndex];

        document.getElementById('vis-passo-indicator').textContent = `Passo ${this.currentPassoIndex + 1} de ${total}`;
        document.getElementById('vis-passo-titulo').textContent = passo.titulo || `Etapa ${this.currentPassoIndex + 1}`;
        document.getElementById('vis-passo-descricao').textContent = passo.descricao;

        const imgWrap = document.getElementById('vis-passo-img-wrap');
        const imgEl = document.getElementById('vis-passo-img');

        if (passo.imagem_url) {
            imgWrap.style.display = 'flex';
            imgEl.src = UI.sanitizeUrl(passo.imagem_url);
        } else {
            imgWrap.style.display = 'none';
            imgEl.src = '';
        }

        // Navegação de botões
        const btnAnt = document.getElementById('btn-vis-passo-anterior');
        const btnProx = document.getElementById('btn-vis-passo-proximo');

        if (btnAnt) btnAnt.disabled = this.currentPassoIndex === 0;
        if (btnProx) btnProx.disabled = this.currentPassoIndex === (total - 1);

        // Indicadores (dots)
        const dotsContainer = document.getElementById('vis-dots-container');
        if (dotsContainer) {
            dotsContainer.innerHTML = passos.map((_, idx) => `
                <div class="vis-dot ${idx === this.currentPassoIndex ? 'active' : ''}" onclick="WikiModule.irParaPasso(${idx})"></div>
            `).join('');
        }
    },

    irParaPasso(idx) {
        if (this.currentGolpeVisualizacao && idx >= 0 && idx < this.currentGolpeVisualizacao.passos.length) {
            this.currentPassoIndex = idx;
            this.renderPassoVisualizacao();
        }
    },

    async deleteGolpe(id, nome) {
        if (!confirm(`Deseja realmente remover o golpe "${nome}" da Wiki?`)) {
            return;
        }

        try {
            const res = await API.delete(`/wiki-golpes/${id}`);
            if (res && res.success) {
                UI.showToast(res.message || 'Golpe removido da Wiki com sucesso!', 'success');
                await this.loadGolpes();
            }
        } catch (err) {
            console.error('Erro ao excluir golpe:', err);
            UI.showToast(err.message || 'Não foi possível remover o golpe.', 'error');
        }
    }
};

window.WikiModule = WikiModule;

