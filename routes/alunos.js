const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const pool = require('../db/connection');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');
const { validateMinorGuardian, hasValidImageSignature } = require('../services/domainRules');
const MatriculaService = require('../services/matriculaService');

// Configuração do Multer para armazenamento de fotos de perfil
const uploadDir = path.join(__dirname, '../public/uploads/alunos');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        const safeExt = allowedExts.includes(ext) ? ext : '.jpg';
        const cleanName = `aluno-${Date.now()}-${Math.round(Math.random() * 1E6)}${safeExt}`;
        cb(null, cleanName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB máx
    fileFilter: (req, file, cb) => {
        const allowedTypes = /^image\/(jpeg|jpg|png|webp)$/;
        const allowedExts = /\.(jpeg|jpg|png|webp)$/;
        const extname = allowedExts.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Apenas imagens nos formatos JPG, PNG ou WEBP são permitidas.'));
    }
});

// POST /api/alunos/upload-foto - Upload de foto de perfil (admin e recepcao)
router.post('/upload-foto', authenticateToken, authorizeRoles('admin', 'recepcao'), (req, res) => {
    upload.single('foto')(req, res, (uploadErr) => {
        if (uploadErr) {
            return res.status(400).json({
                success: false,
                error: uploadErr.code === 'LIMIT_FILE_SIZE'
                    ? 'A imagem excede o limite máximo de 5MB.'
                    : (uploadErr.message || 'Erro no envio do arquivo.')
            });
        }

        try {
            if (!req.file) {
                return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado.' });
            }

            // Verifica assinatura binária real do arquivo contra falsificação de extensão/MIME
            if (!hasValidImageSignature(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
                return res.status(400).json({
                    success: false,
                    error: 'Arquivo inválido: o conteúdo binário não corresponde a uma imagem JPG, PNG ou WEBP legítima.'
                });
            }

            const fileUrl = `/uploads/alunos/${req.file.filename}`;
            res.json({
                success: true,
                message: 'Foto carregada com sucesso!',
                url: fileUrl
            });
        } catch (err) {
            console.error('Erro no upload de foto:', err);
            res.status(500).json({ success: false, error: 'Falha no processamento da imagem.' });
        }
    });
});

// GET /api/alunos - Listagem com filtros, busca e estatísticas básicas (todos os perfis autenticados)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { busca, status, modalidade_id, menor, limit, offset } = req.query;

        let query = `
            SELECT 
                a.id,
                a.nome_completo,
                a.cpf,
                a.data_nascimento,
                TIMESTAMPDIFF(YEAR, a.data_nascimento, CURDATE()) AS idade,
                a.genero,
                a.email,
                a.telefone_whatsapp,
                a.responsavel_nome,
                a.responsavel_telefone,
                a.tipo_sanguineo,
                a.foto_perfil_url,
                a.status,
                a.created_at,
                -- Graduação atual principal
                MAX(gn.nome) AS graduacao_nome,
                MAX(gn.cor_hex_primaria) AS graduacao_cor_primaria,
                MAX(gn.cor_hex_secundaria) AS graduacao_cor_secundaria,
                MAX(m.nome) AS modalidade_nome,
                -- Plano e Matrícula ativa
                MAX(p.nome) AS plano_nome,
                MAX(mat.status) AS matricula_status,
                -- Total de presenças (subquery escalar evita produto cartesiano com faturas)
                (
                    SELECT COUNT(*) 
                    FROM checkins chk 
                    WHERE chk.aluno_id = a.id AND chk.status = 'aprovado'
                ) AS total_presencas,
                -- Status financeiro (contagem exata de faturas atrasadas sem multiplicação por check-ins)
                (
                    SELECT COUNT(*) 
                    FROM faturas f 
                    WHERE f.aluno_id = a.id AND f.status = 'atrasado'
                ) AS faturas_atrasadas
            FROM alunos a
            LEFT JOIN aluno_graduacoes ag ON ag.aluno_id = a.id AND ag.atual = 1
            LEFT JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
            LEFT JOIN modalidades m ON m.id = ag.modalidade_id
            LEFT JOIN matriculas mat ON mat.aluno_id = a.id AND mat.status = 'ativa'
            LEFT JOIN planos p ON p.id = mat.plano_id
            WHERE a.deleted_at IS NULL
        `;

        const params = [];

        if (busca) {
            query += ` AND (a.nome_completo LIKE ? OR a.cpf LIKE ? OR a.email LIKE ? OR a.telefone_whatsapp LIKE ?)`;
            const b = `%${busca}%`;
            params.push(b, b, b, b);
        }

        if (status && status !== 'todos') {
            query += ` AND a.status = ?`;
            params.push(status);
        }

        if (modalidade_id && modalidade_id !== 'todas') {
            query += ` AND ag.modalidade_id = ?`;
            params.push(modalidade_id);
        }

        if (menor === 'sim') {
            query += ` AND TIMESTAMPDIFF(YEAR, a.data_nascimento, CURDATE()) < 18`;
        } else if (menor === 'nao') {
            query += ` AND TIMESTAMPDIFF(YEAR, a.data_nascimento, CURDATE()) >= 18`;
        }

        query += ` GROUP BY a.id ORDER BY a.nome_completo ASC`;

        if (limit !== undefined) {
            const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
            const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
            query += ` LIMIT ? OFFSET ?`;
            params.push(safeLimit, safeOffset);
        }

        const [rows] = await pool.query(query, params);
        res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
        console.error('Erro ao listar alunos:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar alunos.' });
    }
});

