/**
 * PRO COMBATE - Rotas do Painel do Aluno
 * Informações cadastrais, plano, frequência, graduações, avisos, campanhas e conquistas
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db/connection');
const asaasService = require('../services/asaasService');
const { createRateLimiter } = require('../middlewares/auth');
const { hasValidImageSignature } = require('../services/domainRules');
const { persistUploadedFile, removeUploadedFile, resolveOrRestoreUpload } = require('../services/uploadStorage');

/**
 * Garante que foto_perfil_url local existente seja restaurada ou anulada se órfã de deploy antigo
 */
async function sanitizeAlunoPhotoUrl(aluno) {
    if (aluno && aluno.foto_perfil_url && typeof aluno.foto_perfil_url === 'string' && aluno.foto_perfil_url.startsWith('/uploads/alunos/')) {
        const resolvedFoto = await resolveOrRestoreUpload(aluno.foto_perfil_url);
        if (!resolvedFoto) {
            aluno.foto_perfil_url = null;
        }
    }
}

const JWT_SECRET = process.env.JWT_SECRET;

const uploadFotoDir = path.join(__dirname, '../public/uploads/alunos');
if (!fs.existsSync(uploadFotoDir)) {
    fs.mkdirSync(uploadFotoDir, { recursive: true });
}

const fotoAlunoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadFotoDir);
    },
    filename: (req, file, cb) => {
        const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
        const ext = path.extname(file.originalname || '').toLowerCase();
        const safeExt = allowedExts.includes(ext) ? ext : '.jpg';
        cb(null, `perfil-${Date.now()}-${Math.round(Math.random() * 1E6)}${safeExt}`);
    }
});

const uploadFotoPerfilAluno = multer({
    storage: fotoAlunoStorage,
    limits: { fileSize: 6 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /^image\/(jpeg|jpg|png|webp)$/;
        const allowedExts = /\.(jpeg|jpg|png|webp)$/;
        const extname = allowedExts.test(path.extname(file.originalname || '').toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype || '');
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Apenas imagens nos formatos JPG, PNG ou WEBP são permitidas.'));
    }
});

const fotoUploadLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: 'Limite de alterações de foto atingido. Aguarde alguns minutos.'
});

// Catálogo de Recompensas e Desbloqueáveis do Lutador
const CATALOGO_LUVAS = [
    { id: 'padrao', nome: 'Luvas Tradicionais', icone: 'luva-padrao', cor: '#ef4444', req_checkins: 0, descricao: 'Equipamento clássico de entrada no dojo' },
    { id: 'rubro_pro', nome: 'Luvas Rubro Pro', icone: 'luva-rubro', cor: '#b91c1c', req_checkins: 10, descricao: 'Conquistada com 10 treinos dedicados' },
    { id: 'gold_champion', nome: 'Luvas Champion Gold', icone: 'luva-gold', cor: '#f59e0b', req_checkins: 25, descricao: 'Desbloqueio de campeão aos 25 treinos' },
    { id: 'dark_elite', nome: 'Luvas Stealth Carbon', icone: 'luva-dark', cor: '#475569', req_checkins: 40, descricao: 'Armadura de elite aos 40 treinos' }
];

const CATALOGO_TITULOS = [
    { titulo: 'Iniciante Focado', req_checkins: 0, descricao: 'Primeiros passos no caminho marcial' },
    { titulo: 'Guerreiro do Tatame', req_checkins: 5, descricao: 'Constância comprovada nos treinos' },
    { titulo: 'Mestre da Disciplina', req_checkins: 15, descricao: 'Superou a barreira dos 15 treinos' },
    { titulo: 'Espírito de Dragão', req_checkins: 30, descricao: 'Resiliência e força inabalável' },
    { titulo: 'Lenda do Ringue', req_checkins: 50, descricao: 'Veterano consagrado da academia' }
];

// Middleware opcional de autenticação: em produção exige token JWT válido; em dev/teste permite fallback/preview
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    if (token && JWT_SECRET) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
            req.user = decoded;
        } catch {
            req.user = null;
        }
    }
    if (process.env.NODE_ENV === 'production' && !req.user) {
        return res.status(401).json({ success: false, error: 'Autenticação obrigatória.' });
    }
    next();
}

/**
 * POST /api/aluno/foto-perfil
 * Permite ao atleta autenticado alterar sua foto de perfil (câmera ou galeria)
 */
router.post('/foto-perfil', optionalAuth, fotoUploadLimiter, (req, res) => {
    uploadFotoPerfilAluno.single('foto')(req, res, async (uploadErr) => {
        if (uploadErr) {
            return res.status(400).json({
                success: false,
                error: uploadErr.code === 'LIMIT_FILE_SIZE'
                    ? 'A imagem excede o limite máximo permitido de 6MB.'
                    : (uploadErr.message || 'Erro ao processar imagem.')
            });
        }

        const safeRemoveFile = (filePath) => {
            if (!filePath) return;
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        };

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Nenhuma foto foi enviada.'
            });
        }

        if (!hasValidImageSignature(req.file.path)) {
            safeRemoveFile(req.file.path);
            return res.status(400).json({
                success: false,
                error: 'Arquivo inválido: envie uma imagem JPG, PNG ou WEBP legítima.'
            });
        }

        try {
            let alunoId = null;
            if (req.user) {
                alunoId = req.user.aluno_id || (req.user.cargo === 'aluno' ? req.user.id : null);
            }
            if (!alunoId && process.env.NODE_ENV !== 'production') {
                alunoId = parseInt(req.body?.aluno_id || req.query?.aluno_id || '1', 10);
            }

            if (!alunoId || isNaN(alunoId)) {
                safeRemoveFile(req.file.path);
                return res.status(401).json({ success: false, error: 'Autenticação necessária para alterar a foto.' });
            }

            const [alunos] = await pool.query(
                "SELECT id, foto_perfil_url FROM alunos WHERE id = ? AND status != 'inativo' AND deleted_at IS NULL",
                [alunoId]
            );

            if (alunos.length === 0) {
                safeRemoveFile(req.file.path);
                return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
            }

            const antigaUrl = alunos[0].foto_perfil_url;
            const fileUrl = `/uploads/alunos/${req.file.filename}`;
            await persistUploadedFile(fileUrl, req.file.path);

            await pool.query(
                'UPDATE alunos SET foto_perfil_url = ?, face_foto_base_url = ? WHERE id = ? AND deleted_at IS NULL',
                [fileUrl, fileUrl, alunoId]
            );

            if (antigaUrl && typeof antigaUrl === 'string' && antigaUrl.startsWith('/uploads/alunos/') && antigaUrl !== fileUrl) {
                await removeUploadedFile(antigaUrl);
            }

            return res.json({
                success: true,
                message: 'Foto de perfil atualizada com sucesso!',
                foto_perfil_url: fileUrl,
                url: fileUrl
            });
        } catch (err) {
            safeRemoveFile(req.file.path);
            console.error('Erro ao atualizar foto de perfil do aluno:', err);
            return res.status(500).json({ success: false, error: 'Erro interno ao atualizar foto de perfil.' });
        }
    });
});

/**
 * GET /api/aluno/meu-painel
 * Retorna todos os dados consolidados do painel do atleta conforme a interface
 */
