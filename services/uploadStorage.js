/**
 * PRO COMBATE - Persistência Híbrida de Uploads (Disco Local + Diretório Compartilhado + MySQL LONGBLOB)
 * Garante que GIFs e imagens da Wiki e fotos de alunos nunca desapareçam após novos deploys.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const pool = require('../db/connection');

const ALLOWED_FOLDERS = new Set(['wiki', 'alunos']);
const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9._-]+$/;
const MAX_DB_FILE_BYTES = 16 * 1024 * 1024; // 16MB

const APP_ROOT = path.resolve(__dirname, '..');
const PUBLIC_UPLOADS_DIR = path.join(APP_ROOT, 'public', 'uploads');
const PARENT_2 = path.resolve(__dirname, '..', '..');
const PARENT_3 = path.resolve(__dirname, '..', '..', '..');
const PARENT_4 = path.resolve(__dirname, '..', '..', '..', '..');
const IS_HOSTINGER_HBUILDS = path.basename(PARENT_3).toLowerCase() === 'hbuilds';

/**
 * Valida e normaliza URL pública no formato /uploads/<wiki|alunos>/<arquivo>
 */
function parseUploadUrl(urlPath) {
    if (!urlPath || typeof urlPath !== 'string') return null;
    const clean = urlPath.split('?')[0].split('#')[0].trim();
    const match = clean.match(/^\/uploads\/(wiki|alunos)\/([a-zA-Z0-9._-]+)$/);
    if (!match) return null;

    const folder = match[1];
    const filename = match[2];
    if (
        !ALLOWED_FOLDERS.has(folder) ||
        !SAFE_FILENAME_REGEX.test(filename) ||
        filename === '.' ||
        filename === '..' ||
        filename.startsWith('.') ||
        filename.includes('..')
    ) {
        return null;
    }

    return {
        folder,
        filename,
        urlPath: `/uploads/${folder}/${filename}`
    };
}

/**
 * Identifica o MIME type real a partir dos magic bytes do buffer
 */
function detectImageMimeFromBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return 'image/jpeg';
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer.length >= 8 &&
        buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
        buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
    ) {
        return 'image/png';
    }

    // WEBP: RIFF....WEBP
    if (
        buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
        return 'image/webp';
    }

    // GIF: GIF87a ou GIF89a
    if (buffer.length >= 6) {
        const sig = buffer.toString('ascii', 0, 6).toUpperCase();
        if (sig === 'GIF87A' || sig === 'GIF89A') {
            return 'image/gif';
        }
    }

    return null;
}

/**
 * Lê até 12 bytes de um arquivo em disco e retorna seu MIME type real
 */
function detectImageMimeFromFile(filePath) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const header = Buffer.alloc(12);
        const bytesRead = fs.readSync(fd, header, 0, 12, 0);
        fs.closeSync(fd);
        return detectImageMimeFromBuffer(header.subarray(0, bytesRead));
    } catch {
        return null;
    }
}

function getPersistentDirs() {
    const dirs = [];

    if (process.env.UPLOAD_SHARED_DIR) {
        dirs.push(path.resolve(process.env.UPLOAD_SHARED_DIR));
    } else if (IS_HOSTINGER_HBUILDS) {
        dirs.push(path.join(PARENT_3, 'shared_uploads'));
    }

    if (process.env.NODE_ENV !== 'test') {
        dirs.push(path.join(os.homedir(), '.sistema-pro-uploads'));
    }

    return Array.from(new Set(dirs));
}

function resolveSafeTargetPath(baseDir, folder, filename) {
    if (!baseDir || !ALLOWED_FOLDERS.has(folder) || !SAFE_FILENAME_REGEX.test(filename)) {
        return null;
    }
    const baseResolved = path.resolve(baseDir);
    const target = path.resolve(baseResolved, folder, path.basename(filename));
    if (!target.startsWith(baseResolved + path.sep)) {
        return null;
    }
    return target;
}

function writeBufferSafe(targetPath, buffer) {
    if (!targetPath || !Buffer.isBuffer(buffer)) return false;
    try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, buffer);
        return true;
    } catch {
        return false;
    }
}

