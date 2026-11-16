require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { resolveOrRestoreUpload } = require('./services/uploadStorage');

const app = express();
const PORT = process.env.PORT || 3000;

// Oculta assinatura da tecnologia do servidor
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Cabeçalhos de Segurança HTTP (equivalente ao Helmet)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://ui-avatars.com https://images.unsplash.com; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    next();
});

// Configuração de CORS (permite localhost, origens configuradas e rede local privada apenas fora de produção)
const allowedOrigins = Array.from(new Set([
    ...(process.env.CORS_ORIGIN || `http://localhost:${PORT},http://127.0.0.1:${PORT}`)
        .split(',')
        .map(o => o.trim())
        .filter(Boolean),
    'https://gestor.procombate.com',
    'https://www.gestor.procombate.com'
]));

const isLocalOrPrivateNetwork = (origin) => {
    if (!origin) return true;
    if (process.env.NODE_ENV === 'production') return false;
    try {
        const url = new URL(origin);
        const host = url.hostname;
        return (
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host.startsWith('192.168.') ||
            host.startsWith('10.') ||
            /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
        );
    } catch {
        return false;
    }
};

app.use(cors({
    origin: (origin, callback) => {
        // Permite requisições same-origin / sem cabeçalho Origin ou na lista permitida / rede local
        if (!origin || allowedOrigins.includes(origin) || isLocalOrPrivateNetwork(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Origem não permitida pela política de CORS.'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Limite de payload contra ataques de negação de serviço (DoS)
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Cache-Control no-cache para manifest, service worker, favicon e ícones PWA (evita cache antigo no CDN/navegador)
app.use(['/manifest.json', '/sw.js', '/favicon.ico', '/assets/icons'], (req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    next();
});

app.get('/favicon.ico', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(path.join(__dirname, 'public', 'assets', 'icons', 'icon-192.png'));
});

// Serve uploads dinâmicos (wiki/alunos) com restauração automática de diretório compartilhado / MySQL
app.get('/uploads/:folder/:filename', async (req, res, next) => {
    const folder = String(req.params.folder || '').toLowerCase();
    if (folder !== 'wiki' && folder !== 'alunos') {
        return next();
    }

    const safeFilename = path.basename(String(req.params.filename || ''));
    const urlPath = `/uploads/${folder}/${safeFilename}`;

    try {
        const resolved = await resolveOrRestoreUpload(urlPath);
        if (!resolved) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
            return res.status(404).type('text/plain').send('Arquivo não encontrado.');
        }

        res.setHeader('Content-Type', resolved.mimeType || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=86400');

        if (resolved.buffer) {
            return res.send(resolved.buffer);
        }
        return res.sendFile(resolved.filePath, { cacheControl: false }, (sendErr) => {
            if (sendErr && !res.headersSent) {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
                res.status(404).type('text/plain').send('Arquivo não encontrado.');
            }
        });
    } catch (err) {
        console.error('Erro ao servir arquivo de upload:', err);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.status(500).type('text/plain').send('Erro ao carregar arquivo.');
    }
});

// Arquivos estáticos do frontend Vanilla
app.use(express.static(path.join(__dirname, 'public')));

// Rotas da API
const authRoutes = require('./routes/auth');
const alunosRoutes = require('./routes/alunos');
const modalidadesRoutes = require('./routes/modalidades');
const planosRoutes = require('./routes/planos');
const matriculasRoutes = require('./routes/matriculas');
const checkinsRoutes = require('./routes/checkins');
const faturasRoutes = require('./routes/faturas');
const dashboardRoutes = require('./routes/dashboard');

app.use('/api/auth', authRoutes);
app.use('/api/alunos', alunosRoutes);
app.use('/api/modalidades', modalidadesRoutes);
app.use('/api/planos', planosRoutes);
app.use('/api/matriculas', matriculasRoutes);
app.use('/api/checkins', checkinsRoutes);
app.use('/api/faturas', faturasRoutes);
app.use('/api/dashboard', dashboardRoutes);
const painelAlunoRoutes = require('./routes/painelAluno');
app.use('/api/aluno', painelAlunoRoutes);
const wikiGolpesRoutes = require('./routes/wikiGolpes');
app.use('/api/wiki-golpes', wikiGolpesRoutes);
const examesGraduacaoRoutes = require('./routes/examesGraduacao');
app.use('/api/exames', examesGraduacaoRoutes);
app.use('/api/aluno', examesGraduacaoRoutes);

// Healthcheck
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        service: 'Sistema de Gestão de Alunos - Artes Marciais PRO',
        timestamp: new Date().toISOString()
    });
});

// Rotas amigáveis para Autenticação de Alunos (Cadastro em tela única, Login e Reset de Senha)
app.get(['/cadastro', '/login', '/esqueci-senha', '/reset-senha'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cadastro.html'));
});

// Rota amigável para o Painel do Aluno
app.get(['/painel', '/painel-aluno'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'painel-aluno.html'));
});

