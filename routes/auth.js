const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const pool = require('../db/connection');
const { authenticateToken, createRateLimiter, JWT_SECRET } = require('../middlewares/auth');
const { calculateAge, validateMinorGuardian, hasValidImageSignature } = require('../services/domainRules');
const emailService = require('../services/emailService');

// Diretório para armazenamento de fotos de biometria e perfil
const uploadDir = path.join(__dirname, '../public/uploads/alunos');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configuração do Multer para fotos capturadas via câmera
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        const safeExt = allowedExts.includes(ext) ? ext : '.jpg';
        const cleanName = `bio-${Date.now()}-${Math.round(Math.random() * 1E6)}${safeExt}`;
        cb(null, cleanName);
    }
});

const uploadBiometria = multer({
    storage,
    limits: { fileSize: 6 * 1024 * 1024 }, // 6MB máx
    fileFilter: (req, file, cb) => {
        const allowedTypes = /^image\/(jpeg|jpg|png|webp)$/;
        const allowedExts = /\.(jpeg|jpg|png|webp)$/;
        const extname = allowedExts.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Apenas imagens nos formatos JPG, PNG ou WEBP são permitidas para biometria facial.'));
    }
});

// Rate limiters
const loginRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Muitas tentativas de login. Aguarde 15 minutos antes de tentar novamente.'
});

const cadastroRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: 'Limite de cadastros atingido para este endereço IP. Aguarde 15 minutos.'
});

const emailVerificationLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 20,
    message: 'Muitas tentativas de verificação. Aguarde 10 minutos.'
});

// Helpers para auditoria e segurança
function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

async function logLoginAttempt(email, ip, sucesso, motivoFalha = null) {
    try {
        await pool.query(
            'INSERT INTO tentativas_login (email, ip_endereco, sucesso, motivo_falha) VALUES (?, ?, ?, ?)',
            [email ? String(email).trim().toLowerCase() : '', ip || null, sucesso ? 1 : 0, motivoFalha]
        );
    } catch (err) {
        console.error('Falha ao auditar tentativa de login:', err.message);
    }
}

async function createSession(usuarioId, token, ip, userAgent, expiresInHours = 24) {
    try {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiraEm = new Date(Date.now() + expiresInHours * 3600 * 1000);
        await pool.query(
            'INSERT INTO sessoes_usuarios (usuario_id, token_hash, ip_endereco, user_agent, expira_em) VALUES (?, ?, ?, ?, ?)',
            [usuarioId, tokenHash, ip || null, userAgent || null, expiraEm]
        );
    } catch (err) {
        console.error('Falha ao registrar sessão do usuário:', err.message);
    }
}

