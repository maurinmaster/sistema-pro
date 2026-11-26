const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');
const { evaluateCheckinEligibility } = require('../services/domainRules');
const checkinSmartService = require('../services/checkinSmartService');

const ALLOWED_METHODS = new Set(['app_aluno', 'manual_professor', 'reconhecimento_facial']);

async function resolveDefaultModalidadeForAluno(alunoId) {
    const [gradRows] = await pool.query(`
        SELECT modalidade_id
        FROM aluno_graduacoes
        WHERE aluno_id = ? AND atual = 1
        ORDER BY id DESC
        LIMIT 1
    `, [alunoId]);
    if (gradRows.length > 0 && gradRows[0].modalidade_id) {
        return Number(gradRows[0].modalidade_id);
    }

    const [matRows] = await pool.query(`
        SELECT pm.modalidade_id
        FROM matriculas mat
        JOIN planos_modalidades pm ON pm.plano_id = mat.plano_id
        WHERE mat.aluno_id = ? AND mat.status = 'ativa'
        ORDER BY mat.id DESC, pm.modalidade_id ASC
        LIMIT 1
    `, [alunoId]);
    if (matRows.length > 0 && matRows[0].modalidade_id) {
        return Number(matRows[0].modalidade_id);
    }

    const [modRows] = await pool.query(`
        SELECT id
        FROM modalidades
        WHERE ativo = 1
        ORDER BY id ASC
        LIMIT 1
    `);
    if (modRows.length > 0 && modRows[0].id) {
        return Number(modRows[0].id);
    }

    return null;
}

