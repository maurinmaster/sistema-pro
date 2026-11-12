// Utilitários de Interface, Sanitização contra XSS e Notificações
const UI = {
    // Sanitização contra Cross-Site Scripting (XSS) em textos e atributos HTML
    escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    // Validação segura de URLs de imagem (bloqueia javascript:, data: malicioso, etc.)
    sanitizeUrl(url, fallback = '') {
        if (!url || typeof url !== 'string') return fallback;
        const trimmed = url.trim();
        if (
            trimmed.startsWith('https://') ||
            trimmed.startsWith('http://') ||
            trimmed.startsWith('/uploads/')
        ) {
            return this.escapeHtml(trimmed);
        }
        return fallback;
    },

    // Validação de cores Hexadecimais para atributos style
    sanitizeColor(color, fallback = '#94a3b8') {
        if (!color || typeof color !== 'string') return fallback;
        const trimmed = color.trim();
        return /^#[0-9A-Fa-f]{3,8}$/.test(trimmed) ? trimmed : fallback;
    },

    // Sistema de Toasts
    showToast(message, type = 'info', duration = 3500) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${this.escapeHtml(type)}`;
        
        let iconSvg = '';
        if (type === 'success') {
            iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
        } else if (type === 'error') {
            iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
        } else if (type === 'warning') {
            iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
        } else {
            iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
        }

        toast.innerHTML = `
            ${iconSvg}
            <div style="flex: 1;">${this.escapeHtml(message)}</div>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 250);
        }, duration);
    },

    // Controle de Modais
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    },

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    },

    // Formatação de Dinheiro em Real
    formatCurrency(value) {
        if (value === null || value === undefined) return 'R$ 0,00';
        return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    },

    // Formatação de Datas
    formatDate(dateString) {
        if (!dateString) return '-';
        const d = new Date(dateString);
        return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    },

    formatDateTime(dateString) {
        if (!dateString) return '-';
        const d = new Date(dateString);
        return d.toLocaleString('pt-BR');
    },

    // Cálculo exato de idade
    calculateAge(birthDateString) {
        if (!birthDateString) return null;
        const birthDate = new Date(birthDateString);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return age;
    },

    // Lei de Postel: Formatação tolerante de CPF (000.000.000-00)
    formatCPF(value) {
        const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
        if (digits.length <= 3) return digits;
        if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
        if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
        return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
    },

    // Lei de Postel: Formatação tolerante de Telefone / WhatsApp ((00) 00000-0000)
    formatPhone(value) {
        const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
        if (digits.length === 0) return '';
        if (digits.length <= 2) return `(${digits}`;
        if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
        if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
        return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
    },

    // Aplica máscaras automáticas nos campos de CPF e Telefone do DOM
    bindInputMasks() {
        if (typeof document === 'undefined') return;
        const cpfIds = ['aluno-cpf', 'aluno-resp-cpf'];
        const phoneIds = ['aluno-whatsapp', 'aluno-resp-fone', 'aluno-emergencia-fone'];

        cpfIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', (e) => {
                    e.target.value = this.formatCPF(e.target.value);
                });
            }
        });

        phoneIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', (e) => {
                    e.target.value = this.formatPhone(e.target.value);
                });
            }
        });
    },

    // Renderizador visual de insígnia / faixa
    renderBeltBadge(nome, corPrimaria, corSecundaria) {
        if (!nome) return '<span class="text-muted">Sem graduação</span>';
        const safeNome = this.escapeHtml(nome);
        const pColor = this.sanitizeColor(corPrimaria, '#94a3b8');
        const sColor = this.sanitizeColor(corSecundaria, '#1e293b');

        return `
            <div class="belt-tag" title="${safeNome}">
                <div class="belt-pill" style="background: ${pColor};">
                    <div class="belt-pill-tip" style="background: ${sColor};"></div>
                </div>
                <span>${safeNome}</span>
            </div>
        `;
    },

    // Renderizador de status
    renderStatusBadge(status) {
        const allowed = ['ativo', 'inativo', 'trancado', 'bloqueado', 'experimental'];
        const s = allowed.includes(status) ? status : 'inativo';
        const labels = {
            ativo: 'Ativo',
            inativo: 'Inativo',
            trancado: 'Trancado',
            bloqueado: 'Bloqueado',
            experimental: 'Experimental'
        };
        return `<span class="badge-status ${s}">${labels[s] || this.escapeHtml(status)}</span>`;
    },

    // Barramento leve de eventos (EventBus) para desacoplar comunicação entre módulos do frontend
    _listeners: {},
    on(event, handler) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(handler);
    },
    emit(event, detail = null) {
        if (this._listeners[event]) {
            this._listeners[event].forEach(fn => {
                try { fn(detail); } catch (e) { console.error(`Erro no evento ${event}:`, e); }
            });
        }
    }
};

if (typeof window !== 'undefined') {
    window.UI = UI;
    window.AppEvents = { on: UI.on.bind(UI), emit: UI.emit.bind(UI) };
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UI;
}
