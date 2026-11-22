// Módulo de Configurações Centralizadas de Mensagens & Notificações (Admin)
const MensagensConfigModule = {
    config: null,
    catalog: [],
    manualPresets: [],
    filterPublico: 'todos',
    filterBusca: '',
    initialized: false,

    init() {
        if (this.initialized) return;
        this.bindEvents();
        this.initialized = true;
    },

    bindEvents() {
        document.getElementById('btn-msg-salvar-config')?.addEventListener('click', () => this.saveConfig());
        document.getElementById('btn-msg-restaurar-tudo')?.addEventListener('click', () => this.restoreDefaults(null));
        document.getElementById('btn-msg-abrir-whatsapp')?.addEventListener('click', () => {
            if (window.AlunosModule) AlunosModule.openWhatsAppModal();
        });

        // Abas internas
        document.getElementById('btn-tab-msg-servicos')?.addEventListener('click', () => this.switchTab('servicos'));
        document.getElementById('btn-tab-msg-manual')?.addEventListener('click', () => this.switchTab('manual'));
        document.getElementById('btn-tab-msg-logs')?.addEventListener('click', () => this.switchTab('logs'));

        // Filtros de serviços
        document.getElementById('msg-filtro-publico-bar')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-msg-filter]');
            if (!btn) return;
            this.filterPublico = btn.getAttribute('data-msg-filter') || 'todos';
            document.querySelectorAll('#msg-filtro-publico-bar [data-msg-filter]').forEach(el => {
                el.className = el === btn ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
            });
            this.renderServicesList();
        });

        document.getElementById('msg-filtro-busca')?.addEventListener('input', (e) => {
            this.filterBusca = (e.target.value || '').trim().toLowerCase();
            this.renderServicesList();
        });

        // Atualização ao vivo das configurações globais em memória
        document.getElementById('msg-cfg-portal-url')?.addEventListener('input', (e) => {
            if (this.config) this.config.portal_url = e.target.value;
            this.updateAllServicePreviews();
            this.updateManualPreview();
        });
        document.getElementById('msg-cfg-incluir-link')?.addEventListener('change', (e) => {
            if (this.config) this.config.incluir_link_padrao = e.target.checked;
            this.updateAllServicePreviews();
        });
        document.getElementById('msg-cfg-admin-whatsapp')?.addEventListener('input', (e) => {
            if (this.config) this.config.admin_whatsapp = e.target.value;
        });
        document.getElementById('msg-cfg-admin-email')?.addEventListener('input', (e) => {
            if (this.config) this.config.admin_email = e.target.value;
        });

        // Delegação de eventos para lista de serviços
        const listEl = document.getElementById('lista-servicos-mensagens');
        if (listEl) {
            listEl.addEventListener('change', (e) => {
                const key = e.target.getAttribute('data-event-key');
                const field = e.target.getAttribute('data-field');
                if (!key || !field || !this.config?.regras?.[key]) return;
                if (e.target.type === 'checkbox') {
                    this.config.regras[key][field] = e.target.checked;
                    this.updateServiceCardPreview(key);
                }
            });

            listEl.addEventListener('input', (e) => {
                const key = e.target.getAttribute('data-event-key');
                const field = e.target.getAttribute('data-field');
                if (!key || !field || !this.config?.regras?.[key]) return;
                this.config.regras[key][field] = e.target.value;
                this.updateServiceCardPreview(key);
            });

            listEl.addEventListener('click', (e) => {
                const varBtn = e.target.closest('[data-insert-var]');
                if (varBtn) {
                    const key = varBtn.getAttribute('data-event-key');
                    const targetField = varBtn.getAttribute('data-target-field');
                    const varToken = varBtn.getAttribute('data-insert-var');
                    const textarea = listEl.querySelector(`textarea[data-event-key="${key}"][data-field="${targetField}"]`);
                    if (textarea && varToken) {
                        this.insertAtCursor(textarea, varToken);
                        if (this.config?.regras?.[key]) {
                            this.config.regras[key][targetField] = textarea.value;
                            this.updateServiceCardPreview(key);
                        }
                    }
                    return;
                }

                const resetBtn = e.target.closest('[data-reset-event]');
                if (resetBtn) {
                    const key = resetBtn.getAttribute('data-reset-event');
                    if (key) this.restoreDefaults(key);
                }
            });
        }

        // Eventos da aba de envio manual
        document.getElementById('msg-manual-preset')?.addEventListener('change', () => this.applyManualPreset());
        document.getElementById('msg-manual-destino')?.addEventListener('change', (e) => {
            const val = e.target.value;
            const alunoWrap = document.getElementById('msg-manual-aluno-wrap');
            const portalWrap = document.getElementById('msg-manual-portal-wrap');
            if (alunoWrap) alunoWrap.style.display = val === 'aluno' ? 'block' : 'none';
            if (portalWrap) portalWrap.style.display = val === 'todos_alunos' ? 'flex' : 'none';
        });
        document.getElementById('msg-manual-texto')?.addEventListener('input', () => this.updateManualPreview());
        document.getElementById('msg-manual-incluir-link')?.addEventListener('change', () => this.updateManualPreview());
        document.getElementById('btn-msg-manual-inserir-link')?.addEventListener('click', () => {
            const textarea = document.getElementById('msg-manual-texto');
            if (textarea) {
                this.insertAtCursor(textarea, '{link}');
                this.updateManualPreview();
            }
        });
        document.getElementById('form-msg-manual')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitManualMessage();
        });

        // Eventos da aba de Log de Envios e Cadastros Pendentes
        document.getElementById('btn-msg-recarregar-logs')?.addEventListener('click', () => this.loadLogsAndPendentes());
        document.getElementById('msg-logs-canal')?.addEventListener('change', () => this.loadLogs());
        document.getElementById('msg-logs-status')?.addEventListener('change', () => this.loadLogs());

        let logSearchTimer = null;
        document.getElementById('msg-logs-busca')?.addEventListener('input', () => {
            clearTimeout(logSearchTimer);
            logSearchTimer = setTimeout(() => this.loadLogs(), 250);
        });

        let pendSearchTimer = null;
        document.getElementById('msg-pendentes-busca')?.addEventListener('input', () => {
            clearTimeout(pendSearchTimer);
            pendSearchTimer = setTimeout(() => this.loadPendentes(), 250);
        });

        document.getElementById('lista-cadastros-pendentes')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-pendente-action]');
            if (!btn) return;
            const action = btn.getAttribute('data-pendente-action');
            const usuarioId = Number(btn.getAttribute('data-usuario-id'));
            if (!usuarioId) return;

            if (action === 'reenviar') {
                this.reenviarCodigoPendente(usuarioId, btn);
            } else if (action === 'corrigir') {
                const emailAtual = btn.getAttribute('data-email-atual') || '';
                this.corrigirEmailPendente(usuarioId, emailAtual);
            } else if (action === 'ativar') {
                this.ativarContaPendente(usuarioId, btn);
            }
        });
    },

    switchTab(tab) {
        const isServicos = tab === 'servicos';
        const isManual = tab === 'manual';
        const isLogs = tab === 'logs';

        const btnServ = document.getElementById('btn-tab-msg-servicos');
        const btnMan = document.getElementById('btn-tab-msg-manual');
        const btnLogs = document.getElementById('btn-tab-msg-logs');
        const paneServ = document.getElementById('tab-msg-servicos');
        const paneMan = document.getElementById('tab-msg-manual');
        const paneLogs = document.getElementById('tab-msg-logs');

        if (btnServ) btnServ.className = isServicos ? 'btn btn-primary' : 'btn btn-secondary';
        if (btnMan) btnMan.className = isManual ? 'btn btn-primary' : 'btn btn-secondary';
        if (btnLogs) btnLogs.className = isLogs ? 'btn btn-primary' : 'btn btn-secondary';
        if (paneServ) paneServ.style.display = isServicos ? 'block' : 'none';
        if (paneMan) paneMan.style.display = isManual ? 'block' : 'none';
        if (paneLogs) paneLogs.style.display = isLogs ? 'block' : 'none';

        if (isManual) {
            this.loadManualAlunos();
            this.updateManualPreview();
        } else if (isLogs) {
            this.loadLogsAndPendentes();
        }
    },

    insertAtCursor(textarea, token) {
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? textarea.value.length;
        const before = textarea.value.slice(0, start);
        const after = textarea.value.slice(end);
        textarea.value = `${before}${token}${after}`;
        textarea.focus();
        const nextPos = start + token.length;
        textarea.setSelectionRange(nextPos, nextPos);
    },

    async loadAll() {
        this.refreshWaSummary();
        try {
            const res = await API.get('/mensagens-config');
            if (!res?.success || !res.data) {
                throw new Error(res?.error || 'Falha ao carregar configurações de mensagens.');
            }
            this.config = res.data.config;
            this.catalog = Array.isArray(res.data.catalog) ? res.data.catalog : [];
            this.manualPresets = Array.isArray(res.data.manualPresets) ? res.data.manualPresets : [];

            this.fillGeneralFields();
            this.renderServicesList();
            this.populateManualPresets();
            this.loadManualAlunos();
            this.loadPendentes();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao carregar configurações de mensagens.', 'error');
        }
    },

    async refreshWaSummary(fromRetry = false) {
        const badge = document.getElementById('msg-page-wa-status');
        if (!badge) return;
        try {
            const res = await API.get('/whatsapp/status');
            const st = res?.data?.status || 'disconnected';
            if (st === 'connected') {
                const phone = res.data.connectedPhone ? ` (+${res.data.connectedPhone})` : '';
                badge.textContent = `WhatsApp: Conectado${phone}`;
                badge.style.background = 'rgba(34, 197, 94, 0.16)';
                badge.style.color = '#4ade80';
            } else if (st === 'connecting') {
                badge.textContent = 'WhatsApp: Reconectando...';
                badge.style.background = 'rgba(56, 189, 248, 0.16)';
                badge.style.color = '#38bdf8';
                if (!fromRetry) {
                    setTimeout(() => this.refreshWaSummary(true), 3500);
                }
            } else if (st === 'qr') {
                badge.textContent = 'WhatsApp: Aguardando QR Code';
                badge.style.background = 'rgba(245, 158, 11, 0.16)';
                badge.style.color = '#fbbf24';
            } else {
                badge.textContent = 'WhatsApp: Desconectado';
                badge.style.background = 'rgba(239, 68, 68, 0.14)';
                badge.style.color = '#fca5a5';
            }
        } catch {
            badge.textContent = 'WhatsApp: Indisponível';
            badge.style.background = 'rgba(148, 163, 184, 0.14)';
            badge.style.color = '#94a3b8';
        }
    },

    fillGeneralFields() {
        if (!this.config) return;
        const urlEl = document.getElementById('msg-cfg-portal-url');
        const linkEl = document.getElementById('msg-cfg-incluir-link');
        const waEl = document.getElementById('msg-cfg-admin-whatsapp');
        const mailEl = document.getElementById('msg-cfg-admin-email');

        if (urlEl) urlEl.value = this.config.portal_url || 'https://gestor.procombate.com';
        if (linkEl) linkEl.checked = Boolean(this.config.incluir_link_padrao);
        if (waEl) waEl.value = this.config.admin_whatsapp || '';
        if (mailEl) mailEl.value = this.config.admin_email || '';
    },

    getSamplePortalUrl() {
        const raw = document.getElementById('msg-cfg-portal-url')?.value?.trim() || this.config?.portal_url || 'https://gestor.procombate.com';
        return /^https?:\/\/[^\s<>"']+$/i.test(raw) ? raw.replace(/\/+$/, '') : 'https://gestor.procombate.com';
    },

    renderSamplePreview(template, includeLink) {
        const samples = {
            nome: 'Lucas',
            email: 'lucas@procombate.com',
            telefone: '(11) 99999-8888',
            dia_vencimento: '10',
            status: 'Ativo',
            detalhe: 'Atualizado pela academia',
            valor: 'R$ 150,00',
            metodo: 'PIX',
            percentual: '92',
            minimo: '70',
            observacoes: 'Excelente evolução técnica!',
            clinch: '9.0',
            socos: '8.5',
            chutes: '9.0',
            postura: '9.5',
            graduacao: 'Prajied Amarelo',
            evento: 'Exame de Graduação 2026',
            data: '12/12/2026',
            horario: '17:00',
            local: 'PRO COMBATE',
            motivo: 'Viagem na data do evento'
        };

        let text = String(template || '');
        const portalUrl = this.getSamplePortalUrl();
        for (const [k, v] of Object.entries(samples)) {
            text = text.split(`{${k}}`).join(v);
        }

        const hasPlaceholder = text.includes('{link}');
        if (includeLink) {
            text = hasPlaceholder
                ? text.split('{link}').join(portalUrl)
                : `${text.trimEnd()}\n\n🔗 Acesse o sistema: ${portalUrl}`;
        } else {
            text = text.split('{link}').join('');
        }

        return text.replace(/\n{3,}/g, '\n\n').trim();
    },

    updateServiceCardPreview(key) {
        const ev = this.catalog.find(item => item.key === key);
        const rule = this.config?.regras?.[key];
        if (!ev || !rule) return;

        const includeLinkGlobal = document.getElementById('msg-cfg-incluir-link')?.checked !== false;
        const includeLink = Boolean(includeLinkGlobal && rule.incluir_link);

        const prevAlunoEl = document.getElementById(`msg-prev-aluno-${key}`);
        if (prevAlunoEl) {
            prevAlunoEl.textContent = this.renderSamplePreview(rule.mensagem_aluno, includeLink);
        }
        const prevAdminEl = document.getElementById(`msg-prev-admin-${key}`);
        if (prevAdminEl) {
            prevAdminEl.textContent = this.renderSamplePreview(rule.mensagem_admin, includeLink);
        }
    },

    updateAllServicePreviews() {
        for (const ev of this.catalog) {
            this.updateServiceCardPreview(ev.key);
        }
    },

    renderServicesList() {
        const container = document.getElementById('lista-servicos-mensagens');
        if (!container || !this.config) return;

        const filtered = this.catalog.filter(ev => {
            if (this.filterPublico === 'aluno' && !ev.supportsAluno) return false;
            if (this.filterPublico === 'admin' && !ev.supportsAdmin) return false;
            if (this.filterBusca) {
                const hay = `${ev.titulo} ${ev.categoria} ${ev.descricao}`.toLowerCase();
                if (!hay.includes(this.filterBusca)) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            container.innerHTML = `<div class="card" style="padding: 28px; text-align: center; color: var(--text-muted);">Nenhum serviço encontrado para o filtro selecionado.</div>`;
            return;
        }

        const includeLinkGlobal = Boolean(this.config.incluir_link_padrao);

        container.innerHTML = filtered.map(ev => {
            const rule = this.config.regras?.[ev.key] || ev.defaults;
            const keySafe = UI.escapeHtml(ev.key);
            const includeLink = Boolean(includeLinkGlobal && rule.incluir_link);

            const badgesPublico = [
                ev.supportsAluno ? `<span style="font-size: 11px; padding: 3px 8px; border-radius: 999px; background: rgba(34, 197, 94, 0.14); color: #4ade80; font-weight: 700;">Aluno</span>` : '',
                ev.supportsAdmin ? `<span style="font-size: 11px; padding: 3px 8px; border-radius: 999px; background: rgba(249, 115, 22, 0.16); color: #fb923c; font-weight: 700;">Admin</span>` : ''
            ].filter(Boolean).join(' ');

            const varChips = (ev.variaveis || []).map(v => `
                <button type="button" class="btn btn-secondary btn-sm"
                    data-event-key="${keySafe}"
                    data-target-field="${ev.supportsAluno ? 'mensagem_aluno' : 'mensagem_admin'}"
                    data-insert-var="${UI.escapeHtml(v)}"
                    style="padding: 2px 8px; font-size: 11px; font-family: monospace;">
                    ${UI.escapeHtml(v)}
                </button>
            `).join('');

            const alunoPanelHtml = ev.supportsAluno ? `
                <div style="background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 14px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;">
                        <strong style="font-size: 13px; color: #4ade80;">Envio para o Aluno</strong>
                        <div style="display: flex; gap: 14px; flex-wrap: wrap;">
                            <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #e2e8f0; cursor: pointer;">
                                <input type="checkbox" data-event-key="${keySafe}" data-field="aluno_whatsapp" ${rule.aluno_whatsapp ? 'checked' : ''} style="accent-color: #22c55e;">
                                <span>WhatsApp</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #e2e8f0; cursor: pointer;">
                                <input type="checkbox" data-event-key="${keySafe}" data-field="aluno_email" ${rule.aluno_email ? 'checked' : ''} style="accent-color: #38bdf8;">
                                <span>E-mail</span>
                            </label>
                        </div>
                    </div>
                    <textarea class="form-input" rows="4" data-event-key="${keySafe}" data-field="mensagem_aluno" maxlength="2500" style="font-size: 13px; line-height: 1.45; resize: vertical;">${UI.escapeHtml(rule.mensagem_aluno || '')}</textarea>
                    <div style="margin-top: 8px;">
                        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Prévia (Aluno):</div>
                        <div id="msg-prev-aluno-${keySafe}" style="font-size: 12px; color: #cbd5e1; background: rgba(15, 23, 42, 0.65); padding: 10px; border-radius: 8px; white-space: pre-wrap;">${UI.escapeHtml(this.renderSamplePreview(rule.mensagem_aluno, includeLink))}</div>
                    </div>
                </div>
            ` : '';

            const adminPanelHtml = ev.supportsAdmin ? `
                <div style="background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 14px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;">
                        <strong style="font-size: 13px; color: #fb923c;">Alerta para o Admin</strong>
                        <div style="display: flex; gap: 14px; flex-wrap: wrap;">
                            <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #e2e8f0; cursor: pointer;">
                                <input type="checkbox" data-event-key="${keySafe}" data-field="admin_whatsapp" ${rule.admin_whatsapp ? 'checked' : ''} style="accent-color: #22c55e;">
                                <span>WhatsApp Admin</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #e2e8f0; cursor: pointer;">
                                <input type="checkbox" data-event-key="${keySafe}" data-field="admin_email" ${rule.admin_email ? 'checked' : ''} style="accent-color: #38bdf8;">
                                <span>E-mail Admin</span>
                            </label>
                        </div>
                    </div>
                    <textarea class="form-input" rows="4" data-event-key="${keySafe}" data-field="mensagem_admin" maxlength="2500" style="font-size: 13px; line-height: 1.45; resize: vertical;">${UI.escapeHtml(rule.mensagem_admin || '')}</textarea>
                    <div style="margin-top: 8px;">
                        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Prévia (Admin):</div>
                        <div id="msg-prev-admin-${keySafe}" style="font-size: 12px; color: #cbd5e1; background: rgba(15, 23, 42, 0.65); padding: 10px; border-radius: 8px; white-space: pre-wrap;">${UI.escapeHtml(this.renderSamplePreview(rule.mensagem_admin, includeLink))}</div>
                    </div>
                </div>
            ` : '';

            return `
                <div class="card" style="padding: 18px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 12px;">
                        <div>
                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
                                <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8;">${UI.escapeHtml(ev.categoria)}</span>
                                ${badgesPublico}
                            </div>
                            <h4 style="margin: 0; font-size: 15px; color: #ffffff; font-weight: 700;">${UI.escapeHtml(ev.titulo)}</h4>
                            <p style="margin: 4px 0 0 0; font-size: 12px; color: var(--text-muted);">${UI.escapeHtml(ev.descricao)}</p>
                        </div>
                        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                            <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #f8fafc; background: rgba(249, 115, 22, 0.12); border: 1px solid rgba(249, 115, 22, 0.28); padding: 6px 10px; border-radius: 8px; cursor: pointer;">
                                <input type="checkbox" data-event-key="${keySafe}" data-field="incluir_link" ${rule.incluir_link ? 'checked' : ''} style="accent-color: #f97316;">
                                <span>Enviar link gestor.procombate.com</span>
                            </label>
                            <button type="button" class="btn btn-secondary btn-sm" data-reset-event="${keySafe}" title="Restaurar textos originais deste serviço">
                                Restaurar Padrão
                            </button>
                        </div>
                    </div>

                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 12px;">
                        <span style="font-size: 11px; color: var(--text-muted);">Variáveis disponíveis (clique para inserir):</span>
                        ${varChips}
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 14px;">
                        ${alunoPanelHtml}
                        ${adminPanelHtml}
                    </div>
                </div>
            `;
        }).join('');
    },

    async saveConfig() {
        if (!this.config) return;
        const btn = document.getElementById('btn-msg-salvar-config');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Salvando...';
        }

        try {
            const payload = {
                portal_url: document.getElementById('msg-cfg-portal-url')?.value?.trim() || 'https://gestor.procombate.com',
                incluir_link_padrao: document.getElementById('msg-cfg-incluir-link')?.checked !== false,
                admin_whatsapp: document.getElementById('msg-cfg-admin-whatsapp')?.value?.trim() || '',
                admin_email: document.getElementById('msg-cfg-admin-email')?.value?.trim() || '',
                regras: this.config.regras
            };

            const res = await API.put('/mensagens-config', payload);
            if (!res?.success) {
                throw new Error(res?.error || 'Falha ao salvar configurações.');
            }
            this.config = res.data;
            this.fillGeneralFields();
            this.updateAllServicePreviews();
            UI.showToast(res.message || 'Configurações salvas com sucesso!', 'success');
        } catch (err) {
            UI.showToast(err.message || 'Erro ao salvar configurações.', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Salvar Configurações';
            }
        }
    },

    async restoreDefaults(eventKey = null) {
        const msg = eventKey
            ? 'Restaurar as opções e o texto predefinido deste serviço?'
            : 'Restaurar todos os serviços para as mensagens e marcações predefinidas?';
        if (!confirm(msg)) return;

        try {
            const res = await API.post('/mensagens-config/restaurar-padrao', { event_key: eventKey });
            if (!res?.success) {
                throw new Error(res?.error || 'Falha ao restaurar padrões.');
            }
            this.config = res.data;
            this.fillGeneralFields();
            this.renderServicesList();
            UI.showToast(res.message || 'Textos padrão restaurados!', 'success');
        } catch (err) {
            UI.showToast(err.message || 'Erro ao restaurar padrões.', 'error');
        }
    },

    populateManualPresets() {
        const select = document.getElementById('msg-manual-preset');
        if (!select) return;
        select.innerHTML = `<option value="">-- Escolha um modelo predefinido --</option>`;
        for (const preset of this.manualPresets) {
            const opt = document.createElement('option');
            opt.value = preset.id;
            opt.textContent = preset.nome;
            select.appendChild(opt);
        }
        if (this.manualPresets.length > 0 && !document.getElementById('msg-manual-texto')?.value) {
            select.value = this.manualPresets[0].id;
            this.applyManualPreset();
        }
    },

    applyManualPreset() {
        const presetId = document.getElementById('msg-manual-preset')?.value;
        if (!presetId) return;
        const preset = this.manualPresets.find(p => p.id === presetId);
        if (!preset) return;

        const tituloEl = document.getElementById('msg-manual-titulo');
        const textoEl = document.getElementById('msg-manual-texto');
        const linkEl = document.getElementById('msg-manual-incluir-link');

        if (tituloEl) tituloEl.value = preset.titulo || '';
        if (textoEl) textoEl.value = preset.mensagem || '';
        if (linkEl && preset.incluir_link !== undefined) linkEl.checked = Boolean(preset.incluir_link);
        this.updateManualPreview();
    },

    updateManualPreview() {
        const previewEl = document.getElementById('msg-manual-preview');
        const texto = document.getElementById('msg-manual-texto')?.value || '';
        const incluirLink = document.getElementById('msg-manual-incluir-link')?.checked !== false;
        if (!previewEl) return;
        previewEl.textContent = this.renderSamplePreview(texto, incluirLink);
    },

    async loadManualAlunos() {
        const select = document.getElementById('msg-manual-aluno-id');
        if (!select) return;

        try {
            let lista = (window.AlunosModule && Array.isArray(AlunosModule.alunosData) && AlunosModule.alunosData.length > 0)
                ? AlunosModule.alunosData
                : [];
            if (lista.length === 0) {
                const res = await API.get('/alunos?status=ativo');
                if (res?.success && Array.isArray(res.data)) {
                    lista = res.data;
                }
            }

            select.innerHTML = `<option value="">-- Selecione um aluno --</option>`;
            const ordenados = [...lista]
                .filter(a => a && a.id)
                .sort((a, b) => String(a.nome_completo || '').localeCompare(String(b.nome_completo || ''), 'pt-BR'));

            for (const aluno of ordenados) {
                const opt = document.createElement('option');
                opt.value = String(aluno.id);
                const contato = aluno.telefone_whatsapp || aluno.email || 'sem contato';
                opt.textContent = `${aluno.nome_completo} (${contato})`;
                select.appendChild(opt);
            }
        } catch (err) {
            console.warn('[MensagensConfig] Erro ao carregar alunos:', err.message);
        }
    },

    async submitManualMessage() {
        const btn = document.getElementById('btn-enviar-msg-manual');
        const destinoTipo = document.getElementById('msg-manual-destino')?.value || 'todos_alunos';
        const alunoId = document.getElementById('msg-manual-aluno-id')?.value || '';
        const enviarWhatsapp = document.getElementById('msg-manual-wa')?.checked === true;
        const enviarEmail = document.getElementById('msg-manual-email')?.checked === true;
        const incluirLink = document.getElementById('msg-manual-incluir-link')?.checked !== false;
        const publicarNoPortal = document.getElementById('msg-manual-publicar-portal')?.checked === true;
        const titulo = document.getElementById('msg-manual-titulo')?.value?.trim() || '';
        const mensagem = document.getElementById('msg-manual-texto')?.value?.trim() || '';

        if (!enviarWhatsapp && !enviarEmail) {
            UI.showToast('Selecione pelo menos um canal (WhatsApp ou E-mail).', 'warning');
            return;
        }
        if (destinoTipo === 'aluno' && !alunoId) {
            UI.showToast('Selecione o aluno destinatário.', 'warning');
            return;
        }
        if (!titulo || !mensagem) {
            UI.showToast('Preencha o título e o texto da mensagem.', 'warning');
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Enviando...';
        }

        try {
            const res = await API.post('/mensagens-config/enviar-manual', {
                destino_tipo: destinoTipo,
                aluno_id: destinoTipo === 'aluno' ? Number(alunoId) : null,
                enviar_whatsapp: enviarWhatsapp,
                enviar_email: enviarEmail,
                incluir_link: incluirLink,
                publicar_no_portal: destinoTipo === 'todos_alunos' && publicarNoPortal,
                titulo,
                mensagem
            });

            if (!res?.success) {
                throw new Error(res?.error || 'Falha ao enviar mensagem.');
            }
            UI.showToast(res.message || 'Mensagem enviada com sucesso!', 'success');
        } catch (err) {
            UI.showToast(err.message || 'Erro ao enviar mensagem.', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Enviar Mensagem Agora';
            }
        }
    },

    async loadLogsAndPendentes() {
        await Promise.allSettled([this.loadPendentes(), this.loadLogs()]);
    },

    async loadPendentes() {
        const container = document.getElementById('lista-cadastros-pendentes');
        const busca = document.getElementById('msg-pendentes-busca')?.value?.trim() || '';
        try {
            const qs = busca ? `?busca=${encodeURIComponent(busca)}` : '';
            const res = await API.get(`/mensagens-config/pendentes${qs}`);
            if (!res?.success) throw new Error(res?.error || 'Falha ao carregar pendentes.');

            const lista = Array.isArray(res.data) ? res.data : [];
            const badge = document.getElementById('badge-msg-pendentes');
            if (badge && !busca) {
                if (lista.length > 0) {
                    badge.textContent = String(lista.length);
                    badge.style.display = 'inline-block';
                } else {
                    badge.style.display = 'none';
                }
            }

            if (container) this.renderPendentes(lista);
        } catch (err) {
            if (container) {
                container.innerHTML = `<div style="padding: 16px; text-align: center; color: #fca5a5;">${UI.escapeHtml(err.message || 'Erro ao carregar pendentes.')}</div>`;
            }
        }
    },

    renderPendentes(lista) {
        const container = document.getElementById('lista-cadastros-pendentes');
        if (!container) return;

        if (!Array.isArray(lista) || lista.length === 0) {
            container.innerHTML = `<div style="padding: 18px; text-align: center; color: var(--text-muted); background: rgba(255,255,255,0.02); border-radius: 10px;">Nenhum cadastro pendente de confirmação de e-mail no momento.</div>`;
            return;
        }

        container.innerHTML = lista.map(item => {
            const uid = Number(item.usuario_id);
            const dataCad = item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : '-';
            const ultimoEnvio = item.ultimo_envio_codigo ? new Date(item.ultimo_envio_codigo).toLocaleString('pt-BR') : 'Nenhum';
            const tentativas = Number(item.tentativas_codigo || 0);

            return `
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 14px; flex-wrap: wrap; padding: 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;">
                    <div style="min-width: 230px; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <strong style="color: #ffffff; font-size: 14px;">${UI.escapeHtml(item.nome_completo)}</strong>
                            <span style="font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(245, 158, 11, 0.16); color: #fbbf24;">Aguardando Confirmação</span>
                        </div>
                        <div style="font-size: 13px; color: #38bdf8; margin-top: 4px; word-break: break-all;">
                            ${UI.escapeHtml(item.email)}
                        </div>
                        <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 4px;">
                            WhatsApp: ${UI.escapeHtml(item.telefone_whatsapp || 'Não informado')} • Cadastrado em: ${UI.escapeHtml(dataCad)} • Códigos gerados: ${tentativas} (Último: ${UI.escapeHtml(ultimoEnvio)})
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button type="button" class="btn btn-secondary btn-sm"
                            data-pendente-action="corrigir"
                            data-usuario-id="${uid}"
                            data-email-atual="${UI.escapeHtml(item.email)}">
                            Corrigir E-mail
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm"
                            data-pendente-action="reenviar"
                            data-usuario-id="${uid}">
                            Reenviar Código
                        </button>
                        <button type="button" class="btn btn-primary btn-sm"
                            data-pendente-action="ativar"
                            data-usuario-id="${uid}"
                            style="background: #16a34a; border-color: #16a34a;">
                            Ativar Conta
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    async reenviarCodigoPendente(usuarioId, btnEl) {
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.textContent = 'Enviando...';
        }
        try {
            const res = await API.post(`/mensagens-config/pendentes/${usuarioId}/reenviar`, {});
            if (!res?.success) throw new Error(res?.error || 'Falha ao reenviar código.');
            UI.showToast(res.message, res.enviado ? 'success' : 'warning');
            await this.loadLogsAndPendentes();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao reenviar código.', 'error');
        } finally {
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.textContent = 'Reenviar Código';
            }
        }
    },

    async corrigirEmailPendente(usuarioId, emailAtual) {
        const novoEmail = prompt('Digite o e-mail corrigido para este aluno:', emailAtual || '');
        if (novoEmail === null) return;
        const cleanEmail = novoEmail.trim();
        if (!cleanEmail) return;

        try {
            const res = await API.post(`/mensagens-config/pendentes/${usuarioId}/corrigir-email`, {
                novo_email: cleanEmail,
                reenviar_codigo: true
            });
            if (!res?.success) throw new Error(res?.error || 'Falha ao corrigir e-mail.');
            UI.showToast(res.message, res.enviado ? 'success' : 'warning');
            await this.loadLogsAndPendentes();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao corrigir e-mail.', 'error');
        }
    },

    async ativarContaPendente(usuarioId, btnEl) {
        if (!confirm('Confirmar manualmente o e-mail e liberar acesso imediato para este aluno?')) return;
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.textContent = 'Ativando...';
        }
        try {
            const res = await API.post(`/mensagens-config/pendentes/${usuarioId}/ativar`, {});
            if (!res?.success) throw new Error(res?.error || 'Falha ao ativar cadastro.');
            UI.showToast(res.message || 'Conta ativada com sucesso!', 'success');
            await this.loadPendentes();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao ativar cadastro.', 'error');
        } finally {
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.textContent = 'Ativar Conta';
            }
        }
    },

    async loadLogs() {
        const tbody = document.getElementById('tabela-logs-envios-corpo');
        if (!tbody) return;

        const canal = document.getElementById('msg-logs-canal')?.value || '';
        const status = document.getElementById('msg-logs-status')?.value || '';
        const busca = document.getElementById('msg-logs-busca')?.value?.trim() || '';

        const params = new URLSearchParams();
        if (canal) params.set('canal', canal);
        if (status) params.set('status', status);
        if (busca) params.set('busca', busca);
        params.set('limit', '100');

        try {
            const res = await API.get(`/mensagens-config/logs?${params.toString()}`);
            if (!res?.success || !res.data) throw new Error(res?.error || 'Falha ao carregar logs.');
            this.renderLogs(res.data.logs || [], res.data.stats || {});
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #fca5a5;">${UI.escapeHtml(err.message || 'Erro ao carregar histórico.')}</td></tr>`;
        }
    },

    renderLogs(logs, stats) {
        const tbody = document.getElementById('tabela-logs-envios-corpo');
        if (!tbody) return;

        const envEl = document.getElementById('logs-stat-enviados');
        const errEl = document.getElementById('logs-stat-erros');
        const ignEl = document.getElementById('logs-stat-ignorados');
        if (envEl) envEl.textContent = `Enviados (30d): ${Number(stats.enviados || 0)}`;
        if (errEl) errEl.textContent = `Erros (30d): ${Number(stats.erros || 0)}`;
        if (ignEl) ignEl.textContent = `Ignorados (30d): ${Number(stats.ignorados || 0)}`;

        if (!Array.isArray(logs) || logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">Nenhum registro de envio encontrado.</td></tr>`;
            return;
        }

        const statusBadges = {
            enviado: { bg: 'rgba(34, 197, 94, 0.16)', color: '#4ade80', label: 'Enviado' },
            simulado: { bg: 'rgba(56, 189, 248, 0.16)', color: '#38bdf8', label: 'Simulado' },
            ignorado: { bg: 'rgba(245, 158, 11, 0.16)', color: '#fbbf24', label: 'Ignorado' },
            erro: { bg: 'rgba(239, 68, 68, 0.18)', color: '#fca5a5', label: 'Erro' }
        };

        tbody.innerHTML = logs.map(row => {
            const dt = row.created_at ? new Date(row.created_at).toLocaleString('pt-BR') : '-';
            const st = statusBadges[row.status] || statusBadges.erro;
            const canalBadge = row.canal === 'whatsapp'
                ? `<span style="font-size: 11px; font-weight: 700; color: #4ade80;">WhatsApp</span>`
                : `<span style="font-size: 11px; font-weight: 700; color: #38bdf8;">E-mail</span>`;

            const detalhe = row.erro_detalhe
                ? `<span style="color: ${row.status === 'erro' ? '#fca5a5' : '#cbd5e1'};">${UI.escapeHtml(row.erro_detalhe)}</span>`
                : (row.message_id ? `<span style="color: var(--text-muted); font-size: 11px;">ID: ${UI.escapeHtml(row.message_id)}</span>` : '<span style="color: var(--text-muted);">-</span>');

            return `
                <tr>
                    <td style="white-space: nowrap; font-size: 12px;">${UI.escapeHtml(dt)}</td>
                    <td>${canalBadge}</td>
                    <td style="font-size: 12.5px; word-break: break-all;">${UI.escapeHtml(row.destinatario)}</td>
                    <td style="font-size: 12.5px;">
                        <div>${UI.escapeHtml(row.assunto || '-')}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${UI.escapeHtml(row.tipo || '')}</div>
                    </td>
                    <td>
                        <span style="font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: ${st.bg}; color: ${st.color};">
                            ${UI.escapeHtml(st.label)}
                        </span>
                    </td>
                    <td style="font-size: 12px; max-width: 280px; word-break: break-word;">${detalhe}</td>
                </tr>
            `;
        }).join('');
    }
};

window.MensagensConfigModule = MensagensConfigModule;
