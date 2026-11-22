/**
 * PRO COMBATE - Persistência de Sessão WhatsApp (Baileys Auth State) no MySQL
 * Evita perda de sessão após novos deploys na Hostinger ou reinicializações do servidor.
 * Credenciais são criptografadas em repouso com AES-256-GCM usando chave derivada do .env.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_SESSION_ID = 'default';
const ENC_PREFIX = 'enc:v1:';
const keyWriteQueues = new Map();

function deriveAesKey(secret) {
    if (!secret || typeof secret !== 'string' || !secret.trim()) {
        return null;
    }
    return crypto.createHash('sha256').update(secret.trim(), 'utf8').digest();
}

function encryptPayload(plaintext, secret) {
    const str = String(plaintext || '');
    const key = deriveAesKey(secret);
    if (!key) return str;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(str, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptPayload(stored, secret) {
    if (stored === null || stored === undefined) return null;
    const raw = String(stored);

    if (!raw.startsWith(ENC_PREFIX)) {
        return raw;
    }

    const key = deriveAesKey(secret);
    if (!key) return null;

    try {
        const parts = raw.slice(ENC_PREFIX.length).split(':');
        if (parts.length !== 3) return null;
        const iv = Buffer.from(parts[0], 'base64');
        const tag = Buffer.from(parts[1], 'base64');
        const ciphertext = Buffer.from(parts[2], 'base64');
        if (iv.length !== 12 || tag.length !== 16) return null;

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return decrypted.toString('utf8');
    } catch {
        return null;
    }
}

function runSerializedKeyWrite(lockKey, taskFn) {
    const prev = keyWriteQueues.get(lockKey) || Promise.resolve();
    const next = prev.catch(() => {}).then(taskFn);
    keyWriteQueues.set(lockKey, next);
    next.finally(() => {
        if (keyWriteQueues.get(lockKey) === next) {
            keyWriteQueues.delete(lockKey);
        }
    });
    return next;
}

async function ensureAuthTable(dbPool) {
    await dbPool.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_auth_state (
            session_id VARCHAR(64) NOT NULL DEFAULT 'default',
            data_key VARCHAR(191) NOT NULL,
            data_value LONGTEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (session_id, data_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function hasSavedSession(dbPool, sessionId = DEFAULT_SESSION_ID) {
    try {
        const [rows] = await dbPool.query(
            `SELECT 1 AS ok FROM whatsapp_auth_state WHERE session_id = ? AND data_key = 'creds' LIMIT 1`,
            [sessionId]
        );
        return rows.length > 0;
    } catch {
        return false;
    }
}

async function clearSavedSession(dbPool, sessionId = DEFAULT_SESSION_ID) {
    await dbPool.query('DELETE FROM whatsapp_auth_state WHERE session_id = ?', [sessionId]);
}

async function upsertKey(dbPool, sessionId, keyName, data, { baileys, secret }) {
    const json = JSON.stringify(data, baileys.BufferJSON.replacer);
    const stored = encryptPayload(json, secret);
    const lockKey = `${sessionId}:${keyName}`;
    return runSerializedKeyWrite(lockKey, async () => {
        await dbPool.query(
            `INSERT INTO whatsapp_auth_state (session_id, data_key, data_value)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE data_value = VALUES(data_value)`,
            [sessionId, keyName, stored]
        );
    });
}

async function readKey(dbPool, sessionId, keyName, { baileys, secret }) {
    const [rows] = await dbPool.query(
        'SELECT data_value FROM whatsapp_auth_state WHERE session_id = ? AND data_key = ? LIMIT 1',
        [sessionId, keyName]
    );
    if (!rows || rows.length === 0) return null;
    const plaintext = decryptPayload(rows[0].data_value, secret);
    if (!plaintext) return null;
    try {
        return JSON.parse(plaintext, baileys.BufferJSON.reviver);
    } catch {
        return null;
    }
}

async function removeKey(dbPool, sessionId, keyName) {
    const lockKey = `${sessionId}:${keyName}`;
    return runSerializedKeyWrite(lockKey, async () => {
        await dbPool.query(
            'DELETE FROM whatsapp_auth_state WHERE session_id = ? AND data_key = ?',
            [sessionId, keyName]
        );
    });
}

async function migrateLegacyDiskSessionIfNeeded(dbPool, authDir, { baileys, sessionId = DEFAULT_SESSION_ID, secret = '' } = {}) {
    if (!authDir || !baileys) return false;
    const alreadyInDb = await hasSavedSession(dbPool, sessionId);
    if (alreadyInDb) return false;

    const credsFile = path.join(authDir, 'creds.json');
    if (!fs.existsSync(credsFile)) return false;

    const files = fs.readdirSync(authDir).filter(f => f.endsWith('.json'));
    let migrated = 0;

    for (const file of files) {
        try {
            const raw = fs.readFileSync(path.join(authDir, file), 'utf8');
            const parsed = JSON.parse(raw, baileys.BufferJSON.reviver);
            const dataKey = file === 'creds.json' ? 'creds' : file.slice(0, -5);
            await upsertKey(dbPool, sessionId, dataKey, parsed, { baileys, secret });
            migrated++;
        } catch (err) {
            console.warn(`[WhatsApp] Falha ao migrar arquivo legado ${file}:`, err.message);
        }
    }

    if (migrated > 0) {
        console.log(`🔄 [WhatsApp] ${migrated} arquivo(s) de sessão legada migrado(s) do disco para o MySQL.`);
    }
    return migrated > 0;
}

async function useMysqlAuthState(dbPool, { baileys, sessionId = DEFAULT_SESSION_ID, secret = '' } = {}) {
    if (!baileys) {
        throw new Error('Módulo Baileys é obrigatório para useMysqlAuthState.');
    }

    const creds = (await readKey(dbPool, sessionId, 'creds', { baileys, secret })) || baileys.initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids = []) => {
                    const data = {};
                    if (!Array.isArray(ids) || ids.length === 0) return data;

                    const keyNames = ids.map(id => `${type}-${id}`);
                    const placeholders = keyNames.map(() => '?').join(', ');
                    const [rows] = await dbPool.query(
                        `SELECT data_key, data_value FROM whatsapp_auth_state WHERE session_id = ? AND data_key IN (${placeholders})`,
                        [sessionId, ...keyNames]
                    );

                    const rowMap = new Map();
                    for (const row of rows || []) {
                        rowMap.set(row.data_key, row.data_value);
                    }

                    for (const id of ids) {
                        const fullKey = `${type}-${id}`;
                        const rawVal = rowMap.get(fullKey);
                        let value = null;
                        if (rawVal !== undefined && rawVal !== null) {
                            const plain = decryptPayload(rawVal, secret);
                            if (plain) {
                                try {
                                    value = JSON.parse(plain, baileys.BufferJSON.reviver);
                                } catch {
                                    value = null;
                                }
                            }
                        }
                        if (type === 'app-state-sync-key' && value) {
                            value = baileys.proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }
                    return data;
                },
                set: async (data = {}) => {
                    const tasks = [];
                    for (const category of Object.keys(data || {})) {
                        const entries = data[category] || {};
                        for (const id of Object.keys(entries)) {
                            const value = entries[id];
                            const fullKey = `${category}-${id}`;
                            if (value) {
                                tasks.push(upsertKey(dbPool, sessionId, fullKey, value, { baileys, secret }));
                            } else {
                                tasks.push(removeKey(dbPool, sessionId, fullKey));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            return upsertKey(dbPool, sessionId, 'creds', creds, { baileys, secret });
        }
    };
}

module.exports = {
    DEFAULT_SESSION_ID,
    encryptPayload,
    decryptPayload,
    ensureAuthTable,
    hasSavedSession,
    clearSavedSession,
    migrateLegacyDiskSessionIfNeeded,
    useMysqlAuthState
};
