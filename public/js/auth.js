// Módulo de Autenticação e Controle de Acesso Corporativo (RBAC)
const AuthModule = {
    currentUser: null,

    async init() {
        this.bindEvents();
        await this.checkSession();
    },

    bindEvents() {
        // Formulário de login
        const formLogin = document.getElementById('form-login-manual');
        if (formLogin) {
            formLogin.addEventListener('submit', (e) => this.handleManualLogin(e));
        }

        // Botão Sair do Sistema
        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) {
            btnLogout.addEventListener('click', () => this.logout());
        }

        // Toggle para mostrar/ocultar senha no login
        const toggleSenha = document.getElementById('btn-toggle-senha');
        if (toggleSenha) {
            toggleSenha.addEventListener('click', () => {
                const inputSenha = document.getElementById('login-senha');
                if (inputSenha) {
                    const isPass = inputSenha.type === 'password';
                    inputSenha.type = isPass ? 'text' : 'password';
                    toggleSenha.innerHTML = isPass 
                        ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
                        : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
                }
            });
        }
    },

    async checkSession() {
        const token = API.getToken();
        if (!token) {
            // Sem token: exige autenticação imediatamente
            this.showLoginModal();
            return;
        }

        try {
            const res = await API.get('/auth/me');
            this.currentUser = res.user;
            if (this.currentUser && this.currentUser.cargo === 'aluno') {
                window.location.href = '/painel';
                return;
            }
            this.applyPermissions();
            UI.closeModal('modal-auth');
        } catch {
            // Sessão inválida ou expirada
            this.logout('Sua sessão expirou. Por favor, autentique-se novamente.');
        }
    },

    async handleManualLogin(e) {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const senha = document.getElementById('login-senha').value;
        const btnSubmit = document.getElementById('btn-submit-login');
        const alertBox = document.getElementById('auth-modal-alert');

        if (alertBox) alertBox.style.display = 'none';

        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `<div class="spinner"></div> Autenticando...`;

        try {
            const res = await API.post('/auth/login', { email, senha });
            API.setSession(res.token, res.user);
            this.currentUser = res.user;

            UI.showToast(res.message, 'success');
            UI.closeModal('modal-auth');
            this.applyPermissions();

            // Salva e-mail lembrado se solicitado
            const rememberMe = document.getElementById('login-remember')?.checked;
            if (rememberMe) {
                localStorage.setItem('kaizen_remember_email', email);
            } else {
                localStorage.removeItem('kaizen_remember_email');
            }

            // Se o usuário autenticado for um Aluno, redireciona automaticamente para o Portal Mobile-First do Aluno
            if (this.currentUser && this.currentUser.cargo === 'aluno') {
                window.location.href = '/painel';
                return;
            }

            // Recarrega os módulos autenticados
            if (window.AlunosModule) {
                AlunosModule.loadModalidades();
                AlunosModule.loadPlanos();
                AlunosModule.loadAlunos();
            }
            if (window.DashboardModule) DashboardModule.loadDashboard();
            if (window.CheckinsModule) {
                CheckinsModule.loadTurmas();
                CheckinsModule.loadRecentes();
            }
            if (window.GraduacoesModule) GraduacoesModule.loadCatalogo();
        } catch (err) {
            if (alertBox) {
                alertBox.textContent = err.message || 'Erro ao realizar login.';
                alertBox.style.display = 'block';
            }
            UI.showToast(err.message, 'error');
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = `<span>Acessar Plataforma</span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
        }
    },

    async logout(msg = null) {
        try {
            await API.post('/auth/logout', {});
        } catch {
            // Ignora falha de rede no logout
        }

        API.clearSession();
        this.currentUser = null;

        // Limpa perfil na sidebar
        const userName = document.querySelector('.sidebar-footer .user-name');
        const userRole = document.querySelector('.sidebar-footer .user-role');
        const userAvatar = document.querySelector('.sidebar-footer .user-avatar');
        if (userName) userName.textContent = 'Não autenticado';
        if (userRole) userRole.textContent = 'Sessão encerrada';
        if (userAvatar) userAvatar.textContent = '--';

        this.showLoginModal(msg || 'Sua sessão foi encerrada com sucesso.');
    },

    showLoginModal(msg = null) {
        const alertBox = document.getElementById('auth-modal-alert');
        if (alertBox) {
            if (msg) {
                alertBox.textContent = msg;
                alertBox.style.display = 'block';
            } else {
                alertBox.style.display = 'none';
            }
        }

        // Restaura e-mail lembrado
        const remembered = localStorage.getItem('kaizen_remember_email');
        const emailInput = document.getElementById('login-email');
        const rememberCheckbox = document.getElementById('login-remember');
        if (emailInput && remembered) {
            emailInput.value = remembered;
            if (rememberCheckbox) rememberCheckbox.checked = true;
        }

        // Limpa campo de senha
        const senhaInput = document.getElementById('login-senha');
        if (senhaInput) senhaInput.value = '';

        // Exibe modal de autenticação (sem permitir fechamento sem logar)
        const modal = document.getElementById('modal-auth');
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';

            // Oculta botão de fechar se não houver usuário autenticado
            const closeBtn = modal.querySelector('.modal-close');
            if (closeBtn) {
                closeBtn.style.display = this.currentUser ? 'flex' : 'none';
            }
        }
    },

    // Aplicação das permissões (RBAC) conforme cargo do usuário
    applyPermissions() {
        if (!this.currentUser) return;
        const u = this.currentUser;

        // Atualiza perfil na barra lateral
        const userAvatar = document.querySelector('.sidebar-footer .user-avatar');
        const userName = document.querySelector('.sidebar-footer .user-name');
        const userRole = document.querySelector('.sidebar-footer .user-role');

        const initials = u.nome.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
        if (userAvatar) userAvatar.textContent = initials;
        if (userName) userName.textContent = u.nome;

        const roleLabels = {
            admin: 'Administrador Geral',
            recepcao: 'Recepção / Atendimento',
            professor: 'Professor / Mestre'
        };
        if (userRole) userRole.textContent = roleLabels[u.cargo] || u.cargo;

        // Controle de visibilidade de menus por cargo
        const navFinanceiro = document.getElementById('nav-financeiro');
        const btnNovoAluno = document.getElementById('btn-novo-aluno');

        if (u.cargo === 'professor') {
            // Professor foca no pedagógico e não tem acesso ao módulo financeiro
            if (navFinanceiro) navFinanceiro.style.display = 'none';
            if (btnNovoAluno) btnNovoAluno.style.display = 'none';

            // Redireciona para alunos caso estivesse na view financeira
            const viewFinanceiro = document.getElementById('view-financeiro');
            if (viewFinanceiro && viewFinanceiro.classList.contains('active')) {
                document.getElementById('nav-alunos')?.click();
            }
        } else {
            // Admin e Recepção têm acesso normal ao financeiro e cadastros
            if (navFinanceiro) navFinanceiro.style.display = 'flex';
            if (btnNovoAluno) btnNovoAluno.style.display = 'inline-flex';
        }
    },

    can(action) {
        if (!this.currentUser) return false;
        const cargo = this.currentUser.cargo;

        switch (action) {
            case 'manage_alunos':
                return ['admin', 'recepcao'].includes(cargo);
            case 'delete_alunos':
                return cargo === 'admin';
            case 'manage_financeiro':
                return ['admin', 'recepcao'].includes(cargo);
            case 'promote_faixas':
                return ['admin', 'professor'].includes(cargo);
            case 'checkin':
                return ['admin', 'recepcao', 'professor'].includes(cargo);
            default:
                return false;
        }
    }
};

window.AuthModule = AuthModule;