// ============================================================================
// 1. POST /api/auth/login - Autenticação com auditoria e gestão de sessões
// ============================================================================
router.post('/login', loginRateLimiter, async (req, res) => {
    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'] || null;

    try {
        const { email, senha } = req.body;

        if (!email || typeof email !== 'string' || !senha || typeof senha !== 'string') {
            await logLoginAttempt(email, clientIp, 0, 'Campos obrigatórios ausentes');
            return res.status(400).json({
                success: false,
                error: 'E-mail e senha são obrigatórios.'
            });
        }

        if (senha.length > 128) {
            await logLoginAttempt(email, clientIp, 0, 'Senha excessivamente longa');
            return res.status(400).json({
                success: false,
                error: 'Credenciais inválidas.'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // 1.1. Tenta autenticar como membro da Equipe (Admin, Professor, Recepção)
        const [users] = await pool.query(`
            SELECT id, nome, email, senha_hash, cargo, telefone, ativo 
            FROM usuarios_equipe 
            WHERE email = ? AND ativo = 1
        `, [normalizedEmail]);

        if (users.length > 0) {
            const user = users[0];
            let isValid = false;
            try {
                isValid = await bcrypt.compare(senha, user.senha_hash);
            } catch {
                isValid = false;
            }

            if (!isValid) {
                await logLoginAttempt(normalizedEmail, clientIp, 0, 'Senha incorreta (equipe)');
                return res.status(401).json({
                    success: false,
                    error: 'E-mail ou senha inválidos.'
                });
            }

            const payload = {
                id: user.id,
                nome: user.nome,
                email: user.email,
                cargo: user.cargo
            };

            const token = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '24h' });
            await logLoginAttempt(normalizedEmail, clientIp, 1, null);

            return res.json({
                success: true,
                message: `Autenticado com sucesso! Bem-vindo(a), ${user.nome}.`,
                token,
                user: {
                    id: user.id,
                    nome: user.nome,
                    email: user.email,
                    cargo: user.cargo,
                    telefone: user.telefone
                }
            });
        }

        // 1.2. Tenta autenticar na tabela relacional de Usuários de Alunos (usuarios_alunos)
        const [usuariosAlunos] = await pool.query(`
            SELECT ua.id AS usuario_id, ua.aluno_id, ua.email, ua.senha_hash, ua.status AS usuario_status, ua.email_verificado,
                   a.nome_completo, a.telefone_whatsapp, a.genero, a.foto_perfil_url, a.status AS aluno_status
            FROM usuarios_alunos ua
            JOIN alunos a ON a.id = ua.aluno_id
            WHERE ua.email = ? AND ua.status != 'inativo' AND a.status != 'inativo' AND a.deleted_at IS NULL
        `, [normalizedEmail]);

        if (usuariosAlunos.length > 0) {
            const ua = usuariosAlunos[0];

            if (ua.usuario_status === 'bloqueado' || ua.aluno_status === 'bloqueado') {
                await logLoginAttempt(normalizedEmail, clientIp, 0, 'Conta bloqueada');
                return res.status(403).json({
                    success: false,
                    error: 'Acesso bloqueado pela administração da academia. Entre em contato com a secretaria.'
                });
            }

            let isValid = false;
            try {
                isValid = await bcrypt.compare(senha, ua.senha_hash);
            } catch {
                isValid = false;
            }

            if (!isValid) {
                await logLoginAttempt(normalizedEmail, clientIp, 0, 'Senha incorreta (aluno)');
                return res.status(401).json({
                    success: false,
                    error: 'E-mail ou senha inválidos.'
                });
            }

            const alunoPayload = {
                id: ua.aluno_id,
                usuario_id: ua.usuario_id,
                aluno_id: ua.aluno_id,
                nome: ua.nome_completo,
                email: ua.email,
                cargo: 'aluno'
            };

            const alunoToken = jwt.sign(alunoPayload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '24h' });

            // Registra sessão e atualiza data de último login
            await createSession(ua.usuario_id, alunoToken, clientIp, userAgent);
            await pool.query('UPDATE usuarios_alunos SET ultimo_login = NOW() WHERE id = ?', [ua.usuario_id]);
            await logLoginAttempt(normalizedEmail, clientIp, 1, null);

            return res.json({
                success: true,
                message: `Bem-vindo(a) ao Portal do Atleta, ${ua.nome_completo}!`,
                token: alunoToken,
                user: {
                    id: ua.aluno_id,
                    usuario_id: ua.usuario_id,
                    aluno_id: ua.aluno_id,
                    nome: ua.nome_completo,
                    email: ua.email,
                    cargo: 'aluno',
                    telefone: ua.telefone_whatsapp,
                    genero: ua.genero,
                    foto_perfil_url: ua.foto_perfil_url,
                    email_verificado: ua.email_verificado === 1
                }
            });
        }

        // 1.3. Fallback: Alunos pré-existentes na tabela alunos com senha_app_hash
        const [alunosLegacy] = await pool.query(`
            SELECT id, nome_completo, email, senha_app_hash, telefone_whatsapp, genero, foto_perfil_url, status
            FROM alunos
            WHERE email = ? AND status != 'inativo' AND deleted_at IS NULL
        `, [normalizedEmail]);

        if (alunosLegacy.length > 0 && alunosLegacy[0].senha_app_hash) {
            const aluno = alunosLegacy[0];
            let isValid = false;
            try {
                isValid = await bcrypt.compare(senha, aluno.senha_app_hash);
            } catch {
                isValid = false;
            }

            if (!isValid) {
                await logLoginAttempt(normalizedEmail, clientIp, 0, 'Senha incorreta (legacy)');
                return res.status(401).json({
                    success: false,
                    error: 'E-mail ou senha inválidos.'
                });
            }

            // Sincroniza e cria o registro em usuarios_alunos
            const [uResult] = await pool.query(`
                INSERT INTO usuarios_alunos (aluno_id, email, senha_hash, status, email_verificado, ultimo_login)
                VALUES (?, ?, ?, 'ativo', 1, NOW())
                ON DUPLICATE KEY UPDATE ultimo_login = NOW()
            `, [aluno.id, normalizedEmail, aluno.senha_app_hash]);

            const usuarioId = uResult.insertId || aluno.id;

            const alunoPayload = {
                id: aluno.id,
                usuario_id: usuarioId,
                aluno_id: aluno.id,
                nome: aluno.nome_completo,
                email: aluno.email,
                cargo: 'aluno'
            };

            const alunoToken = jwt.sign(alunoPayload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '24h' });
            await createSession(usuarioId, alunoToken, clientIp, userAgent);
            await logLoginAttempt(normalizedEmail, clientIp, 1, null);

            return res.json({
                success: true,
                message: `Bem-vindo(a) ao Portal do Atleta, ${aluno.nome_completo}!`,
                token: alunoToken,
                user: {
                    id: aluno.id,
                    usuario_id: usuarioId,
                    aluno_id: aluno.id,
                    nome: aluno.nome_completo,
                    email: aluno.email,
                    cargo: 'aluno',
                    telefone: aluno.telefone_whatsapp,
                    genero: aluno.genero,
                    foto_perfil_url: aluno.foto_perfil_url,
                    email_verificado: true
                }
            });
        }

        await logLoginAttempt(normalizedEmail, clientIp, 0, 'Usuário não localizado');
        return res.status(401).json({
            success: false,
            error: 'E-mail ou senha inválidos.'
        });
    } catch (err) {
        console.error('Erro no login:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao realizar autenticação.' });
    }
});