// GET /api/alunos/lixeira - Lista de cadastros de alunos na lixeira (soft-deleted) (exclusivo admin)
router.get('/lixeira', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const { busca } = req.query;
        let sql = `
            SELECT 
                a.id,
                a.nome_completo,
                a.cpf,
                a.email,
                a.telefone_whatsapp,
                a.foto_perfil_url,
                a.status,
                a.created_at,
                a.deleted_at,
                TIMESTAMPDIFF(DAY, a.deleted_at, NOW()) AS dias_na_lixeira
            FROM alunos a
            WHERE a.deleted_at IS NOT NULL
        `;
        const params = [];
        if (busca) {
            sql += ` AND (a.nome_completo LIKE ? OR a.cpf LIKE ? OR a.email LIKE ? OR a.telefone_whatsapp LIKE ?)`;
            const b = `%${busca}%`;
            params.push(b, b, b, b);
        }
        sql += ` ORDER BY a.deleted_at DESC`;

        const [rows] = await pool.query(sql, params);
        res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
        console.error('Erro ao listar lixeira de alunos:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar lixeira de alunos.' });
    }
});

// POST /api/alunos/lixeira/esvaziar - Apaga permanentemente todos os cadastros da lixeira (exclusivo admin)
router.post('/lixeira/esvaziar', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query('SELECT id FROM alunos WHERE deleted_at IS NOT NULL');
        let totalExcluidos = 0;

        for (const item of rows) {
            await executarExclusaoPermanente(conn, item.id);
            totalExcluidos++;
        }

        await conn.commit();
        res.json({
            success: true,
            message: `Lixeira esvaziada com sucesso. ${totalExcluidos} cadastro(s) excluído(s) permanentemente.`,
            count: totalExcluidos
        });
    } catch (err) {
        await conn.rollback();
        console.error('Erro ao esvaziar lixeira de alunos:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao esvaziar a lixeira de cadastros.' });
    } finally {
        conn.release();
    }
});

// GET /api/alunos/:id - Dossiê 360 do Aluno (todos autenticados)
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Dados cadastrais do aluno
        const [alunos] = await pool.query(`
            SELECT 
                a.*,
                TIMESTAMPDIFF(YEAR, a.data_nascimento, CURDATE()) AS idade
            FROM alunos a
            WHERE a.id = ? AND a.deleted_at IS NULL
        `, [id]);

        if (alunos.length === 0) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        const aluno = alunos[0];

        // 2. Matrícula e Plano (verificar antes para sincronizar primeira faixa se necessário)
        const [matriculas] = await pool.query(`
            SELECT 
                mat.*,
                p.nome AS plano_nome,
                p.valor_mensal,
                p.limite_checkins_semana
            FROM matriculas mat
            JOIN planos p ON p.id = mat.plano_id
            WHERE mat.aluno_id = ?
            ORDER BY (CASE WHEN mat.status = 'ativa' THEN 1 WHEN mat.status = 'trancada' THEN 2 ELSE 3 END), mat.id DESC
        `, [id]);

        if (matriculas.length > 0 && matriculas[0].status === 'ativa') {
            await MatriculaService.ensureStudentModalityGraduations(pool, id, matriculas[0].plano_id);
        }

        // 3. Histórico de Graduações e Avaliações Técnicas
        const [graduacoes] = await pool.query(`
            SELECT 
                ag.id,
                ag.modalidade_id,
                ag.graduacao_nivel_id,
                ag.data_graduacao,
                ag.observacoes,
                ag.atual,
                gn.nome AS nivel_nome,
                gn.cor_hex_primaria,
                gn.cor_hex_secundaria,
                gn.graus,
                gn.ordem_hierarquica,
                gn.requisitos_lista_json,
                gn.total_itens,
                gn.porcentagem_minima,
                m.nome AS modalidade_nome,
                ue.nome AS professor_avaliador
            FROM aluno_graduacoes ag
            JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
            JOIN modalidades m ON m.id = ag.modalidade_id
            LEFT JOIN usuarios_equipe ue ON ue.id = ag.professor_avaliador_id
            WHERE ag.aluno_id = ?
            ORDER BY ag.atual DESC, ag.data_graduacao DESC
        `, [id]);

        // Carrega avaliações técnicas detalhadas para as graduações ativas do aluno
        const activeGrads = graduacoes.filter(g => g.atual === 1);
        const avaliacoes = [];

        for (const ag of activeGrads) {
            const [evalRows] = await pool.query(`
                SELECT aag.*, ue.nome AS professor_nome
                FROM aluno_avaliacoes_graduacao aag
                LEFT JOIN usuarios_equipe ue ON ue.id = aag.professor_id
                WHERE aag.aluno_id = ? AND aag.modalidade_id = ? AND aag.graduacao_nivel_id = ?
            `, [id, ag.modalidade_id, ag.graduacao_nivel_id]);

            const [nextNivelRows] = await pool.query(`
                SELECT id, nome, cor_hex_primaria, cor_hex_secundaria, ordem_hierarquica, requisitos_lista_json, total_itens, porcentagem_minima
                FROM graduacoes_niveis
                WHERE modalidade_id = ? AND ordem_hierarquica > ?
                ORDER BY ordem_hierarquica ASC
                LIMIT 1
            `, [ag.modalidade_id, ag.ordem_hierarquica]);

            let reqList = [];
            try {
                if (ag.requisitos_lista_json) {
                    reqList = typeof ag.requisitos_lista_json === 'string'
                        ? JSON.parse(ag.requisitos_lista_json)
                        : ag.requisitos_lista_json;
                }
            } catch {}
            if (!Array.isArray(reqList) || reqList.length === 0) {
                reqList = ['Base e postura', 'Fundamentos técnicos', 'Aplicação prática', 'Defesa e bloqueio', 'Conduta marcial'];
            }

            let evalData = evalRows[0] || null;
            let itensAvaliados = [];
            if (evalData && evalData.itens_avaliados_json) {
                try {
                    itensAvaliados = typeof evalData.itens_avaliados_json === 'string'
                        ? JSON.parse(evalData.itens_avaliados_json)
                        : evalData.itens_avaliados_json;
                } catch {}
            }
            if (!Array.isArray(itensAvaliados) || itensAvaliados.length === 0) {
                itensAvaliados = reqList.map(item => ({ item: String(item).trim(), nota: 0 }));
            }

            const totalPossivel = itensAvaliados.length * 5;
            const totalObtido = evalData ? (evalData.total_pontos_obtidos || 0) : 0;
            const pct = totalPossivel > 0 ? (totalObtido / totalPossivel) * 100 : 0;
            const minPct = Number(ag.porcentagem_minima) || 70.00;
            const apto = evalData ? (evalData.apto === 1) : (pct >= minPct);

            avaliacoes.push({
                modalidade_id: ag.modalidade_id,
                modalidade_nome: ag.modalidade_nome,
                graduacao_nivel_id: ag.graduacao_nivel_id,
                nivel_nome: ag.nivel_nome,
                cor_hex_primaria: ag.cor_hex_primaria,
                cor_hex_secundaria: ag.cor_hex_secundaria,
                ordem_hierarquica: ag.ordem_hierarquica,
                porcentagem_minima: minPct,
                total_itens: ag.total_itens || reqList.length,
                requisitos_lista: reqList,
                itens_avaliados: itensAvaliados,
                total_pontos_obtidos: totalObtido,
                total_pontos_possiveis: totalPossivel,
                percentual_obtido: parseFloat(pct.toFixed(2)),
                apto: apto ? 1 : 0,
                observacoes_professor: evalData ? evalData.observacoes_professor : null,
                data_avaliacao: evalData ? evalData.data_avaliacao : null,
                professor_avaliador: evalData ? evalData.professor_nome : null,
                proxima_graduacao: nextNivelRows[0] || null
            });
        }

        // 4. Histórico Financeiro / Faturas
        const [faturas] = await pool.query(`
            SELECT 
                f.id,
                f.competencia,
                f.valor_original,
                f.valor_desconto,
                f.valor_juros_multa,
                f.valor_pago,
                f.data_vencimento,
                f.data_pagamento,
                f.metodo_pagamento,
                f.status,
                f.observacoes
            FROM faturas f
            WHERE f.aluno_id = ?
            ORDER BY f.data_vencimento DESC
        `, [id]);

        // 5. Histórico de Check-ins / Presenças (últimos 30)
        const [checkins] = await pool.query(`
            SELECT 
                c.id,
                c.data_hora_checkin,
                c.metodo,
                c.status,
                m.nome AS modalidade_nome,
                t.nome AS turma_nome
            FROM checkins c
            JOIN modalidades m ON m.id = c.modalidade_id
            LEFT JOIN turmas t ON t.id = c.turma_id
            WHERE c.aluno_id = ?
            ORDER BY c.data_hora_checkin DESC
            LIMIT 30
        `, [id]);

        // 6. Avaliações Contínuas de Desempenho (Clinch-Sparring e Condicionamento)
        const [avaliacoesDesempenho] = await pool.query(`
            SELECT aad.*, ue.nome AS professor_nome
            FROM aluno_avaliacoes_desempenho aad
            LEFT JOIN usuarios_equipe ue ON ue.id = aad.professor_id
            WHERE aad.aluno_id = ?
            ORDER BY aad.data_avaliacao DESC, aad.id DESC
        `, [id]);

        res.json({
            success: true,
            data: {
                aluno,
                graduacoes,
                avaliacoes,
                avaliacoes_desempenho: avaliacoesDesempenho,
                matricula: matriculas[0] || null,
                matriculas_historico: matriculas,
                faturas,
                checkins
            }
        });
    } catch (err) {
        console.error('Erro ao buscar dossiê do aluno:', err);
        res.status(500).json({ success: false, error: 'Erro ao buscar detalhes do aluno.' });
    }
});

