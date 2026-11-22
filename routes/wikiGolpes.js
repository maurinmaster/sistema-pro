/**
 * PRO COMBATE - Rotas da Wiki de Golpes e Movimentos Técnicos
 * Cadastro, listagem, passos com imagens e instruções detalhadas de execução
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db/connection');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');
const { hasValidImageSignature } = require('../services/domainRules');
const { persistUploadedFile } = require('../services/uploadStorage');

// Diretório para fotos dos passos da Wiki
const uploadWikiDir = path.join(__dirname, '../public/uploads/wiki');
if (!fs.existsSync(uploadWikiDir)) {
    fs.mkdirSync(uploadWikiDir, { recursive: true });
}

// Configuração do Multer para fotos dos passos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadWikiDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueName = `passo-${Date.now()}-${Math.round(Math.random() * 1E6)}${ext}`;
        cb(null, uniqueName);
    }
});

const uploadPasso = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB para permitir GIFs animados
    fileFilter: (req, file, cb) => {
        const allowedExts = /^(jpeg|jpg|png|webp|gif)$/i;
        const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
        const mime = (file.mimetype || '').toLowerCase();

        if (allowedExts.test(ext) || mime.includes('gif') || mime.startsWith('image/')) {
            return cb(null, true);
        }
        cb(new Error('Apenas imagens nos formatos JPG, PNG, WEBP ou GIF são permitidas.'));
    }
});

/**
 * Helper compartilhado para upload de imagens/GIFs da Wiki com validação de magic bytes e persistência durável
 */
function handleWikiImageUpload(req, res, fieldCandidates, successMessage, logLabel) {
    uploadPasso.any()(req, res, async (uploadErr) => {
        if (uploadErr) {
            return res.status(400).json({
                success: false,
                error: uploadErr.code === 'LIMIT_FILE_SIZE'
                    ? 'A imagem/GIF excede o limite máximo permitido de 15MB.'
                    : (uploadErr.message || 'Erro no envio do arquivo.')
            });
        }

        try {
            const file = req.file || (req.files && (req.files.find(f => fieldCandidates.includes(f.fieldname)) || req.files[0]));
            if (!file) {
                return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado.' });
            }

            // Validação estrita de assinatura binária (magic bytes) contra falsificação
            if (!hasValidImageSignature(file.path)) {
                try { fs.unlinkSync(file.path); } catch { /* ignore */ }
                return res.status(400).json({
                    success: false,
                    error: 'Arquivo inválido: o conteúdo binário não corresponde a uma imagem JPG, PNG, WEBP ou GIF legítima.'
                });
            }

            const fileUrl = `/uploads/wiki/${file.filename}`;
            await persistUploadedFile(fileUrl, file.path);

            res.json({
                success: true,
                url: fileUrl,
                filename: file.filename,
                message: successMessage
            });
        } catch (err) {
            console.error(`Erro no processamento da ${logLabel}:`, err);
            res.status(500).json({ success: false, error: 'Erro interno ao processar o arquivo enviado.' });
        }
    });
}

/**
 * POST /api/wiki-golpes/upload-capa
 * Upload de imagem/GIF de capa para o golpe com verificação de magic bytes
 */
router.post('/upload-capa', authenticateToken, authorizeRoles('admin', 'professor'), (req, res) => {
    handleWikiImageUpload(req, res, ['capa', 'foto'], 'Capa do golpe enviada com sucesso!', 'imagem de capa');
});

/**
 * POST /api/wiki-golpes/upload-passo
 * Upload de imagem ilustrativa para um passo do golpe com verificação de magic bytes
 */
router.post('/upload-passo', authenticateToken, authorizeRoles('admin', 'professor'), (req, res) => {
    handleWikiImageUpload(req, res, ['foto', 'passo'], 'Imagem do passo enviada com sucesso!', 'imagem do passo');
});