// ============================================================================
// 2. POST /api/auth/upload-foto-perfil - Upload e verificação de foto da câmera / perfil
// ============================================================================
router.post(['/upload-foto-biometria', '/upload-foto-perfil'], cadastroRateLimiter, (req, res) => {
    uploadBiometria.single('foto')(req, res, (uploadErr) => {
        if (uploadErr) {
            return res.status(400).json({
                success: false,
                error: uploadErr.code === 'LIMIT_FILE_SIZE'
                    ? 'A imagem excede o limite máximo permitido de 6MB.'
                    : (uploadErr.message || 'Erro ao processar imagem da câmera.')
            });
        }

        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'Nenhuma foto enviada pela câmera.'
                });
            }

            // Validação estrita de magic bytes para segurança do backend
            if (!hasValidImageSignature(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
                return res.status(400).json({
                    success: false,
                    error: 'Arquivo inválido: a imagem capturada não possui cabeçalho de foto válido (JPG/PNG/WEBP).'
                });
            }

            const fileUrl = `/uploads/alunos/${req.file.filename}`;
            res.json({
                success: true,
                message: 'Foto facial registrada com sucesso para reconhecimento biométrico!',
                url: fileUrl
            });
        } catch (err) {
            console.error('Erro no processamento da biometria facial:', err);
            res.status(500).json({ success: false, error: 'Falha interna ao processar foto facial.' });
        }
    });
});

