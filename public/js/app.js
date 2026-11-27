// Aplicação Principal e Roteador de Seções
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🥋 [Sistema PRO] Inicializando aplicação...');

    // Inicialização dos módulos (Autenticação primeiro para configurar permissões)
    if (window.UI && typeof UI.bindInputMasks === 'function') UI.bindInputMasks();
    if (window.AuthModule) await AuthModule.init();
    if (window.AlunoDetalhesModule) AlunoDetalhesModule.init();
    if (window.AlunosModule) await AlunosModule.init();
    if (window.DashboardModule) await DashboardModule.init();
    if (window.CheckinsModule) await CheckinsModule.init();
    if (window.GraduacoesModule) await GraduacoesModule.init();
    if (window.PlanosModule) await PlanosModule.init();
    if (window.WikiModule) WikiModule.init();
    if (window.MissoesModule) await MissoesModule.init();
    if (window.ExamesModule) await ExamesModule.init();
    if (window.MensagensConfigModule) MensagensConfigModule.init();
    if (window.EquipeModule) EquipeModule.init();

    // Roteamento de Menus / Tabs Principais
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    const sections = document.querySelectorAll('.view-section');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const targetSection = item.getAttribute('data-view');
            if (!targetSection) return;

            // Bloqueio de rota no frontend para perfis sem permissão
            if (targetSection === 'financeiro' && window.AuthModule && !AuthModule.can('manage_financeiro')) {
                UI.showToast('Acesso restrito: seu perfil de Professor não tem permissão para acessar o módulo financeiro.', 'warning');
                return;
            }
            if (targetSection === 'mensagens' && window.AuthModule && !AuthModule.can('manage_mensagens')) {
                UI.showToast('Acesso restrito: apenas administradores podem configurar mensagens do sistema.', 'warning');
                return;
            }
            if (targetSection === 'equipe' && window.AuthModule && !AuthModule.can('manage_equipe')) {
                UI.showToast('Acesso restrito: apenas administradores podem gerenciar professores e equipe.', 'warning');
                return;
            }

            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            sections.forEach(sec => {
                sec.classList.remove('active');
                if (sec.id === `view-${targetSection}`) {
                    sec.classList.add('active');
                }
            });

            // Título dinâmico no Topbar (completo em >= 768px, curto no mobile)
            const titleMap = {
                'dashboard': { title: 'Visão Geral do Centro de Treinamento', shortTitle: 'Visão Geral', desc: 'Métricas, frequência diária e indicadores de performance' },
                'alunos': { title: 'Gestão de Alunos', shortTitle: 'Alunos', desc: 'Dossiê 360°, controle cadastral, responsáveis e graduações' },
                'checkins': { title: 'Controle de Presença & Check-ins', shortTitle: 'Presenças', desc: 'Registro de chamadas, turmas e auditoria de acesso' },
                'graduacoes': { title: 'Catálogo de Graduações & Exames', shortTitle: 'Graduações', desc: 'Faixas, critérios de evolução e quadro de honra' },
                'exames': { title: 'Exames de Graduação', shortTitle: 'Exames', desc: 'Eventos de graduação, convocação de atletas aptos e controle financeiro' },
                'financeiro': { title: 'Planos & Gestão Financeira', shortTitle: 'Financeiro', desc: 'Gestão comercial de planos de treino, mensalidades e faturamento' },
                'wiki': { title: 'Biblioteca de Golpes & Movimentos (Wiki)', shortTitle: 'Wiki', desc: 'Caderno técnico com passo a passo ilustrado, fotos e descrições de execução' },
                'missoes': { title: 'Quadro de Missões & Desafios', shortTitle: 'Missões', desc: 'Crie desafios para os atletas escolherem e valide entregas concluídas no tatame' },
                'equipe': { title: 'Professores & Equipe', shortTitle: 'Professores', desc: 'Cadastro de professores avaliadores, administradores e recepção' },
                'mensagens': { title: 'Configurações de Mensagens & Notificações', shortTitle: 'Mensagens', desc: 'Gerencie serviços automáticos, textos predefinidos, alertas para admin e envio do link do sistema' }
            };

            const info = titleMap[targetSection] || { title: 'Sistema PRO', shortTitle: 'Sistema PRO', desc: '' };
            const pageTitleEl = document.getElementById('page-title-text');
            const pageDescEl = document.getElementById('page-desc-text');
            if (pageTitleEl) {
                let desktopSpan = pageTitleEl.querySelector('.page-title-desktop');
                let mobileSpan = pageTitleEl.querySelector('.page-title-mobile');
                if (!desktopSpan || !mobileSpan) {
                    pageTitleEl.textContent = '';
                    desktopSpan = document.createElement('span');
                    desktopSpan.className = 'page-title-desktop';
                    mobileSpan = document.createElement('span');
                    mobileSpan.className = 'page-title-mobile';
                    pageTitleEl.appendChild(desktopSpan);
                    pageTitleEl.appendChild(mobileSpan);
                }
                desktopSpan.textContent = info.title;
                mobileSpan.textContent = info.shortTitle || info.title;
            }
            if (pageDescEl) pageDescEl.textContent = info.desc;

            // Recarregamentos sob demanda
            if (targetSection === 'dashboard') DashboardModule.loadDashboard();
            if (targetSection === 'alunos') AlunosModule.loadAlunos();
            if (targetSection === 'checkins') CheckinsModule.loadRecentes();
            if (targetSection === 'financeiro' && window.PlanosModule) PlanosModule.loadAll();
            if (targetSection === 'graduacoes' && window.GraduacoesModule) GraduacoesModule.loadCatalogo();
            if (targetSection === 'wiki' && window.WikiModule) WikiModule.loadGolpes();
            if (targetSection === 'missoes' && window.MissoesModule) MissoesModule.loadAll();
            if (targetSection === 'exames' && window.ExamesModule) ExamesModule.loadAll();
            if (targetSection === 'equipe' && window.EquipeModule) EquipeModule.loadAll();
            if (targetSection === 'mensagens' && window.MensagensConfigModule) MensagensConfigModule.loadAll();

            // Em telas mobile, fecha o menu após navegar
            if (window.innerWidth <= 868) {
                closeSidebarMobile();
            }
        });
    });

    // Controle da Sidebar Mobile (Drawer off-canvas)
    const sidebarEl = document.getElementById('app-sidebar');
    const backdropEl = document.getElementById('sidebar-backdrop');
    const btnToggleSidebar = document.getElementById('btn-sidebar-toggle');
    const btnCloseSidebar = document.getElementById('btn-sidebar-close');

    function closeSidebarMobile() {
        if (sidebarEl) sidebarEl.classList.remove('open');
        if (backdropEl) backdropEl.classList.remove('active');
        document.body.style.overflow = '';
    }

    function openSidebarMobile() {
        if (sidebarEl) sidebarEl.classList.add('open');
        if (backdropEl) backdropEl.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    if (btnToggleSidebar) btnToggleSidebar.addEventListener('click', openSidebarMobile);
    if (btnCloseSidebar) btnCloseSidebar.addEventListener('click', closeSidebarMobile);
    if (backdropEl) backdropEl.addEventListener('click', closeSidebarMobile);

    // Submissão do Form de Promoção / Graduação
    const formPromo = document.getElementById('form-promocao');
    if (formPromo) {
        formPromo.addEventListener('submit', async (e) => {
            e.preventDefault();
            const alunoId = document.getElementById('promo-aluno-id').value;
            const modalidadeId = document.getElementById('promo-modalidade-id').value;
            const graduacaoNivelId = document.getElementById('promo-nivel-id').value;
            const professorId = document.getElementById('promo-professor-id').value || null;
            const dataGraduacao = document.getElementById('promo-data').value;
            const observacoes = document.getElementById('promo-obs').value || null;

            if (!modalidadeId || !graduacaoNivelId) {
                UI.showToast('Selecione a modalidade e a graduação.', 'warning');
                return;
            }

            try {
                await API.post(`/alunos/${alunoId}/graduacoes`, {
                    modalidade_id: modalidadeId,
                    graduacao_nivel_id: graduacaoNivelId,
                    professor_avaliador_id: professorId,
                    data_graduacao: dataGraduacao,
                    observacoes: observacoes
                });

                UI.showToast('Graduação lançada com sucesso!', 'success');
                UI.closeModal('modal-promocao');
                if (window.AlunosModule) AlunosModule.loadAlunos();
                if (window.AlunoDetalhesModule && AlunoDetalhesModule.currentAlunoId == alunoId) {
                    AlunoDetalhesModule.openDossier(alunoId);
                }
            } catch (err) {
                UI.showToast('Erro ao registrar promoção: ' + err.message, 'error');
            }
        });

        // Quando modalidade mudar no modal de promoção, atualiza catálogo de faixas
        const selectPromoMod = document.getElementById('promo-modalidade-id');
        if (selectPromoMod) {
            selectPromoMod.addEventListener('change', (e) => {
                const modId = e.target.value;
                const selectNivel = document.getElementById('promo-nivel-id');
                if (!modId || !AlunosModule.modalidades) {
                    selectNivel.innerHTML = '<option value="">Selecione primeiro a modalidade</option>';
                    return;
                }
                const modalidade = AlunosModule.modalidades.find(m => m.id == modId);
                if (!modalidade || !modalidade.niveis) return;

                selectNivel.innerHTML = '<option value="">Selecione a nova graduação</option>';
                modalidade.niveis.forEach(n => {
                    selectNivel.innerHTML += `<option value="${Number(n.id)}">${UI.escapeHtml(n.nome)} (${Number(n.ordem_hierarquica)}º nível)</option>`;
                });
            });
        }
    }

    // Modal de fechamento via clique no overlay (exceto modal de login quando não autenticado)
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                if (overlay.id === 'modal-auth' && (!window.AuthModule || !AuthModule.currentUser)) {
                    return;
                }
                UI.closeModal(overlay.id);
            }
        });
    });

    // Lei de Jakob: Fechamento de modais ativos e menu lateral ao pressionar a tecla ESC
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;

        // Fecha drawer mobile se estiver aberto
        if (sidebarEl && sidebarEl.classList.contains('open')) {
            closeSidebarMobile();
            return;
        }

        // Fecha o último modal ativo (respeitando bloqueio de autenticação)
        const activeModals = Array.from(document.querySelectorAll('.modal-overlay.active'));
        if (activeModals.length > 0) {
            const topModal = activeModals[activeModals.length - 1];
            if (topModal.id === 'modal-auth' && (!window.AuthModule || !AuthModule.currentUser)) {
                return;
            }
            UI.closeModal(topModal.id);
        }
    });
});

// Carregamento da View de Planos & Finanças
async function loadFinanceiroView() {
    if (window.PlanosModule) {
        await PlanosModule.loadAll();
    }
}
