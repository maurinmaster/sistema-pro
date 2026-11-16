/**
 * PRO COMBATE - Sistema Unificado de Autenticação
 * Cadastro em Tela Única, Login e Recuperação de Senha
 */

const AuthApp = {
    registeredEmail: null,
    resetEmail: null,
    isUploadingPhoto: false,

    init() {
        this.bindViewNavigation();
        this.bindMasksAndValidation();
        this.bindPhotoUpload();
        this.bindPasswordToggles();
        this.bindForms();
        this.bindDigitInputs('verify-digits-container', () => this.submitEmailVerification());
        this.bindDigitInputs('reset-digits-container');
        this.checkInitialRoute();
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js?v=7').catch(() => {});
        }
    },

    // =========================================================================
    // 1. NAVEGAÇÃO E TRANSIÇÃO ENTRE TELAS (CADASTRO, LOGIN, RESET)
    // =========================================================================
    bindViewNavigation() {
        const tabCadastro = document.getElementById('tab-btn-cadastro');
        const tabLogin = document.getElementById('tab-btn-login');
        const linkGotoReset = document.getElementById('link-goto-reset');
        const linkGotoCadastro = document.getElementById('link-goto-cadastro');
        const linkBackToLogin = document.getElementById('link-back-to-login');

        tabCadastro?.addEventListener('click', () => this.switchView('view-cadastro'));
        tabLogin?.addEventListener('click', () => this.switchView('view-login'));
        linkGotoReset?.addEventListener('click', (e) => {
            e.preventDefault();
            this.switchView('view-reset');
        });
        linkGotoCadastro?.addEventListener('click', (e) => {
            e.preventDefault();
            this.switchView('view-cadastro');
        });
        linkBackToLogin?.addEventListener('click', (e) => {
            e.preventDefault();
            this.switchView('view-login');
        });

        // Alternância de gênero
        const genderButtons = document.querySelectorAll('.gender-btn');
        genderButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                genderButtons.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                const hiddenGender = document.getElementById('cad-genero');
                if (hiddenGender) hiddenGender.value = btn.dataset.value;
            });
        });
    },

    switchView(viewId) {
        // Oculta todas as telas
        document.querySelectorAll('.auth-view').forEach(view => {
            view.classList.remove('active');
        });

        // Exibe a tela desejada
        const targetView = document.getElementById(viewId);
        if (targetView) targetView.classList.add('active');

        // Atualiza botões da barra de navegação superior
        const tabCadastro = document.getElementById('tab-btn-cadastro');
        const tabLogin = document.getElementById('tab-btn-login');
        const pillsBar = document.getElementById('nav-pills-bar');
        const headerSub = document.getElementById('header-sub-text');

        if (viewId === 'view-cadastro') {
            pillsBar.style.display = 'flex';
            tabCadastro?.classList.add('active');
            tabLogin?.classList.remove('active');
            if (headerSub) headerSub.textContent = 'Preencha seus dados para criar sua conta';
            window.location.hash = '#cadastro';
        } else if (viewId === 'view-login') {
            pillsBar.style.display = 'flex';
            tabLogin?.classList.add('active');
            tabCadastro?.classList.remove('active');
            if (headerSub) headerSub.textContent = 'Entre com seu e-mail e senha cadastrados';
            window.location.hash = '#login';
        } else if (viewId === 'view-reset') {
            pillsBar.style.display = 'none';
            if (headerSub) headerSub.textContent = 'Redefinição de senha de acesso';
            window.location.hash = '#reset';
        } else if (viewId === 'view-verify') {
            pillsBar.style.display = 'none';
            if (headerSub) headerSub.textContent = 'Validação de segurança da sua conta';
            window.location.hash = '#verificar';
        } else if (viewId === 'view-success') {
            pillsBar.style.display = 'none';
            if (headerSub) headerSub.textContent = 'Bem-vindo(a) ao PRO COMBATE!';
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    checkInitialRoute() {
        const hash = window.location.hash.toLowerCase();
        const path = window.location.pathname.toLowerCase();

        if (path === '/login' || hash === '#login') {
            this.switchView('view-login');
        } else if (path === '/esqueci-senha' || path === '/reset-senha' || hash === '#reset') {
            this.switchView('view-reset');
        } else {
            this.switchView('view-cadastro');
        }
    },

    // =========================================================================
    // 2. MÁSCARAS E REGRAS DE MENOR DE IDADE
    // =========================================================================
    bindMasksAndValidation() {
        const inputCpf = document.getElementById('cad-cpf');
        const inputTel = document.getElementById('cad-whatsapp');
        const inputRespTel = document.getElementById('cad-resp-tel');
        const inputNasc = document.getElementById('cad-nasc');

        // Máscara de CPF (000.000.000-00)
        const applyCpfMask = (e) => {
            let v = e.target.value.replace(/\D/g, '').slice(0, 11);
            if (v.length > 9) v = `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
            else if (v.length > 6) v = `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6)}`;
            else if (v.length > 3) v = `${v.slice(0, 3)}.${v.slice(3)}`;
            e.target.value = v;
        };
        inputCpf?.addEventListener('input', applyCpfMask);

        // Máscara de Telefone / WhatsApp ((00) 00000-0000)
        const applyPhoneMask = (e) => {
            let v = e.target.value.replace(/\D/g, '').slice(0, 11);
            if (v.length > 6) v = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
            else if (v.length > 2) v = `(${v.slice(0, 2)}) ${v.slice(2)}`;
            e.target.value = v;
        };
        inputTel?.addEventListener('input', applyPhoneMask);
        inputRespTel?.addEventListener('input', applyPhoneMask);

        // Cálculo dinâmico de idade com revelação suave do responsável
        inputNasc?.addEventListener('change', () => {
            const birthVal = inputNasc.value;
            if (!birthVal) return;

            const age = this.calculateAge(birthVal);
            const minorBox = document.getElementById('minor-box');
            const minorTagText = document.getElementById('minor-tag-text');
            const respNome = document.getElementById('cad-resp-nome');
            const respTel = document.getElementById('cad-resp-tel');

            if (age !== null && age < 18) {
                if (minorBox) minorBox.style.display = 'block';
                if (minorTagText) minorTagText.textContent = `Atleta Menor de Idade (${age} anos) — Dados do Responsável Legal`;
                if (respNome) respNome.required = true;
                if (respTel) respTel.required = true;
                this.showToast(`Atleta menor de 18 anos (${age} anos). Informe o responsável legal.`, 'default');
            } else {
                if (minorBox) minorBox.style.display = 'none';
                if (respNome) respNome.required = false;
                if (respTel) respTel.required = false;
            }
        });
    },

    calculateAge(birthDateString) {
        const birth = new Date(birthDateString);
        if (isNaN(birth.getTime())) return null;
        const now = new Date();
        let age = now.getFullYear() - birth.getFullYear();
        const m = now.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) {
            age--;
        }
        return age;
    },

    // =========================================================================
    // 3. COMPONENTE DE FOTO DE PERFIL / CÂMERA INTEGRADA
    // =========================================================================
    bindPhotoUpload() {
        const inputCamera = document.getElementById('input-camera-selfie');
        const inputGallery = document.getElementById('input-gallery-file');

        inputCamera?.addEventListener('change', (e) => this.handleImageSelect(e));
        inputGallery?.addEventListener('change', (e) => this.handleImageSelect(e));
    },

    async handleImageSelect(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        // Prévia imediata da imagem no avatar circular
        const avatarWrap = document.getElementById('avatar-wrap');
        const avatarImg = document.getElementById('avatar-img');
        const avatarPlaceholder = document.getElementById('avatar-placeholder');
        const labelCameraText = document.getElementById('label-camera-text');

        if (avatarImg && avatarPlaceholder && avatarWrap) {
            avatarImg.src = URL.createObjectURL(file);
            avatarImg.style.display = 'block';
            avatarPlaceholder.style.display = 'none';
            avatarWrap.classList.add('has-photo');
            if (labelCameraText) labelCameraText.textContent = 'Trocar Foto';
        }

        // Upload assíncrono para o backend com validação de magic bytes
        this.isUploadingPhoto = true;
        try {
            this.showToast('Enviando foto...', 'default');
            const formData = new FormData();
            formData.append('foto', file, 'foto-perfil.jpg');

            const res = await fetch('/api/auth/upload-foto-perfil', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Erro ao processar imagem.');
            }

            document.getElementById('cad-foto-url').value = data.url;
            avatarWrap?.classList.remove('photo-error');
            avatarWrap?.classList.add('has-photo');
            this.showToast('Foto registrada com sucesso!', 'success');
        } catch (err) {
            console.error('Falha no upload da foto:', err);
            const cadFotoInput = document.getElementById('cad-foto-url');
            if (cadFotoInput) cadFotoInput.value = '';
            avatarWrap?.classList.remove('has-photo');
            avatarWrap?.classList.add('photo-error');
            this.showToast(err.message || 'Erro ao enviar foto.', 'error');
        } finally {
            this.isUploadingPhoto = false;
        }
    },

    // =========================================================================
    // 4. TOGGLE DE SENHA
    // =========================================================================
    bindPasswordToggles() {
        document.querySelectorAll('.btn-toggle-pw').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.target;
                const input = document.getElementById(targetId);
                if (!input) return;

                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';

                btn.innerHTML = isPassword
                    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                         <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                         <line x1="1" y1="1" x2="23" y2="23" />
                       </svg>`
                    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                         <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                         <circle cx="12" cy="12" r="3" />
                       </svg>`;
            });
        });
    },

    // =========================================================================
    // 5. ENTRADA DE CÓDIGOS DE 6 DÍGITOS
    // =========================================================================
    bindDigitInputs(containerId, onCompleteCallback) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const inputs = Array.from(container.querySelectorAll('.digit-input'));

        inputs.forEach((input, idx) => {
            input.addEventListener('input', (e) => {
                const val = e.target.value.replace(/\D/g, '');
                e.target.value = val ? val[0] : '';

                if (val && idx < inputs.length - 1) {
                    inputs[idx + 1].focus();
                }

                const fullCode = inputs.map(i => i.value).join('');
                if (fullCode.length === 6 && typeof onCompleteCallback === 'function') {
                    onCompleteCallback(fullCode);
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !input.value && idx > 0) {
                    inputs[idx - 1].focus();
                }
            });

            input.addEventListener('paste', (e) => {
                e.preventDefault();
                const pasteData = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
                if (!pasteData) return;

                pasteData.split('').forEach((char, i) => {
                    if (inputs[i]) inputs[i].value = char;
                });

                if (pasteData.length === 6) {
                    inputs[5].focus();
                    if (typeof onCompleteCallback === 'function') {
                        onCompleteCallback(pasteData);
                    }
                } else if (inputs[pasteData.length]) {
                    inputs[pasteData.length].focus();
                }
            });
        });
    },

    getDigitsValue(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return '';
        const inputs = Array.from(container.querySelectorAll('.digit-input'));
        return inputs.map(i => i.value.trim()).join('');
    },

    // =========================================================================
    // 6. SUBMISSÃO DE FORMULÁRIOS
    // =========================================================================
    bindForms() {
        // Form de Cadastro
        document.getElementById('form-cadastro')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitCadastro();
        });

        // Form de Login
        document.getElementById('form-login')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitLogin();
        });

        // Form de Solicitação de Reset (Esqueci a Senha)
        document.getElementById('form-reset-request')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitResetRequest();
        });

        // Form de Aplicação de Nova Senha
        document.getElementById('form-reset-apply')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitResetApply();
        });

        // Confirmação de Código de E-mail
        document.getElementById('btn-confirm-code')?.addEventListener('click', () => {
            this.submitEmailVerification();
        });

        // Reenvio de Código de E-mail
        document.getElementById('btn-resend-code')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.resendEmailCode();
        });
    },

    // -------------------------------------------------------------------------
    // CADASTRO (TUDO EM UMA TELA)
    // -------------------------------------------------------------------------
    async submitCadastro() {
        const nome = document.getElementById('cad-nome')?.value.trim();
        const sobrenome = document.getElementById('cad-sobrenome')?.value.trim();
        const cpf = document.getElementById('cad-cpf')?.value.trim();
        const nasc = document.getElementById('cad-nasc')?.value;
        const whatsapp = document.getElementById('cad-whatsapp')?.value.trim();
        const genero = document.getElementById('cad-genero')?.value || 'Masculino';
        const email = document.getElementById('cad-email')?.value.trim();
        const senha = document.getElementById('cad-senha')?.value;
        const senhaConf = document.getElementById('cad-senha-conf')?.value;
        const termos = document.getElementById('cad-termos')?.checked;
        const fotoUrl = document.getElementById('cad-foto-url')?.value || null;

        // Validações
        if (this.isUploadingPhoto) {
            this.showToast('Aguarde o término do envio da foto...', 'error');
            return;
        }

        const avatarWrap = document.getElementById('avatar-wrap');
        if (!fotoUrl || !fotoUrl.trim()) {
            avatarWrap?.classList.add('photo-error');
            avatarWrap?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            this.showToast('A foto de perfil é obrigatória no cadastro. Tire uma foto ou escolha da galeria.', 'error');
            return;
        }
        avatarWrap?.classList.remove('photo-error');

        if (!nome || nome.length < 2) {
            this.showToast('Informe seu nome.', 'error');
            document.getElementById('cad-nome')?.focus();
            return;
        }

        if (!sobrenome || sobrenome.length < 2) {
            this.showToast('Informe seu sobrenome.', 'error');
            document.getElementById('cad-sobrenome')?.focus();
            return;
        }

        const cleanCpf = cpf.replace(/\D/g, '');
        if (!cleanCpf || cleanCpf.length !== 11) {
            this.showToast('Informe um CPF válido com 11 dígitos.', 'error');
            document.getElementById('cad-cpf')?.focus();
            return;
        }

        if (!nasc) {
            this.showToast('Informe sua data de nascimento.', 'error');
            document.getElementById('cad-nasc')?.focus();
            return;
        }

        const age = this.calculateAge(nasc);
        let respNome = null;
        let respTel = null;

        if (age !== null && age < 18) {
            respNome = document.getElementById('cad-resp-nome')?.value.trim();
            respTel = document.getElementById('cad-resp-tel')?.value.trim();

            if (!respNome) {
                this.showToast('Informe o nome do responsável legal.', 'error');
                document.getElementById('cad-resp-nome')?.focus();
                return;
            }
            if (!respTel || respTel.replace(/\D/g, '').length < 10) {
                this.showToast('Informe o telefone completo do responsável legal.', 'error');
                document.getElementById('cad-resp-tel')?.focus();
                return;
            }
        }

        const cleanWhats = whatsapp.replace(/\D/g, '');
        if (!cleanWhats || cleanWhats.length < 10) {
            this.showToast('Informe seu WhatsApp com DDD.', 'error');
            document.getElementById('cad-whatsapp')?.focus();
            return;
        }

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            this.showToast('Informe um e-mail válido.', 'error');
            document.getElementById('cad-email')?.focus();
            return;
        }

        if (!senha || senha.length < 6) {
            this.showToast('A senha deve ter no mínimo 6 caracteres.', 'error');
            document.getElementById('cad-senha')?.focus();
            return;
        }

        if (senha !== senhaConf) {
            this.showToast('As senhas não coincidem. Confira novamente.', 'error');
            document.getElementById('cad-senha-conf')?.focus();
            return;
        }

        if (!termos) {
            this.showToast('Você precisa aceitar os termos para prosseguir.', 'error');
            return;
        }

        const btnSubmit = document.getElementById('btn-submit-cad');
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `<span>Criando sua conta...</span>`;

        try {
            const payload = {
                nome,
                sobrenome,
                nome_completo: `${nome} ${sobrenome}`,
                cpf,
                data_nascimento: nasc,
                telefone_whatsapp: whatsapp,
                genero,
                email,
                senha,
                foto_perfil_url: fotoUrl,
                consentimento_biometria_lgpd: 1,
                responsavel_nome: respNome,
                responsavel_telefone: respTel
            };

            const res = await fetch('/api/auth/cadastro-aluno', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Erro ao realizar cadastro.');
            }

            this.registeredEmail = email;
            document.getElementById('verify-email-display').textContent = email;

            this.showToast('Cadastro realizado! Enviamos o código de ativação.', 'success');
            this.switchView('view-verify');

            // Se estiver em ambiente de teste/dev com código retornado, foca no primeiro dígito
            const firstDigit = document.querySelector('#verify-digits-container .digit-input');
            if (firstDigit) firstDigit.focus();

        } catch (err) {
            console.error('Erro no cadastro:', err);
            this.showToast(err.message, 'error');
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = `<span>Concluir Meu Cadastro</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6" />
                </svg>`;
        }
    },

    // -------------------------------------------------------------------------
    // LOGIN
    // -------------------------------------------------------------------------
    async submitLogin() {
        const email = document.getElementById('login-email')?.value.trim();
        const senha = document.getElementById('login-senha')?.value;

        if (!email) {
            this.showToast('Informe seu e-mail cadastrado.', 'error');
            document.getElementById('login-email')?.focus();
            return;
        }

        if (!senha) {
            this.showToast('Digite sua senha.', 'error');
            document.getElementById('login-senha')?.focus();
            return;
        }

        const btnLogin = document.getElementById('btn-submit-login');
        btnLogin.disabled = true;
        btnLogin.innerHTML = `<span>Entrando...</span>`;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, senha })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'E-mail ou senha incorretos.');
            }

            // Armazena credenciais no localStorage
            localStorage.setItem('auth_token', data.token);
            if (data.user) {
                localStorage.setItem('user', JSON.stringify(data.user));
            }

            this.showToast(data.message || 'Login efetuado com sucesso!', 'success');

            // Redireciona para o portal correspondente
            setTimeout(() => {
                if (data.user && data.user.cargo === 'aluno') {
                    window.location.href = '/painel';
                } else {
                    window.location.href = '/';
                }
            }, 800);

        } catch (err) {
            console.error('Falha no login:', err);
            this.showToast(err.message, 'error');
        } finally {
            btnLogin.disabled = false;
            btnLogin.innerHTML = `<span>Entrar no Sistema</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                </svg>`;
        }
    },

    // -------------------------------------------------------------------------
    // RECUPERAÇÃO DE SENHA (ESQUECI A SENHA)
    // -------------------------------------------------------------------------
    async submitResetRequest() {
        const email = document.getElementById('reset-email')?.value.trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            this.showToast('Informe um e-mail válido.', 'error');
            document.getElementById('reset-email')?.focus();
            return;
        }

        const btn = document.getElementById('btn-submit-reset-req');
        btn.disabled = true;
        btn.innerHTML = `<span>Gerando código...</span>`;

        try {
            const res = await fetch('/api/auth/esqueci-senha', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Erro ao solicitar redefinição.');
            }

            this.resetEmail = email;
            document.getElementById('reset-email-display').textContent = email;

            this.showToast('Código de recuperação gerado! Confira seu e-mail.', 'success');

            // Transita suavemente para a Etapa 2
            document.getElementById('reset-step-1').style.display = 'none';
            document.getElementById('reset-step-2').style.display = 'block';

            const firstDigit = document.querySelector('#reset-digits-container .digit-input');
            if (firstDigit) firstDigit.focus();

        } catch (err) {
            console.error('Erro na solicitação de reset:', err);
            this.showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<span>Enviar Código de Recuperação</span>`;
        }
    },

    async submitResetApply() {
        const codigo = this.getDigitsValue('reset-digits-container');
        const novaSenha = document.getElementById('reset-new-pw')?.value;
        const confSenha = document.getElementById('reset-conf-pw')?.value;

        if (!codigo || codigo.length !== 6) {
            this.showToast('Digite o código de 6 dígitos completo.', 'error');
            return;
        }

        if (!novaSenha || novaSenha.length < 6) {
            this.showToast('A nova senha deve ter no mínimo 6 caracteres.', 'error');
            document.getElementById('reset-new-pw')?.focus();
            return;
        }

        if (novaSenha !== confSenha) {
            this.showToast('As senhas digitadas não coincidem.', 'error');
            document.getElementById('reset-conf-pw')?.focus();
            return;
        }

        const btn = document.getElementById('btn-submit-new-pw');
        btn.disabled = true;
        btn.innerHTML = `<span>Salvando nova senha...</span>`;

        try {
            const res = await fetch('/api/auth/redefinir-senha', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: this.resetEmail,
                    codigo,
                    nova_senha: novaSenha
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Código inválido ou expirado.');
            }

            this.showToast('Senha redefinida com sucesso! Faça login com a nova senha.', 'success');

            // Preenche e-mail no login e redireciona
            const loginEmail = document.getElementById('login-email');
            if (loginEmail) loginEmail.value = this.resetEmail;

            setTimeout(() => {
                document.getElementById('reset-step-1').style.display = 'block';
                document.getElementById('reset-step-2').style.display = 'none';
                this.switchView('view-login');
            }, 1200);

        } catch (err) {
            console.error('Erro ao redefinir senha:', err);
            this.showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<span>Salvar Nova Senha</span>`;
        }
    },

    // -------------------------------------------------------------------------
    // VALIDAÇÃO DE E-MAIL APÓS CADASTRO
    // -------------------------------------------------------------------------
    async submitEmailVerification() {
        const codigo = this.getDigitsValue('verify-digits-container');
        if (!codigo || codigo.length !== 6) {
            this.showToast('Digite o código de 6 dígitos recebido.', 'error');
            return;
        }

        const email = this.registeredEmail || document.getElementById('cad-email')?.value.trim();
        if (!email) {
            this.showToast('E-mail não identificado. Volte ao cadastro.', 'error');
            return;
        }

        const btn = document.getElementById('btn-confirm-code');
        btn.disabled = true;
        btn.innerHTML = `<span>Validando...</span>`;

        try {
            const res = await fetch('/api/auth/verificar-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, codigo })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Código incorreto ou expirado.');
            }

            if (data.token) {
                localStorage.setItem('auth_token', data.token);
            }
            if (data.user) {
                localStorage.setItem('user', JSON.stringify(data.user));
            }

            this.showToast('E-mail validado com sucesso!', 'success');
            this.switchView('view-success');

        } catch (err) {
            console.error('Erro na validação de e-mail:', err);
            this.showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<span>Validar e Entrar</span>`;
        }
    },

    async resendEmailCode() {
        const email = this.registeredEmail || document.getElementById('cad-email')?.value.trim();
        if (!email) {
            this.showToast('E-mail não identificado.', 'error');
            return;
        }

        try {
            this.showToast('Reenviando código...', 'default');
            const res = await fetch('/api/auth/reenviar-codigo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Erro ao reenviar.');
            }

            this.showToast('Novo código enviado com sucesso!', 'success');
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    },

    // =========================================================================
    // 7. TOAST FEEDBACK
    // =========================================================================
    showToast(message, type = 'default') {
        const toast = document.getElementById('auth-toast');
        if (!toast) return;

        toast.className = '';
        toast.textContent = message;

        if (type === 'success') toast.classList.add('success');
        else if (type === 'error') toast.classList.add('error');

        toast.classList.add('show');

        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, 3600);
    }
};

// Inicialização automática quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    AuthApp.init();
});