router.get('/meu-painel', optionalAuth, async (req, res) => {
    try {
        // Identifica o aluno: preferência pelo usuário autenticado no token JWT
        let alunoId = null;
        if (req.user) {
            alunoId = req.user.aluno_id || (req.user.cargo === 'aluno' ? req.user.id : null);
        }

        // Permite visualização por ID se for admin/equipe ou para visualização direta
        if (!alunoId && req.query.aluno_id) {
            alunoId = parseInt(req.query.aluno_id, 10);
        }

        // Fallback padrão para primeiro aluno caso não especificado (modo demonstração)
        if (!alunoId || isNaN(alunoId)) {
            alunoId = 1;
        }

        // 1. Dados Cadastrais e Físicos do Aluno
        const [alunos] = await pool.query(`
            SELECT id, nome_completo, genero, email, telefone_whatsapp, data_nascimento,
                   foto_perfil_url, peso_kg, altura_cm, torax_cm, cintura_cm, quadril_cm,
                   skin_fighter, avatar_tom, avatar_cabelo, avatar_luva, titulo_ativo, status, created_at
            FROM alunos
            WHERE id = ? AND status != 'inativo' AND deleted_at IS NULL
        `, [alunoId]);

        if (alunos.length === 0) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado ou inativo.' });
        }

        const aluno = alunos[0];
        await sanitizeAlunoPhotoUrl(aluno);

        // Cálculo de Idade
        let idade = null;
        if (aluno.data_nascimento) {
            const birth = new Date(aluno.data_nascimento);
            const now = new Date();
            idade = now.getFullYear() - birth.getFullYear();
            const m = now.getMonth() - birth.getMonth();
            if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) idade--;
        }

        // Cálculo de IMC (Índice de Massa Corporal) - Real e sem dados fictícios
        const peso = aluno.peso_kg !== null && aluno.peso_kg !== undefined ? parseFloat(aluno.peso_kg) : null;
        const alturaCm = aluno.altura_cm !== null && aluno.altura_cm !== undefined ? parseInt(aluno.altura_cm, 10) : null;
        const toraxCm = aluno.torax_cm !== null && aluno.torax_cm !== undefined ? parseFloat(aluno.torax_cm) : null;
        const cinturaCm = aluno.cintura_cm !== null && aluno.cintura_cm !== undefined ? parseFloat(aluno.cintura_cm) : null;
        const quadrilCm = aluno.quadril_cm !== null && aluno.quadril_cm !== undefined ? parseFloat(aluno.quadril_cm) : null;

        let imcValor = null;
        let imcClassificacao = 'Não aferido';
        let imcCor = '#94a3b8'; // neutro
        if (peso && alturaCm && alturaCm > 0) {
            const alturaMetros = alturaCm / 100;
            imcValor = parseFloat((peso / (alturaMetros * alturaMetros)).toFixed(1));
            if (imcValor < 18.5) {
                imcClassificacao = 'Abaixo do peso';
                imcCor = '#38bdf8';
            } else if (imcValor <= 24.9) {
                imcClassificacao = 'Saudável (Ideal)';
                imcCor = '#10b981';
            } else if (imcValor <= 29.9) {
                imcClassificacao = 'Sobrepeso Leve';
                imcCor = '#f59e0b';
            } else {
                imcClassificacao = 'Acima da meta';
                imcCor = '#ef4444';
            }
        }

        // 2. Plano Contratado e Matrícula Ativa
        const [matriculas] = await pool.query(`
            SELECT m.id AS matricula_id, m.status AS matricula_status, m.data_inicio, m.data_fim, m.valor_acordado,
                   p.id AS plano_id, p.nome AS plano_nome, p.descricao AS plano_descricao,
                   p.periodicidade_meses, p.limite_checkins_semana,
                   DATEDIFF(m.data_fim, CURDATE()) AS dias_restantes
            FROM matriculas m
            JOIN planos p ON p.id = m.plano_id
            WHERE m.aluno_id = ? AND m.status = 'ativa'
            ORDER BY m.id DESC
            LIMIT 1
        `, [alunoId]);

        const plano = matriculas.length > 0 ? matriculas[0] : null;

        // 2.1. Faturas e Histórico Financeiro do Aluno (Integração Asaas & Mensalidades)
        const [faturasAluno] = await pool.query(`
            SELECT f.id, f.matricula_id, f.aluno_id, f.competencia, f.valor_original, f.valor_desconto, f.valor_pago,
                   f.data_vencimento, f.data_pagamento, f.metodo_pagamento, f.status,
                   f.asaas_payment_id, f.asaas_invoice_url, f.asaas_pix_qrcode, f.asaas_pix_copia_cola, f.asaas_status,
                   p.nome AS plano_nome,
                   CASE 
                       WHEN f.status = 'atrasado' OR (f.status = 'pendente' AND f.data_vencimento < CURDATE()) THEN 1 
                       ELSE 0 
                   END AS em_atraso,
                   DATEDIFF(CURDATE(), f.data_vencimento) AS dias_atraso
            FROM faturas f
            JOIN matriculas m ON m.id = f.matricula_id
            JOIN planos p ON p.id = m.plano_id
            WHERE f.aluno_id = ? AND f.status != 'cancelado'
            ORDER BY 
                CASE 
                    WHEN f.status = 'atrasado' OR (f.status = 'pendente' AND f.data_vencimento < CURDATE()) THEN 0
                    WHEN f.status = 'pendente' THEN 1
                    ELSE 2
                END,
                f.data_vencimento DESC
            LIMIT 12
        `, [alunoId]);

        const faturasAtrasadas = faturasAluno.filter(f => f.em_atraso === 1);
        const faturaAberta = faturasAluno.find(f => f.status === 'pendente' || f.em_atraso === 1);
        const statusFinanceiro = faturasAtrasadas.length > 0 ? 'atrasado' : (faturaAberta ? 'pendente' : 'em_dia');

        // 3. Frequência e Check-ins
        // 3.1. Presenças no mês atual
        const [checkinsMes] = await pool.query(`
            SELECT COUNT(*) AS total_mes
            FROM checkins
            WHERE aluno_id = ? AND status = 'aprovado'
              AND MONTH(data_hora_checkin) = MONTH(CURDATE())
              AND YEAR(data_hora_checkin) = YEAR(CURDATE())
        `, [alunoId]);
        const totalMes = checkinsMes[0]?.total_mes || 0;

        // 3.2. Total histórico de presenças
        const [checkinsTotal] = await pool.query(`
            SELECT COUNT(*) AS total_geral
            FROM checkins
            WHERE aluno_id = ? AND status = 'aprovado'
        `, [alunoId]);
        const totalGeral = checkinsTotal[0]?.total_geral || 0;

        // 3.3. Fogo de Frequência & Régua Semanal dos 7 Dias (Streak de Treino)
        const agora = new Date();
        const diaSemanaHoje = agora.getDay();
        const diffParaSegunda = (diaSemanaHoje === 0 ? -6 : 1 - diaSemanaHoje);

        const segundaData = new Date(agora);
        segundaData.setDate(agora.getDate() + diffParaSegunda);
        segundaData.setHours(0, 0, 0, 0);

        const domingoData = new Date(segundaData);
        domingoData.setDate(segundaData.getDate() + 6);
        domingoData.setHours(23, 59, 59, 999);

        const formatYMD = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        const inicioSemanaStr = `${formatYMD(segundaData)} 00:00:00`;
        const fimSemanaStr = `${formatYMD(domingoData)} 23:59:59`;

        const [checkinsSemanaRows] = await pool.query(`
            SELECT DATE(data_hora_checkin) AS data_checkin
            FROM checkins
            WHERE aluno_id = ? AND status = 'aprovado'
              AND data_hora_checkin >= ? AND data_hora_checkin <= ?
        `, [alunoId, inicioSemanaStr, fimSemanaStr]);

        const datasCheckinsSemana = new Set(checkinsSemanaRows.map(r => formatYMD(new Date(r.data_checkin))));
        const NOMES_DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
        const hojeYMD = formatYMD(agora);

        const diasSemana = [];
        let totalTreinosSemana = 0;

        // Régua semanal com os 5 dias úteis (Seg a Sex - sem Sáb e Dom)
        for (let i = 0; i < 5; i++) {
            const d = new Date(segundaData);
            d.setDate(segundaData.getDate() + i);
            const dStr = formatYMD(d);
            const presente = datasCheckinsSemana.has(dStr);
            if (presente) totalTreinosSemana++;

            diasSemana.push({
                dia_index: i,
                dia_sigla: NOMES_DIAS[i],
                dia_numero: d.getDate(),
                data: dStr,
                presente,
                is_hoje: dStr === hojeYMD,
                is_passado: dStr < hojeYMD,
                is_futuro: dStr > hojeYMD
            });
        }

        // Caso o atleta tenha treinado no fim de semana (Sáb/Dom), soma no total da semana
        for (let i = 5; i < 7; i++) {
            const d = new Date(segundaData);
            d.setDate(segundaData.getDate() + i);
            const dStr = formatYMD(d);
            if (datasCheckinsSemana.has(dStr)) {
                totalTreinosSemana++;
            }
        }

        // Streak de Semanas Consecutivas
        const [semanasCheckins] = await pool.query(`
            SELECT DISTINCT YEARWEEK(data_hora_checkin, 1) AS yw
            FROM checkins
            WHERE aluno_id = ? AND status = 'aprovado'
            ORDER BY yw DESC
        `, [alunoId]);

        const [semanaAtualRow] = await pool.query('SELECT YEARWEEK(CURDATE(), 1) as cur_yw');
        const curYw = Number(semanaAtualRow[0]?.cur_yw);
        const setSemanas = new Set(semanasCheckins.map(s => Number(s.yw)));
        let streakSemanas = 0;

        let checkYw = curYw;
        if (!setSemanas.has(checkYw)) {
            const [prevWeekRow] = await pool.query('SELECT YEARWEEK(DATE_SUB(CURDATE(), INTERVAL 1 WEEK), 1) as prev_yw');
            checkYw = Number(prevWeekRow[0]?.prev_yw);
        }

        if (setSemanas.has(checkYw)) {
            const [allConsecutive] = await pool.query(`
                SELECT DISTINCT YEARWEEK(data_hora_checkin, 1) AS yw
                FROM checkins
                WHERE aluno_id = ? AND status = 'aprovado' AND YEARWEEK(data_hora_checkin, 1) <= ?
                ORDER BY yw DESC
                LIMIT 52
            `, [alunoId, checkYw]);

            for (let i = 0; i < allConsecutive.length; i++) {
                streakSemanas++;
                if (i < allConsecutive.length - 1) {
                    const thisYw = Number(allConsecutive[i].yw);
                    const nextYw = Number(allConsecutive[i + 1].yw);
                    if (thisYw - nextYw !== 1 && !(thisYw % 100 === 1 && nextYw % 100 >= 52)) {
                        break;
                    }
                }
            }
        }
        if (streakSemanas === 0 && totalTreinosSemana > 0) {
            streakSemanas = 1;
        }

        const metaSemana = (plano && plano.limite_checkins_semana) ? Number(plano.limite_checkins_semana) : 3;
        const streakObj = {
            semanas_consecutivas: streakSemanas,
            total_semana: totalTreinosSemana,
            meta_semana: metaSemana,
            percentual_semana: Math.min(100, Math.round((totalTreinosSemana / metaSemana) * 100)),
            meta_atingida: totalTreinosSemana >= metaSemana,
            dias_semana: diasSemana
        };

        // 3.3. Histórico Real de Avaliações Contínuas de Desempenho e Graduações (Sem dados sintéticos)
        const [desempenhoHistory] = await pool.query(`
            SELECT aad.id, aad.data_avaliacao, 
                   aad.nota_clinch, aad.nota_socos, aad.nota_chutes, aad.nota_postura,
                   aad.nota_clinch_sparring, aad.nota_condicionamento, aad.observacoes,
                   ue.nome AS professor_nome
            FROM aluno_avaliacoes_desempenho aad
            LEFT JOIN usuarios_equipe ue ON ue.id = aad.professor_id
            WHERE aad.aluno_id = ?
            ORDER BY aad.data_avaliacao DESC, aad.id DESC
        `, [alunoId]);

        const [graduacoesHistory] = await pool.query(`
            SELECT aag.id, aag.modalidade_id, aag.graduacao_nivel_id, aag.professor_id,
                   aag.data_avaliacao, aag.percentual_obtido, aag.total_pontos_obtidos, aag.total_pontos_possiveis,
                   aag.apto, aag.observacoes_professor, aag.itens_avaliados_json,
                   gn.nome AS nivel_nome, gn.cor_hex_primaria, gn.cor_hex_secundaria,
                   gn.ordem_hierarquica, gn.porcentagem_minima, gn.requisitos_lista_json,
                   m.nome AS modalidade_nome,
                   ue.nome AS professor_nome
            FROM aluno_avaliacoes_graduacao aag
            JOIN graduacoes_niveis gn ON gn.id = aag.graduacao_nivel_id
            JOIN modalidades m ON m.id = aag.modalidade_id
            LEFT JOIN usuarios_equipe ue ON ue.id = aag.professor_id
            WHERE aag.aluno_id = ?
            ORDER BY gn.ordem_hierarquica DESC, aag.data_avaliacao DESC, aag.id DESC
        `, [alunoId]);

        // Mapeia EXCLUSIVAMENTE os dados que foram de fato lançados no banco
        const ultGradPct = graduacoesHistory.length > 0 
            ? parseFloat(graduacoesHistory[0].percentual_obtido) || 0
            : 0;

        const ultAvaliacao = desempenhoHistory.length > 0 ? desempenhoHistory[0] : null;
        const notasTecnicas = ultAvaliacao ? {
            id: ultAvaliacao.id,
            clinch: Number(parseFloat(ultAvaliacao.nota_clinch !== null && ultAvaliacao.nota_clinch !== undefined ? ultAvaliacao.nota_clinch : (ultAvaliacao.nota_clinch_sparring || 0)).toFixed(1)),
            socos: Number(parseFloat(ultAvaliacao.nota_socos !== null && ultAvaliacao.nota_socos !== undefined ? ultAvaliacao.nota_socos : 0).toFixed(1)),
            chutes: Number(parseFloat(ultAvaliacao.nota_chutes !== null && ultAvaliacao.nota_chutes !== undefined ? ultAvaliacao.nota_chutes : 0).toFixed(1)),
            postura: Number(parseFloat(ultAvaliacao.nota_postura !== null && ultAvaliacao.nota_postura !== undefined ? ultAvaliacao.nota_postura : 0).toFixed(1)),
            data_avaliacao: ultAvaliacao.data_avaliacao,
            professor_nome: ultAvaliacao.professor_nome,
            observacoes: ultAvaliacao.observacoes
        } : {
            id: null,
            clinch: null,
            socos: null,
            chutes: null,
            postura: null,
            data_avaliacao: null,
            professor_nome: null,
            observacoes: null
        };

        const ultClinch = desempenhoHistory.length > 0
            ? parseFloat(desempenhoHistory[0].nota_clinch_sparring || 0)
            : 0;

        const ultCond = desempenhoHistory.length > 0
            ? parseFloat(desempenhoHistory[0].nota_condicionamento || 0)
            : 0;

        let evolucaoDesempenho = desempenhoHistory.map((d, index) => {
            const dataObj = new Date(d.data_avaliacao);
            const dataFormatada = !isNaN(dataObj.getTime())
                ? dataObj.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
                : String(d.data_avaliacao);

            const gradItem = graduacoesHistory[index] || graduacoesHistory[0] || null;
            const gradPct = gradItem ? parseFloat(gradItem.percentual_obtido) || 0 : ultGradPct;
            const clinch = parseFloat(d.nota_clinch_sparring || 0);
            const cond = parseFloat(d.nota_condicionamento || 0);

            // Alturas proporcionais para a coluna vertical empilhada (10 a 50px)
            const roseH = Math.min(50, Math.max(12, Math.round((gradPct / 100) * 48)));
            const cyanH = Math.min(45, Math.max(10, Math.round((clinch / 10) * 40)));
            const amberH = Math.min(42, Math.max(10, Math.round((cond / 10) * 38)));

            return {
                id: d.id,
                label: `Ev ${desempenhoHistory.length - index}`,
                data_avaliacao: d.data_avaliacao,
                data_formatada: dataFormatada,
                nivel_nome: gradItem ? gradItem.nivel_nome : null,
                tecnica_pct: Number(gradPct.toFixed(1)),
                clinch_nota: Number(clinch.toFixed(1)),
                cond_nota: Number(cond.toFixed(1)),
                tecnica_score: `${gradPct.toFixed(0)}%`,
                clinch_score: `${clinch.toFixed(1)}/10`,
                cond_score: `${cond.toFixed(1)}/10`,
                rose: roseH,
                cyan: cyanH,
                amber: amberH,
                observacoes: d.observacoes || null,
                professor_nome: d.professor_nome || null
            };
        }).reverse();

        // Caso haja histórico de graduação lançado mas sem avaliação de clinch ainda:
        if (evolucaoDesempenho.length === 0 && graduacoesHistory.length > 0) {
            evolucaoDesempenho = graduacoesHistory.map((g, index) => {
                const dataObj = new Date(g.data_avaliacao);
                const dataFormatada = !isNaN(dataObj.getTime())
                    ? dataObj.toLocaleDateString('pt-BR')
                    : String(g.data_avaliacao);
                const gradPct = parseFloat(g.percentual_obtido || 0);
                const roseH = Math.min(50, Math.max(12, Math.round((gradPct / 100) * 48)));

                return {
                    id: g.id,
                    label: `Grad ${index + 1}`,
                    data_avaliacao: g.data_avaliacao,
                    data_formatada: dataFormatada,
                    nivel_nome: g.nivel_nome,
                    tecnica_pct: Number(gradPct.toFixed(1)),
                    clinch_nota: 0,
                    cond_nota: 0,
                    tecnica_score: `${gradPct.toFixed(0)}%`,
                    clinch_score: 'N/A',
                    cond_score: 'N/A',
                    rose: roseH,
                    cyan: 12,
                    amber: 10,
                    observacoes: 'Avaliação técnica de graduação',
                    professor_nome: null
                };
            }).reverse();
        }

        // Se não houver lançamentos, mantém array vazio (zero dados sintéticos ou simulados)

        // 4. Graduação Atual & Avaliação Técnica (Priorizando Muay Thai para o Prajied)
        const [graduacoes] = await pool.query(`
            SELECT ag.id AS aluno_graduacao_id, ag.data_graduacao,
                   gn.id AS nivel_id, gn.nome AS nivel_nome, gn.cor_hex_primaria, gn.cor_hex_secundaria,
                   gn.graus, gn.ordem_hierarquica, gn.porcentagem_minima, gn.prajied_icone_url,
                   m.id AS modalidade_id, m.nome AS modalidade_nome
            FROM aluno_graduacoes ag
            JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
            JOIN modalidades m ON m.id = ag.modalidade_id
            WHERE ag.aluno_id = ? AND ag.atual = 1
            ORDER BY (m.nome LIKE '%Muay%') DESC, ag.id DESC
        `, [alunoId]);

        let graduacaoAtual = null;
        let graduacaoMuayThai = null;
        let avaliacaoTecnica = null;

        if (graduacoes.length > 0) {
            graduacaoAtual = graduacoes[0];
            graduacaoMuayThai = graduacoes.find(g => g.modalidade_nome.toLowerCase().includes('muay')) || null;

            // Busca os pontos e percentual na faixa atual (ou avaliação mais recente do aluno)
            const [avaliacoes] = await pool.query(`
                SELECT percentual_obtido, total_pontos_obtidos, total_pontos_possiveis, apto, itens_avaliados_json, observacoes_professor
                FROM aluno_avaliacoes_graduacao
                WHERE aluno_id = ? AND graduacao_nivel_id = ?
                ORDER BY data_avaliacao DESC, id DESC
                LIMIT 1
            `, [alunoId, graduacaoAtual.nivel_id]);

            if (avaliacoes.length > 0) {
                avaliacaoTecnica = avaliacoes[0];
            } else {
                const [outrasAvaliacoes] = await pool.query(`
                    SELECT percentual_obtido, total_pontos_obtidos, total_pontos_possiveis, apto, itens_avaliados_json, observacoes_professor
                    FROM aluno_avaliacoes_graduacao
                    WHERE aluno_id = ?
                    ORDER BY data_avaliacao DESC, id DESC
                    LIMIT 1
                `, [alunoId]);
                if (outrasAvaliacoes.length > 0) {
                    avaliacaoTecnica = outrasAvaliacoes[0];
                }
            }
        }

        // 4.1. Golpes e Movimentos Técnicos vinculados à Faixa Atual e Anteriores (Currículo da Wiki)
        let faixasProgresso = [];
        let faixaAtualObj = null;
        let faixasAnteriores = [];

        if (graduacaoAtual && graduacaoAtual.nivel_id) {
            // Busca a faixa atual e todas as faixas anteriores dessa modalidade até a ordem hierárquica atual
            const [niveisProgresso] = await pool.query(`
                SELECT gn.id AS nivel_id, gn.nome AS nivel_nome, gn.ordem_hierarquica,
                       gn.cor_hex_primaria, gn.cor_hex_secundaria,
                       m.id AS modalidade_id, m.nome AS modalidade_nome,
                       (gn.id = ?) AS is_atual
                FROM graduacoes_niveis gn
                JOIN modalidades m ON m.id = gn.modalidade_id
                WHERE gn.modalidade_id = ? AND gn.ordem_hierarquica <= ?
                ORDER BY gn.ordem_hierarquica DESC
            `, [graduacaoAtual.nivel_id, graduacaoAtual.modalidade_id, graduacaoAtual.ordem_hierarquica || 99]);

            for (const nivel of niveisProgresso) {
                const [golpesRows] = await pool.query(`
                    SELECT wg.id, wg.nome, wg.categoria, wg.nivel_dificuldade, wg.descricao_geral, wg.imagem_capa,
                           m.nome AS modalidade_nome,
                           COALESCE(agp.status, 'em_treino') AS status_progresso,
                           (agp.status = 'dominado') AS is_dominado,
                           (SELECT COUNT(*) FROM wiki_golpe_passos wgp WHERE wgp.golpe_id = wg.id) AS total_passos
                    FROM graduacao_nivel_golpes gng
                    JOIN wiki_golpes wg ON wg.id = gng.golpe_id
                    LEFT JOIN modalidades m ON m.id = wg.modalidade_id
                    LEFT JOIN aluno_golpes_progresso agp ON agp.golpe_id = wg.id AND agp.aluno_id = ?
                    WHERE gng.graduacao_nivel_id = ?
                    ORDER BY wg.categoria ASC, wg.nome ASC
                `, [alunoId, nivel.nivel_id]);

                const itemFaixa = {
                    nivel_id: nivel.nivel_id,
                    nivel_nome: nivel.nivel_nome,
                    ordem_hierarquica: nivel.ordem_hierarquica,
                    is_atual: Boolean(nivel.is_atual),
                    status_tipo: nivel.is_atual ? 'atual' : 'anterior',
                    status_label: nivel.is_atual ? 'Faixa Atual (Foco de Treino)' : 'Graduação Anterior (Concluída)',
                    cor_primaria: nivel.cor_hex_primaria,
                    cor_secundaria: nivel.cor_hex_secundaria,
                    modalidade_id: nivel.modalidade_id,
                    modalidade_nome: nivel.modalidade_nome,
                    total_golpes: golpesRows.length,
                    golpes: golpesRows.map(g => ({
                        ...g,
                        is_dominado: Boolean(g.is_dominado),
                        status_progresso: g.status_progresso || 'em_treino',
                        nivel_id: nivel.nivel_id,
                        nivel_nome: nivel.nivel_nome,
                        is_faixa_atual: Boolean(nivel.is_atual),
                        faixa_tipo: nivel.is_atual ? 'atual' : 'anterior',
                        faixa_badge_label: nivel.is_atual ? `⭐ Faixa Atual: ${nivel.nivel_nome}` : `✓ Faixa Anterior: ${nivel.nivel_nome}`
                    }))
                };

                faixasProgresso.push(itemFaixa);
                if (nivel.is_atual) {
                    faixaAtualObj = itemFaixa;
                } else {
                    faixasAnteriores.push(itemFaixa);
                }
            }
        }

        const golpesFaixaAtual = faixaAtualObj ? faixaAtualObj.golpes : [];

        // Cálculo da Barra de Prontidão para o Exame de Faixa (Gamificação da Wiki)
        const totalGolpesFaixa = golpesFaixaAtual.length;
        const golpesDominados = golpesFaixaAtual.filter(g => g.status_progresso === 'dominado').length;
        const golpesEmTreino = Math.max(0, totalGolpesFaixa - golpesDominados);
        const percentualProntidao = totalGolpesFaixa > 0 ? Math.round((golpesDominados / totalGolpesFaixa) * 100) : 0;
        const metaProntidao = Number(graduacaoAtual ? graduacaoAtual.porcentagem_minima : 70) || 70;
        const aptoExame = totalGolpesFaixa > 0 && percentualProntidao >= metaProntidao;

        const prontidaoExame = {
            total_golpes: totalGolpesFaixa,
            golpes_dominados: golpesDominados,
            golpes_em_treino: golpesEmTreino,
            percentual_prontidao: percentualProntidao,
            meta_minima: metaProntidao,
            apto_exame: aptoExame,
            nivel_id: graduacaoAtual ? graduacaoAtual.nivel_id : null,
            nivel_nome: graduacaoAtual ? graduacaoAtual.nivel_nome : 'Iniciante (Sem graduação)'
        };

        let proximaGraduacao = null;
        if (graduacaoAtual && graduacaoAtual.modalidade_id) {
            const [proxRows] = await pool.query(`
                SELECT gn.id AS nivel_id, gn.nome AS nivel_nome, gn.cor_hex_primaria, gn.cor_hex_secundaria,
                       gn.ordem_hierarquica, gn.porcentagem_minima, gn.prajied_icone_url
                FROM graduacoes_niveis gn
                WHERE gn.modalidade_id = ? AND gn.ordem_hierarquica = ?
                LIMIT 1
            `, [graduacaoAtual.modalidade_id, (graduacaoAtual.ordem_hierarquica || 1) + 1]);
            if (proxRows.length > 0) {
                proximaGraduacao = proxRows[0];
            }
        }

        let exameProximo = null;
        try {
            let modFilter = '';
            const exameParams = [alunoId];
            if (graduacaoAtual && graduacaoAtual.modalidade_id) {
                modFilter = ' AND (eg.modalidade_id IS NULL OR eg.modalidade_id = ?)';
                exameParams.push(graduacaoAtual.modalidade_id);
            }

            const [exameRows] = await pool.query(`
                SELECT eg.id, eg.titulo, eg.modalidade_id, eg.data_evento, eg.horario_inicio, eg.local_evento,
                       eg.taxa_inscricao, eg.descricao, eg.data_limite_inscricao,
                       c.status AS convite_status, c.id AS convite_id, c.valor AS convite_valor,
                       c.asaas_payment_id, c.asaas_invoice_url, c.asaas_pix_qrcode, c.asaas_pix_copia_cola
                FROM eventos_graduacao eg
                LEFT JOIN evento_graduacao_convites c ON c.evento_id = eg.id AND c.aluno_id = ?
                WHERE eg.status IN ('aberto', 'em_andamento') AND eg.data_evento >= CURDATE() ${modFilter}
                ORDER BY eg.data_evento ASC
                LIMIT 1
            `, exameParams);
            if (exameRows.length > 0) {
                exameProximo = exameRows[0];
            }
        } catch {
            // Em caso de tabela de eventos não existir em algum ambiente
        }

        // 5. Histórico de Graduações Conquistadas
        const [historicoGraduacoes] = await pool.query(`
            SELECT ag.id, ag.data_graduacao, ag.observacoes, ag.atual,
                   gn.nome AS nivel_nome, gn.cor_hex_primaria, gn.cor_hex_secundaria,
                   m.nome AS modalidade_nome
            FROM aluno_graduacoes ag
            JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
            JOIN modalidades m ON m.id = ag.modalidade_id
            WHERE ag.aluno_id = ?
            ORDER BY gn.ordem_hierarquica ASC
        `, [alunoId]);

        // 6. Avisos e Campanhas da Academia
        const [avisos] = await pool.query(`
            SELECT id, titulo, tipo, descricao, data_evento, tag_destaque, created_at
            FROM avisos_campanhas
            WHERE ativo = 1
            ORDER BY id ASC
            LIMIT 6
        `);

        // 7. Conquistas e Badges
        const [conquistas] = await pool.query(`
            SELECT c.id, c.codigo, c.titulo, c.descricao, c.icone, c.categoria,
                   (ac.id IS NOT NULL) AS desbloqueada,
                   ac.data_desbloqueio
            FROM conquistas c
            LEFT JOIN aluno_conquistas ac ON ac.conquista_id = c.id AND ac.aluno_id = ?
            ORDER BY c.id ASC
        `, [alunoId]);

        // 8. Histórico de Medidas Físicas e Comparativo de Evolução
        const [historicoMedidas] = await pool.query(`
            SELECT id, data_medicao, peso_kg, altura_cm, torax_cm, cintura_cm, quadril_cm,
                   braco_cm, coxa_cm, imc, imc_classificacao, observacoes, created_at
            FROM aluno_historico_medidas
            WHERE aluno_id = ?
            ORDER BY data_medicao DESC, id DESC
            LIMIT 12
        `, [alunoId]);

        let ultimasMedidasDelta = {
            peso: { delta: 0, arrow: 'equal' },
            torax: { delta: 0, arrow: 'equal' },
            cintura: { delta: 0, arrow: 'equal' },
            quadril: { delta: 0, arrow: 'equal' },
            imc: { delta: 0, arrow: 'equal' }
        };
        let diasUltimaChecagem = 'Sem aferição';
        let shapeName = 'Aguardando Avaliação';

        if (historicoMedidas.length > 0) {
            const latest = historicoMedidas[0];
            const prev = historicoMedidas.length > 1 ? historicoMedidas[1] : null;

            // Dias desde última checagem
            const dateLatest = new Date(latest.data_medicao);
            const dateNow = new Date();
            const diffDays = Math.max(0, Math.floor((dateNow - dateLatest) / (1000 * 60 * 60 * 24)));
            if (diffDays === 0) diasUltimaChecagem = 'Hoje';
            else if (diffDays === 1) diasUltimaChecagem = 'Ontem';
            else diasUltimaChecagem = `Há ${diffDays} dias`;

            if (prev) {
                const dPeso = Number((latest.peso_kg - prev.peso_kg).toFixed(1));
                const dTorax = Number(((latest.torax_cm || 0) - (prev.torax_cm || 0)).toFixed(1));
                const dCintura = Number(((latest.cintura_cm || 0) - (prev.cintura_cm || 0)).toFixed(1));
                const dQuadril = Number(((latest.quadril_cm || 0) - (prev.quadril_cm || 0)).toFixed(1));
                const dImc = Number((latest.imc - prev.imc).toFixed(1));

                ultimasMedidasDelta = {
                    peso: { delta: dPeso, arrow: dPeso > 0 ? 'up' : dPeso < 0 ? 'down' : 'equal' },
                    torax: { delta: dTorax, arrow: dTorax > 0 ? 'up' : dTorax < 0 ? 'down' : 'equal' },
                    cintura: { delta: dCintura, arrow: dCintura > 0 ? 'up' : dCintura < 0 ? 'down' : 'equal' },
                    quadril: { delta: dQuadril, arrow: dQuadril > 0 ? 'up' : dQuadril < 0 ? 'down' : 'equal' },
                    imc: { delta: dImc, arrow: dImc > 0 ? 'up' : dImc < 0 ? 'down' : 'equal' }
                };
            }

            // Determina Biotipo / Shape Marcial com base no tórax e cintura
            if (latest.torax_cm && latest.cintura_cm) {
                const ratio = latest.torax_cm / latest.cintura_cm;
                if (ratio >= 1.25) shapeName = 'Triângulo Invertido (V-Taper)';
                else if (ratio >= 1.15) shapeName = 'Perfil Atlético / Kombat';
                else shapeName = 'Condicionamento em Evolução';
            }
        }

        // Identifica opções de avatar baseado no gênero e tom
        const isFeminino = String(aluno.genero || '').toUpperCase() === 'F';
        const tomPele = (aluno.avatar_tom === 'negra') ? 'negra' : 'branca';
        const modeloBase = isFeminino 
            ? (tomPele === 'negra' ? 'mulher-negra.png' : 'mulher-branca.png')
            : (tomPele === 'negra' ? 'homem-negro.png' : 'homem-branco.png');

        const defaultCabelo = isFeminino ? 'cabelo-mulher-1.png' : 'cabelo-homem-1.png';
        const cabeloEscolhido = aluno.avatar_cabelo || defaultCabelo;
        const luvaEscolhida = aluno.avatar_luva || 'padrao';
        const tituloEscolhido = aluno.titulo_ativo || 'Iniciante Focado';

        // Recompensas e Desbloqueáveis do Lutador baseados na assiduidade real
        const recompensas = {
            total_checkins: totalGeral,
            luvas: CATALOGO_LUVAS.map(luva => ({
                ...luva,
                desbloqueada: totalGeral >= luva.req_checkins,
                equipada: luvaEscolhida === luva.id,
                faltam_checkins: Math.max(0, luva.req_checkins - totalGeral)
            })),
            titulos: CATALOGO_TITULOS.map(t => ({
                ...t,
                desbloqueado: totalGeral >= t.req_checkins,
                ativo: tituloEscolhido === t.titulo,
                faltam_checkins: Math.max(0, t.req_checkins - totalGeral)
            }))
        };

        // Resposta consolidada para a interface
        res.json({
            success: true,
            aluno: {
                id: aluno.id,
                nome_completo: aluno.nome_completo,
                primeiro_nome: aluno.nome_completo.split(' ')[0],
                genero: isFeminino ? 'F' : 'M',
                avatar_tom: tomPele,
                avatar_cabelo: cabeloEscolhido,
                avatar_luva: luvaEscolhida,
                titulo_ativo: tituloEscolhido,
                avatar: {
                    genero: isFeminino ? 'F' : 'M',
                    tom: tomPele,
                    modelo_base: modeloBase,
                    base_url: `/assets/avatar/${modeloBase}`,
                    cabelo: cabeloEscolhido,
                    cabelo_url: `/assets/avatar/${cabeloEscolhido}`,
                    luva: luvaEscolhida,
                    titulo: tituloEscolhido
                },
                email: aluno.email,
                telefone: aluno.telefone_whatsapp,
                idade,
                foto_perfil_url: aluno.foto_perfil_url,
                skin_fighter: aluno.skin_fighter || 'mt-skin-1.jpg',
                status: aluno.status,
                medidas: {
                    peso_kg: peso,
                    altura_cm: alturaCm,
                    torax_cm: toraxCm,
                    cintura_cm: cinturaCm,
                    quadril_cm: quadrilCm,
                    imc: imcValor,
                    imc_classificacao: imcClassificacao,
                    imc_cor: imcCor,
                    dias_ultima_checagem: diasUltimaChecagem,
                    shape_name: shapeName,
                    deltas: ultimasMedidasDelta
                },
                notas_tecnicas: notasTecnicas,
                historico_medidas: historicoMedidas
            },
            plano: plano ? {
                matricula_id: plano.matricula_id,
                nome: plano.plano_nome,
                descricao: plano.plano_descricao,
                status: plano.matricula_status,
                data_inicio: plano.data_inicio,
                data_fim: plano.data_fim,
                dias_restantes: plano.dias_restantes,
                valor_mensal: Number(plano.valor_acordado),
                limite_semana: plano.limite_checkins_semana ? `${plano.limite_checkins_semana}x/sem` : 'Livre',
                status_financeiro: statusFinanceiro,
                has_atraso: faturasAtrasadas.length > 0,
                total_atrasadas: faturasAtrasadas.length,
                dias_maior_atraso: faturasAtrasadas.length > 0 ? Math.max(...faturasAtrasadas.map(f => f.dias_atraso || 0)) : 0,
                fatura_aberta: faturaAberta ? {
                    id: faturaAberta.id,
                    competencia: faturaAberta.competencia,
                    plano_nome: faturaAberta.plano_nome,
                    valor: Number(faturaAberta.valor_original),
                    data_vencimento: faturaAberta.data_vencimento,
                    em_atraso: Boolean(faturaAberta.em_atraso),
                    dias_atraso: Math.max(0, faturaAberta.dias_atraso || 0),
                    asaas_payment_id: faturaAberta.asaas_payment_id,
                    asaas_invoice_url: faturaAberta.asaas_invoice_url,
                    asaas_pix_qrcode: faturaAberta.asaas_pix_qrcode,
                    asaas_pix_copia_cola: faturaAberta.asaas_pix_copia_cola,
                    asaas_status: faturaAberta.asaas_status
                } : null,
                faturas: faturasAluno.map(f => ({
                    id: f.id,
                    competencia: f.competencia,
                    plano_nome: f.plano_nome,
                    valor: Number(f.valor_original),
                    valor_pago: f.valor_pago ? Number(f.valor_pago) : null,
                    data_vencimento: f.data_vencimento,
                    data_pagamento: f.data_pagamento,
                    metodo_pagamento: f.metodo_pagamento,
                    status: f.em_atraso ? 'atrasado' : f.status,
                    em_atraso: Boolean(f.em_atraso),
                    dias_atraso: Math.max(0, f.dias_atraso || 0),
                    asaas_invoice_url: f.asaas_invoice_url,
                    asaas_pix_copia_cola: f.asaas_pix_copia_cola
                }))
            } : null,
            frequencia: {
                total_mes: totalMes,
                total_geral: totalGeral,
                meta_mensal: 16,
                percentual_meta: Math.min(100, Math.round((totalMes / 16) * 100)),
                streak: streakObj,
                activity_growth: evolucaoDesempenho,
                evolucao_desempenho: evolucaoDesempenho,
                ultimas_notas: {
                    tecnica_graduacao: ultGradPct,
                    clinch_sparring: ultClinch,
                    condicionamento: ultCond
                }
            },
            prontidao_exame: prontidaoExame,
            recompensas: recompensas,
            graduacao: {
                atual: graduacaoAtual ? {
                    nivel_id: graduacaoAtual.nivel_id,
                    nivel_nome: graduacaoAtual.nivel_nome,
                    modalidade: graduacaoAtual.modalidade_nome,
                    cor_primaria: graduacaoAtual.cor_hex_primaria,
                    cor_secundaria: graduacaoAtual.cor_hex_secundaria,
                    porcentagem_minima: graduacaoAtual.porcentagem_minima,
                    data_graduacao: graduacaoAtual.data_graduacao,
                    golpes: golpesFaixaAtual,
                    total_golpes: golpesFaixaAtual.length
                } : null,
                muay_thai: graduacaoMuayThai ? {
                    nivel_id: graduacaoMuayThai.nivel_id,
                    nivel_nome: graduacaoMuayThai.nivel_nome,
                    modalidade: graduacaoMuayThai.modalidade_nome,
                    cor_primaria: graduacaoMuayThai.cor_hex_primaria,
                    cor_secundaria: graduacaoMuayThai.cor_hex_secundaria || graduacaoMuayThai.cor_hex_primaria,
                    ordem_hierarquica: graduacaoMuayThai.ordem_hierarquica,
                    porcentagem_minima: graduacaoMuayThai.porcentagem_minima,
                    prajied_icone_url: graduacaoMuayThai.prajied_icone_url || `/assets/prajied/prajied-${Math.min(12, Math.max(1, graduacaoMuayThai.ordem_hierarquica || 1))}.png`,
                    data_graduacao: graduacaoMuayThai.data_graduacao
                } : null,
                avaliacao: avaliacaoTecnica ? {
                    percentual_obtido: parseFloat(avaliacaoTecnica.percentual_obtido) || 0,
                    pontos_obtidos: avaliacaoTecnica.total_pontos_obtidos,
                    pontos_possiveis: avaliacaoTecnica.total_pontos_possiveis,
                    apto: avaliacaoTecnica.apto === 1,
                    observacoes: avaliacaoTecnica.observacoes_professor
                } : null,
                historico: historicoGraduacoes,
                avaliacoes: graduacoesHistory.map(g => {
                    let itens = [];
                    try {
                        if (g.itens_avaliados_json) {
                            itens = typeof g.itens_avaliados_json === 'string'
                                ? JSON.parse(g.itens_avaliados_json)
                                : g.itens_avaliados_json;
                        }
                    } catch {
                        itens = [];
                    }
                    if (!Array.isArray(itens) || itens.length === 0) {
                        let reqs = [];
                        try {
                            if (g.requisitos_lista_json) {
                                reqs = typeof g.requisitos_lista_json === 'string'
                                    ? JSON.parse(g.requisitos_lista_json)
                                    : g.requisitos_lista_json;
                            }
                        } catch {
                            reqs = [];
                        }
                        if (Array.isArray(reqs) && reqs.length > 0) {
                            itens = reqs.map(r => ({ item: String(r).trim(), nota: 0 }));
                        } else {
                            itens = [];
                        }
                    }
                    return {
                        id: g.id,
                        modalidade_id: g.modalidade_id,
                        modalidade_nome: g.modalidade_nome,
                        graduacao_nivel_id: g.graduacao_nivel_id,
                        nivel_nome: g.nivel_nome,
                        cor_primaria: g.cor_hex_primaria,
                        cor_secundaria: g.cor_hex_secundaria || g.cor_hex_primaria,
                        ordem_hierarquica: g.ordem_hierarquica,
                        porcentagem_minima: parseFloat(g.porcentagem_minima) || 70,
                        professor_nome: g.professor_nome || null,
                        data_avaliacao: g.data_avaliacao,
                        total_pontos_obtidos: Number(g.total_pontos_obtidos) || 0,
                        total_pontos_possiveis: Number(g.total_pontos_possiveis) || (itens.length * 5),
                        percentual_obtido: parseFloat(g.percentual_obtido) || 0,
                        apto: g.apto === 1,
                        observacoes_professor: g.observacoes_professor || null,
                        itens_avaliados: itens.map(it => ({
                            item: String(it.item || '').trim(),
                            nota: Math.min(Math.max(parseInt(it.nota, 10) || 0, 0), 5)
                        })),
                        is_atual: Boolean(
                            graduacaoAtual &&
                            graduacaoAtual.nivel_id === g.graduacao_nivel_id &&
                            graduacaoAtual.modalidade_id === g.modalidade_id
                        )
                    };
                }),
                proxima_graduacao: proximaGraduacao,
                faixas_progresso: faixasProgresso,
                faixa_atual: faixaAtualObj,
                faixas_anteriores: faixasAnteriores
            },
            exame_proximo: exameProximo,
            avisos_campanhas: avisos,
            conquistas,
            notas_tecnicas: notasTecnicas,
            golpes_faixa_atual: golpesFaixaAtual,
            faixas_progresso: faixasProgresso,
            faixa_atual: faixaAtualObj,
            faixas_anteriores: faixasAnteriores
        });

    } catch (err) {
        console.error('Erro ao carregar painel do aluno:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar painel do atleta.' });
    }
});