// Rota amigável para a Wiki de Técnicas e Golpes do Aluno (Página Separada)
app.get(['/painel/wiki', '/wiki-aluno'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'wiki-aluno.html'));
});

// Fallback para SPA (compatível com Express 5)
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Tratador global de erros (evita vazamento de stack traces)
app.use((err, req, res, next) => {
    if (err.message === 'Origem não permitida pela política de CORS.') {
        return res.status(403).json({ success: false, error: err.message });
    }
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ success: false, error: 'Payload da requisição excede o tamanho máximo permitido.' });
    }
    console.error('Erro não tratado na aplicação:', err);
    res.status(500).json({ success: false, error: 'Erro interno no servidor.' });
});

// Inicialização do servidor (apenas quando executado diretamente, facilitando testes de integração)
if (require.main === module) {
    const http = require('http');
    const https = require('https');
    const fs = require('fs');

    // 1. Servidor HTTP padrão (Porta 3000)
    const serverHttp = http.createServer(app);
    serverHttp.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`⚠️ [Porta Ocupada] A porta ${PORT} já está em uso por outro processo.`);
        } else {
            console.error('❌ Erro no servidor HTTP:', err.message);
        }
    });

    serverHttp.listen(PORT, '0.0.0.0', () => {
        console.log(`====================================================`);
        console.log(`🚀 Sistema de Gestão de Alunos em execução!`);
        console.log(`📍 Local HTTP:       http://localhost:${PORT}`);
        console.log(`📱 Rede Local HTTP:  http://192.168.3.7:${PORT}`);
        console.log(`📋 Auto-Cadastro:    http://192.168.3.7:${PORT}/cadastro`);
    });

    // 2. Servidor HTTPS seguro para desbloquear Câmera ao Vivo no celular (Porta 3443)
    try {
        const keyPath = path.join(__dirname, 'certs', 'key.pem');
        const certPath = path.join(__dirname, 'certs', 'cert.pem');
        if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
            const httpsOptions = {
                key: fs.readFileSync(keyPath),
                cert: fs.readFileSync(certPath)
            };
            const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
            const serverHttps = https.createServer(httpsOptions, app);
            serverHttps.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    console.error(`⚠️ [Porta Ocupada] A porta HTTPS ${HTTPS_PORT} já está em uso.`);
                } else {
                    console.error('❌ Erro no servidor HTTPS:', err.message);
                }
            });
            serverHttps.listen(HTTPS_PORT, '0.0.0.0', () => {
                console.log(`🔒 Local HTTPS:      https://localhost:${HTTPS_PORT}`);
                console.log(`📱 Celular HTTPS (Câmera ao Vivo): https://192.168.3.7:${HTTPS_PORT}/cadastro`);
                console.log(`⏰ ${new Date().toLocaleString('pt-BR')}`);
                console.log(`====================================================`);
            });
        }
    } catch (err) {
        console.warn('⚠️ Não foi possível iniciar HTTPS:', err.message);
    }
}

module.exports = app;