// POST /api/alunos - Criar novo aluno (admin e recepcao)
router.post('/', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const {
            nome_completo,
            cpf,
            data_nascimento,
            genero,
            email,
            telefone_whatsapp,
            responsavel_nome,
            responsavel_cpf,
            responsavel_telefone,
            contato_emergencia_nome,
            contato_emergencia_fone,
            tipo_sanguineo,
            observacoes_medicas,
            foto_perfil_url,
            status = 'ativo',
            // Opcionais na criação inicial
            modalidade_id,
            graduacao_nivel_id,
            plano_id,
            dia_vencimento = 10
        } = req.body;

        if (!nome_completo || !data_nascimento || !telefone_whatsapp) {
            await conn.rollback();
            return res.status(400).json({
                success: false,
                error: 'Nome completo, data de nascimento e WhatsApp são campos obrigatórios.'
            });
        }

        // Validação de Menor de Idade via regra de domínio centralizada
        const minorCheck = validateMinorGuardian(data_nascimento, responsavel_nome, responsavel_telefone);
        if (!minorCheck.valid) {
            await conn.rollback();
            return res.status(400).json({
                success: false,
                error: minorCheck.error
            });
        }

        const defaultPasswordHash = await bcrypt.hash('123456', 10);

        // Insere aluno
        const [result] = await conn.query(`
            INSERT INTO alunos (
                nome_completo, cpf, data_nascimento, genero, email, senha_app_hash, telefone_whatsapp,
                responsavel_nome, responsavel_cpf, responsavel_telefone,
                contato_emergencia_nome, contato_emergencia_fone, tipo_sanguineo, observacoes_medicas,
                foto_perfil_url, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            nome_completo.trim(),
            cpf ? cpf.trim() : null,
            data_nascimento,
            genero || 'Outro',
            email ? email.trim().toLowerCase() : null,
            defaultPasswordHash,
            telefone_whatsapp.trim(),
            responsavel_nome ? responsavel_nome.trim() : null,
            responsavel_cpf ? responsavel_cpf.trim() : null,
            responsavel_telefone ? responsavel_telefone.trim() : null,
            contato_emergencia_nome ? contato_emergencia_nome.trim() : null,
            contato_emergencia_fone ? contato_emergencia_fone.trim() : null,
            tipo_sanguineo || null,
            observacoes_medicas ? observacoes_medicas.trim() : null,
            foto_perfil_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(nome_completo)}&background=0284c7&color=fff&size=200`,
            status
        ]);

        const alunoId = result.insertId;

        // Se informou modalidade e nível de graduação inicial
        if (modalidade_id && graduacao_nivel_id) {
            await conn.query(`
                INSERT INTO aluno_graduacoes (
                    aluno_id, modalidade_id, graduacao_nivel_id, data_graduacao, observacoes, atual
                ) VALUES (?, ?, ?, CURDATE(), 'Graduação inicial cadastrada na matrícula.', 1)
            `, [alunoId, modalidade_id, graduacao_nivel_id]);
        }

        // Se informou plano para matrícula imediata (usa MatriculaService centralizado)
        if (plano_id) {
            await MatriculaService.createEnrollmentWithInvoice(conn, {
                alunoId,
                planoId: plano_id,
                diaVencimento: dia_vencimento,
                dueDateMode: 'next_month_if_past'
            });
        }

        await conn.commit();
        res.status(201).json({ success: true, message: 'Aluno cadastrado com sucesso!', id: alunoId });
    } catch (err) {
        await conn.rollback();
        console.error('Erro ao cadastrar aluno:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, error: 'CPF ou E-mail já cadastrado para outro aluno.' });
        }
        res.status(500).json({ success: false, error: 'Erro interno ao cadastrar aluno.' });
    } finally {
        conn.release();
    }
});

