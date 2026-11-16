/**
 * PRO COMBATE - Script da Página Dedicada da Wiki do Aluno
 * Exibição explícita do currículo da faixa atual e graduações anteriores
 */

const WikiAlunoApp = {
    alunoData: null,
    authToken: null,
    faixasProgresso: [],
    faixaAtual: null,
    faixasAnteriores: [],
    filtroFaixa: 'atual', // 'atual' | 'todas' | nivel_id
    filtroCategoria: 'todos',
    termoBusca: '',
    currentTecnicaVisualizacao: null,
    currentPassoIndex: 0,

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

    init() {
        this.authToken = localStorage.getItem('auth_token');
        this.bindEvents();
        this.loadCurriculoData();
    },

    bindEvents() {
        // Preserva query param no link de voltar
        const urlParams = new URLSearchParams(window.location.search);
        const alunoIdParam = urlParams.get('aluno_id');
        const linkVoltar = document.getElementById('link-voltar-painel');
        if (linkVoltar && alunoIdParam) {
            linkVoltar.href = `/painel?aluno_id=${encodeURIComponent(alunoIdParam)}`;
        }

        // Logout
        document.getElementById('btn-logout')?.addEventListener('click', () => {
            if (confirm('Deseja realmente sair da sua conta?')) {
                localStorage.removeItem('auth_token');
                localStorage.removeItem('user');
                window.location.href = '/login';
            }
        });

        // Fechamento de modais
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                const modalId = btn.dataset.close;
                const modal = document.getElementById(modalId);
                if (modal) modal.style.display = 'none';
            });
        });

        document.querySelectorAll('.modal-backdrop').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.style.display = 'none';
            });
        });

        // Filtros por Categoria
        document.querySelectorAll('#wiki-category-pills .curriculum-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#wiki-category-pills .curriculum-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.filtroCategoria = btn.dataset.category || 'todos';
                this.renderGrid();
            });
        });

        // Campo de Busca
        const searchInput = document.getElementById('wiki-search-input');
        if (searchInput) {
            let debounceTimer;
            searchInput.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    this.termoBusca = searchInput.value.trim().toLowerCase();
                    this.renderGrid();
                }, 250);
            });
        }

        // Controles de Navegação do Passo a Passo
        document.getElementById('btn-tecnica-anterior')?.addEventListener('click', () => this.passoAnterior());
        document.getElementById('btn-tecnica-proximo')?.addEventListener('click', () => this.passoProximo());

        // Navegação por teclado
        window.addEventListener('keydown', (e) => {
            const modal = document.getElementById('modal-visualizar-tecnica');
            if (modal && modal.style.display !== 'none') {
                if (e.key === 'ArrowLeft') this.passoAnterior();
                else if (e.key === 'ArrowRight') this.passoProximo();
                else if (e.key === 'Escape') modal.style.display = 'none';
            }
        });
    },

    async loadCurriculoData() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const queryAlunoId = urlParams.get('aluno_id');

            let endpoint = '/api/aluno/curriculo';
            if (queryAlunoId) {
                endpoint += `?aluno_id=${encodeURIComponent(queryAlunoId)}`;
            }

            const headers = {};
            if (this.authToken && this.authToken !== 'null' && this.authToken !== 'undefined') {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const res = await fetch(endpoint, { headers });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Erro ao carregar currículo de técnicas.');
            }

            this.alunoData = data.aluno;
            this.faixaAtual = data.faixa_atual;
            this.faixasAnteriores = data.faixas_anteriores || [];
            this.faixasProgresso = data.faixas_progresso || [];

            this.renderHeader();
            this.renderBeltTabs();
            this.renderGrid();

        } catch (err) {
            console.error('Falha ao carregar wiki do aluno:', err);
        }
    },

    renderHeader() {
        if (!this.alunoData) return;

        const nameEl = document.getElementById('header-student-name');
        const avatarEl = document.getElementById('header-avatar-img');
        const descEl = document.getElementById('wiki-page-desc');

        const fallbackName = this.alunoData.primeiro_nome || this.alunoData.nome_completo || 'Atleta';
        const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName)}&background=dc2626&color=fff`;
        const safeAvatar = this.sanitizeUrl(this.alunoData.foto_perfil_url);

        if (nameEl) nameEl.textContent = this.alunoData.primeiro_nome || this.alunoData.nome_completo;
        if (avatarEl) {
            avatarEl.onerror = () => {
                avatarEl.onerror = null;
                avatarEl.src = fallbackAvatar;
            };
            avatarEl.src = safeAvatar || fallbackAvatar;
        }

        if (descEl && this.faixaAtual) {
            descEl.innerHTML = `Currículo oficial de <strong>${this.escapeHtml(this.faixaAtual.nivel_nome)}</strong> (${this.escapeHtml(this.faixaAtual.modalidade_nome || 'Artes Marciais')}) e histórico de graduações anteriores.`;
        }
    },

    renderBeltTabs() {
        const container = document.getElementById('belts-selector-tabs');
        if (!container) return;

        if (this.faixasProgresso.length === 0) {
            container.innerHTML = '';
            return;
        }

        let totalTécnicasGeral = 0;
        this.faixasProgresso.forEach(f => { totalTécnicasGeral += (f.total_golpes || 0); });

        const badgeTotal = document.getElementById('wiki-total-techniques-badge');
        if (badgeTotal) {
            badgeTotal.textContent = `${totalTécnicasGeral} ${totalTécnicasGeral === 1 ? 'técnica cadastrada' : 'técnicas cadastradas'}`;
        }

        let tabsHtml = '';

        // Aba: Faixa Atual (Destacada)
        if (this.faixaAtual) {
            const isSel = this.filtroFaixa === 'atual' || String(this.filtroFaixa) === String(this.faixaAtual.nivel_id);
            tabsHtml += `
                <button type="button" class="belt-tab-btn belt-tab-current ${isSel ? 'active' : ''}" onclick="WikiAlunoApp.selecionarFaixa('atual')">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <span>Faixa Atual: ${this.escapeHtml(this.faixaAtual.nivel_nome)}</span>
                    <span class="belt-badge-pill belt-badge-current">${this.faixaAtual.total_golpes || 0} técnicas</span>
                </button>
            `;
        }

        // Abas: Faixas Anteriores (Concluídas)
        this.faixasAnteriores.forEach(f => {
            const isSel = String(this.filtroFaixa) === String(f.nivel_id);
            tabsHtml += `
                <button type="button" class="belt-tab-btn ${isSel ? 'active' : ''}" onclick="WikiAlunoApp.selecionarFaixa(${f.nivel_id})">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    <span>${this.escapeHtml(f.nivel_nome)}</span>
                    <span class="belt-badge-pill belt-badge-past">${f.total_golpes || 0}</span>
                </button>
            `;
        });

        // Aba: Todas as Graduações
        if (this.faixasProgresso.length > 1) {
            const isSel = this.filtroFaixa === 'todas';
            tabsHtml += `
                <button type="button" class="belt-tab-btn ${isSel ? 'active' : ''}" onclick="WikiAlunoApp.selecionarFaixa('todas')">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
                    <span>Todas as Graduações</span>
                    <span class="belt-badge-pill belt-badge-past">${totalTécnicasGeral} total</span>
                </button>
            `;
        }

        container.innerHTML = tabsHtml;
    },

    selecionarFaixa(filtro) {
        this.filtroFaixa = filtro;
        this.renderBeltTabs();
        this.renderGrid();
    },

    obterGolpesFiltrados() {
        let golpes = [];

        if (this.filtroFaixa === 'atual') {
            golpes = this.faixaAtual ? (this.faixaAtual.golpes || []) : [];
        } else if (this.filtroFaixa === 'todas') {
            this.faixasProgresso.forEach(f => {
                if (f.golpes && f.golpes.length > 0) {
                    golpes.push(...f.golpes);
                }
            });
        } else {
            // Nível específico (ID)
            const nivelId = parseInt(this.filtroFaixa, 10);
            const faixa = this.faixasProgresso.find(f => f.nivel_id === nivelId);
            golpes = faixa ? (faixa.golpes || []) : [];
        }

        // Filtro por Categoria
        if (this.filtroCategoria && this.filtroCategoria !== 'todos') {
            golpes = golpes.filter(g => (g.categoria || '').toLowerCase() === this.filtroCategoria.toLowerCase());
        }

        // Filtro por Busca de Texto
        if (this.termoBusca) {
            golpes = golpes.filter(g => {
                const matchNome = (g.nome || '').toLowerCase().includes(this.termoBusca);
                const matchDesc = (g.descricao_geral || '').toLowerCase().includes(this.termoBusca);
                const matchCat = (g.categoria || '').toLowerCase().includes(this.termoBusca);
                return matchNome || matchDesc || matchCat;
            });
        }

        return golpes;
    },

    renderGrid() {
        const grid = document.getElementById('wiki-cards-grid');
        if (!grid) return;

        const golpes = this.obterGolpesFiltrados();

        if (!golpes || golpes.length === 0) {
            grid.innerHTML = `
                <div class="curriculum-empty-box">
                    <div class="curriculum-empty-icon">
                        <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                            <path d="M12 8v4"/>
                            <path d="M12 16h.01"/>
                        </svg>
                    </div>
                    <h3 class="curriculum-empty-title">Nenhum movimento técnico encontrado</h3>
                    <p class="curriculum-empty-desc">
                        Não encontramos técnicas para o filtro selecionado. Experimente alternar para "Faixa Atual" ou "Todas as Graduações".
                    </p>
                </div>
            `;
            return;
        }

        grid.innerHTML = golpes.map(g => {
            const nomeEsc = this.escapeHtml(g.nome);
            const catEsc = this.escapeHtml(g.categoria || 'Técnica');
            const descEsc = this.escapeHtml(g.descricao_geral || 'Siga a instrução técnica biomecânica para dominar o movimento.');
            const diffClass = `curriculum-tag-diff-${(g.nivel_dificuldade || 'iniciante').toLowerCase()}`;
            const diffLabel = (g.nivel_dificuldade || 'iniciante').charAt(0).toUpperCase() + (g.nivel_dificuldade || 'iniciante').slice(1);
            const totalPassos = parseInt(g.total_passos, 10) || 0;
            const capaUrl = this.sanitizeUrl(g.imagem_capa || g.imagem_capa_exibicao);

            // Badge explícito de Faixa Atual vs Faixa Anterior
            const isAtual = Boolean(g.is_faixa_atual);
            const beltBadgeHtml = isAtual
                ? `<span class="card-belt-badge card-belt-badge-current" title="Técnica da sua faixa atual">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    Faixa Atual: ${this.escapeHtml(g.nivel_nome || 'Atual')}
                   </span>`
                : `<span class="card-belt-badge card-belt-badge-past" title="Técnica de faixa anterior concluída">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    ${this.escapeHtml(g.nivel_nome || 'Anterior')}
                   </span>`;

            const mediaHtml = capaUrl
                ? `<img src="${capaUrl}" alt="${nomeEsc}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'curriculum-media-placeholder\\'><svg width=\\'28\\' height=\\'28\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.8\\'><path d=\\'M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z\\'/></svg><span>Técnica da Faixa</span></div>'">`
                : `<div class="curriculum-media-placeholder">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        <span>Técnica da Faixa</span>
                   </div>`;

            return `
                <div class="curriculum-strike-card">
                    <div class="curriculum-card-media">
                        ${beltBadgeHtml}
                        ${mediaHtml}
                        <div class="curriculum-badge-steps">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                            ${totalPassos} ${totalPassos === 1 ? 'passo' : 'passos'}
                        </div>
                    </div>
                    <div class="curriculum-card-body">
                        <div class="curriculum-card-meta">
                            <span class="curriculum-tag">${catEsc}</span>
                            <span class="curriculum-tag ${diffClass}">${diffLabel}</span>
                        </div>
                        <h3 class="curriculum-card-title">${nomeEsc}</h3>
                        <p class="curriculum-card-desc">${descEsc}</p>
                        <button type="button" class="curriculum-card-btn" onclick="WikiAlunoApp.abrirPassoAPassoTecnica(${g.id})">
                            <span>Ver Passo a Passo</span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

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
                     onclick="WikiAlunoApp.irParaPasso(${idx})"></div>
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
    }
};

document.addEventListener('DOMContentLoaded', () => {
    WikiAlunoApp.init();
});