/**
 * GET /api/wiki-golpes
 * Listagem de golpes cadastrados na Wiki com filtros opcionais (busca, modalidade, categoria)
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { search, modalidade_id, categoria } = req.query;

        let query = `
            SELECT wg.id, wg.nome, wg.modalidade_id, wg.categoria, wg.nivel_dificuldade,
                   wg.descricao_geral, wg.imagem_capa, wg.ativo, wg.created_at, wg.updated_at,
                   m.nome AS modalidade_nome,
                   COUNT(wgp.id) AS total_passos,
                   COALESCE(
                       NULLIF(wg.imagem_capa, ''),
                       (
                           SELECT wgp2.imagem_url
                           FROM wiki_golpe_passos wgp2
                           WHERE wgp2.golpe_id = wg.id AND wgp2.imagem_url IS NOT NULL AND wgp2.imagem_url != ''
                           ORDER BY wgp2.ordem ASC
                           LIMIT 1
                       )
                   ) AS imagem_capa_exibicao
            FROM wiki_golpes wg
            LEFT JOIN modalidades m ON m.id = wg.modalidade_id
            LEFT JOIN wiki_golpe_passos wgp ON wgp.golpe_id = wg.id
            WHERE wg.ativo = 1
        `;

        const params = [];

        if (search && search.trim()) {
            query += ` AND (wg.nome LIKE ? OR wg.descricao_geral LIKE ? OR wg.categoria LIKE ?)`;
            const term = `%${search.trim()}%`;
            params.push(term, term, term);
        }

        if (modalidade_id && !isNaN(parseInt(modalidade_id, 10))) {
            query += ` AND wg.modalidade_id = ?`;
            params.push(parseInt(modalidade_id, 10));
        }

        if (categoria && categoria.trim()) {
            query += ` AND wg.categoria = ?`;
            params.push(categoria.trim());
        }

        query += ` GROUP BY wg.id ORDER BY wg.nome ASC`;

        const [golpes] = await pool.query(query, params);
        res.json({ success: true, golpes });
    } catch (err) {
        console.error('Erro ao listar golpes da wiki:', err);
        res.status(500).json({ success: false, error: 'Erro ao consultar a biblioteca de golpes.' });
    }
});

/**
 * GET /api/wiki-golpes/:id
 * Detalhes de um golpe específico incluindo todos os seus passos em ordem
 */
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const golpeId = parseInt(req.params.id, 10);
        if (isNaN(golpeId)) {
            return res.status(400).json({ success: false, error: 'ID do golpe inválido.' });
        }

        const [golpes] = await pool.query(`
            SELECT wg.id, wg.nome, wg.modalidade_id, wg.categoria, wg.nivel_dificuldade,
                   wg.descricao_geral, wg.imagem_capa, wg.ativo, wg.created_at, wg.updated_at,
                   m.nome AS modalidade_nome
            FROM wiki_golpes wg
            LEFT JOIN modalidades m ON m.id = wg.modalidade_id
            WHERE wg.id = ? AND wg.ativo = 1
        `, [golpeId]);

        if (golpes.length === 0) {
            return res.status(404).json({ success: false, error: 'Golpe não encontrado.' });
        }

        const [passos] = await pool.query(`
            SELECT id, golpe_id, ordem, titulo, descricao, imagem_url, created_at
            FROM wiki_golpe_passos
            WHERE golpe_id = ?
            ORDER BY ordem ASC, id ASC
        `, [golpeId]);

        res.json({
            success: true,
            golpe: {
                ...golpes[0],
                total_passos: passos.length,
                passos
            }
        });
    } catch (err) {
        console.error('Erro ao buscar golpe da wiki:', err);
        res.status(500).json({ success: false, error: 'Erro ao consultar os detalhes do golpe.' });
    }
});

/**
 * POST /api/wiki-golpes
 * Cadastro de novo golpe ou movimento com seus respectivos passos e fotos
 */
router.post('/', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { nome, modalidade_id, categoria, nivel_dificuldade, descricao_geral, imagem_capa, passos } = req.body;

        if (!nome || typeof nome !== 'string' || !nome.trim()) {
            return res.status(400).json({ success: false, error: 'O nome do golpe ou movimento é obrigatório.' });
        }

        if (!Array.isArray(passos) || passos.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'É necessário cadastrar ao menos um passo para a execução do golpe.'
            });
        }

        // Validação de cada passo
        for (let i = 0; i < passos.length; i++) {
            const p = passos[i];
            if (!p.descricao || typeof p.descricao !== 'string' || !p.descricao.trim()) {
                return res.status(400).json({
                    success: false,
                    error: `A descrição do Passo ${i + 1} é obrigatória.`
                });
            }
        }

        const modId = modalidade_id ? parseInt(modalidade_id, 10) : null;
        const cat = categoria ? String(categoria).trim().substring(0, 80) : null;
        const nivel = ['iniciante', 'intermediario', 'avancado'].includes(nivel_dificuldade)
            ? nivel_dificuldade
            : 'iniciante';
        const descGeral = descricao_geral ? String(descricao_geral).trim() : null;
        const imgCapa = imagem_capa ? String(imagem_capa).trim().substring(0, 255) : null;

        await conn.beginTransaction();

        const [insertResult] = await conn.query(`
            INSERT INTO wiki_golpes (nome, modalidade_id, categoria, nivel_dificuldade, descricao_geral, imagem_capa, ativo)
            VALUES (?, ?, ?, ?, ?, ?, 1)
        `, [nome.trim().substring(0, 150), modId, cat, nivel, descGeral, imgCapa]);

        const golpeId = insertResult.insertId;

        // Insere os passos sequencialmente
        for (let idx = 0; idx < passos.length; idx++) {
            const passo = passos[idx];
            const ordem = idx + 1;
            const titulo = passo.titulo ? String(passo.titulo).trim().substring(0, 150) : `Passo ${ordem}`;
            const descricao = String(passo.descricao).trim();
            const imagemUrl = passo.imagem_url ? String(passo.imagem_url).trim().substring(0, 255) : null;

            await conn.query(`
                INSERT INTO wiki_golpe_passos (golpe_id, ordem, titulo, descricao, imagem_url)
                VALUES (?, ?, ?, ?, ?)
            `, [golpeId, ordem, titulo, descricao, imagemUrl]);
        }

        await conn.commit();

        res.status(201).json({
            success: true,
            id: golpeId,
            message: 'Golpe cadastrado com sucesso na Wiki!'
        });
    } catch (err) {
        await conn.rollback();
        console.error('Erro ao cadastrar golpe na wiki:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao salvar o golpe e seus passos.' });
    } finally {
        conn.release();
    }
});