// PUT /api/alunos/:id - Atualizar dados do aluno (admin e recepcao)
router.put('/:id', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nome_completo,
            cpf,
            data_nascimento,
            genero,
            email,
            telefone_whatsapp,
            responsavel_nome,
            responsavel_cpf,
            responsavel_telefone,
            contato_emergencia_nome,
            contato_emergencia_fone,
            tipo_sanguineo,
            observacoes_medicas,
            foto_perfil_url,
            status
        } = req.body;

        if (!nome_completo || !data_nascimento || !telefone_whatsapp) {
            return res.status(400).json({
                success: false,
                error: 'Nome completo, data de nascimento e WhatsApp são campos obrigatórios.'
            });
        }

        const [result] = await pool.query(`
            UPDATE alunos SET
                nome_completo = ?,
                cpf = ?,
                data_nascimento = ?,
                genero = ?,
                email = ?,
                telefone_whatsapp = ?,
                responsavel_nome = ?,
                responsavel_cpf = ?,
                responsavel_telefone = ?,
                contato_emergencia_nome = ?,
                contato_emergencia_fone = ?,
                tipo_sanguineo = ?,
                observacoes_medicas = ?,
                foto_perfil_url = ?,
                status = ?
            WHERE id = ? AND deleted_at IS NULL
        `, [
            nome_completo.trim(),
            cpf ? cpf.trim() : null,
            data_nascimento,
            genero || 'Outro',
            email ? email.trim() : null,
            telefone_whatsapp.trim(),
            responsavel_nome ? responsavel_nome.trim() : null,
            responsavel_cpf ? responsavel_cpf.trim() : null,
            responsavel_telefone ? responsavel_telefone.trim() : null,
            contato_emergencia_nome ? contato_emergencia_nome.trim() : null,
            contato_emergencia_fone ? contato_emergencia_fone.trim() : null,
            tipo_sanguineo || null,
            observacoes_medicas ? observacoes_medicas.trim() : null,
            foto_perfil_url || null,
            status || 'ativo',
            id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        res.json({ success: true, message: 'Dados do aluno atualizados com sucesso!' });
    } catch (err) {
        console.error('Erro ao atualizar aluno:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, error: 'CPF ou E-mail já utilizado por outro aluno.' });
        }
        res.status(500).json({ success: false, error: 'Erro interno ao atualizar dados do aluno.' });
    }
});

// PATCH /api/alunos/:id/status - Alterar status rápido (admin e recepcao)
router.patch('/:id/status', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const allowed = ['ativo', 'inativo', 'trancado', 'bloqueado', 'experimental'];
        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, error: 'Status inválido.' });
        }

        const [result] = await pool.query('UPDATE alunos SET status = ? WHERE id = ? AND deleted_at IS NULL', [status, id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        res.json({ success: true, message: `Status do aluno alterado para ${status}.` });
    } catch (err) {
        console.error('Erro ao alterar status:', err);
        res.status(500).json({ success: false, error: 'Erro ao alterar status.' });
    }
});

// POST /api/alunos/:id/graduacoes - Lançar nova graduação / promoção (admin e professor)
router.post('/:id/graduacoes', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const aluno_id = req.params.id;
        const { modalidade_id, graduacao_nivel_id, professor_avaliador_id, data_graduacao, observacoes } = req.body;

        if (!modalidade_id || !graduacao_nivel_id) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'Modalidade e nível de graduação são obrigatórios.' });
        }

        // Desmarca graduação atual anterior para esta modalidade
        await conn.query(`
            UPDATE aluno_graduacoes 
            SET atual = 0 
            WHERE aluno_id = ? AND modalidade_id = ?
        `, [aluno_id, modalidade_id]);

        // Insere nova graduação como atual
        await conn.query(`
            INSERT INTO aluno_graduacoes (
                aluno_id, modalidade_id, graduacao_nivel_id, data_graduacao, professor_avaliador_id, observacoes, atual
            ) VALUES (?, ?, ?, ?, ?, ?, 1)
        `, [
            aluno_id,
            modalidade_id,
            graduacao_nivel_id,
            data_graduacao || new Date().toISOString().slice(0, 10),
            professor_avaliador_id || null,
            observacoes || null
        ]);

        // Inicializa as especificações da nova graduação em aluno_avaliacoes_graduacao
        const [nivelRows] = await conn.query('SELECT requisitos_lista_json, total_itens, porcentagem_minima FROM graduacoes_niveis WHERE id = ?', [graduacao_nivel_id]);
        if (nivelRows.length > 0) {
            let reqs = [];
            try {
                if (nivelRows[0].requisitos_lista_json) {
                    reqs = typeof nivelRows[0].requisitos_lista_json === 'string'
                        ? JSON.parse(nivelRows[0].requisitos_lista_json)
                        : nivelRows[0].requisitos_lista_json;
                }
            } catch {
                reqs = [];
            }
            if (!Array.isArray(reqs) || reqs.length === 0) {
                reqs = ['Base e Postura', 'Fundamentos Técnicos', 'Aplicação Prática', 'Sparring / Rolamento', 'Conduta Marcial'];
            }
            const novosItens = reqs.map(item => ({ item: String(item).trim(), nota: 0 }));
            const totalPossivel = novosItens.length * 5;

            await conn.query(`
                INSERT INTO aluno_avaliacoes_graduacao (
                    aluno_id, modalidade_id, graduacao_nivel_id, professor_id, itens_avaliados_json, total_pontos_obtidos, total_pontos_possiveis, percentual_obtido, apto, data_avaliacao
                ) VALUES (?, ?, ?, ?, ?, 0, ?, 0.00, 0, NOW())
                ON DUPLICATE KEY UPDATE
                    graduacao_nivel_id = VALUES(graduacao_nivel_id),
                    professor_id = VALUES(professor_id),
                    itens_avaliados_json = VALUES(itens_avaliados_json),
                    total_pontos_obtidos = 0,
                    total_pontos_possiveis = VALUES(total_pontos_possiveis),
                    percentual_obtido = 0.00,
                    apto = 0,
                    data_avaliacao = NOW()
            `, [aluno_id, modalidade_id, graduacao_nivel_id, professor_avaliador_id || null, JSON.stringify(novosItens), totalPossivel]);
        }

        await conn.commit();
        res.json({ success: true, message: 'Graduação lançada e atualizada com sucesso!' });
    } catch (err) {
        await conn.rollback();
        console.error('Erro ao lançar graduação:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao registrar graduação.' });
    } finally {
        conn.release();
    }
});