// ============================================================================
// 3. POST /api/auth/cadastro-aluno - Auto-cadastro de Aluno (Mobile First)
// ============================================================================
router.post('/cadastro-aluno', cadastroRateLimiter, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const {
            nome_completo,
            nome,
            sobrenome,
            cpf,
            data_nascimento,
            genero,
            email,
            senha,
            telefone_whatsapp,
            responsavel_nome,
            responsavel_cpf,
            responsavel_telefone,
            contato_emergencia_nome,
            contato_emergencia_fone,
            tipo_sanguineo,
            observacoes_medicas,
            foto_perfil_url,
            consentimento_biometria_lgpd
        } = req.body;

        const finalNomeCompleto = (nome_completo && String(nome_completo).trim())
            ? String(nome_completo).trim()
            : (nome ? `${String(nome).trim()} ${sobrenome ? String(sobrenome).trim() : ''}`.trim() : '');

        // Validações essenciais
        if (!finalNomeCompleto) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'O nome completo é obrigatório.' });
        }

        if (!data_nascimento || isNaN(new Date(data_nascimento).getTime())) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'Data de nascimento válida é obrigatória.' });
        }

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'E-mail válido é obrigatório para acesso.' });
        }

        if (!senha || String(senha).length < 6) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'A senha de acesso deve ter pelo menos 6 caracteres.' });
        }

        if (!telefone_whatsapp || !String(telefone_whatsapp).trim()) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'O telefone / WhatsApp é obrigatório para notificações.' });
        }

        if (!foto_perfil_url || typeof foto_perfil_url !== 'string' || !foto_perfil_url.trim()) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'A foto de perfil é obrigatória para realizar o cadastro.' });
        }

        // Validação de Menor de Idade
        const guardianValidation = validateMinorGuardian(data_nascimento, responsavel_nome, responsavel_telefone);
        if (!guardianValidation.valid) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: guardianValidation.error });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        // Verifica unicidade de e-mail tanto em usuarios_alunos quanto em alunos
        const [emailExists] = await conn.query(
            'SELECT id FROM alunos WHERE email = ? UNION SELECT id FROM usuarios_alunos WHERE email = ?',
            [normalizedEmail, normalizedEmail]
        );
        if (emailExists.length > 0) {
            await conn.rollback();
            return res.status(409).json({ success: false, error: 'Este e-mail já está cadastrado no sistema. Faça login ou recupere sua senha.' });
        }

        // CPF opcional, mas se fornecido valida duplicidade
        const cleanCpf = cpf ? String(cpf).replace(/\D/g, '') : null;
        if (cleanCpf && cleanCpf.length === 11) {
            const formattedCpf = `${cleanCpf.slice(0, 3)}.${cleanCpf.slice(3, 6)}.${cleanCpf.slice(6, 9)}-${cleanCpf.slice(9, 11)}`;
            const [cpfExists] = await conn.query('SELECT id FROM alunos WHERE cpf = ?', [formattedCpf]);
            if (cpfExists.length > 0) {
                await conn.rollback();
                return res.status(409).json({ success: false, error: 'Já existe um aluno cadastrado com este CPF.' });
            }
        }

        // Criptografia da senha
        const senhaHash = await bcrypt.hash(senha, 10);
        const fotoFinalUrl = String(foto_perfil_url).trim();

        // 1. Inserção na tabela principal de alunos
        const [alunoResult] = await conn.query(`
            INSERT INTO alunos (
                nome_completo, cpf, data_nascimento, genero, email, senha_app_hash,
                telefone_whatsapp, responsavel_nome, responsavel_cpf, responsavel_telefone,
                contato_emergencia_nome, contato_emergencia_fone, tipo_sanguineo, observacoes_medicas,
                foto_perfil_url, face_foto_base_url, consentimento_biometria_lgpd, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativo')
        `, [
            finalNomeCompleto,
            cpf ? String(cpf).trim() : null,
            data_nascimento,
            genero || 'Outro',
            normalizedEmail,
            senhaHash,
            telefone_whatsapp.trim(),
            guardianValidation.isMinor ? String(responsavel_nome).trim() : null,
            guardianValidation.isMinor && responsavel_cpf ? String(responsavel_cpf).trim() : null,
            guardianValidation.isMinor ? String(responsavel_telefone).trim() : null,
            contato_emergencia_nome ? String(contato_emergencia_nome).trim() : null,
            contato_emergencia_fone ? String(contato_emergencia_fone).trim() : null,
            tipo_sanguineo ? String(tipo_sanguineo).trim() : null,
            observacoes_medicas ? String(observacoes_medicas).trim() : null,
            fotoFinalUrl,
            foto_perfil_url || null, // Foto base para reconhecimento facial futuro
            consentimento_biometria_lgpd ? 1 : 0
        ]);

        const alunoId = alunoResult.insertId;

        // Atribui automaticamente a primeira graduação ao novo atleta cadastrado
        try {
            const [mods] = await conn.query(`
                SELECT id FROM modalidades
                WHERE ativo = 1
                ORDER BY (nome LIKE '%Muay%') DESC, id ASC
                LIMIT 1
            `);
            if (mods.length > 0) {
                const defaultModId = mods[0].id;
                const [niveis] = await conn.query(`
                    SELECT id FROM graduacoes_niveis
                    WHERE modalidade_id = ?
                    ORDER BY ordem_hierarquica ASC, id ASC
                    LIMIT 1
                `, [defaultModId]);

                if (niveis.length > 0) {
                    await conn.query(`
                        INSERT INTO aluno_graduacoes (
                            aluno_id, modalidade_id, graduacao_nivel_id, data_graduacao, observacoes, atual
                        ) VALUES (?, ?, ?, CURDATE(), 'Graduação inicial automática no cadastro.', 1)
                    `, [alunoId, defaultModId, niveis[0].id]);
                }
            }
        } catch (gradErr) {
            console.error('[Auth] Aviso: Falha ao atribuir graduação inicial:', gradErr.message);
        }

        // 2. Inserção na tabela relacional de autenticação (usuarios_alunos)
        const [usuarioResult] = await conn.query(`
            INSERT INTO usuarios_alunos (aluno_id, email, senha_hash, status, email_verificado)
            VALUES (?, ?, ?, 'pendente_verificacao', 0)
        `, [alunoId, normalizedEmail, senhaHash]);

        const usuarioId = usuarioResult.insertId;

        // 3. Geração de código de verificação de 6 dígitos e token hash
        const codigoVerificacao = Math.floor(100000 + Math.random() * 900000).toString();
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiraEm = new Date(Date.now() + 24 * 3600 * 1000); // 24 horas

        await conn.query(`
            INSERT INTO verificacoes_email (usuario_id, token_hash, codigo_verificacao, expira_em, verificado)
            VALUES (?, ?, ?, ?, 0)
        `, [usuarioId, tokenHash, codigoVerificacao, expiraEm]);

        await conn.commit();

        // Envio do e-mail com código de confirmação
        try {
            await emailService.sendVerificationEmail(normalizedEmail, finalNomeCompleto, codigoVerificacao);
        } catch (mailErr) {
            console.error('Falha ao enviar e-mail de verificação para', normalizedEmail, mailErr.message);
        }

        res.status(201).json({
            success: true,
            message: 'Cadastro realizado com sucesso! Enviamos o código de ativação para seu e-mail.',
            aluno_id: alunoId,
            usuario_id: usuarioId,
            email: normalizedEmail,
            ...(process.env.NODE_ENV !== 'production' ? { codigo_verificacao_dev: codigoVerificacao } : {})
        });
    } catch (err) {
        await conn.rollback();
        console.error('Erro no cadastro de aluno:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao realizar cadastro.' });
    } finally {
        conn.release();
    }
});