/**
 * GET /api/aluno/curriculo
 * Retorna o currículo técnico completo do aluno: faixa atual e graduações anteriores com suas técnicas
 */
router.get('/curriculo', optionalAuth, async (req, res) => {
    try {
        let alunoId = null;
        if (req.user) {
            alunoId = req.user.aluno_id || (req.user.cargo === 'aluno' ? req.user.id : null);
        }
        if (!alunoId && req.query.aluno_id) {
            alunoId = parseInt(req.query.aluno_id, 10);
        }
        if (!alunoId || isNaN(alunoId)) alunoId = 1;

        // Dados cadastrais essenciais do aluno
        const [alunos] = await pool.query(`
            SELECT id, nome_completo, foto_perfil_url, genero
            FROM alunos
            WHERE id = ? AND status != 'inativo' AND deleted_at IS NULL
        `, [alunoId]);

        if (alunos.length === 0) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado ou inativo.' });
        }
        const aluno = alunos[0];
        await sanitizeAlunoPhotoUrl(aluno);

        // Graduação atual do aluno
        const [graduacoes] = await pool.query(`
            SELECT ag.graduacao_nivel_id, gn.id AS nivel_id, gn.nome AS nivel_nome, gn.ordem_hierarquica,
                   gn.cor_hex_primaria, gn.cor_hex_secundaria, m.id AS modalidade_id, m.nome AS modalidade_nome
            FROM aluno_graduacoes ag
            JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
            JOIN modalidades m ON m.id = ag.modalidade_id
            WHERE ag.aluno_id = ? AND ag.atual = 1
            ORDER BY (m.nome LIKE '%Muay%') DESC, ag.id DESC
            LIMIT 1
        `, [alunoId]);

        if (graduacoes.length === 0) {
            return res.json({
                success: true,
                aluno: {
                    id: aluno.id,
                    nome_completo: aluno.nome_completo,
                    primeiro_nome: aluno.nome_completo.split(' ')[0],
                    foto_perfil_url: aluno.foto_perfil_url
                },
                modalidade_nome: null,
                faixa_atual: null,
                faixas_anteriores: [],
                faixas_progresso: []
            });
        }

        const gradAtual = graduacoes[0];

        const [niveisProgresso] = await pool.query(`
            SELECT gn.id AS nivel_id, gn.nome AS nivel_nome, gn.ordem_hierarquica,
                   gn.cor_hex_primaria, gn.cor_hex_secundaria,
                   m.id AS modalidade_id, m.nome AS modalidade_nome,
                   (gn.id = ?) AS is_atual
            FROM graduacoes_niveis gn
            JOIN modalidades m ON m.id = gn.modalidade_id
            WHERE gn.modalidade_id = ? AND gn.ordem_hierarquica <= ?
            ORDER BY gn.ordem_hierarquica DESC
        `, [gradAtual.nivel_id, gradAtual.modalidade_id, gradAtual.ordem_hierarquica || 99]);

        const faixasProgresso = [];
        let faixaAtualObj = null;
        const faixasAnteriores = [];

        for (const nivel of niveisProgresso) {
            const [golpesRows] = await pool.query(`
                SELECT wg.id, wg.nome, wg.categoria, wg.nivel_dificuldade, wg.descricao_geral, wg.imagem_capa,
                       m.nome AS modalidade_nome,
                       COALESCE(agp.status, 'em_treino') AS status_progresso,
                       (agp.status = 'dominado') AS is_dominado,
                       (SELECT COUNT(*) FROM wiki_golpe_passos wgp WHERE wgp.golpe_id = wg.id) AS total_passos
                FROM graduacao_nivel_golpes gng
                JOIN wiki_golpes wg ON wg.id = gng.golpe_id
                LEFT JOIN modalidades m ON m.id = wg.modalidade_id
                LEFT JOIN aluno_golpes_progresso agp ON agp.golpe_id = wg.id AND agp.aluno_id = ?
                WHERE gng.graduacao_nivel_id = ?
                ORDER BY wg.categoria ASC, wg.nome ASC
            `, [alunoId, nivel.nivel_id]);

            const itemFaixa = {
                nivel_id: nivel.nivel_id,
                nivel_nome: nivel.nivel_nome,
                ordem_hierarquica: nivel.ordem_hierarquica,
                is_atual: Boolean(nivel.is_atual),
                status_tipo: nivel.is_atual ? 'atual' : 'anterior',
                status_label: nivel.is_atual ? 'Faixa Atual (Foco de Treino)' : 'Graduação Anterior (Concluída)',
                cor_primaria: nivel.cor_hex_primaria,
                cor_secundaria: nivel.cor_hex_secundaria,
                modalidade_id: nivel.modalidade_id,
                modalidade_nome: nivel.modalidade_nome,
                total_golpes: golpesRows.length,
                golpes: golpesRows.map(g => ({
                    ...g,
                    is_dominado: Boolean(g.is_dominado),
                    status_progresso: g.status_progresso || 'em_treino',
                    nivel_id: nivel.nivel_id,
                    nivel_nome: nivel.nivel_nome,
                    is_faixa_atual: Boolean(nivel.is_atual),
                    faixa_tipo: nivel.is_atual ? 'atual' : 'anterior',
                    faixa_badge_label: nivel.is_atual ? `⭐ Faixa Atual: ${nivel.nivel_nome}` : `✓ Faixa Anterior: ${nivel.nivel_nome}`
                }))
            };

            faixasProgresso.push(itemFaixa);
            if (nivel.is_atual) {
                faixaAtualObj = itemFaixa;
            } else {
                faixasAnteriores.push(itemFaixa);
            }
        }

        const golpesFaixaAtualCurriculo = faixaAtualObj ? faixaAtualObj.golpes : [];
        const totalGolpesCurriculo = golpesFaixaAtualCurriculo.length;
        const dominadosCurriculo = golpesFaixaAtualCurriculo.filter(g => g.status_progresso === 'dominado').length;
        const percentualProntidaoCurriculo = totalGolpesCurriculo > 0 ? Math.round((dominadosCurriculo / totalGolpesCurriculo) * 100) : 100;
        const metaProntidaoCurriculo = Number(gradAtual.porcentagem_minima || 70);

        res.json({
            success: true,
            aluno: {
                id: aluno.id,
                nome_completo: aluno.nome_completo,
                primeiro_nome: aluno.nome_completo.split(' ')[0],
                foto_perfil_url: aluno.foto_perfil_url
            },
            modalidade_nome: gradAtual.modalidade_nome,
            prontidao_exame: {
                total_golpes: totalGolpesCurriculo,
                golpes_dominados: dominadosCurriculo,
                golpes_em_treino: totalGolpesCurriculo - dominadosCurriculo,
                percentual_prontidao: percentualProntidaoCurriculo,
                meta_minima: metaProntidaoCurriculo,
                apto_exame: percentualProntidaoCurriculo >= metaProntidaoCurriculo,
                nivel_id: gradAtual.nivel_id,
                nivel_nome: gradAtual.nivel_nome
            },
            faixa_atual: faixaAtualObj,
            faixas_anteriores: faixasAnteriores,
            faixas_progresso: faixasProgresso
        });
    } catch (err) {
        console.error('Erro ao consultar currículo completo do atleta:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar currículo do atleta.' });
    }
});

