const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pool = require('../db/connection');

const AUTH_DIR = path.join(__dirname, '../storage/whatsapp-auth');

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
        this.connectPromise = null;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.schemaChecked = false;
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
            lastError: this.lastError
        };
    }

    initAutoReconnect() {
        try {
            const credsPath = path.join(AUTH_DIR, 'creds.json');
            if (fs.existsSync(credsPath)) {
                console.log('📱 [WhatsApp] Sessão Baileys encontrada. Reconectando automaticamente...');
                this.connect().catch(err => {
                    console.warn('[WhatsApp] Falha na reconexão automática:', err.message);
                });
            }
        } catch (err) {
            console.warn('[WhatsApp] Erro ao verificar sessão salva:', err.message);
        }
    }

    async connect() {
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
                this.lastError = null;
                this.status = 'connecting';

                if (!fs.existsSync(AUTH_DIR)) {
                    fs.mkdirSync(AUTH_DIR, { recursive: true });
                }

                const {
                    default: makeWASocket,
                    useMultiFileAuthState,
                    DisconnectReason,
                    fetchLatestBaileysVersion
                } = await this.loadBaileys();

                const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
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
                    markOnlineOnConnect: false
                });

                this.sock = sock;
                sock.ev.on('creds.update', saveCreds);

                sock.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect, qr } = update;

                    if (qr) {
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
                        this.qrCodeDataUrl = null;
                        this.lastError = null;
                        this.reconnectAttempts = 0;
                        const rawId = sock.user?.id || '';
                        this.connectedPhone = rawId.split(':')[0].split('@')[0] || null;
                        this.connectedName = sock.user?.name || 'PRO COMBATE';
                        console.log(`✅ [WhatsApp] Conectado via Baileys (${this.connectedPhone || 'número vinculado'})`);
                    }

                    if (connection === 'close') {
                        const statusCode = lastDisconnect?.error?.output?.statusCode;
                        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

                        this.sock = null;
                        this.qrCodeDataUrl = null;

                        if (this.isManualDisconnect || isLoggedOut) {
                            this.status = 'disconnected';
                            this.connectedPhone = null;
                            this.connectedName = null;
                            if (isLoggedOut) {
                                this.lastError = 'Sessão desconectada no WhatsApp. Gere um novo QR Code para reconectar.';
                                this.clearAuthDir();
                            }
                            return;
                        }

                        if (this.reconnectAttempts < 5) {
                            this.reconnectAttempts++;
                            this.status = 'connecting';
                            const delayMs = 3000 * this.reconnectAttempts;
                            this.reconnectTimer = setTimeout(() => {
                                this.connect().catch(() => {});
                            }, delayMs);
                        } else {
                            this.status = 'disconnected';
                            this.lastError = 'Não foi possível manter a conexão com o WhatsApp. Tente gerar um novo QR Code.';
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

    async disconnect() {
        this.isManualDisconnect = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.sock) {
            try { await this.sock.logout(); } catch {}
            try { this.sock.end(undefined); } catch {}
            this.sock = null;
        }
        this.clearAuthDir();
        this.status = 'disconnected';
        this.qrCodeDataUrl = null;
        this.connectedPhone = null;
        this.connectedName = null;
        this.lastError = null;
        return this.getStatus();
    }

    async sendTextMessage(phone, text) {
        if (this.status !== 'connected' || !this.sock) {
            return { success: false, skipped: true, reason: 'WhatsApp não conectado.' };
        }
        const digits = this.normalizePhoneToDigits(phone);
        if (!digits) {
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
            return { success: true, jid: targetJid };
        } catch (err) {
            console.warn(`[WhatsApp] Falha ao enviar mensagem para ${digits}:`, err.message);
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
                return { success: false, skipped: true, reason: 'Aluno optou por não receber WhatsApp.' };
            }

            const text = typeof messageBuilder === 'function' ? messageBuilder(aluno) : messageBuilder;
            return await this.sendTextMessage(aluno.telefone_whatsapp, text);
        } catch (err) {
            console.warn('[WhatsApp] Erro ao notificar aluno:', err.message);
            return { success: false, error: err.message };
        }
    }
}

const whatsappServiceInstance = new WhatsAppService();
module.exports = whatsappServiceInstance;
