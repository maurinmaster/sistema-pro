const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsappService');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');

// Todas as rotas de configuração do WhatsApp exigem perfil admin
router.use(authenticateToken, authorizeRoles('admin'));

// GET /api/whatsapp/status - Consulta estado atual da conexão Baileys e desperta sessão salva se necessário
router.get('/status', async (req, res) => {
    try {
        if (whatsappService.status === 'disconnected' && !whatsappService.isManualDisconnect) {
            await whatsappService.ensureConnectedIfSaved({ waitMs: 0 });
        }
    } catch {
        // Retorna estado atual mesmo se checagem em segundo plano falhar
    }
    res.json({
        success: true,
        data: whatsappService.getStatus()
    });
});

// POST /api/whatsapp/conectar - Inicia conexão Baileys e gera QR Code
router.post('/conectar', async (req, res) => {
    try {
        const status = await whatsappService.connect();
        res.json({
            success: true,
            message: 'Conexão com WhatsApp iniciada.',
            data: status
        });
    } catch (err) {
        console.error('[WhatsApp] Erro ao iniciar conexão:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao iniciar conexão com WhatsApp.' });
    }
});

// POST /api/whatsapp/desconectar - Encerra sessão e remove credenciais salvas
router.post('/desconectar', async (req, res) => {
    try {
        const status = await whatsappService.disconnect();
        res.json({
            success: true,
            message: 'WhatsApp desconectado com sucesso.',
            data: status
        });
    } catch (err) {
        console.error('[WhatsApp] Erro ao desconectar:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao desconectar WhatsApp.' });
    }
});

// POST /api/whatsapp/teste - Envia mensagem de teste para validar número conectado
router.post('/teste', async (req, res) => {
    try {
        const telefone = typeof req.body?.telefone === 'string' ? req.body.telefone.trim() : '';
        const mensagem = typeof req.body?.mensagem === 'string' && req.body.mensagem.trim()
            ? req.body.mensagem.trim()
            : '✅ *PRO COMBATE*\nTeste de conexão WhatsApp realizado com sucesso!';

        if (!whatsappService.normalizePhoneToDigits(telefone)) {
            return res.status(400).json({ success: false, error: 'Informe um número de WhatsApp válido com DDD.' });
        }
        if (mensagem.length > 1000) {
            return res.status(400).json({ success: false, error: 'A mensagem de teste deve ter no máximo 1000 caracteres.' });
        }

        const result = await whatsappService.sendTextMessage(telefone, mensagem);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.reason || result.error || 'Não foi possível enviar a mensagem de teste.'
            });
        }

        res.json({
            success: true,
            message: 'Mensagem de teste enviada com sucesso!'
        });
    } catch (err) {
        console.error('[WhatsApp] Erro ao enviar mensagem de teste:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao enviar mensagem de teste.' });
    }
});

module.exports = router;