// POST /api/alunos/:id/avaliacoes-graduacao - Lançar / Atualizar notas da avaliação técnica (admin e professor)
router.post('/:id/avaliacoes-graduacao', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const aluno_id = req.params.id;
        const { modalidade_id, graduacao_nivel_id, itens_avaliados, observacoes } = req.body;

        if (!modalidade_id || !graduacao_nivel_id || !Array.isArray(itens_avaliados)) {
            return res.status(400).json({ success: false, error: 'Dados incompletos para registrar avaliação.' });
        }

        const [niveis] = await pool.query(
            'SELECT porcentagem_minima FROM graduacoes_niveis WHERE id = ? AND modalidade_id = ?',
            [graduacao_nivel_id, modalidade_id]
        );
        if (niveis.length === 0) {
            return res.status(404).json({ success: false, error: 'Nível de graduação não encontrado para esta modalidade.' });
        }

        const minPct = Number(niveis[0].porcentagem_minima) || 70.00;

        let totalPontosObtidos = 0;
        const cleanedItens = itens_avaliados.map(i => {
            const nota = Math.min(Math.max(parseInt(i.nota, 10) || 0, 0), 5);
            totalPontosObtidos += nota;
            return {
                item: String(i.item || '').trim(),
                nota
            };
        });

        const totalPontosPossiveis = cleanedItens.length * 5;
        const percentualObtido = totalPontosPossiveis > 0 
            ? parseFloat(((totalPontosObtidos / totalPontosPossiveis) * 100).toFixed(2)) 
            : 0;

        const apto = percentualObtido >= minPct ? 1 : 0;
        const professorId = req.user && req.user.id ? req.user.id : null;

        await pool.query(`
            INSERT INTO aluno_avaliacoes_graduacao (
                aluno_id, modalidade_id, graduacao_nivel_id, professor_id,
                itens_avaliados_json, total_pontos_obtidos, total_pontos_possiveis,
                percentual_obtido, apto, observacoes_professor, data_avaliacao
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                professor_id = VALUES(professor_id),
                itens_avaliados_json = VALUES(itens_avaliados_json),
                total_pontos_obtidos = VALUES(total_pontos_obtidos),
                total_pontos_possiveis = VALUES(total_pontos_possiveis),
                percentual_obtido = VALUES(percentual_obtido),
                apto = VALUES(apto),
                observacoes_professor = VALUES(observacoes_professor),
                data_avaliacao = NOW()
        `, [
            aluno_id,
            modalidade_id,
            graduacao_nivel_id,
            professorId,
            JSON.stringify(cleanedItens),
            totalPontosObtidos,
            totalPontosPossiveis,
            percentualObtido,
            apto,
            observacoes ? String(observacoes).trim() : null
        ]);

        res.json({
            success: true,
            message: apto 
                ? `Avaliação salva! Aluno com aproveitamento de ${percentualObtido}% - APTO para a próxima fase!` 
                : `Avaliação salva! Aluno com aproveitamento de ${percentualObtido}% (Mínimo exigido: ${minPct}%).`,
            data: {
                total_pontos_obtidos: totalPontosObtidos,
                total_pontos_possiveis: totalPontosPossiveis,
                percentual_obtido: percentualObtido,
                porcentagem_minima: minPct,
                apto
            }
        });
    } catch (err) {
        console.error('Erro ao salvar avaliação de graduação:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao salvar avaliação.' });
    }
});