// ============================================================================
// 4. POST /api/auth/verificar-email - Validação do código de e-mail e ativação
// ============================================================================
router.post('/verificar-email', emailVerificationLimiter, async (req, res) => {
    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'] || null;

    try {
        const { email, codigo } = req.body;

        if (!email || !codigo) {
            return res.status(400).json({ success: false, error: 'E-mail e código de verificação são obrigatórios.' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const cleanCodigo = String(codigo).trim();

        const [rows] = await pool.query(`
            SELECT ve.id AS verificacao_id, ve.usuario_id, ve.expira_em, ve.verificado,
                   ua.aluno_id, ua.email, ua.status AS usuario_status,
                   a.nome_completo, a.telefone_whatsapp, a.genero, a.foto_perfil_url
            FROM verificacoes_email ve
            JOIN usuarios_alunos ua ON ua.id = ve.usuario_id
            JOIN alunos a ON a.id = ua.aluno_id
            WHERE ua.email = ? AND ve.codigo_verificacao = ? AND ve.verificado = 0
            ORDER BY ve.id DESC
            LIMIT 1
        `, [normalizedEmail, cleanCodigo]);

        if (rows.length === 0) {
            return res.status(400).json({ success: false, error: 'Código de verificação incorreto ou já utilizado.' });
        }

        const record = rows[0];

        if (new Date() > new Date(record.expira_em)) {
            return res.status(400).json({ success: false, error: 'Este código de verificação expirou. Solicite um novo código.' });
        }

        // Marca verificado e ativa o usuário
        await pool.query('UPDATE verificacoes_email SET verificado = 1 WHERE id = ?', [record.verificacao_id]);
        await pool.query("UPDATE usuarios_alunos SET email_verificado = 1, status = 'ativo', ultimo_login = NOW() WHERE id = ?", [record.usuario_id]);

        // Gera token de autenticação e sessão ativa imediata
        const alunoPayload = {
            id: record.aluno_id,
            usuario_id: record.usuario_id,
            aluno_id: record.aluno_id,
            nome: record.nome_completo,
            email: record.email,
            cargo: 'aluno'
        };

        const token = jwt.sign(alunoPayload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '24h' });
        await createSession(record.usuario_id, token, clientIp, userAgent);

        res.json({
            success: true,
            message: 'E-mail verificado com sucesso! Seu acesso está liberado.',
            token,
            user: {
                id: record.aluno_id,
                usuario_id: record.usuario_id,
                aluno_id: record.aluno_id,
                nome: record.nome_completo,
                email: record.email,
                cargo: 'aluno',
                telefone: record.telefone_whatsapp,
                genero: record.genero,
                foto_perfil_url: record.foto_perfil_url,
                email_verificado: true
            }
        });
    } catch (err) {
        console.error('Erro na verificação de e-mail:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao validar e-mail.' });
    }
});

// ============================================================================
// 5. POST /api/auth/reenviar-codigo - Reenvio de código de confirmação
// ============================================================================
router.post('/reenviar-codigo', emailVerificationLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, error: 'O e-mail é obrigatório.' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        const [usuarios] = await pool.query(`
            SELECT ua.id, ua.email_verificado, a.nome_completo 
            FROM usuarios_alunos ua
            JOIN alunos a ON a.id = ua.aluno_id
            WHERE ua.email = ?
        `, [normalizedEmail]);

        if (usuarios.length === 0) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }

        const usuario = usuarios[0];
        if (usuario.email_verificado === 1) {
            return res.json({ success: true, message: 'Seu e-mail já foi verificado anteriormente. Você pode entrar diretamente.' });
        }

        const novoCodigo = Math.floor(100000 + Math.random() * 900000).toString();
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiraEm = new Date(Date.now() + 24 * 3600 * 1000);

        await pool.query(`
            INSERT INTO verificacoes_email (usuario_id, token_hash, codigo_verificacao, expira_em, verificado)
            VALUES (?, ?, ?, ?, 0)
        `, [usuario.id, tokenHash, novoCodigo, expiraEm]);

        try {
            await emailService.sendVerificationEmail(normalizedEmail, usuario.nome_completo, novoCodigo);
        } catch (mailErr) {
            console.error('Falha ao reenviar e-mail de verificação para', normalizedEmail, mailErr.message);
        }

        res.json({
            success: true,
            message: 'Novo código de verificação enviado para seu e-mail!',
            ...(process.env.NODE_ENV !== 'production' ? { codigo_verificacao_dev: novoCodigo } : {})
        });
    } catch (err) {
        console.error('Erro ao reenviar código:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao gerar novo código.' });
    }
});