/**
 * PUT /api/wiki-golpes/:id
 * Atualização de golpe existente e de seus passos
 */
router.put('/:id', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const golpeId = parseInt(req.params.id, 10);
        if (isNaN(golpeId)) {
            return res.status(400).json({ success: false, error: 'ID do golpe inválido.' });
        }

        const { nome, modalidade_id, categoria, nivel_dificuldade, descricao_geral, imagem_capa, passos } = req.body;

        if (!nome || typeof nome !== 'string' || !nome.trim()) {
            return res.status(400).json({ success: false, error: 'O nome do golpe ou movimento é obrigatório.' });
        }

        if (!Array.isArray(passos) || passos.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'É necessário cadastrar ao menos um passo para a execução do golpe.'
            });
        }

        for (let i = 0; i < passos.length; i++) {
            const p = passos[i];
            if (!p.descricao || typeof p.descricao !== 'string' || !p.descricao.trim()) {
                return res.status(400).json({
                    success: false,
                    error: `A descrição do Passo ${i + 1} é obrigatória.`
                });
            }
        }

        const modId = modalidade_id ? parseInt(modalidade_id, 10) : null;
        const cat = categoria ? String(categoria).trim().substring(0, 80) : null;
        const nivel = ['iniciante', 'intermediario', 'avancado'].includes(nivel_dificuldade)
            ? nivel_dificuldade
            : 'iniciante';
        const descGeral = descricao_geral ? String(descricao_geral).trim() : null;

        await conn.beginTransaction();

        let imgCapa;
        if (imagem_capa === undefined) {
            const [existRows] = await conn.query(
                `SELECT imagem_capa FROM wiki_golpes WHERE id = ? AND ativo = 1`,
                [golpeId]
            );
            if (existRows.length === 0) {
                await conn.rollback();
                return res.status(404).json({ success: false, error: 'Golpe não encontrado para atualização.' });
            }
            imgCapa = existRows[0].imagem_capa || null;
        } else {
            imgCapa = imagem_capa ? String(imagem_capa).trim().substring(0, 255) : null;
        }

        const [updateResult] = await conn.query(`
            UPDATE wiki_golpes
            SET nome = ?, modalidade_id = ?, categoria = ?, nivel_dificuldade = ?, descricao_geral = ?, imagem_capa = ?
            WHERE id = ? AND ativo = 1
        `, [nome.trim().substring(0, 150), modId, cat, nivel, descGeral, imgCapa, golpeId]);

        if (updateResult.affectedRows === 0) {
            await conn.rollback();
            return res.status(404).json({ success: false, error: 'Golpe não encontrado para atualização.' });
        }

        // Substitui os passos anteriores
        await conn.query(`DELETE FROM wiki_golpe_passos WHERE golpe_id = ?`, [golpeId]);

        for (let idx = 0; idx < passos.length; idx++) {
            const passo = passos[idx];
            const ordem = idx + 1;
            const titulo = passo.titulo ? String(passo.titulo).trim().substring(0, 150) : `Passo ${ordem}`;
            const descricao = String(passo.descricao).trim();
            const imagemUrl = passo.imagem_url ? String(passo.imagem_url).trim().substring(0, 255) : null;

            await conn.query(`
                INSERT INTO wiki_golpe_passos (golpe_id, ordem, titulo, descricao, imagem_url)
                VALUES (?, ?, ?, ?, ?)
            `, [golpeId, ordem, titulo, descricao, imagemUrl]);
        }

        await conn.commit();

        res.json({
            success: true,
            id: golpeId,
            message: 'Golpe e passos atualizados com sucesso!'
        });
    } catch (err) {
        await conn.rollback();
        console.error('Erro ao atualizar golpe na wiki:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao atualizar o golpe.' });
    } finally {
        conn.release();
    }
});

/**
 * DELETE /api/wiki-golpes/:id
 * Exclusão lógica ou física do golpe e de seus passos
 */
router.delete('/:id', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const golpeId = parseInt(req.params.id, 10);
        if (isNaN(golpeId)) {
            return res.status(400).json({ success: false, error: 'ID do golpe inválido.' });
        }

        const [result] = await pool.query(`UPDATE wiki_golpes SET ativo = 0 WHERE id = ?`, [golpeId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Golpe não encontrado para exclusão.' });
        }

        res.json({ success: true, message: 'Golpe removido da Wiki com sucesso!' });
    } catch (err) {
        console.error('Erro ao excluir golpe da wiki:', err);
        res.status(500).json({ success: false, error: 'Erro ao remover o golpe.' });
    }
});

module.exports = router;