// POST /api/alunos/:id/avaliacoes-desempenho - Registrar avaliação técnica (Clinch, Socos, Chutes, Postura)
router.post('/:id/avaliacoes-desempenho', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const alunoId = parseInt(req.params.id, 10);
        if (isNaN(alunoId) || alunoId <= 0) {
            return res.status(400).json({ success: false, error: 'ID de aluno inválido.' });
        }

        const {
            data_avaliacao,
            nota_clinch,
            nota_socos,
            nota_chutes,
            nota_postura,
            nota_clinch_sparring,
            nota_condicionamento,
            observacoes
        } = req.body;

        // Suporte aos 4 quesitos solicitados: Clinch, Socos, Chutes, Postura (0 a 10)
        // Fallback para campos legados caso enviado por interface antiga
        const rawClinch = parseFloat(nota_clinch !== undefined ? nota_clinch : nota_clinch_sparring);
        const rawSocos = parseFloat(nota_socos !== undefined ? nota_socos : (nota_condicionamento !== undefined ? nota_condicionamento : 0));
        const rawChutes = parseFloat(nota_chutes !== undefined ? nota_chutes : (nota_condicionamento !== undefined ? nota_condicionamento : 0));
        const rawPostura = parseFloat(nota_postura !== undefined ? nota_postura : (nota_clinch_sparring !== undefined ? nota_clinch_sparring : 0));

        if (isNaN(rawClinch) || rawClinch < 0 || rawClinch > 10) {
            return res.status(400).json({ success: false, error: 'A nota de Clinch deve estar entre 0.0 e 10.0.' });
        }
        if (isNaN(rawSocos) || rawSocos < 0 || rawSocos > 10) {
            return res.status(400).json({ success: false, error: 'A nota de Socos deve estar entre 0.0 e 10.0.' });
        }
        if (isNaN(rawChutes) || rawChutes < 0 || rawChutes > 10) {
            return res.status(400).json({ success: false, error: 'A nota de Chutes deve estar entre 0.0 e 10.0.' });
        }
        if (isNaN(rawPostura) || rawPostura < 0 || rawPostura > 10) {
            return res.status(400).json({ success: false, error: 'A nota de Postura deve estar entre 0.0 e 10.0.' });
        }

        // Validação da data
        let dataAval = data_avaliacao;
        if (!dataAval || isNaN(Date.parse(dataAval))) {
            dataAval = new Date().toISOString().split('T')[0];
        }

        const professorId = req.user && req.user.id ? req.user.id : null;
        const cleanObs = observacoes ? String(observacoes).trim().substring(0, 500) : null;

        // Campos legados calculados para compatibilidade
        const legacyClinch = rawClinch;
        const legacyCond = Number(((rawSocos + rawChutes + rawPostura) / 3).toFixed(1));

        const [result] = await pool.query(`
            INSERT INTO aluno_avaliacoes_desempenho 
            (aluno_id, professor_id, data_avaliacao, nota_clinch, nota_socos, nota_chutes, nota_postura, nota_clinch_sparring, nota_condicionamento, observacoes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [alunoId, professorId, dataAval, rawClinch, rawSocos, rawChutes, rawPostura, legacyClinch, legacyCond, cleanObs]);

        res.status(201).json({
            success: true,
            message: 'Avaliação técnica (Clinch, Socos, Chutes, Postura) registrada com sucesso!',
            data: {
                id: result.insertId,
                aluno_id: alunoId,
                data_avaliacao: dataAval,
                nota_clinch: rawClinch,
                nota_socos: rawSocos,
                nota_chutes: rawChutes,
                nota_postura: rawPostura,
                nota_clinch_sparring: legacyClinch,
                nota_condicionamento: legacyCond,
                observacoes: cleanObs
            }
        });
    } catch (err) {
        console.error('Erro ao salvar avaliação de desempenho:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao salvar avaliação de desempenho.' });
    }
});

// GET /api/alunos/:id/avaliacoes-desempenho - Listar avaliações de Clinch-Sparring e Condicionamento
router.get('/:id/avaliacoes-desempenho', authenticateToken, async (req, res) => {
    try {
        const alunoId = parseInt(req.params.id, 10);
        if (isNaN(alunoId) || alunoId <= 0) {
            return res.status(400).json({ success: false, error: 'ID de aluno inválido.' });
        }

        const [rows] = await pool.query(`
            SELECT aad.*, ue.nome AS professor_nome
            FROM aluno_avaliacoes_desempenho aad
            LEFT JOIN usuarios_equipe ue ON ue.id = aad.professor_id
            WHERE aad.aluno_id = ?
            ORDER BY aad.data_avaliacao DESC, aad.id DESC
        `, [alunoId]);

        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('Erro ao buscar avaliações de desempenho:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar avaliações de desempenho.' });
    }
});

// DELETE /api/alunos/:id/avaliacoes-desempenho/:evalId - Excluir avaliação de desempenho
router.delete('/:id/avaliacoes-desempenho/:evalId', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const alunoId = parseInt(req.params.id, 10);
        const evalId = parseInt(req.params.evalId, 10);

        if (isNaN(alunoId) || isNaN(evalId)) {
            return res.status(400).json({ success: false, error: 'Parâmetros inválidos.' });
        }

        const [result] = await pool.query(
            'DELETE FROM aluno_avaliacoes_desempenho WHERE id = ? AND aluno_id = ?',
            [evalId, alunoId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Avaliação não encontrada para este aluno.' });
        }

        res.json({ success: true, message: 'Avaliação de desempenho removida com sucesso.' });
    } catch (err) {
        console.error('Erro ao remover avaliação de desempenho:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao excluir avaliação de desempenho.' });
    }
});

// POST /api/alunos/:id/aprovar-promocao - Promover aluno aprovado para a próxima graduação
router.post('/:id/aprovar-promocao', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const aluno_id = req.params.id;
        const { modalidade_id, graduacao_nivel_id, observacoes } = req.body;

        if (!modalidade_id || !graduacao_nivel_id) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'Modalidade e nível atual são obrigatórios.' });
        }

        const [gradAtual] = await conn.query(`
            SELECT ag.id, gn.ordem_hierarquica, gn.nome AS nivel_nome
            FROM aluno_graduacoes ag
            JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
            WHERE ag.aluno_id = ? AND ag.modalidade_id = ? AND ag.graduacao_nivel_id = ? AND ag.atual = 1
        `, [aluno_id, modalidade_id, graduacao_nivel_id]);

        if (gradAtual.length === 0) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'O aluno não possui esta graduação ativa no momento.' });
        }

        const [proximos] = await conn.query(`
            SELECT id, nome, ordem_hierarquica, requisitos_lista_json, total_itens, porcentagem_minima
            FROM graduacoes_niveis
            WHERE modalidade_id = ? AND ordem_hierarquica > ?
            ORDER BY ordem_hierarquica ASC
            LIMIT 1
        `, [modalidade_id, gradAtual[0].ordem_hierarquica]);

        if (proximos.length === 0) {
            await conn.rollback();
            return res.status(400).json({ success: false, error: 'O aluno já atingiu o nível mais alto desta modalidade!' });
        }

        const proxNivel = proximos[0];
        const professorId = req.user && req.user.id ? req.user.id : null;

        await conn.query(`
            UPDATE aluno_graduacoes 
            SET atual = 0 
            WHERE aluno_id = ? AND modalidade_id = ?
        `, [aluno_id, modalidade_id]);

        await conn.query(`
            INSERT INTO aluno_graduacoes (
                aluno_id, modalidade_id, graduacao_nivel_id, data_graduacao, professor_avaliador_id, observacoes, atual
            ) VALUES (?, ?, ?, CURDATE(), ?, ?, 1)
        `, [
            aluno_id,
            modalidade_id,
            proxNivel.id,
            professorId,
            observacoes || `Aprovado por mérito técnico na fase anterior (${gradAtual[0].nivel_nome}).`
        ]);

        let reqList = [];
        try {
            if (proxNivel.requisitos_lista_json) {
                reqList = typeof proxNivel.requisitos_lista_json === 'string'
                    ? JSON.parse(proxNivel.requisitos_lista_json)
                    : proxNivel.requisitos_lista_json;
            }
        } catch {}
        if (!Array.isArray(reqList) || reqList.length === 0) {
            reqList = ['Base e postura', 'Fundamentos técnicos', 'Aplicação prática', 'Defesa e bloqueio', 'Conduta marcial'];
        }
        const novosItens = reqList.map(item => ({ item: String(item).trim(), nota: 0 }));
        const totalPossivel = novosItens.length * 5;

        await conn.query(`
            INSERT INTO aluno_avaliacoes_graduacao (
                aluno_id, modalidade_id, graduacao_nivel_id, itens_avaliados_json, total_pontos_obtidos, total_pontos_possiveis, percentual_obtido, apto
            ) VALUES (?, ?, ?, ?, 0, ?, 0.00, 0)
            ON DUPLICATE KEY UPDATE
                graduacao_nivel_id = VALUES(graduacao_nivel_id),
                itens_avaliados_json = VALUES(itens_avaliados_json),
                total_pontos_obtidos = 0,
                total_pontos_possiveis = VALUES(total_pontos_possiveis),
                percentual_obtido = 0.00,
                apto = 0
        `, [aluno_id, modalidade_id, proxNivel.id, JSON.stringify(novosItens), totalPossivel]);

        await conn.commit();
        res.json({
            success: true,
            message: `Graduação aprovada com sucesso! Aluno promovido para "${proxNivel.nome}".`,
            data: {
                nova_graduacao: proxNivel
            }
        });
    } catch (err) {
        await conn.rollback();
        console.error('Erro ao aprovar promoção de graduação:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao aprovar promoção.' });
    } finally {
        conn.release();
    }
});

// POST /api/alunos/:id/resetar-senha - Redefinição administrativa de senha do aluno
router.post('/:id/resetar-senha', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const alunoId = parseInt(req.params.id, 10);
        if (isNaN(alunoId) || alunoId <= 0) {
            return res.status(400).json({ success: false, error: 'ID de aluno inválido.' });
        }

        const [alunos] = await pool.query('SELECT id, nome_completo, email FROM alunos WHERE id = ? AND deleted_at IS NULL', [alunoId]);
        if (alunos.length === 0) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }
        const aluno = alunos[0];

        let { nova_senha } = req.body;
        if (nova_senha && typeof nova_senha === 'string') {
            nova_senha = nova_senha.trim();
        }

        // Se nenhuma senha foi fornecida, gera uma senha temporária segura e amigável
        if (!nova_senha) {
            const randomCode = Math.floor(1000 + Math.random() * 9000);
            nova_senha = `Kz@${randomCode}`;
        } else if (nova_senha.length < 6) {
            return res.status(400).json({ success: false, error: 'A nova senha deve possuir no mínimo 6 caracteres.' });
        }

        const senhaHash = await bcrypt.hash(nova_senha, 10);
        const alunoEmail = (aluno.email || `aluno${alunoId}@kaizen.local`).trim().toLowerCase();

        // Atualiza a senha no registro do aluno
        await pool.query('UPDATE alunos SET senha_app_hash = ? WHERE id = ?', [senhaHash, alunoId]);

        // Sincroniza ou cria a conta de login na tabela relacional usuarios_alunos
        await pool.query(`
            INSERT INTO usuarios_alunos (aluno_id, email, senha_hash, status, email_verificado)
            VALUES (?, ?, ?, 'ativo', 1)
            ON DUPLICATE KEY UPDATE 
                senha_hash = VALUES(senha_hash),
                status = 'ativo',
                email_verificado = 1,
                email = VALUES(email)
        `, [alunoId, alunoEmail, senhaHash]);

        // Revoga sessões ativas anteriores do aluno por segurança
        await pool.query(`
            UPDATE sessoes_usuarios 
            SET revogado = 1 
            WHERE usuario_id IN (SELECT id FROM usuarios_alunos WHERE aluno_id = ?)
        `, [alunoId]);

        res.json({
            success: true,
            message: `Senha do aluno "${aluno.nome_completo}" redefinida com sucesso!`,
            aluno_id: alunoId,
            nome_completo: aluno.nome_completo,
            email: aluno.email,
            nova_senha: nova_senha
        });
    } catch (err) {
        console.error('Erro ao resetar senha do aluno:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao redefinir senha do aluno.' });
    }
});

// Helper compartilhado para exclusão física/definitiva de um aluno e de seus dados relacionais em transação
async function executarExclusaoPermanente(conn, alunoId) {
    const [alunoRows] = await conn.query('SELECT id, nome_completo, foto_perfil_url FROM alunos WHERE id = ?', [alunoId]);
    if (alunoRows.length === 0) {
        return null;
    }
    const aluno = alunoRows[0];

    // 1. Exclusão ordenada de registros dependentes (evita conflitos com foreign keys RESTRICT)
    await conn.query('DELETE FROM faturas WHERE aluno_id = ?', [alunoId]);
    await conn.query('DELETE FROM matriculas WHERE aluno_id = ?', [alunoId]);
    await conn.query('DELETE FROM evento_graduacao_convites WHERE aluno_id = ?', [alunoId]);
    await conn.query('DELETE FROM aluno_avaliacoes_desempenho WHERE aluno_id = ?', [alunoId]);
    await conn.query('DELETE FROM aluno_avaliacoes_graduacao WHERE aluno_id = ?', [alunoId]);
    await conn.query('DELETE FROM aluno_conquistas WHERE aluno_id = ?', [alunoId]);
    await conn.query('DELETE FROM aluno_golpes_progresso WHERE aluno_id = ?', [alunoId]);
    await conn.query('DELETE FROM aluno_graduacoes WHERE aluno_id = ?', [alunoId]);
    await conn.query('DELETE FROM aluno_historico_medidas WHERE aluno_id = ?', [alunoId]);
    await conn.query('DELETE FROM checkins WHERE aluno_id = ?', [alunoId]);

    // 2. Exclui sessões, redefinições, verificações de e-mail e conta de usuário
    await conn.query('DELETE FROM sessoes_usuarios WHERE usuario_id IN (SELECT id FROM usuarios_alunos WHERE aluno_id = ?)', [alunoId]);
    await conn.query('DELETE FROM redefinicoes_senha WHERE usuario_id IN (SELECT id FROM usuarios_alunos WHERE aluno_id = ?)', [alunoId]);
    await conn.query('DELETE FROM verificacoes_email WHERE usuario_id IN (SELECT id FROM usuarios_alunos WHERE aluno_id = ?)', [alunoId]);
    await conn.query('DELETE FROM usuarios_alunos WHERE aluno_id = ?', [alunoId]);

    // 3. Exclui o registro principal do aluno
    await conn.query('DELETE FROM alunos WHERE id = ?', [alunoId]);

    // 4. Limpa arquivo físico de foto se for upload local do sistema
    if (aluno.foto_perfil_url && aluno.foto_perfil_url.startsWith('/uploads/alunos/')) {
        const filePath = path.join(__dirname, '..', 'public', aluno.foto_perfil_url);
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {
            // Silencioso se arquivo já não existir
        }
    }

    return aluno;
}

// POST /api/alunos/:id/restaurar - Restaura um cadastro da lixeira de volta para a lista ativa (exclusivo admin)
router.post('/:id/restaurar', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    const alunoId = parseInt(req.params.id, 10);
    if (isNaN(alunoId) || alunoId <= 0) {
        return res.status(400).json({ success: false, error: 'ID de aluno inválido.' });
    }

    try {
        const [alunoRows] = await pool.query('SELECT id, nome_completo, deleted_at FROM alunos WHERE id = ?', [alunoId]);
        if (alunoRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        const aluno = alunoRows[0];
        if (!aluno.deleted_at) {
            return res.status(400).json({ success: false, error: 'Este cadastro já está ativo (não está na lixeira).' });
        }

        await pool.query('UPDATE alunos SET deleted_at = NULL, updated_at = NOW() WHERE id = ?', [alunoId]);
        await pool.query('UPDATE usuarios_alunos SET status = "ativo" WHERE aluno_id = ?', [alunoId]).catch(() => {});

        res.json({
            success: true,
            message: `Cadastro de "${aluno.nome_completo}" restaurado com sucesso!`
        });
    } catch (err) {
        console.error('Erro ao restaurar aluno da lixeira:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao restaurar cadastro.' });
    }
});

// DELETE /api/alunos/:id - Soft Delete: Move o cadastro do aluno para a lixeira (exclusivo admin)
router.delete('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    const alunoId = parseInt(req.params.id, 10);
    if (isNaN(alunoId) || alunoId <= 0) {
        return res.status(400).json({ success: false, error: 'ID de aluno inválido.' });
    }

    try {
        const [alunoRows] = await pool.query('SELECT id, nome_completo, deleted_at FROM alunos WHERE id = ?', [alunoId]);
        if (alunoRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        const aluno = alunoRows[0];
        if (aluno.deleted_at) {
            return res.status(400).json({ success: false, error: 'Este aluno já se encontra na lixeira.' });
        }

        // 1. Marca deleted_at no aluno
        await pool.query('UPDATE alunos SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?', [alunoId]);

        // 2. Desativa acesso de login e encerra sessões ativas
        await pool.query('UPDATE usuarios_alunos SET status = "inativo" WHERE aluno_id = ?', [alunoId]).catch(() => {});
        await pool.query('DELETE FROM sessoes_usuarios WHERE usuario_id IN (SELECT id FROM usuarios_alunos WHERE aluno_id = ?)', [alunoId]).catch(() => {});

        res.json({
            success: true,
            message: `Aluno "${aluno.nome_completo}" movido para a lixeira com sucesso.`
        });
    } catch (err) {
        console.error('Erro ao mover aluno para a lixeira:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao mover aluno para a lixeira.' });
    }
});

// DELETE /api/alunos/:id/permanente - Hard Delete: Exclusão permanente do aluno e de todos os dados vinculados (exclusivo admin)
router.delete('/:id/permanente', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    const alunoId = parseInt(req.params.id, 10);
    if (isNaN(alunoId) || alunoId <= 0) {
        return res.status(400).json({ success: false, error: 'ID de aluno inválido.' });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const aluno = await executarExclusaoPermanente(conn, alunoId);
        if (!aluno) {
            await conn.rollback();
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        await conn.commit();

        res.json({
            success: true,
            message: `Cadastro de "${aluno.nome_completo}" e todos os registros associados foram excluídos permanentemente.`
        });
    } catch (err) {
        await conn.rollback();
        console.error('Erro ao excluir aluno permanentemente:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao excluir aluno do banco de dados.' });
    } finally {
        conn.release();
    }
});

module.exports = router;