// ============================================================================
// 6. POST /api/auth/esqueci-senha - Solicitação de redefinição de senha
// ============================================================================
router.post('/esqueci-senha', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 }), async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, error: 'O e-mail é obrigatório.' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        const [usuarios] = await pool.query(`
            SELECT ua.id, a.nome_completo 
            FROM usuarios_alunos ua
            JOIN alunos a ON a.id = ua.aluno_id
            WHERE ua.email = ? AND a.deleted_at IS NULL
        `, [normalizedEmail]);

        // Responde de forma genérica para proteção contra enumeração de e-mails
        if (usuarios.length === 0) {
            return res.json({
                success: true,
                message: 'Se o e-mail estiver cadastrado, você receberá o código para redefinir sua senha.'
            });
        }

        const usuario = usuarios[0];
        const usuarioId = usuario.id;
        const codigoRecuperacao = Math.floor(100000 + Math.random() * 900000).toString();
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiraEm = new Date(Date.now() + 1 * 3600 * 1000); // 1 hora

        await pool.query(`
            INSERT INTO redefinicoes_senha (usuario_id, token_hash, codigo_recuperacao, expira_em, usado)
            VALUES (?, ?, ?, ?, 0)
        `, [usuarioId, tokenHash, codigoRecuperacao, expiraEm]);

        try {
            await emailService.sendPasswordResetEmail(normalizedEmail, usuario.nome_completo, codigoRecuperacao);
        } catch (mailErr) {
            console.error('Falha ao enviar e-mail de recuperação para', normalizedEmail, mailErr.message);
        }

        res.json({
            success: true,
            message: 'Código de recuperação gerado com sucesso! Confira seu e-mail.',
            ...(process.env.NODE_ENV !== 'production' ? { codigo_recuperacao_dev: codigoRecuperacao } : {})
        });
    } catch (err) {
        console.error('Erro no fluxo de esqueci-senha:', err);
        res.status(500).json({ success: false, error: 'Erro ao processar solicitação de senha.' });
    }
});