function copyFileSafe(srcPath, destPath) {
    if (!srcPath || !destPath || path.resolve(srcPath) === path.resolve(destPath)) return true;
    try {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
        return true;
    } catch {
        return false;
    }
}

function unlinkSafe(targetPath) {
    if (!targetPath) return;
    try {
        if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
        }
    } catch {
        // ignore
    }
}

async function ensureUploadTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS arquivos_upload (
            caminho VARCHAR(255) NOT NULL PRIMARY KEY,
            mime_type VARCHAR(80) NOT NULL,
            tamanho INT UNSIGNED NOT NULL,
            conteudo LONGBLOB NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
}

/**
 * Persiste um arquivo enviado no disco local (public/uploads), diretórios compartilhados e MySQL (LONGBLOB)
 */
async function persistUploadedFile(urlPath, localFilePath) {
    const parsed = parseUploadUrl(urlPath);
    if (!parsed || !localFilePath || !fs.existsSync(localFilePath)) {
        return { persisted: false };
    }

    const buffer = fs.readFileSync(localFilePath);
    const mimeType = detectImageMimeFromBuffer(buffer);
    if (!mimeType) {
        return { persisted: false };
    }

    const publicTarget = resolveSafeTargetPath(PUBLIC_UPLOADS_DIR, parsed.folder, parsed.filename);
    if (publicTarget && path.resolve(localFilePath) !== path.resolve(publicTarget)) {
        writeBufferSafe(publicTarget, buffer);
    }

    for (const dir of getPersistentDirs()) {
        const persistentTarget = resolveSafeTargetPath(dir, parsed.folder, parsed.filename);
        writeBufferSafe(persistentTarget, buffer);
    }

    if (buffer.length <= MAX_DB_FILE_BYTES) {
        try {
            await ensureUploadTable();
            await pool.query(
                `INSERT INTO arquivos_upload (caminho, mime_type, tamanho, conteudo)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                     mime_type = VALUES(mime_type),
                     tamanho = VALUES(tamanho),
                     conteudo = VALUES(conteudo)`,
                [parsed.urlPath, mimeType, buffer.length, buffer]
            );
        } catch (err) {
            console.warn('⚠️ [UploadStorage] Não foi possível gravar cópia no MySQL:', err.message || err.code || 'erro desconhecido');
        }
    }

    return {
        persisted: true,
        urlPath: parsed.urlPath,
        mimeType,
        size: buffer.length
    };
}

/**
 * Remove arquivo do disco atual, diretórios persistentes e MySQL
 */
async function removeUploadedFile(urlPath) {
    const parsed = parseUploadUrl(urlPath);
    if (!parsed) return;

    unlinkSafe(resolveSafeTargetPath(PUBLIC_UPLOADS_DIR, parsed.folder, parsed.filename));
    for (const dir of getPersistentDirs()) {
        unlinkSafe(resolveSafeTargetPath(dir, parsed.folder, parsed.filename));
    }

    try {
        await pool.query('DELETE FROM arquivos_upload WHERE caminho = ?', [parsed.urlPath]);
    } catch {
        // ignore se tabela ainda não existir
    }
}

/**
 * Resolve o arquivo no disco atual ou restaura automaticamente do diretório compartilhado / MySQL
 */
