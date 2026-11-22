const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pool = require('../db/connection');
const messageLogService = require('./messageLogService');
const whatsappAuthStore = require('./whatsappAuthStore');

const AUTH_DIR = path.join(__dirname, '../storage/whatsapp-auth');
const MAX_RECONNECT_ATTEMPTS = 12;

const silentLogger = {
    level: 'silent',
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    child() { return this; }
};

function computeReconnectDelayMs(attempt, { isConflict = false } = {}) {
    const safeAttempt = Math.max(1, Number(attempt) || 1);
    if (isConflict) {
        return Math.min(60000, 15000 * safeAttempt);
    }
    const schedule = [2000, 4000, 8000, 15000, 30000, 60000];
    return schedule[Math.min(safeAttempt - 1, schedule.length - 1)];
}

class WhatsAppService {
    constructor() {
        this.baileys = null;
        this.sock = null;
        this.status = 'disconnected'; // disconnected | connecting | qr | connected
        this.qrCodeDataUrl = null;
        this.connectedPhone = null;
        this.connectedName = null;
        this.lastError = null;
        this.isManualDisconnect = false;
        this.isShuttingDown = false;
        this.abortAutoReconnectOnQr = false;
        this.hasSavedSession = false;
        this.autoReconnectStarted = false;
        this.authTableReady = false;
        this.connectPromise = null;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.schemaChecked = false;
    }

    getAuthSecret() {
        return process.env.WHATSAPP_AUTH_SECRET || process.env.JWT_SECRET || '';
    }

    computeReconnectDelayMs(attempt, opts) {
        return computeReconnectDelayMs(attempt, opts);
    }

    async loadBaileys() {
        if (!this.baileys) {
            this.baileys = await import('@whiskeysockets/baileys');
        }
        return this.baileys;
    }

    async ensureWhatsAppColumn() {
        if (this.schemaChecked) return;
        try {
            const dbName = process.env.DB_NAME || 'sistema_pro';
            const [rows] = await pool.query(
                `SELECT COUNT(*) AS count
                 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'alunos' AND COLUMN_NAME = 'receber_whatsapp'`,
                [dbName]
            );
            if (rows[0].count === 0) {
                await pool.query(
                    'ALTER TABLE `alunos` ADD COLUMN `receber_whatsapp` TINYINT(1) NOT NULL DEFAULT 1 AFTER `telefone_whatsapp`'
                );
                console.log('🔧 [WhatsApp] Coluna receber_whatsapp adicionada na tabela alunos.');
            }
            this.schemaChecked = true;
        } catch (err) {
            console.warn('[WhatsApp] Aviso ao verificar coluna receber_whatsapp:', err.message);
        }
    }

    async ensureAuthStorageReady() {
        if (!this.authTableReady) {
            await whatsappAuthStore.ensureAuthTable(pool);
            this.authTableReady = true;
        }
        if (fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
            const baileys = await this.loadBaileys();
            await whatsappAuthStore.migrateLegacyDiskSessionIfNeeded(pool, AUTH_DIR, {
                baileys,
                secret: this.getAuthSecret()
            });
        }
    }

    async hasSavedCredentials() {
        await this.ensureAuthStorageReady();
        const saved = await whatsappAuthStore.hasSavedSession(pool);
        this.hasSavedSession = saved;
        return saved;
    }