// ============================================================================
// 7. POST /api/auth/redefinir-senha - Aplicação de nova senha
// ============================================================================
router.post('/redefinir-senha', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 }), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const { email, codigo, nova_senha } = req.body;

        if (!email || !codigo || !nova_senha) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'E-mail, código e nova senha são obrigatórios.' });
        }

        if (String(nova_senha).length < 6) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'A nova senha deve ter no mínimo 6 caracteres.' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const cleanCodigo = String(codigo).trim();

        const [rows] = await conn.query(`
            SELECT rs.id AS redefinicao_id, rs.usuario_id, rs.expira_em, rs.usado, ua.aluno_id
            FROM redefinicoes_senha rs
            JOIN usuarios_alunos ua ON ua.id = rs.usuario_id
            WHERE ua.email = ? AND rs.codigo_recuperacao = ? AND rs.usado = 0
            ORDER BY rs.id DESC
            LIMIT 1
        `, [normalizedEmail, cleanCodigo]);

        if (rows.length === 0) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'Código de recuperação inválido ou já utilizado.' });
        }

        const record = rows[0];

        if (new Date() > new Date(record.expira_em)) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'Este código de recuperação expirou.' });
        }

        const novoHash = await bcrypt.hash(nova_senha, 10);

        await conn.query('UPDATE redefinicoes_senha SET usado = 1 WHERE id = ?', [record.redefinicao_id]);
        await conn.query('UPDATE usuarios_alunos SET senha_hash = ? WHERE id = ?', [novoHash, record.usuario_id]);
        await conn.query('UPDATE alunos SET senha_app_hash = ? WHERE id = ?', [novoHash, record.aluno_id]);

        // Revoga sessões ativas anteriores por segurança
        await conn.query('UPDATE sessoes_usuarios SET revogado = 1 WHERE usuario_id = ?', [record.usuario_id]);

        await conn.commit();

        res.json({
            success: true,
            message: 'Senha redefinida com sucesso! Você já pode entrar com sua nova senha.'
        });
    } catch (err) {
        await conn.rollback();
        console.error('Erro ao redefinir senha:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao redefinir senha.' });
    } finally {
        conn.release();
    }
});

// ============================================================================
// 8. GET /api/auth/me - Obter dados do usuário autenticado na sessão ativa
// ============================================================================
router.get('/me', authenticateToken, async (req, res) => {
    try {
        if (req.user.cargo === 'aluno') {
            const [alunos] = await pool.query(`
                SELECT id, nome_completo AS nome, email, telefone_whatsapp AS telefone, genero, foto_perfil_url, status
                FROM alunos
                WHERE id = ? AND status != 'inativo' AND deleted_at IS NULL
            `, [req.user.aluno_id || req.user.id]);

            if (alunos.length === 0) {
                return res.status(404).json({ success: false, error: 'Aluno não encontrado ou inativo.' });
            }

            return res.json({
                success: true,
                user: {
                    ...alunos[0],
                    aluno_id: alunos[0].id,
                    cargo: 'aluno'
                }
            });
        }

        const [users] = await pool.query(`
            SELECT id, nome, email, cargo, telefone, ativo 
            FROM usuarios_equipe 
            WHERE id = ? AND ativo = 1
        `, [req.user.id]);

        if (users.length === 0) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado ou inativo.' });
        }

        res.json({ success: true, user: users[0] });
    } catch (err) {
        console.error('Erro ao verificar sessão:', err);
        res.status(500).json({ success: false, error: 'Erro ao verificar sessão.' });
    }
});

// ============================================================================
// 9. POST /api/auth/logout - Encerramento de sessão com revogação
// ============================================================================
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

        if (token && req.user && req.user.usuario_id) {
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            await pool.query(
                'UPDATE sessoes_usuarios SET revogado = 1 WHERE usuario_id = ? AND token_hash = ?',
                [req.user.usuario_id, tokenHash]
            );
        }

        res.json({ success: true, message: 'Sessão encerrada com sucesso.' });
    } catch (err) {
        console.error('Erro no logout:', err);
        res.json({ success: true, message: 'Sessão encerrada.' });
    }
});

module.exports = router;
