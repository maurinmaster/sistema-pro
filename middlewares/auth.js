const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error('❌ [SEGURANÇA CRÍTICA] A variável de ambiente JWT_SECRET não está definida ou possui menos de 32 caracteres.');
    process.exit(1);
}

/**
 * Middleware para validar Token JWT
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Acesso não autorizado: token de autenticação ausente.'
        });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({
            success: false,
            error: 'Token inválido ou expirado. Faça login novamente.'
        });
    }
}

/**
 * Middleware para controle de acesso baseado em cargos (RBAC)
 * @param  {...string} allowedRoles ('admin', 'recepcao', 'professor')
 */
function authorizeRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Usuário não autenticado.'
            });
        }

        if (!allowedRoles.includes(req.user.cargo)) {
            return res.status(403).json({
                success: false,
                error: `Acesso restrito: seu perfil (${req.user.cargo}) não tem permissão para realizar esta operação.`
            });
        }

        next();
    };
}

/**
 * Limitador de taxa (Rate Limiter) em memória por IP para proteção contra força bruta
 */
function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 10, message = 'Muitas requisições deste IP. Tente novamente mais tarde.' } = {}) {
    const hits = new Map();

    // Limpeza periódica para evitar vazamento de memória
    const interval = setInterval(() => {
        const now = Date.now();
        for (const [key, record] of hits.entries()) {
            if (now > record.resetTime) {
                hits.delete(key);
            }
        }
    }, Math.min(windowMs, 60 * 1000));

    if (interval.unref) interval.unref();

    return (req, res, next) => {
        const ip = req.ip || req.socket?.remoteAddress || 'unknown';
        const now = Date.now();
        let record = hits.get(ip);

        if (!record || now > record.resetTime) {
            record = { count: 0, resetTime: now + windowMs };
            hits.set(ip, record);
        }

        record.count += 1;

        const remaining = Math.max(0, max - record.count);
        res.setHeader('X-RateLimit-Limit', String(max));
        res.setHeader('X-RateLimit-Remaining', String(remaining));
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(record.resetTime / 1000)));

        if (record.count > max) {
            return res.status(429).json({
                success: false,
                error: message
            });
        }

        next();
    };
}

module.exports = {
    authenticateToken,
    authorizeRoles,
    createRateLimiter,
    JWT_SECRET
};