// GET /api/checkins/painel-inteligente - Painel visual de presenças com ordenação por 1º check-in e horário habitual
router.get('/painel-inteligente', authenticateToken, async (req, res) => {
    try {
        const nowBr = checkinSmartService.getBrazilNowParts();
        const hoje = nowBr.dateIso;
        const horaAtual = nowBr.hora;
        const minutoAtual = nowBr.minuto;
        const currentMinutes = nowBr.minutesOfDay;

        const rawData = typeof req.query.data === 'string' ? req.query.data.trim() : '';
        const dataReferencia = /^\d{4}-\d{2}-\d{2}$/.test(rawData) ? rawData : hoje;

        const rawHora = req.query.hora;
        let selectedHour = null;
        if (rawHora !== undefined && rawHora !== null && String(rawHora).trim() !== '' && rawHora !== 'auto') {
            const parsedHora = parseInt(String(rawHora), 10);
            if (!Number.isNaN(parsedHora) && parsedHora >= 0 && parsedHora <= 23) {
                selectedHour = parsedHora;
            }
        }

        // 1. Alunos ativos elegíveis para chamada rápida no painel
        const [alunosAtivos] = await pool.query(`
            SELECT
                a.id,
                a.nome_completo,
                a.foto_perfil_url,
                a.status,
                DATE_FORMAT(a.created_at, '%Y-%m-%d') AS data_cadastro,
                (
                    SELECT ag.modalidade_id
                    FROM aluno_graduacoes ag
                    WHERE ag.aluno_id = a.id AND ag.atual = 1
                    ORDER BY ag.id DESC
                    LIMIT 1
                ) AS grad_modalidade_id,
                (
                    SELECT m.nome
                    FROM aluno_graduacoes ag
                    JOIN modalidades m ON m.id = ag.modalidade_id
                    WHERE ag.aluno_id = a.id AND ag.atual = 1
                    ORDER BY ag.id DESC
                    LIMIT 1
                ) AS modalidade_nome,
                (
                    SELECT COUNT(*)
                    FROM faturas f
                    WHERE f.aluno_id = a.id
                      AND (f.status = 'atrasado' OR (f.status = 'pendente' AND f.data_vencimento < ?))
                ) AS faturas_atrasadas
            FROM alunos a
            WHERE a.deleted_at IS NULL
              AND a.status = 'ativo'
            ORDER BY a.nome_completo ASC
        `, [hoje]);

        // 2. Check-ins já registrados na data selecionada
        const [registradosRows] = await pool.query(`
            SELECT
                c.id AS checkin_id,
                c.aluno_id,
                c.modalidade_id,
                c.turma_id,
                c.data_hora_checkin,
                DATE_FORMAT(c.data_hora_checkin, '%Y-%m-%d') AS data_local,
                DATE_FORMAT(c.data_hora_checkin, '%H:%i') AS hora_checkin,
                c.metodo,
                c.status,
                c.motivo_bloqueio,
                a.nome_completo,
                a.foto_perfil_url,
                m.nome AS modalidade_nome,
                t.nome AS turma_nome
            FROM checkins c
            JOIN alunos a ON a.id = c.aluno_id
            JOIN modalidades m ON m.id = c.modalidade_id
            LEFT JOIN turmas t ON t.id = c.turma_id
            WHERE a.deleted_at IS NULL
              AND DATE(c.data_hora_checkin) = ?
            ORDER BY c.data_hora_checkin DESC, c.id DESC
        `, [dataReferencia]);

        // 3. Total histórico por aluno (para identificar quem está fazendo o 1º check-in)
        const [totaisRows] = await pool.query(`
            SELECT aluno_id, COUNT(*) AS total_checkins
            FROM checkins
            GROUP BY aluno_id
        `);

        // 4. Minutos históricos dos últimos 120 dias (para reconhecer horário habitual)
        const [horariosHistoricoRows] = await pool.query(`
            SELECT
                aluno_id,
                HOUR(data_hora_checkin) AS hora,
                MINUTE(data_hora_checkin) AS minuto
            FROM checkins
            WHERE status = 'aprovado'
              AND data_hora_checkin >= DATE_SUB(CURDATE(), INTERVAL 120 DAY)
        `);

        const historyStatsMap = new Map();
        for (const row of totaisRows) {
            const aid = Number(row.aluno_id);
            historyStatsMap.set(aid, {
                total_checkins: Number(row.total_checkins || 0),
                minutos_historico: []
            });
        }
        for (const row of horariosHistoricoRows) {
            const aid = Number(row.aluno_id);
            if (!historyStatsMap.has(aid)) {
                historyStatsMap.set(aid, { total_checkins: 1, minutos_historico: [] });
            }
            const mins = (Number(row.hora || 0) * 60) + Number(row.minuto || 0);
            historyStatsMap.get(aid).minutos_historico.push(mins);
        }

        // Consolida nomes curtos consistentes considerando todos os alunos envolvidos
        const combinedForNames = new Map();
        alunosAtivos.forEach(a => combinedForNames.set(Number(a.id), { id: Number(a.id), nome_completo: a.nome_completo }));
        registradosRows.forEach(r => combinedForNames.set(Number(r.aluno_id), { id: Number(r.aluno_id), nome_completo: r.nome_completo }));
        const shortNamesMap = checkinSmartService.getDisplayShortNames(Array.from(combinedForNames.values()));

        const checkedInIds = new Set(registradosRows.map(r => Number(r.aluno_id)));
        const pendingCandidates = alunosAtivos
            .filter(a => !checkedInIds.has(Number(a.id)))
            .map(a => ({
                ...a,
                modalidade_id: a.grad_modalidade_id || null,
                faturas_atrasadas: Number(a.faturas_atrasadas || 0)
            }));

        const rankedPending = checkinSmartService.rankStudentsForSmartCheckin(
            pendingCandidates,
            historyStatsMap,
            { currentMinutes, windowMinutes: 90, selectedHour }
        ).map(item => ({
            ...item,
            nome_curto: shortNamesMap.get(Number(item.id)) || item.nome_curto
        }));

        const registrados = registradosRows.map(r => ({
            checkin_id: Number(r.checkin_id),
            id: Number(r.aluno_id),
            aluno_id: Number(r.aluno_id),
            nome_completo: r.nome_completo,
            nome_curto: shortNamesMap.get(Number(r.aluno_id)) || String(r.nome_completo || '').split(/\s+/)[0],
            foto_perfil_url: r.foto_perfil_url,
            modalidade_id: Number(r.modalidade_id),
            modalidade_nome: r.modalidade_nome,
            turma_nome: r.turma_nome || null,
            data_hora_checkin: r.data_hora_checkin,
            data_local: r.data_local,
            hora_checkin: r.hora_checkin,
            metodo: r.metodo,
            status: r.status,
            motivo_bloqueio: r.motivo_bloqueio || null
        }));

        const horariosDetectados = checkinSmartService.extractDetectedHours(horariosHistoricoRows);

        res.json({
            success: true,
            data: {
                hoje,
                data_referencia: dataReferencia,
                hora_atual: horaAtual,
                minuto_atual: minutoAtual,
                horario_atual_label: `${String(horaAtual).padStart(2, '0')}:${String(minutoAtual).padStart(2, '0')}`,
                horarios_detectados: horariosDetectados,
                pendentes: rankedPending,
                registrados,
                totais: {
                    pendentes: rankedPending.length,
                    registrados: registrados.length,
                    primeiro_checkin: rankedPending.filter(p => p.is_primeiro_checkin).length
                }
            }
        });
    } catch (err) {
        console.error('Erro ao carregar painel inteligente de check-ins:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao carregar painel inteligente de presenças.' });
    }
});