    normalizePhoneToDigits(phone) {
        if (!phone) return null;
        const digits = String(phone).replace(/\D/g, '');
        if (digits.length < 10) return null;
        if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
            return `55${digits}`;
        }
        return digits;
    }

    getStatus() {
        return {
            status: this.status,
            qrCodeDataUrl: this.qrCodeDataUrl,
            connectedPhone: this.connectedPhone,
            connectedName: this.connectedName,
            lastError: this.lastError,
            hasSavedSession: Boolean(this.hasSavedSession)
        };
    }

    initAutoReconnect() {
        if (process.env.NODE_ENV === 'test' || this.autoReconnectStarted || this.isShuttingDown) {
            return;
        }
        this.autoReconnectStarted = true;

        (async () => {
            try {
                const hasSaved = await this.hasSavedCredentials();
                if (hasSaved && !this.isManualDisconnect && !this.isShuttingDown) {
                    console.log('📱 [WhatsApp] Sessão persistida no MySQL encontrada. Reconectando automaticamente...');
                    await this.connect({ autoReconnect: true });
                }
            } catch (err) {
                console.warn('[WhatsApp] Falha ao verificar/reconectar sessão salva:', err.message);
            }
        })();
    }

    async ensureConnectedIfSaved({ waitMs = 0 } = {}) {
        if (process.env.NODE_ENV === 'test') {
            return this.status === 'connected' && Boolean(this.sock);
        }
        if (this.status === 'connected' && this.sock) {
            return true;
        }
        if (this.isManualDisconnect || this.isShuttingDown) {
            return false;
        }

        if (this.status === 'disconnected') {
            try {
                const hasSaved = await this.hasSavedCredentials();
                if (!hasSaved) return false;
                this.connect({ autoReconnect: true }).catch(() => {});
            } catch {
                return false;
            }
        }

        if (waitMs > 0) {
            const deadline = Date.now() + waitMs;
            while (Date.now() < deadline && this.status === 'connecting' && !this.isShuttingDown) {
                await new Promise(resolve => setTimeout(resolve, 250));
                if (this.status === 'connected' && this.sock) {
                    return true;
                }
            }
        }

        return this.status === 'connected' && Boolean(this.sock);
    }

    async connect({ autoReconnect = false } = {}) {
        if (this.status === 'connected' && this.sock) {
            return this.getStatus();
        }
        if (this.connectPromise) {
            return this.connectPromise;
        }

        this.connectPromise = (async () => {
            try {
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }

                this.isManualDisconnect = false;
                this.isShuttingDown = false;
                this.abortAutoReconnectOnQr = false;
                this.lastError = null;
                this.status = 'connecting';

                await this.ensureAuthStorageReady();
                const baileys = await this.loadBaileys();
                const {
                    default: makeWASocket,
                    DisconnectReason,
                    fetchLatestBaileysVersion
                } = baileys;

                const { state, saveCreds } = await whatsappAuthStore.useMysqlAuthState(pool, {
                    baileys,
                    secret: this.getAuthSecret()
                });
                let version;
                try {
                    const latest = await fetchLatestBaileysVersion();
                    version = latest?.version;
                } catch {
                    version = undefined;
                }

                if (this.sock) {
                    try { this.sock.end(undefined); } catch {}
                    this.sock = null;
                }

                const sock = makeWASocket({
                    ...(version ? { version } : {}),
                    auth: state,
                    logger: silentLogger,
                    printQRInTerminal: false,
                    browser: ['PRO COMBATE', 'Chrome', '1.0.0'],
                    markOnlineOnConnect: false,
                    keepAliveIntervalMs: 25000,
                    connectTimeoutMs: 30000,
                    syncFullHistory: false
                });

                this.sock = sock;
                sock.ev.on('creds.update', saveCreds);

                sock.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect, qr } = update;

                    if (qr) {
                        if (autoReconnect) {
                            this.abortAutoReconnectOnQr = true;
                            this.qrCodeDataUrl = null;
                            this.status = 'disconnected';
                            this.lastError = 'Sessão do WhatsApp expirada. Clique em Conectar para ler um novo QR Code.';
                            if (this.reconnectTimer) {
                                clearTimeout(this.reconnectTimer);
                                this.reconnectTimer = null;
                            }
                            this.sock = null;
                            try { sock.end(undefined); } catch {}
                            return;
                        }
                        try {
                            this.qrCodeDataUrl = await QRCode.toDataURL(qr, { width: 260, margin: 1 });
                            this.status = 'qr';
                            this.lastError = null;
                        } catch (qrErr) {
                            console.warn('[WhatsApp] Erro ao gerar QR Code:', qrErr.message);
                        }
                    }

                    if (connection === 'open') {
                        this.status = 'connected';
                        this.hasSavedSession = true;
                        this.qrCodeDataUrl = null;
                        this.lastError = null;
                        this.reconnectAttempts = 0;
                        this.abortAutoReconnectOnQr = false;
                        const rawId = sock.user?.id || '';
                        this.connectedPhone = rawId.split(':')[0].split('@')[0] || null;
                        this.connectedName = sock.user?.name || 'PRO COMBATE';
                        console.log(`✅ [WhatsApp] Conectado via Baileys (${this.connectedPhone || 'número vinculado'})`);
                    }

                    if (connection === 'close') {
                        if (this.sock === sock) {
                            this.sock = null;
                        }
                        this.qrCodeDataUrl = null;

                        if (this.isShuttingDown) {
                            this.status = 'disconnected';
                            return;
                        }

                        if (this.abortAutoReconnectOnQr) {
                            this.abortAutoReconnectOnQr = false;
                            this.status = 'disconnected';
                            return;
                        }

                        const statusCode = lastDisconnect?.error?.output?.statusCode;
                        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
                        const isConflict = statusCode === DisconnectReason.replaced || statusCode === 440;

                        if (this.isManualDisconnect || isLoggedOut) {
                            this.status = 'disconnected';
                            this.connectedPhone = null;
                            this.connectedName = null;
                            if (isLoggedOut) {
                                this.lastError = 'Sessão desconectada no WhatsApp. Gere um novo QR Code para reconectar.';
                                this.hasSavedSession = false;
                                try { await whatsappAuthStore.clearSavedSession(pool); } catch {}
                                this.clearAuthDir();
                            }
                            return;
                        }

                        if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                            this.reconnectAttempts++;
                            this.status = 'connecting';
                            const delayMs = this.computeReconnectDelayMs(this.reconnectAttempts, { isConflict });
                            console.log(`🔄 [WhatsApp] Reconectando em ${Math.round(delayMs / 1000)}s (tentativa ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}${isConflict ? ', conflito de sessão' : ''})...`);
                            this.reconnectTimer = setTimeout(() => {
                                this.connect({ autoReconnect: true }).catch(() => {});
                            }, delayMs);
                            if (typeof this.reconnectTimer.unref === 'function') {
                                this.reconnectTimer.unref();
                            }
                        } else {
                            this.status = 'disconnected';
                            this.lastError = 'Não foi possível manter a conexão com o WhatsApp após múltiplas tentativas. Clique em Conectar para tentar novamente.';
                        }
                    }
                });

                return this.getStatus();
            } catch (err) {
                this.status = 'disconnected';
                this.lastError = err.message || 'Falha ao iniciar conexão com WhatsApp.';
                console.error('[WhatsApp] Erro ao conectar Baileys:', err.message);
                return this.getStatus();
            } finally {
                this.connectPromise = null;
            }
        })();

        return this.connectPromise;
    }

    clearAuthDir() {
        try {
            if (fs.existsSync(AUTH_DIR)) {
                fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            }
        } catch (err) {
            console.warn('[WhatsApp] Erro ao limpar credenciais:', err.message);
        }
    }

    shutdownGracefully() {
        this.isShuttingDown = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.sock) {
            try { this.sock.end(undefined); } catch {}
            this.sock = null;
        }
        this.status = 'disconnected';
    }

    async disconnect() {
        this.isManualDisconnect = true;
        this.hasSavedSession = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.sock) {
            try { await this.sock.logout(); } catch {}
            try { this.sock.end(undefined); } catch {}
            this.sock = null;
        }
        try { await whatsappAuthStore.clearSavedSession(pool); } catch {}
        this.clearAuthDir();
        this.status = 'disconnected';
        this.qrCodeDataUrl = null;
        this.connectedPhone = null;
        this.connectedName = null;
        this.lastError = null;
        return this.getStatus();
    }

    extractSummary(text) {
        if (!text) return null;
        const firstLine = String(text)
            .split(/\r?\n/)
            .map(l => l.trim())
            .find(Boolean) || '';
        return firstLine.replace(/\*+/g, '').slice(0, 120) || null;
    }

    async sendTextMessage(phone, text, tipo = 'whatsapp') {
        const summary = this.extractSummary(text);

        if (this.status !== 'connected' || !this.sock) {
            await this.ensureConnectedIfSaved({ waitMs: 8000 });
        }

        if (this.status !== 'connected' || !this.sock) {
            messageLogService.recordLog({
                canal: 'whatsapp',
                tipo,
                destinatario: String(phone || 'desconhecido'),
                assunto: summary,
                status: 'ignorado',
                erro_detalhe: 'WhatsApp não conectado.'
            }).catch(() => {});
            return { success: false, skipped: true, reason: 'WhatsApp não conectado.' };
        }
        const digits = this.normalizePhoneToDigits(phone);
        if (!digits) {
            messageLogService.recordLog({
                canal: 'whatsapp',
                tipo,
                destinatario: String(phone || 'desconhecido'),
                assunto: summary,
                status: 'ignorado',
                erro_detalhe: 'Número de WhatsApp inválido ou ausente.'
            }).catch(() => {});
            return { success: false, skipped: true, reason: 'Número de WhatsApp inválido ou ausente.' };
        }
        const cleanText = typeof text === 'string' ? text.trim() : '';
        if (!cleanText) {
            return { success: false, skipped: true, reason: 'Mensagem vazia.' };
        }

        try {
            let targetJid = `${digits}@s.whatsapp.net`;
            try {
                const check = await this.sock.onWhatsApp(digits);
                if (Array.isArray(check) && check[0]?.exists && check[0]?.jid) {
                    targetJid = check[0].jid;
                }
            } catch {
                // Usa JID padrão se consulta onWhatsApp falhar
            }

            await this.sock.sendMessage(targetJid, { text: cleanText });
            messageLogService.recordLog({
                canal: 'whatsapp',
                tipo,
                destinatario: digits,
                assunto: summary,
                status: 'enviado',
                message_id: targetJid
            }).catch(() => {});
            return { success: true, jid: targetJid };
        } catch (err) {
            console.warn(`[WhatsApp] Falha ao enviar mensagem para ${digits}:`, err.message);
            messageLogService.recordLog({
                canal: 'whatsapp',
                tipo,
                destinatario: digits,
                assunto: summary,
                status: 'erro',
                erro_detalhe: err.message
            }).catch(() => {});
            return { success: false, error: err.message };
        }
    }

    async notifyAluno(alunoId, messageBuilder) {
        try {
            await this.ensureWhatsAppColumn();
            const [rows] = await pool.query(
                'SELECT nome_completo, telefone_whatsapp, receber_whatsapp FROM alunos WHERE id = ? AND deleted_at IS NULL',
                [alunoId]
            );
            if (rows.length === 0) {
                return { success: false, skipped: true, reason: 'Aluno não encontrado.' };
            }
            const aluno = rows[0];
            if (aluno.receber_whatsapp === 0 || aluno.receber_whatsapp === false) {
                messageLogService.recordLog({
                    canal: 'whatsapp',
                    tipo: 'whatsapp_aluno',
                    destinatario: aluno.telefone_whatsapp || aluno.nome_completo,
                    assunto: 'Envio automático bloqueado por preferência',
                    status: 'ignorado',
                    erro_detalhe: 'Aluno optou por não receber WhatsApp.'
                }).catch(() => {});
                return { success: false, skipped: true, reason: 'Aluno optou por não receber WhatsApp.' };
            }

            const text = typeof messageBuilder === 'function' ? messageBuilder(aluno) : messageBuilder;
            return await this.sendTextMessage(aluno.telefone_whatsapp, text, 'whatsapp_aluno');
        } catch (err) {
            console.warn('[WhatsApp] Erro ao notificar aluno:', err.message);
            return { success: false, error: err.message };
        }
    }
}

const whatsappServiceInstance = new WhatsAppService();

if (process.env.NODE_ENV !== 'test') {
    const handleStopSignal = () => {
        whatsappServiceInstance.shutdownGracefully();
    };
    process.once('SIGTERM', handleStopSignal);
    process.once('SIGINT', handleStopSignal);
}

module.exports = whatsappServiceInstance;