async function resolveOrRestoreUpload(urlPath) {
    const parsed = parseUploadUrl(urlPath);
    if (!parsed) return null;

    // 1. Disco atual (public/uploads)
    const publicPath = resolveSafeTargetPath(PUBLIC_UPLOADS_DIR, parsed.folder, parsed.filename);
    if (publicPath && fs.existsSync(publicPath)) {
        const mimeType = detectImageMimeFromFile(publicPath);
        if (mimeType) {
            return { filePath: publicPath, mimeType };
        }
    }

    // 2. Diretórios persistentes (hbuilds/shared_uploads ou ~/.sistema-pro-uploads)
    for (const dir of getPersistentDirs()) {
        const persistentPath = resolveSafeTargetPath(dir, parsed.folder, parsed.filename);
        if (persistentPath && fs.existsSync(persistentPath)) {
            const mimeType = detectImageMimeFromFile(persistentPath);
            if (mimeType) {
                copyFileSafe(persistentPath, publicPath);
                try {
                    const buf = fs.readFileSync(persistentPath);
                    if (buf.length <= MAX_DB_FILE_BYTES) {
                        await ensureUploadTable();
                        await pool.query(
                            `INSERT IGNORE INTO arquivos_upload (caminho, mime_type, tamanho, conteudo) VALUES (?, ?, ?, ?)`,
                            [parsed.urlPath, mimeType, buf.length, buf]
                        );
                    }
                } catch {
                    // ignore falha pontual no backfill
                }
                return { filePath: fs.existsSync(publicPath) ? publicPath : persistentPath, mimeType };
            }
        }
    }

    // 3. Fallback definitivo no MySQL (arquivos_upload)
    try {
        const [rows] = await pool.query(
            'SELECT mime_type, conteudo FROM arquivos_upload WHERE caminho = ? LIMIT 1',
            [parsed.urlPath]
        );
        if (rows.length > 0 && rows[0].conteudo) {
            const buffer = Buffer.isBuffer(rows[0].conteudo)
                ? rows[0].conteudo
                : Buffer.from(rows[0].conteudo);
            const mimeType = rows[0].mime_type || detectImageMimeFromBuffer(buffer);
            if (!mimeType) return null;

            writeBufferSafe(publicPath, buffer);
            for (const dir of getPersistentDirs()) {
                writeBufferSafe(resolveSafeTargetPath(dir, parsed.folder, parsed.filename), buffer);
            }

            return {
                filePath: fs.existsSync(publicPath) ? publicPath : null,
                buffer,
                mimeType
            };
        }
    } catch {
        // ignore caso banco esteja indisponível
    }

    return null;
}

/**
 * Varre diretórios candidatos procurando arquivos válidos nas subpastas wiki e alunos
 */
function collectUploadsFromRoot(rootDir, maxDepth = 5) {
    const discovered = new Map();
    if (!rootDir || !fs.existsSync(rootDir)) return discovered;

    const SKIP_DIRS = new Set(['node_modules', '.git', 'tmp', '.cache', 'fighters']);
    const UPLOAD_PARENT_NAMES = new Set(['uploads', 'shared_uploads', '.sistema-pro-uploads']);

    function walk(currentDir, depth, parentName) {
        if (depth > maxDepth) return;
        let entries;
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
            return;
        }

        const dirName = path.basename(currentDir).toLowerCase();
        const isTargetUploadLeaf =
            ALLOWED_FOLDERS.has(dirName) &&
            UPLOAD_PARENT_NAMES.has((parentName || '').toLowerCase());

        if (isTargetUploadLeaf) {
            for (const entry of entries) {
                if (!entry.isFile()) continue;
                const parsed = parseUploadUrl(`/uploads/${dirName}/${entry.name}`);
                if (!parsed) continue;

                const fullPath = path.join(currentDir, entry.name);
                const mimeType = detectImageMimeFromFile(fullPath);
                if (!mimeType) continue;

                if (!discovered.has(parsed.urlPath)) {
                    discovered.set(parsed.urlPath, {
                        ...parsed,
                        fullPath,
                        mimeType
                    });
                }
            }
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (SKIP_DIRS.has(entry.name)) continue;
            walk(path.join(currentDir, entry.name), depth + 1, path.basename(currentDir));
        }
    }

    walk(path.resolve(rootDir), 0, path.basename(path.dirname(path.resolve(rootDir))));
    return discovered;
}

/**
 * Sincroniza todos os uploads encontrados em builds anteriores/diretórios compartilhados com o MySQL
 * e materializa no disco da versão atual todos os registros armazenados em arquivos_upload.
 */