/**
 * GET /api/aluno/golpe/:id
 * Retorna os detalhes de um golpe e todos os seus passos com fotos e instruções para o aluno
 */
router.get('/golpe/:id', optionalAuth, async (req, res) => {
    try {
        const golpeId = parseInt(req.params.id, 10);
        if (!golpeId || isNaN(golpeId)) {
            return res.status(400).json({ success: false, error: 'ID do golpe inválido.' });
        }

        const [golpes] = await pool.query(`
            SELECT wg.id, wg.nome, wg.categoria, wg.nivel_dificuldade, wg.descricao_geral, wg.imagem_capa,
                   m.id AS modalidade_id, m.nome AS modalidade_nome
            FROM wiki_golpes wg
            LEFT JOIN modalidades m ON m.id = wg.modalidade_id
            WHERE wg.id = ?
        `, [golpeId]);

        if (golpes.length === 0) {
            return res.status(404).json({ success: false, error: 'Golpe técnico não encontrado.' });
        }

        const [passos] = await pool.query(`
            SELECT id, golpe_id, ordem, titulo, descricao, imagem_url
            FROM wiki_golpe_passos
            WHERE golpe_id = ?
            ORDER BY ordem ASC
        `, [golpeId]);

        const golpe = golpes[0];
        golpe.passos = passos;

        res.json({ success: true, golpe });
    } catch (err) {
        console.error('Erro ao buscar detalhes do golpe para o aluno:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao carregar o golpe técnico.' });
    }
});