// GET /api/checkins/recentes - Lista os check-ins mais recentes (todos autenticados)
router.get('/recentes', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                c.id,
                c.data_hora_checkin,
                DATE_FORMAT(c.data_hora_checkin, '%Y-%m-%d') AS data_local,
                DATE_FORMAT(c.data_hora_checkin, '%H:%i') AS hora_checkin,
                c.metodo,
                c.status,
                c.motivo_bloqueio,
                a.id AS aluno_id,
                a.nome_completo AS aluno_nome,
                a.foto_perfil_url,
                m.nome AS modalidade_nome,
                t.nome AS turma_nome
            FROM checkins c
            JOIN alunos a ON a.id = c.aluno_id
            JOIN modalidades m ON m.id = c.modalidade_id
            LEFT JOIN turmas t ON t.id = c.turma_id
            ORDER BY c.data_hora_checkin DESC
            LIMIT 50
        `);
        res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
        console.error('Erro ao listar check-ins:', err);
        res.status(500).json({ success: false, error: 'Erro ao listar check-ins.' });
    }
});

// GET /api/checkins/aluno/:alunoId/calendario - Calendário mensal de presenças e faltas para a Aba 360°
router.get('/aluno/:alunoId/calendario', authenticateToken, async (req, res) => {
    const alunoId = parseInt(req.params.alunoId, 10);
    if (Number.isNaN(alunoId) || alunoId <= 0) {
        return res.status(400).json({ success: false, error: 'ID de aluno inválido.' });
    }

    try {
        const nowBr = checkinSmartService.getBrazilNowParts();

        const anoRaw = parseInt(String(req.query.ano || nowBr.ano), 10);
        const mesRaw = parseInt(String(req.query.mes || nowBr.mes), 10);
        const ano = (!Number.isNaN(anoRaw) && anoRaw >= 2020 && anoRaw <= 2100) ? anoRaw : nowBr.ano;
        const mes = (!Number.isNaN(mesRaw) && mesRaw >= 1 && mesRaw <= 12) ? mesRaw : nowBr.mes;

        const [alunoRows] = await pool.query(`
            SELECT id, nome_completo, DATE_FORMAT(created_at, '%Y-%m-%d') AS data_cadastro
            FROM alunos
            WHERE id = ? AND deleted_at IS NULL
            LIMIT 1
        `, [alunoId]);

        if (alunoRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        const [checkinsRows] = await pool.query(`
            SELECT
                c.id,
                c.data_hora_checkin,
                DATE_FORMAT(c.data_hora_checkin, '%Y-%m-%d') AS data_local,
                DATE_FORMAT(c.data_hora_checkin, '%H:%i') AS hora_local,
                c.metodo,
                c.status,
                m.nome AS modalidade_nome,
                t.nome AS turma_nome
            FROM checkins c
            JOIN modalidades m ON m.id = c.modalidade_id
            LEFT JOIN turmas t ON t.id = c.turma_id
            WHERE c.aluno_id = ?
              AND YEAR(c.data_hora_checkin) = ?
              AND MONTH(c.data_hora_checkin) = ?
            ORDER BY c.data_hora_checkin DESC, c.id DESC
        `, [alunoId, ano, mes]);

        const calendario = checkinSmartService.buildAttendanceCalendarMonth(ano, mes, checkinsRows, {
            todayIso: nowBr.dateIso,
            dataCadastro: alunoRows[0].data_cadastro
        });

        res.json({
            success: true,
            data: {
                ano,
                mes,
                hoje: nowBr.dateIso,
                data_cadastro: alunoRows[0].data_cadastro,
                checkins: checkinsRows,
                calendario
            }
        });
    } catch (err) {
        console.error('Erro ao carregar calendário de presenças:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar calendário de presenças.' });
    }
});

// POST /api/checkins - Registrar novo check-in / presença (suporta check-in ágil sem turma/modalidade explícitas)
router.post('/', authenticateToken, async (req, res) => {
    try {
        const alunoId = parseInt(req.body?.aluno_id, 10);
        if (Number.isNaN(alunoId) || alunoId <= 0) {
            return res.status(400).json({ success: false, error: 'Aluno inválido ou não informado.' });
        }

        const rawMetodo = typeof req.body?.metodo === 'string' ? req.body.metodo.trim() : 'manual_professor';
        const metodo = ALLOWED_METHODS.has(rawMetodo) ? rawMetodo : 'manual_professor';
        const rapido = Boolean(req.body?.rapido);
        const nowBr = checkinSmartService.getBrazilNowParts();

        // Verifica status do aluno
        const [alunos] = await pool.query(
            'SELECT id, status, nome_completo, foto_perfil_url FROM alunos WHERE id = ? AND deleted_at IS NULL',
            [alunoId]
        );
        if (alunos.length === 0) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }
        const aluno = alunos[0];

        // Se for check-in rápido por duplo clique, evita duplicação no mesmo dia (fuso GMT-3)
        if (rapido) {
            const [existingToday] = await pool.query(`
                SELECT
                    c.id,
                    c.aluno_id,
                    c.modalidade_id,
                    c.turma_id,
                    c.data_hora_checkin,
                    DATE_FORMAT(c.data_hora_checkin, '%Y-%m-%d') AS data_local,
                    DATE_FORMAT(c.data_hora_checkin, '%H:%i') AS hora_checkin,
                    c.metodo,
                    c.status,
                    c.motivo_bloqueio,
                    a.nome_completo AS aluno_nome,
                    a.foto_perfil_url,
                    m.nome AS modalidade_nome
                FROM checkins c
                JOIN alunos a ON a.id = c.aluno_id
                JOIN modalidades m ON m.id = c.modalidade_id
                WHERE c.aluno_id = ? AND DATE(c.data_hora_checkin) = ?
                ORDER BY c.id DESC
                LIMIT 1
            `, [alunoId, nowBr.dateIso]);

            if (existingToday.length > 0) {
                return res.status(200).json({
                    success: true,
                    already_checked_in: true,
                    id: existingToday[0].id,
                    status: existingToday[0].status,
                    motivo_bloqueio: existingToday[0].motivo_bloqueio,
                    checkin: existingToday[0],
                    message: `${aluno.nome_completo} já possui check-in registrado hoje às ${existingToday[0].hora_checkin}.`
                });
            }
        }

        // Resolve modalidade automaticamente se omitida
        let modalidadeId = parseInt(req.body?.modalidade_id, 10);
        if (Number.isNaN(modalidadeId) || modalidadeId <= 0) {
            modalidadeId = await resolveDefaultModalidadeForAluno(alunoId);
        }
        if (!modalidadeId) {
            return res.status(400).json({ success: false, error: 'Nenhuma modalidade ativa encontrada para registrar o check-in.' });
        }

        const rawTurmaId = req.body?.turma_id;
        const parsedTurmaId = (rawTurmaId !== undefined && rawTurmaId !== null && String(rawTurmaId).trim() !== '')
            ? parseInt(String(rawTurmaId), 10)
            : null;
        const turmaId = (parsedTurmaId && !Number.isNaN(parsedTurmaId) && parsedTurmaId > 0) ? parsedTurmaId : null;

        let faturasAtrasadas = 0;
        if (!['bloqueado', 'trancado', 'inativo'].includes(aluno.status)) {
            const [atrasos] = await pool.query(`
                SELECT COUNT(*) AS total_atrasadas 
                FROM faturas 
                WHERE aluno_id = ? AND (status = 'atrasado' OR (status = 'pendente' AND data_vencimento < ?))
            `, [alunoId, nowBr.dateIso]);
            faturasAtrasadas = atrasos[0].total_atrasadas;
        }

        const { status: statusCheckin, motivoBloqueio } = evaluateCheckinEligibility(aluno.status, faturasAtrasadas);

        const [result] = await pool.query(`
            INSERT INTO checkins (aluno_id, modalidade_id, turma_id, data_hora_checkin, metodo, status, motivo_bloqueio, validado_por_usuario_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [alunoId, modalidadeId, turmaId, nowBr.sqlDateTime, metodo, statusCheckin, motivoBloqueio, req.user ? req.user.id : null]);

        const [createdRows] = await pool.query(`
            SELECT
                c.id,
                c.aluno_id,
                c.modalidade_id,
                c.turma_id,
                c.data_hora_checkin,
                DATE_FORMAT(c.data_hora_checkin, '%Y-%m-%d') AS data_local,
                DATE_FORMAT(c.data_hora_checkin, '%H:%i') AS hora_checkin,
                c.metodo,
                c.status,
                c.motivo_bloqueio,
                a.nome_completo AS aluno_nome,
                a.foto_perfil_url,
                m.nome AS modalidade_nome
            FROM checkins c
            JOIN alunos a ON a.id = c.aluno_id
            JOIN modalidades m ON m.id = c.modalidade_id
            WHERE c.id = ?
            LIMIT 1
        `, [result.insertId]);

        res.status(201).json({
            success: true,
            id: result.insertId,
            status: statusCheckin,
            motivo_bloqueio: motivoBloqueio,
            checkin: createdRows[0] || null,
            message: statusCheckin === 'aprovado'
                ? `Presença de ${aluno.nome_completo} confirmada com sucesso!`
                : `Check-in ${statusCheckin}: ${motivoBloqueio}`
        });
    } catch (err) {
        console.error('Erro ao registrar check-in:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao registrar check-in.' });
    }
});