async function syncUploadsOnBoot() {
    await ensureUploadTable();

    const scanRoots = [PUBLIC_UPLOADS_DIR, ...getPersistentDirs()];
    const publicHtmlUploads = path.join(PARENT_4, 'public_html', 'uploads');
    if (fs.existsSync(publicHtmlUploads)) {
        scanRoots.push(publicHtmlUploads);
    }
    if (IS_HOSTINGER_HBUILDS) {
        scanRoots.push(PARENT_3);
    } else if (fs.existsSync(path.join(PARENT_2, 'uploads'))) {
        scanRoots.push(PARENT_2);
    }

    const discovered = new Map();
    for (const root of scanRoots) {
        const depth = root === PARENT_3 ? 5 : 4;
        const found = collectUploadsFromRoot(root, depth);
        for (const [urlPath, item] of found.entries()) {
            if (!discovered.has(urlPath)) {
                discovered.set(urlPath, item);
            }
        }
    }

    const [existingRows] = await pool.query('SELECT caminho FROM arquivos_upload');
    const existingDbPaths = new Set(existingRows.map(r => r.caminho));

    let insertedInDb = 0;
    for (const item of discovered.values()) {
        const publicTarget = resolveSafeTargetPath(PUBLIC_UPLOADS_DIR, item.folder, item.filename);
        if (publicTarget && !fs.existsSync(publicTarget)) {
            copyFileSafe(item.fullPath, publicTarget);
        }
        for (const dir of getPersistentDirs()) {
            const pTarget = resolveSafeTargetPath(dir, item.folder, item.filename);
            if (pTarget && !fs.existsSync(pTarget)) {
                copyFileSafe(item.fullPath, pTarget);
            }
        }

        if (!existingDbPaths.has(item.urlPath)) {
            try {
                const buffer = fs.readFileSync(item.fullPath);
                if (buffer.length > 0 && buffer.length <= MAX_DB_FILE_BYTES) {
                    await pool.query(
                        `INSERT IGNORE INTO arquivos_upload (caminho, mime_type, tamanho, conteudo) VALUES (?, ?, ?, ?)`,
                        [item.urlPath, item.mimeType, buffer.length, buffer]
                    );
                    existingDbPaths.add(item.urlPath);
                    insertedInDb++;
                }
            } catch (err) {
                console.warn(`⚠️ [UploadStorage] Falha ao importar ${item.urlPath} para MySQL:`, err.message || err.code || 'erro desconhecido');
            }
        }
    }

    // Restaura no disco da versão atual arquivos existentes no MySQL mas ausentes no disco
    let restoredFromDb = 0;
    for (const dbPath of existingDbPaths) {
        const parsed = parseUploadUrl(dbPath);
        if (!parsed) continue;

        const publicTarget = resolveSafeTargetPath(PUBLIC_UPLOADS_DIR, parsed.folder, parsed.filename);
        const needPublic = publicTarget && !fs.existsSync(publicTarget);
        if (!needPublic) continue;

        try {
            const [rows] = await pool.query(
                'SELECT conteudo FROM arquivos_upload WHERE caminho = ? LIMIT 1',
                [parsed.urlPath]
            );
            if (rows.length > 0 && rows[0].conteudo) {
                const buffer = Buffer.isBuffer(rows[0].conteudo)
                    ? rows[0].conteudo
                    : Buffer.from(rows[0].conteudo);
                if (writeBufferSafe(publicTarget, buffer)) {
                    restoredFromDb++;
                }
                for (const dir of getPersistentDirs()) {
                    const pTarget = resolveSafeTargetPath(dir, parsed.folder, parsed.filename);
                    if (pTarget && !fs.existsSync(pTarget)) {
                        writeBufferSafe(pTarget, buffer);
                    }
                }
            }
        } catch (err) {
            console.warn(`⚠️ [UploadStorage] Falha ao restaurar ${parsed.urlPath}:`, err.message || err.code || 'erro desconhecido');
        }
    }

    console.log(
        `📦 [UploadStorage] Sync concluído: ${discovered.size} encontrado(s) no disco, ${insertedInDb} importado(s) para o MySQL, ${restoredFromDb} restaurado(s) do MySQL.`
    );
    return {
        discovered: discovered.size,
        insertedInDb,
        restoredFromDb
    };
}

module.exports = {
    PUBLIC_UPLOADS_DIR,
    parseUploadUrl,
    detectImageMimeFromBuffer,
    detectImageMimeFromFile,
    getPersistentDirs,
    ensureUploadTable,
    persistUploadedFile,
    removeUploadedFile,
    resolveOrRestoreUpload,
    syncUploadsOnBoot
};