/**
 * PUT /api/aluno/medidas
 * Permite ao atleta atualizar suas medidas físicas (peso, altura, tórax, cintura, quadril)
 */
router.put('/medidas', optionalAuth, async (req, res) => {
    try {
        let alunoId = req.user ? (req.user.aluno_id || req.user.id) : null;
        if (!alunoId && req.body.aluno_id) alunoId = parseInt(req.body.aluno_id, 10);
        if (!alunoId) alunoId = 1;

        const { peso_kg, altura_cm, torax_cm, cintura_cm, quadril_cm } = req.body;

        const peso = parseFloat(peso_kg);
        const altura = parseInt(altura_cm, 10);
        const torax = parseFloat(torax_cm) || null;
        const cintura = parseFloat(cintura_cm) || null;
        const quadril = parseFloat(quadril_cm) || null;

        if (isNaN(peso) || peso < 20 || peso > 300) {
            return res.status(400).json({ success: false, error: 'Peso inválido em kg.' });
        }
        if (isNaN(altura) || altura < 80 || altura > 250) {
            return res.status(400).json({ success: false, error: 'Altura inválida em cm.' });
        }

        await pool.query(`
            UPDATE alunos
            SET peso_kg = ?, altura_cm = ?, torax_cm = ?, cintura_cm = ?, quadril_cm = ?
            WHERE id = ?
        `, [peso, altura, torax, cintura, quadril, alunoId]);

        // Cálculo de IMC para o registro de histórico
        const imcCalc = parseFloat((peso / ((altura / 100) * (altura / 100))).toFixed(1));
        let imcClassif = 'Normal';
        if (imcCalc < 18.5) imcClassif = 'Abaixo do peso';
        else if (imcCalc <= 24.9) imcClassif = 'Saudável (Ideal)';
        else if (imcCalc <= 29.9) imcClassif = 'Sobrepeso Leve';
        else imcClassif = 'Acima da meta';

        const dataMedicao = req.body.data_medicao ? String(req.body.data_medicao).substring(0, 10) : new Date().toISOString().split('T')[0];
        const observacoes = req.body.observacoes ? String(req.body.observacoes).substring(0, 255) : 'Medições atualizadas pelo atleta';
        const braco = parseFloat(req.body.braco_cm) || null;
        const coxa = parseFloat(req.body.coxa_cm) || null;

        // Salva histórico físico para comparativo de evolução
        await pool.query(`
            INSERT INTO aluno_historico_medidas
            (aluno_id, data_medicao, peso_kg, altura_cm, torax_cm, cintura_cm, quadril_cm, braco_cm, coxa_cm, imc, imc_classificacao, observacoes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [alunoId, dataMedicao, peso, altura, torax, cintura, quadril, braco, coxa, imcCalc, imcClassif, observacoes]);

        // Desbloqueia conquista "Condicionamento Pro" caso não tenha ainda
        await pool.query(`
            INSERT IGNORE INTO aluno_conquistas (aluno_id, conquista_id, data_desbloqueio)
            VALUES (?, 5, NOW())
        `, [alunoId]);

        res.json({
            success: true,
            message: 'Medidas corporais e histórico de evolução salvos com sucesso!'
        });
    } catch (err) {
        console.error('Erro ao atualizar medidas:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao salvar medidas.' });
    }
});

/**
 * GET /api/aluno/historico-medidas
 * Retorna o histórico completo de avaliações físicas para comparativo de evolução
 */
router.get('/historico-medidas', optionalAuth, async (req, res) => {
    try {
        let alunoId = req.user ? (req.user.aluno_id || req.user.id) : null;
        if (!alunoId && req.query.aluno_id) alunoId = parseInt(req.query.aluno_id, 10);
        if (!alunoId) alunoId = 1;

        const [historico] = await pool.query(`
            SELECT id, data_medicao, peso_kg, altura_cm, torax_cm, cintura_cm, quadril_cm,
                   braco_cm, coxa_cm, imc, imc_classificacao, observacoes, created_at
            FROM aluno_historico_medidas
            WHERE aluno_id = ?
            ORDER BY data_medicao ASC, id ASC
        `, [alunoId]);

        // Calcula deltas cronológicos entre medições consecutivas
        const evolucao = historico.map((item, index) => {
            const anterior = index > 0 ? historico[index - 1] : null;
            return {
                id: item.id,
                data_medicao: item.data_medicao,
                peso_kg: parseFloat(item.peso_kg),
                altura_cm: item.altura_cm,
                torax_cm: item.torax_cm ? parseFloat(item.torax_cm) : null,
                cintura_cm: item.cintura_cm ? parseFloat(item.cintura_cm) : null,
                quadril_cm: item.quadril_cm ? parseFloat(item.quadril_cm) : null,
                braco_cm: item.braco_cm ? parseFloat(item.braco_cm) : null,
                coxa_cm: item.coxa_cm ? parseFloat(item.coxa_cm) : null,
                imc: parseFloat(item.imc),
                imc_classificacao: item.imc_classificacao,
                observacoes: item.observacoes,
                delta_peso: anterior ? Number((parseFloat(item.peso_kg) - parseFloat(anterior.peso_kg)).toFixed(1)) : 0,
                delta_torax: anterior && item.torax_cm && anterior.torax_cm ? Number((parseFloat(item.torax_cm) - parseFloat(anterior.torax_cm)).toFixed(1)) : 0,
                delta_cintura: anterior && item.cintura_cm && anterior.cintura_cm ? Number((parseFloat(item.cintura_cm) - parseFloat(anterior.cintura_cm)).toFixed(1)) : 0,
                delta_quadril: anterior && item.quadril_cm && anterior.quadril_cm ? Number((parseFloat(item.quadril_cm) - parseFloat(anterior.quadril_cm)).toFixed(1)) : 0,
                delta_imc: anterior ? Number((parseFloat(item.imc) - parseFloat(anterior.imc)).toFixed(1)) : 0
            };
        });

        // Resumo Geral Comparativo (Primeira avaliação vs Última avaliação)
        let resumo = null;
        if (evolucao.length > 0) {
            const primeiro = evolucao[0];
            const ultimo = evolucao[evolucao.length - 1];
            resumo = {
                primeira_medicao: primeiro.data_medicao,
                ultima_medicao: ultimo.data_medicao,
                total_avaliacoes: evolucao.length,
                evolucao_peso: Number((ultimo.peso_kg - primeiro.peso_kg).toFixed(1)),
                evolucao_torax: primeiro.torax_cm && ultimo.torax_cm ? Number((ultimo.torax_cm - primeiro.torax_cm).toFixed(1)) : 0,
                evolucao_cintura: primeiro.cintura_cm && ultimo.cintura_cm ? Number((ultimo.cintura_cm - primeiro.cintura_cm).toFixed(1)) : 0,
                evolucao_quadril: primeiro.quadril_cm && ultimo.quadril_cm ? Number((ultimo.quadril_cm - primeiro.quadril_cm).toFixed(1)) : 0,
                evolucao_imc: Number((ultimo.imc - primeiro.imc).toFixed(1))
            };
        }

        // Retorna cronologia invertida para tabela (mais recentes no topo)
        res.json({
            success: true,
            resumo,
            historico: [...evolucao].reverse()
        });
    } catch (err) {
        console.error('Erro ao buscar histórico de medidas:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar histórico.' });
    }
});

/**
 * DELETE /api/aluno/historico-medidas/:id
 * Remove um registro de histórico de medidas físicas do atleta
 */
router.delete('/historico-medidas/:id', optionalAuth, async (req, res) => {
    try {
        let alunoId = req.user ? (req.user.aluno_id || req.user.id) : null;
        if (!alunoId && req.query.aluno_id) alunoId = parseInt(req.query.aluno_id, 10);
        if (!alunoId) alunoId = 1;

        const recordId = parseInt(req.params.id, 10);
        if (isNaN(recordId)) {
            return res.status(400).json({ success: false, error: 'ID de registro inválido.' });
        }

        const [result] = await pool.query(`
            DELETE FROM aluno_historico_medidas
            WHERE id = ? AND aluno_id = ?
        `, [recordId, alunoId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Registro não encontrado ou não pertence a este aluno.' });
        }

        res.json({ success: true, message: 'Registro de medida excluído com sucesso.' });
    } catch (err) {
        console.error('Erro ao excluir registro de medida:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao excluir registro.' });
    }
});

/**
 * POST /api/aluno/golpe-progresso
 * Atualiza o status de treino ou domínio de uma técnica da Wiki para o atleta
 */
router.post('/golpe-progresso', optionalAuth, async (req, res) => {
    try {
        let alunoId = req.user ? (req.user.aluno_id || req.user.id) : null;
        if (!alunoId && req.body.aluno_id) alunoId = parseInt(req.body.aluno_id, 10);
        if (!alunoId) alunoId = 1;

        const golpeId = parseInt(req.body.golpe_id, 10);
        const statusReq = String(req.body.status || '').toLowerCase().trim();

        if (!golpeId || isNaN(golpeId)) {
            return res.status(400).json({ success: false, error: 'ID do golpe é obrigatório e deve ser numérico.' });
        }

        if (statusReq !== 'em_treino' && statusReq !== 'dominado') {
            return res.status(400).json({ success: false, error: "Status inválido. Use 'em_treino' ou 'dominado'." });
        }

        // Valida se o golpe existe
        const [golpeRows] = await pool.query('SELECT id, nome FROM wiki_golpes WHERE id = ?', [golpeId]);
        if (golpeRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Golpe técnico não encontrado.' });
        }

        // Upsert seguro com Prepared Statements
        await pool.query(`
            INSERT INTO aluno_golpes_progresso (aluno_id, golpe_id, status)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = NOW()
        `, [alunoId, golpeId, statusReq]);

        // Recalcula prontidão para a faixa atual do atleta
        const [gradAtualRows] = await pool.query(`
            SELECT ag.graduacao_nivel_id, gn.id AS nivel_id, gn.nome AS nivel_nome, gn.porcentagem_minima
            FROM aluno_graduacoes ag
            JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
            WHERE ag.aluno_id = ? AND ag.atual = 1
            ORDER BY ag.id DESC
            LIMIT 1
        `, [alunoId]);

        let prontidao = null;
        if (gradAtualRows.length > 0) {
            const nivelId = gradAtualRows[0].nivel_id;
            const metaMinima = Number(gradAtualRows[0].porcentagem_minima || 70);

            const [golpesNivel] = await pool.query(`
                SELECT wg.id, COALESCE(agp.status, 'em_treino') AS status_progresso
                FROM graduacao_nivel_golpes gng
                JOIN wiki_golpes wg ON wg.id = gng.golpe_id
                LEFT JOIN aluno_golpes_progresso agp ON agp.golpe_id = wg.id AND agp.aluno_id = ?
                WHERE gng.graduacao_nivel_id = ?
            `, [alunoId, nivelId]);

            const total = golpesNivel.length;
            const dominados = golpesNivel.filter(g => g.status_progresso === 'dominado').length;
            const emTreino = total - dominados;
            const percentual = total > 0 ? Math.round((dominados / total) * 100) : 100;

            prontidao = {
                total_golpes: total,
                golpes_dominados: dominados,
                golpes_em_treino: emTreino,
                percentual_prontidao: percentual,
                meta_minima: metaMinima,
                apto_exame: percentual >= metaMinima,
                nivel_id: nivelId,
                nivel_nome: gradAtualRows[0].nivel_nome
            };
        }

        res.json({
            success: true,
            message: statusReq === 'dominado' ? 'Técnica marcada como Dominada!' : 'Técnica em treinamento ativo!',
            golpe_id: golpeId,
            status: statusReq,
            is_dominado: statusReq === 'dominado',
            prontidao_exame: prontidao
        });
    } catch (err) {
        console.error('Erro ao atualizar progresso de golpe:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao atualizar progresso do golpe.' });
    }
});

/**
 * PUT /api/aluno/skin
 * Permite ao atleta personalizar seu avatar (tom de pele, modelo, cabelo, luvas e título conquistado)
 */
router.put('/skin', optionalAuth, async (req, res) => {
    try {
        let alunoId = req.user ? (req.user.aluno_id || req.user.id) : null;
        if (!alunoId && req.body.aluno_id) alunoId = parseInt(req.body.aluno_id, 10);
        if (!alunoId) alunoId = 1;

        const { avatar_tom, avatar_cabelo, avatar_luva, titulo_ativo, skin_fighter } = req.body;

        // Recupera o aluno atual para saber gênero, preferências e total de treinos
        const [alunoRows] = await pool.query(`
            SELECT id, genero, avatar_tom, avatar_cabelo, avatar_luva, titulo_ativo, skin_fighter 
            FROM alunos 
            WHERE id = ? AND deleted_at IS NULL
        `, [alunoId]);

        if (alunoRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }
        const currentAluno = alunoRows[0];
        const isFeminino = String(currentAluno.genero || '').toUpperCase() === 'F';

        // Total de presenças reais para validar desbloqueios
        const [checkinsTotal] = await pool.query(`
            SELECT COUNT(*) AS total_geral
            FROM checkins
            WHERE aluno_id = ? AND status = 'aprovado'
        `, [alunoId]);
        const totalGeral = checkinsTotal[0]?.total_geral || 0;

        // Sanitização e validação de tom de pele ('branca' | 'negra')
        let cleanTom = currentAluno.avatar_tom || 'branca';
        if (avatar_tom) {
            cleanTom = (String(avatar_tom).toLowerCase().trim() === 'negra') ? 'negra' : 'branca';
        }

        // Sanitização e validação de cabelo
        let cleanCabelo = currentAluno.avatar_cabelo || (isFeminino ? 'cabelo-mulher-1.png' : 'cabelo-homem-1.png');
        if (avatar_cabelo) {
            const sanitized = String(avatar_cabelo).replace(/[^a-zA-Z0-9._-]/g, '').trim();
            if (sanitized) {
                cleanCabelo = sanitized;
            }
        }

        // Validação de Luva (verifica requisito de check-in)
        let cleanLuva = currentAluno.avatar_luva || 'padrao';
        if (avatar_luva) {
            const itemLuva = CATALOGO_LUVAS.find(l => l.id === avatar_luva);
            if (itemLuva) {
                if (totalGeral >= itemLuva.req_checkins) {
                    cleanLuva = itemLuva.id;
                } else {
                    return res.status(400).json({
                        success: false,
                        error: `Você precisa de ${itemLuva.req_checkins} treinos para equipar a ${itemLuva.nome} (você possui ${totalGeral}).`
                    });
                }
            }
        }

        // Validação de Título (verifica requisito de check-in)
        let cleanTitulo = currentAluno.titulo_ativo || 'Iniciante Focado';
        if (titulo_ativo) {
            const itemTitulo = CATALOGO_TITULOS.find(t => t.titulo === titulo_ativo);
            if (itemTitulo) {
                if (totalGeral >= itemTitulo.req_checkins) {
                    cleanTitulo = itemTitulo.titulo;
                } else {
                    return res.status(400).json({
                        success: false,
                        error: `Você precisa de ${itemTitulo.req_checkins} treinos para desbloquear o título '${itemTitulo.titulo}' (você possui ${totalGeral}).`
                    });
                }
            }
        }

        const cleanSkin = skin_fighter ? String(skin_fighter).replace(/[^a-zA-Z0-9._-]/g, '').trim() : (currentAluno.skin_fighter || 'mt-skin-1.jpg');

        await pool.query(`
            UPDATE alunos 
            SET avatar_tom = ?, avatar_cabelo = ?, avatar_luva = ?, titulo_ativo = ?, skin_fighter = ?
            WHERE id = ?
        `, [cleanTom, cleanCabelo, cleanLuva, cleanTitulo, cleanSkin, alunoId]);

        const modeloBase = isFeminino 
            ? (cleanTom === 'negra' ? 'mulher-negra.png' : 'mulher-branca.png')
            : (cleanTom === 'negra' ? 'homem-negro.png' : 'homem-branco.png');

        res.json({
            success: true,
            message: 'Avatar e equipamentos atualizados com sucesso!',
            avatar_tom: cleanTom,
            avatar_cabelo: cleanCabelo,
            avatar_luva: cleanLuva,
            titulo_ativo: cleanTitulo,
            avatar: {
                genero: isFeminino ? 'F' : 'M',
                tom: cleanTom,
                modelo_base: modeloBase,
                base_url: `/assets/avatar/${modeloBase}`,
                cabelo: cleanCabelo,
                cabelo_url: `/assets/avatar/${cleanCabelo}`,
                luva: cleanLuva,
                titulo: cleanTitulo
            },
            recompensas: {
                total_checkins: totalGeral,
                luvas: CATALOGO_LUVAS.map(luva => ({
                    ...luva,
                    desbloqueada: totalGeral >= luva.req_checkins,
                    equipada: cleanLuva === luva.id,
                    faltam_checkins: Math.max(0, luva.req_checkins - totalGeral)
                })),
                titulos: CATALOGO_TITULOS.map(t => ({
                    ...t,
                    desbloqueado: totalGeral >= t.req_checkins,
                    ativo: cleanTitulo === t.titulo,
                    faltam_checkins: Math.max(0, t.req_checkins - totalGeral)
                }))
            }
        });
    } catch (err) {
        console.error('Erro ao atualizar avatar/skin:', err);
        res.status(500).json({ success: false, error: 'Erro ao salvar avatar.' });
    }
});

/**
 * GET /api/aluno/historico-financeiro
 * Retorna lista unificada de faturas de mensalidades e taxas de exames de graduação
 * Contemplando pagamentos efetuados via Gateway Asaas e pagamentos manuais (balcão/chave direta)
 */
router.get('/historico-financeiro', optionalAuth, async (req, res) => {
    try {
        let alunoId = req.user ? (req.user.aluno_id || req.user.id) : null;
        if (!alunoId && req.query.aluno_id) alunoId = parseInt(req.query.aluno_id, 10);
        if (!alunoId) alunoId = 1;

        // 1. Faturas de Mensalidades
        const [faturas] = await pool.query(`
            SELECT f.id, f.matricula_id, f.aluno_id, f.competencia, f.valor_original, f.valor_desconto, f.valor_pago,
                   f.data_vencimento, f.data_pagamento, f.metodo_pagamento, f.status,
                   f.asaas_payment_id, f.asaas_invoice_url, f.asaas_pix_qrcode, f.asaas_pix_copia_cola, f.asaas_status,
                   p.nome AS plano_nome,
                   CASE 
                       WHEN f.status = 'atrasado' OR (f.status = 'pendente' AND f.data_vencimento < CURDATE()) THEN 1 
                       ELSE 0 
                   END AS em_atraso,
                   DATEDIFF(CURDATE(), f.data_vencimento) AS dias_atraso
            FROM faturas f
            JOIN matriculas m ON m.id = f.matricula_id
            JOIN planos p ON p.id = m.plano_id
            WHERE f.aluno_id = ? AND f.status != 'cancelado'
            ORDER BY f.data_vencimento DESC
        `, [alunoId]);

        // 2. Taxas e Convites de Exames de Graduação
        const [convites] = await pool.query(`
            SELECT c.id, c.evento_id, c.aluno_id, c.modalidade_id, c.graduacao_atual_id, c.graduacao_pretendida_id,
                   c.valor, c.status, c.data_convite, c.data_resposta, c.data_pagamento,
                   c.asaas_payment_id, c.asaas_invoice_url, c.asaas_pix_qrcode, c.asaas_pix_copia_cola, c.asaas_billing_type, c.asaas_status,
                   eg.titulo AS evento_titulo, eg.data_evento, eg.taxa_inscricao,
                   m.nome AS modalidade_nome,
                   gn.nome AS graduacao_nome
            FROM evento_graduacao_convites c
            JOIN eventos_graduacao eg ON eg.id = c.evento_id
            JOIN modalidades m ON m.id = c.modalidade_id
            JOIN graduacoes_niveis gn ON gn.id = c.graduacao_pretendida_id
            WHERE c.aluno_id = ?
            ORDER BY eg.data_evento DESC
        `, [alunoId]);

        const itens = [];
        const mesesNomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

        // Mapeia Mensalidades
        for (const f of faturas) {
            const isPago = f.status === 'pago';
            const isAtrasado = f.em_atraso === 1;
            const isManual = !f.asaas_payment_id || f.asaas_status === 'RECEIVED_MANUALLY' || ['dinheiro', 'balcao'].includes(f.metodo_pagamento);

            let tituloFmt = 'Mensalidade';
            if (f.competencia && /^\d{4}-\d{2}$/.test(f.competencia)) {
                const [ano, mes] = f.competencia.split('-');
                const mesNome = mesesNomes[parseInt(mes, 10) - 1] || mes;
                tituloFmt = `Mensalidade • ${mesNome}/${ano}`;
            } else if (f.competencia) {
                tituloFmt = `Mensalidade • ${f.competencia}`;
            } else {
                tituloFmt = `Mensalidade • ${f.plano_nome}`;
            }

            itens.push({
                id: `fat_${f.id}`,
                fatura_id: f.id,
                tipo: 'mensalidade',
                tipo_label: 'Mensalidade',
                titulo: tituloFmt,
                subtitulo: `Plano: ${f.plano_nome}`,
                competencia: f.competencia,
                data_referencia: f.data_vencimento,
                data_pagamento: f.data_pagamento,
                valor: Number(f.valor_original || 0),
                valor_pago: isPago ? Number(f.valor_pago || f.valor_original || 0) : null,
                status: isPago ? 'pago' : (isAtrasado ? 'atrasado' : (f.status === 'cancelado' ? 'cancelado' : 'pendente')),
                status_label: isPago ? 'Pago' : (isAtrasado ? 'Em Atraso' : (f.status === 'cancelado' ? 'Cancelado' : 'Pendente')),
                metodo_pagamento: isPago ? (f.metodo_pagamento || (isManual ? 'dinheiro' : 'pix')) : null,
                origem_pagamento: isManual ? 'manual' : 'asaas',
                origem_label: isManual ? 'Manual / Balcão' : 'Pagamento Online',
                asaas_status: f.asaas_status,
                asaas_payment_id: f.asaas_payment_id,
                asaas_invoice_url: f.asaas_invoice_url,
                asaas_pix_qrcode: f.asaas_pix_qrcode,
                asaas_pix_copia_cola: f.asaas_pix_copia_cola
            });
        }

        // Mapeia Exames de Graduação
        for (const c of convites) {
            const isPago = c.status === 'pago';
            const isCancelado = c.status === 'recusado';
            const isManual = !c.asaas_payment_id || c.asaas_status === 'RECEIVED_MANUALLY' || c.asaas_status === 'MANUAL';
            const valorFinal = Number(c.valor || c.taxa_inscricao || 0);

            itens.push({
                id: `grad_${c.id}`,
                convite_id: c.id,
                tipo: 'graduacao',
                tipo_label: 'Exame de Graduação',
                titulo: `Graduação • ${c.graduacao_nome}`,
                subtitulo: `${c.modalidade_nome} • ${c.evento_titulo}`,
                competencia: null,
                data_referencia: c.data_evento || c.data_convite,
                data_pagamento: c.data_pagamento || (isPago ? c.data_resposta : null),
                valor: valorFinal,
                valor_pago: isPago ? valorFinal : null,
                status: isPago ? 'pago' : (isCancelado ? 'cancelado' : 'pendente'),
                status_label: isPago ? 'Pago' : (isCancelado ? 'Cancelado' : (c.status === 'aceito' ? 'Aguardando Pagamento' : 'Convocado')),
                metodo_pagamento: c.asaas_billing_type || 'pix',
                origem_pagamento: isManual ? 'manual' : 'asaas',
                origem_label: isManual ? 'Manual / Balcão' : 'Pagamento Online',
                asaas_status: c.asaas_status,
                asaas_payment_id: c.asaas_payment_id,
                asaas_invoice_url: c.asaas_invoice_url,
                asaas_pix_qrcode: c.asaas_pix_qrcode,
                asaas_pix_copia_cola: c.asaas_pix_copia_cola
            });
        }

        // Ordena: Em atraso primeiro, depois pendentes, depois pagos mais recentes
        itens.sort((a, b) => {
            const pesoStatus = { atrasado: 0, pendente: 1, pago: 2, cancelado: 3 };
            const pA = pesoStatus[a.status] ?? 2;
            const pB = pesoStatus[b.status] ?? 2;
            if (pA !== pB) return pA - pB;
            const dateA = new Date(a.data_referencia || a.data_pagamento || 0);
            const dateB = new Date(b.data_referencia || b.data_pagamento || 0);
            return dateB - dateA;
        });

        // Totais e Indicadores Financeiros
        let totalPago = 0;
        let totalPendente = 0;
        let temAtraso = false;

        itens.forEach(item => {
            if (item.status === 'pago') {
                totalPago += (item.valor_pago || item.valor || 0);
            } else if (item.status === 'atrasado') {
                totalPendente += (item.valor || 0);
                temAtraso = true;
            } else if (item.status === 'pendente') {
                totalPendente += (item.valor || 0);
            }
        });

        res.json({
            success: true,
            resumo: {
                total_pago: totalPago,
                total_pendente: totalPendente,
                qtd_total: itens.length,
                qtd_pagos: itens.filter(i => i.status === 'pago').length,
                qtd_pendentes: itens.filter(i => ['pendente', 'atrasado'].includes(i.status)).length,
                status_financeiro: temAtraso ? 'atrasado' : (totalPendente > 0 ? 'pendente' : (itens.length > 0 ? 'em_dia' : 'sem_faturas')),
                has_atraso: temAtraso
            },
            itens
        });
    } catch (err) {
        console.error('[PainelAluno] Erro ao buscar histórico financeiro:', err);
        res.status(500).json({ success: false, error: 'Erro ao carregar faturas e pagamentos.' });
    }
});

/**
 * POST /api/aluno/faturas/:id/gerar-asaas
 * Gera ou recupera cobrança PIX/Boleto/Cartão no Asaas para uma fatura de mensalidade
 */
router.post('/faturas/:id/gerar-asaas', optionalAuth, async (req, res) => {
    try {
        let alunoId = req.user ? (req.user.aluno_id || req.user.id) : null;
        if (!alunoId && req.body.aluno_id) alunoId = parseInt(req.body.aluno_id, 10);
        if (!alunoId) alunoId = 1;

        const faturaId = parseInt(req.params.id, 10);
        if (!faturaId || isNaN(faturaId)) {
            return res.status(400).json({ success: false, error: 'ID da fatura inválido.' });
        }

        // Busca a fatura e valida propriedade estrita do aluno
        const [faturas] = await pool.query(`
            SELECT f.id, f.aluno_id, f.competencia, f.valor_original, f.data_vencimento, f.status,
                   f.asaas_customer_id, f.asaas_payment_id, f.asaas_invoice_url, f.asaas_pix_qrcode,
                   f.asaas_pix_copia_cola, f.asaas_status,
                   a.nome_completo, a.email, a.cpf, a.telefone_whatsapp,
                   p.nome AS plano_nome
            FROM faturas f
            JOIN alunos a ON a.id = f.aluno_id
            JOIN matriculas m ON m.id = f.matricula_id
            JOIN planos p ON p.id = m.plano_id
            WHERE f.id = ? AND f.aluno_id = ?
        `, [faturaId, alunoId]);

        if (faturas.length === 0) {
            return res.status(404).json({ success: false, error: 'Fatura não encontrada ou não pertence ao aluno.' });
        }

        const fat = faturas[0];

        if (fat.status === 'pago') {
            return res.status(400).json({ success: false, error: 'Esta fatura já se encontra quitada.' });
        }

        // Se já possui cobrança ativa e QR Code gerado, retorna imediatamente
        if (fat.asaas_payment_id && fat.asaas_pix_copia_cola) {
            return res.json({
                success: true,
                message: 'Cobrança pronta para pagamento.',
                data: {
                    fatura_id: fat.id,
                    competencia: fat.competencia,
                    plano_nome: fat.plano_nome,
                    valor: Number(fat.valor_original),
                    data_vencimento: fat.data_vencimento,
                    asaas_payment_id: fat.asaas_payment_id,
                    asaas_invoice_url: fat.asaas_invoice_url,
                    asaas_pix_qrcode: fat.asaas_pix_qrcode,
                    asaas_pix_copia_cola: fat.asaas_pix_copia_cola,
                    asaas_status: fat.asaas_status,
                    is_mock: String(fat.asaas_payment_id).startsWith('pay_mock_')
                }
            });
        }

        // Cria ou busca cliente no Asaas
        const customer = await asaasService.criarOuBuscarCliente({
            nome: fat.nome_completo,
            email: fat.email,
            cpfCnpj: fat.cpf,
            telefone: fat.telefone_whatsapp,
            alunoId: fat.aluno_id
        });

        // Data de vencimento da cobrança (mínimo 2 dias à frente se já vencida)
        let dueDate = fat.data_vencimento ? new Date(fat.data_vencimento).toISOString().split('T')[0] : null;
        const hojeIso = new Date().toISOString().split('T')[0];
        if (!dueDate || dueDate < hojeIso) {
            const prox = new Date();
            prox.setDate(prox.getDate() + 2);
            dueDate = prox.toISOString().split('T')[0];
        }

        // Gera a cobrança Pix no Asaas
        const cobranca = await asaasService.criarCobranca({
            customerId: customer.id,
            valor: Number(fat.valor_original),
            vencimento: dueDate,
            descricao: `Mensalidade ${fat.competencia} - ${fat.plano_nome} (PRO COMBATE)`,
            externalReference: `fatura_${fat.id}_aluno_${fat.aluno_id}`,
            billingType: 'PIX'
        });

        const pixQr = cobranca.pixQrCode ? cobranca.pixQrCode.encodedImage : null;
        const pixPayload = cobranca.pixQrCode ? cobranca.pixQrCode.payload : null;

        // Persiste dados do Asaas na fatura
        await pool.query(`
            UPDATE faturas SET
                asaas_customer_id = ?,
                asaas_payment_id = ?,
                asaas_invoice_url = ?,
                asaas_pix_qrcode = ?,
                asaas_pix_copia_cola = ?,
                asaas_status = ?
            WHERE id = ?
        `, [
            customer.id,
            cobranca.id,
            cobranca.invoiceUrl,
            pixQr,
            pixPayload,
            cobranca.status || 'PENDING',
            fat.id
        ]);

        res.json({
            success: true,
            message: 'Cobrança gerada com sucesso!',
            data: {
                fatura_id: fat.id,
                competencia: fat.competencia,
                plano_nome: fat.plano_nome,
                valor: Number(fat.valor_original),
                data_vencimento: dueDate,
                asaas_payment_id: cobranca.id,
                asaas_invoice_url: cobranca.invoiceUrl,
                asaas_pix_qrcode: pixQr,
                asaas_pix_copia_cola: pixPayload,
                asaas_status: cobranca.status,
                is_mock: cobranca.is_mock
            }
        });
    } catch (err) {
        console.error('Erro ao gerar cobrança para fatura:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao comunicar com o serviço de cobrança.' });
    }
});

/**
 * POST /api/aluno/faturas/:id/verificar-asaas
 * Verifica status da cobrança no Asaas ou simula pagamento em ambiente de teste
 */
router.post('/faturas/:id/verificar-asaas', optionalAuth, async (req, res) => {
    try {
        let alunoId = req.user ? (req.user.aluno_id || req.user.id) : null;
        if (!alunoId && req.body.aluno_id) alunoId = parseInt(req.body.aluno_id, 10);
        if (!alunoId) alunoId = 1;

        const faturaId = parseInt(req.params.id, 10);
        const { simular_confirmacao } = req.body;

        const [faturas] = await pool.query(`
            SELECT id, aluno_id, valor_original, status, asaas_payment_id, asaas_status
            FROM faturas
            WHERE id = ? AND aluno_id = ?
        `, [faturaId, alunoId]);

        if (faturas.length === 0) {
            return res.status(404).json({ success: false, error: 'Fatura não encontrada.' });
        }

        const fat = faturas[0];

        if (fat.status === 'pago') {
            return res.json({ success: true, pago: true, message: 'Fatura já confirmada como paga!' });
        }

        if (!fat.asaas_payment_id) {
            return res.status(400).json({ success: false, error: 'Nenhuma cobrança ativa gerada para esta fatura.' });
        }

        // Se o frontend solicitar simulação de pagamento (apenas fora de produção e sem gateway real configurado)
        if (simular_confirmacao) {
            if (process.env.NODE_ENV === 'production' || asaasService.isConfigured()) {
                return res.status(403).json({ success: false, error: 'Simulação de pagamento indisponível em ambiente de produção.' });
            }
            await pool.query(`
                UPDATE faturas SET
                    status = 'pago',
                    data_pagamento = NOW(),
                    metodo_pagamento = 'pix',
                    valor_pago = valor_original,
                    asaas_status = 'RECEIVED'
                WHERE id = ?
            `, [fat.id]);

            return res.json({
                success: true,
                pago: true,
                message: 'Pagamento simulado com sucesso (Ambiente de Testes)!'
            });
        }

        // Consulta status atualizado no Asaas
        const cobranca = await asaasService.consultarCobranca(fat.asaas_payment_id);
        const st = cobranca ? cobranca.status : null;

        if (st === 'RECEIVED' || st === 'CONFIRMED' || st === 'RECEIVED_IN_CASH') {
            await pool.query(`
                UPDATE faturas SET
                    status = 'pago',
                    data_pagamento = NOW(),
                    metodo_pagamento = 'pix',
                    valor_pago = valor_original,
                    asaas_status = ?
                WHERE id = ?
            `, [st, fat.id]);

            return res.json({ success: true, pago: true, message: 'Pagamento confirmado com sucesso!' });
        }

        res.json({
            success: true,
            pago: false,
            asaas_status: st || fat.asaas_status || 'PENDING',
            message: 'Aguardando confirmação do pagamento pelo banco.'
        });
    } catch (err) {
        console.error('Erro ao verificar status Asaas da fatura:', err);
        res.status(500).json({ success: false, error: 'Erro ao verificar status do pagamento.' });
    }
});

/**
 * POST /api/aluno/faturas/:id/pagar-cartao
 * Processa pagamento direto com cartão de crédito para fatura de mensalidade
 */
router.post('/faturas/:id/pagar-cartao', optionalAuth, async (req, res) => {
    try {
        let alunoId = req.user ? (req.user.aluno_id || req.user.id) : null;
        if (!alunoId && req.body.aluno_id) alunoId = parseInt(req.body.aluno_id, 10);
        if (!alunoId) alunoId = 1;

        const faturaId = parseInt(req.params.id, 10);
        const {
            numero_cartao,
            nome_impresso,
            mes_validade,
            ano_validade,
            cvv,
            cpf_titular,
            cep_titular,
            numero_endereco,
            telefone_titular
        } = req.body;

        if (!numero_cartao || !nome_impresso || !mes_validade || !ano_validade || !cvv) {
            return res.status(400).json({
                success: false,
                error: 'Informe todos os dados do cartão de crédito (número, nome impresso, validade e CVV).'
            });
        }

        const [faturas] = await pool.query(`
            SELECT f.id, f.aluno_id, f.valor_original, f.status, f.asaas_payment_id, f.asaas_customer_id, f.competencia,
                   a.nome_completo, a.email, a.cpf, a.telefone_whatsapp,
                   p.nome AS plano_nome
            FROM faturas f
            JOIN alunos a ON f.aluno_id = a.id
            LEFT JOIN matriculas m ON f.matricula_id = m.id
            LEFT JOIN planos p ON m.plano_id = p.id
            WHERE f.id = ? AND f.aluno_id = ?
        `, [faturaId, alunoId]);

        if (faturas.length === 0) {
            return res.status(404).json({ success: false, error: 'Fatura não encontrada.' });
        }

        const fat = faturas[0];

        if (fat.status === 'pago') {
            return res.status(400).json({ success: false, error: 'Esta fatura já se encontra quitada.' });
        }

        // 1. Obtém ou cria o cliente no gateway Asaas se não existir
        let customerId = fat.asaas_customer_id;
        if (!customerId) {
            const customer = await asaasService.criarOuBuscarCliente({
                nome: fat.nome_completo,
                email: fat.email,
                cpfCnpj: fat.cpf,
                telefone: fat.telefone_whatsapp,
                alunoId: fat.aluno_id
            });
            customerId = customer.id;
        }

        // 2. Processa o pagamento via cartão de crédito
        const cobranca = await asaasService.pagarComCartao({
            paymentId: fat.asaas_payment_id,
            customerId: customerId,
            valor: Number(fat.valor_original),
            descricao: `Mensalidade ${fat.competencia || ''} - ${fat.plano_nome || 'PRO COMBATE'}`,
            externalReference: `fatura_${fat.id}_aluno_${fat.aluno_id}`,
            creditCard: {
                holderName: nome_impresso,
                number: numero_cartao,
                expiryMonth: mes_validade,
                expiryYear: ano_validade,
                ccv: cvv
            },
            creditCardHolderInfo: {
                name: nome_impresso,
                email: fat.email,
                cpfCnpj: cpf_titular || fat.cpf,
                postalCode: cep_titular || '01001000',
                addressNumber: numero_endereco || 'S/N',
                phone: telefone_titular || fat.telefone_whatsapp
            },
            remoteIp: req.ip
        });

        const cardBrand = cobranca.creditCard?.creditCardBrand || asaasService.detectCardBrand(numero_cartao);
        const last4 = cobranca.creditCard?.creditCardNumber || String(numero_cartao).replace(/\D/g, '').slice(-4);

        // 3. Persiste a quitação no banco de dados com segurança
        await pool.query(`
            UPDATE faturas SET
                status = 'pago',
                data_pagamento = NOW(),
                metodo_pagamento = 'cartao_credito',
                valor_pago = valor_original,
                asaas_customer_id = COALESCE(asaas_customer_id, ?),
                asaas_payment_id = ?,
                asaas_status = 'CONFIRMED'
            WHERE id = ?
        `, [
            customerId,
            cobranca.id || fat.asaas_payment_id,
            fat.id
        ]);

        return res.json({
            success: true,
            pago: true,
            message: 'Pagamento aprovado com sucesso no cartão de crédito!',
            detalhes: {
                fatura_id: fat.id,
                bandeira: cardBrand,
                ultimos4: last4,
                valor: Number(fat.valor_original),
                data_pagamento: new Date().toISOString()
            }
        });

    } catch (err) {
        console.error('Erro ao pagar fatura com cartão:', err);
        return res.status(400).json({
            success: false,
            error: err.message || 'Falha ao processar pagamento com cartão de crédito.'
        });
    }
});

module.exports = router;