// DELETE /api/checkins/:id - Desfaz um check-in registrado (admin, professor, recepcao)
router.delete('/:id', authenticateToken, authorizeRoles('admin', 'professor', 'recepcao'), async (req, res) => {
    const checkinId = parseInt(req.params.id, 10);
    if (Number.isNaN(checkinId) || checkinId <= 0) {
        return res.status(400).json({ success: false, error: 'ID de check-in inválido.' });
    }

    try {
        const [rows] = await pool.query(`
            SELECT c.id, c.aluno_id, a.nome_completo
            FROM checkins c
            LEFT JOIN alunos a ON a.id = c.aluno_id
            WHERE c.id = ?
            LIMIT 1
        `, [checkinId]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Registro de check-in não encontrado.' });
        }

        await pool.query('DELETE FROM checkins WHERE id = ?', [checkinId]);

        res.json({
            success: true,
            id: checkinId,
            aluno_id: Number(rows[0].aluno_id),
            message: `Check-in de ${rows[0].nome_completo || 'aluno'} desfeito com sucesso!`
        });
    } catch (err) {
        console.error('Erro ao desfazer check-in:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao desfazer check-in.' });
    }
});

// GET /api/checkins/turmas - Listar turmas ativas
router.get('/turmas', authenticateToken, async (req, res) => {
    try {
        const [turmas] = await pool.query(`
            SELECT t.*, m.nome AS modalidade_nome, ue.nome AS professor_nome
            FROM turmas t
            JOIN modalidades m ON m.id = t.modalidade_id
            LEFT JOIN usuarios_equipe ue ON ue.id = t.professor_id
            WHERE t.ativo = 1
            ORDER BY t.modalidade_id, t.horario_inicio
        `);
        res.json({ success: true, data: turmas });
    } catch (err) {
        console.error('Erro ao listar turmas:', err);
        res.status(500).json({ success: false, error: 'Erro ao listar turmas.' });
    }
});

module.exports = router;
