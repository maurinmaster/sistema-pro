// Cliente de API para comunicação com o backend Express com Autenticação JWT
const API = {
    getToken() {
        return localStorage.getItem('kaizen_token');
    },

    setSession(token, user) {
        localStorage.setItem('kaizen_token', token);
        localStorage.setItem('kaizen_user', JSON.stringify(user));
    },

    getUser() {
        const user = localStorage.getItem('kaizen_user');
        return user ? JSON.parse(user) : null;
    },

    clearSession() {
        localStorage.removeItem('kaizen_token');
        localStorage.removeItem('kaizen_user');
    },

    getHeaders(extraHeaders = {}) {
        const headers = { ...extraHeaders };
        const token = this.getToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    },

    handleError(res, data) {
        if (res.status === 401) {
            this.clearSession();
            if (window.AuthModule) {
                AuthModule.showLoginModal('Sua sessão expirou ou você não está autenticado. Faça login para continuar.');
            }
        }
        throw new Error(data.error || 'Erro na requisição');
    },

    async get(endpoint) {
        try {
            const res = await fetch(`/api${endpoint}`, {
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (!res.ok) this.handleError(res, data);
            return data;
        } catch (err) {
            console.error(`Erro GET ${endpoint}:`, err);
            throw err;
        }
    },

    async post(endpoint, body) {
        try {
            const res = await fetch(`/api${endpoint}`, {
                method: 'POST',
                headers: this.getHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) this.handleError(res, data);
            return data;
        } catch (err) {
            console.error(`Erro POST ${endpoint}:`, err);
            throw err;
        }
    },

    async put(endpoint, body) {
        try {
            const res = await fetch(`/api${endpoint}`, {
                method: 'PUT',
                headers: this.getHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) this.handleError(res, data);
            return data;
        } catch (err) {
            console.error(`Erro PUT ${endpoint}:`, err);
            throw err;
        }
    },

    async patch(endpoint, body) {
        try {
            const res = await fetch(`/api${endpoint}`, {
                method: 'PATCH',
                headers: this.getHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) this.handleError(res, data);
            return data;
        } catch (err) {
            console.error(`Erro PATCH ${endpoint}:`, err);
            throw err;
        }
    },

    async delete(endpoint) {
        try {
            const res = await fetch(`/api${endpoint}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (!res.ok) this.handleError(res, data);
            return data;
        } catch (err) {
            console.error(`Erro DELETE ${endpoint}:`, err);
            throw err;
        }
    }
};

window.API = API;
