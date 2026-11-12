/**
 * KAIZEN CT PRO - Rotas de Exames de Graduação e Integração Asaas
 * Gestão de eventos de graduação, identificação de alunos aptos,
 * envio de convites e processamento de pagamentos via Gateway Asaas
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../db/connection');
const asaasService = require('../services/asaasService');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');

const JWT_SECRET = process.env.JWT_SECRET;

// Middleware de autenticação opcional para flexibilidade do portal do aluno
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
    next();
}

// ============================================================================
// 1. ROTAS ADMINISTRATIVAS - GESTÃO DE EVENTOS E CONVITES
// ============================================================================

/**
 * GET /api/exames/eventos
 * Lista todos os eventos de exame de graduação com contadores de participantes
 */
router.get('/eventos', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        const { status, modalidade_id } = req.query;

        let sql = `
            SELECT 
                eg.id,
                eg.titulo,
                eg.modalidade_id,
                m.nome AS modalidade_nome,
                eg.data_evento,
                eg.horario_inicio,
                eg.data_limite_inscricao,
                eg.local_evento,
                eg.taxa_inscricao,
                eg.descricao,
                eg.status,
                eg.created_at,
                COUNT(c.id) AS total_convidados,
                SUM(CASE WHEN c.status IN ('aceito', 'pago') THEN 1 ELSE 0 END) AS total_confirmados,
                SUM(CASE WHEN c.status = 'pago' THEN 1 ELSE 0 END) AS total_pagos,
                SUM(CASE WHEN c.status = 'recusado' THEN 1 ELSE 0 END) AS total_recusados,
                COALESCE(SUM(CASE WHEN c.status = 'pago' THEN c.valor ELSE 0 END), 0.00) AS total_arrecadado
            FROM eventos_graduacao eg
            LEFT JOIN modalidades m ON m.id = eg.modalidade_id
            LEFT JOIN evento_graduacao_convites c ON c.evento_id = eg.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            sql += ' AND eg.status = ?';
            params.push(status);
        }
        if (modalidade_id) {
            sql += ' AND eg.modalidade_id = ?';
            params.push(modalidade_id);
        }

        sql += ' GROUP BY eg.id ORDER BY eg.data_evento DESC, eg.id DESC';

        const [eventos] = await pool.query(sql, params);

        res.json({ success: true, data: eventos });
    } catch (err) {
        console.error('Erro ao listar eventos de exame:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar eventos de graduação.' });
    }
});

/**
 * GET /api/exames/eventos/:id
 * Retorna detalhes do evento e a lista de alunos convidados
 */
router.get('/eventos/:id', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        const eventoId = parseInt(req.params.id, 10);
        if (isNaN(eventoId)) {
            return res.status(400).json({ success: false, error: 'ID do evento inválido.' });
        }

        const [eventos] = await pool.query(`
            SELECT eg.*, m.nome AS modalidade_nome
            FROM eventos_graduacao eg
            LEFT JOIN modalidades m ON m.id = eg.modalidade_id
            WHERE eg.id = ?
        `, [eventoId]);

        if (eventos.length === 0) {
            return res.status(404).json({ success: false, error: 'Evento de exame não encontrado.' });
        }

        const evento = eventos[0];

        // Lista de convites vinculados a este evento
        const [convites] = await pool.query(`
            SELECT 
                c.id AS convite_id,
                c.evento_id,
                c.aluno_id,
                a.nome_completo AS aluno_nome,
                a.foto_perfil_url AS aluno_foto,
                a.email AS aluno_email,
                a.telefone_whatsapp AS aluno_telefone,
                m.id AS modalidade_id,
                m.nome AS modalidade_nome,
                gn_atual.id AS graduacao_atual_id,
                gn_atual.nome AS graduacao_atual_nome,
                gn_atual.cor_hex_primaria AS atual_cor_primaria,
                gn_pret.id AS graduacao_pretendida_id,
                gn_pret.nome AS graduacao_pretendida_nome,
                gn_pret.cor_hex_primaria AS pretendida_cor_primaria,
                c.percentual_avaliacao,
                c.apto_motivo,
                c.valor,
                c.status AS convite_status,
                c.data_convite,
                c.data_resposta,
                c.motivo_recusa,
                c.asaas_payment_id,
                c.asaas_invoice_url,
                c.asaas_pix_copia_cola,
                c.asaas_billing_type,
                c.asaas_status,
                c.data_pagamento
            FROM evento_graduacao_convites c
            JOIN alunos a ON a.id = c.aluno_id
            JOIN modalidades m ON m.id = c.modalidade_id
            JOIN graduacoes_niveis gn_atual ON gn_atual.id = c.graduacao_atual_id
            JOIN graduacoes_niveis gn_pret ON gn_pret.id = c.graduacao_pretendida_id
            WHERE c.evento_id = ?
            ORDER BY a.nome_completo ASC
        `, [eventoId]);

        evento.convites = convites;
        evento.total_convidados = convites.length;
        evento.total_pagos = convites.filter(c => c.convite_status === 'pago').length;
        evento.total_confirmados = convites.filter(c => ['aceito', 'pago'].includes(c.convite_status)).length;
        evento.total_arrecadado = convites
            .filter(c => c.convite_status === 'pago')
            .reduce((acc, c) => acc + parseFloat(c.valor || 0), 0);

        res.json({ success: true, data: evento });
    } catch (err) {
        console.error('Erro ao consultar detalhes do evento:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar detalhes do evento.' });
    }
});

/**
 * POST /api/exames/eventos
 * Cria um novo evento de exame de graduação
 */
router.post('/eventos', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        const {
            titulo,
            modalidade_id,
            data_evento,
            horario_inicio,
            data_limite_inscricao,
            local_evento,
            taxa_inscricao,
            descricao,
            status
        } = req.body;

        if (!titulo || typeof titulo !== 'string' || titulo.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'O título do evento de exame é obrigatório.' });
        }

        if (!data_evento || !/^\d{4}-\d{2}-\d{2}$/.test(data_evento)) {
            return res.status(400).json({ success: false, error: 'A data do evento é obrigatória no formato AAAA-MM-DD.' });
        }

        const taxaNum = parseFloat(taxa_inscricao);
        if (isNaN(taxaNum) || taxaNum < 0) {
            return res.status(400).json({ success: false, error: 'A taxa de inscrição deve ser um valor numérico válido.' });
        }

        const cleanTitulo = titulo.trim().substring(0, 150);
        const cleanLocal = (local_evento && typeof local_evento === 'string') 
            ? local_evento.trim().substring(0, 200) 
            : 'Dojo Central - Kaizen CT';
        const cleanHorario = (horario_inicio && /^\d{2}:\d{2}(:\d{2})?$/.test(horario_inicio)) 
            ? horario_inicio 
            : '09:00:00';
        const cleanDataLimite = (data_limite_inscricao && /^\d{4}-\d{2}-\d{2}$/.test(data_limite_inscricao)) 
            ? data_limite_inscricao 
            : null;
        const cleanStatus = ['rascunho', 'aberto', 'em_andamento', 'concluido', 'cancelado'].includes(status) 
            ? status 
            : 'aberto';
        const cleanModalidadeId = modalidade_id ? parseInt(modalidade_id, 10) : null;
        const usuarioId = req.user ? req.user.id : null;

        const [result] = await pool.query(`
            INSERT INTO eventos_graduacao (
                titulo, modalidade_id, data_evento, horario_inicio,
                data_limite_inscricao, local_evento, taxa_inscricao,
                descricao, status, criado_por_usuario_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            cleanTitulo, cleanModalidadeId, data_evento, cleanHorario,
            cleanDataLimite, cleanLocal, taxaNum,
            descricao || null, cleanStatus, usuarioId
        ]);

        const novoEventoId = result.insertId;

        // Cria aviso automático no mural da academia para divulgar o exame
        try {
            await pool.query(`
                INSERT INTO avisos_campanhas (titulo, tipo, descricao, data_evento, tag_destaque, ativo)
                VALUES (?, 'evento', ?, ?, 'Exame Oficial', 1)
            `, [
                cleanTitulo,
                descricao || `Novo Exame de Graduação agendado para ${data_evento} às ${cleanHorario}. Verifique sua aptidão técnica e confirme sua participação!`,
                data_evento
            ]);
        } catch (avisoErr) {
            console.warn('[Exames] Falha ao publicar aviso automático:', avisoErr.message);
        }

        res.status(201).json({
            success: true,
            message: 'Evento de exame de graduação iniciado com sucesso!',
            evento_id: novoEventoId,
            data: { id: novoEventoId }
        });
    } catch (err) {
        console.error('Erro ao criar evento de exame:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao criar evento de graduação.' });
    }
});

/**
 * PUT /api/exames/eventos/:id
 * Atualiza um evento existente
 */
router.put('/eventos/:id', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        const eventoId = parseInt(req.params.id, 10);
        if (isNaN(eventoId)) {
            return res.status(400).json({ success: false, error: 'ID do evento inválido.' });
        }

        const {
            titulo,
            modalidade_id,
            data_evento,
            horario_inicio,
            data_limite_inscricao,
            local_evento,
            taxa_inscricao,
            descricao,
            status
        } = req.body;

        const [existente] = await pool.query('SELECT id FROM eventos_graduacao WHERE id = ?', [eventoId]);
        if (existente.length === 0) {
            return res.status(404).json({ success: false, error: 'Evento não encontrado.' });
        }

        const updates = [];
        const params = [];

        if (titulo !== undefined) {
            updates.push('titulo = ?');
            params.push(String(titulo).trim().substring(0, 150));
        }
        if (modalidade_id !== undefined) {
            updates.push('modalidade_id = ?');
            params.push(modalidade_id ? parseInt(modalidade_id, 10) : null);
        }
        if (data_evento !== undefined) {
            updates.push('data_evento = ?');
            params.push(data_evento);
        }
        if (horario_inicio !== undefined) {
            updates.push('horario_inicio = ?');
            params.push(horario_inicio);
        }
        if (data_limite_inscricao !== undefined) {
            updates.push('data_limite_inscricao = ?');
            params.push(data_limite_inscricao || null);
        }
        if (local_evento !== undefined) {
            updates.push('local_evento = ?');
            params.push(String(local_evento).trim().substring(0, 200));
        }
        if (taxa_inscricao !== undefined) {
            const t = parseFloat(taxa_inscricao);
            updates.push('taxa_inscricao = ?');
            params.push(isNaN(t) ? 150.00 : t);
        }
        if (descricao !== undefined) {
            updates.push('descricao = ?');
            params.push(descricao || null);
        }
        if (status !== undefined) {
            if (['rascunho', 'aberto', 'em_andamento', 'concluido', 'cancelado'].includes(status)) {
                updates.push('status = ?');
                params.push(status);
            }
        }

        if (updates.length > 0) {
            params.push(eventoId);
            await pool.query(`UPDATE eventos_graduacao SET ${updates.join(', ')} WHERE id = ?`, params);
        }

        res.json({ success: true, message: 'Evento atualizado com sucesso.' });
    } catch (err) {
        console.error('Erro ao atualizar evento:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao atualizar evento.' });
    }
});

/**
 * DELETE /api/exames/eventos/:id
 * Remove um evento de graduação
 */
router.delete('/eventos/:id', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        const eventoId = parseInt(req.params.id, 10);
        if (isNaN(eventoId)) {
            return res.status(400).json({ success: false, error: 'ID inválido.' });
        }

        const [result] = await pool.query('DELETE FROM eventos_graduacao WHERE id = ?', [eventoId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Evento não encontrado.' });
        }

        res.json({ success: true, message: 'Evento de exame removido com sucesso.' });
    } catch (err) {
        console.error('Erro ao excluir evento:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao excluir evento.' });
    }
});

/**
 * GET /api/exames/alunos-aptos
 * Varre todos os alunos e identifica os que estão aptos a prestar exame de graduação
 * com base na avaliação técnica de graduação OU na prontidão dos golpes da faixa atual.
 */
router.get('/alunos-aptos', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        const eventoId = req.query.evento_id ? parseInt(req.query.evento_id, 10) : null;
        const modalidadeId = req.query.modalidade_id ? parseInt(req.query.modalidade_id, 10) : null;

        // 1. Busca todos os alunos com graduação ativa
        let sql = `
            SELECT 
                a.id AS aluno_id,
                a.nome_completo,
                a.foto_perfil_url,
                a.email,
                a.telefone_whatsapp,
                a.status AS aluno_status,
                ag.id AS aluno_graduacao_id,
                m.id AS modalidade_id,
                m.nome AS modalidade_nome,
                gn_atual.id AS graduacao_atual_id,
                gn_atual.nome AS graduacao_atual_nome,
                gn_atual.ordem_hierarquica AS ordem_atual,
                gn_atual.cor_hex_primaria AS atual_cor_primaria,
                gn_atual.porcentagem_minima AS meta_minima
            FROM alunos a
            JOIN aluno_graduacoes ag ON ag.aluno_id = a.id AND ag.atual = 1
            JOIN modalidades m ON m.id = ag.modalidade_id
            JOIN graduacoes_niveis gn_atual ON gn_atual.id = ag.graduacao_nivel_id
            WHERE a.status != 'inativo' AND a.deleted_at IS NULL
        `;
        const params = [];

        if (modalidadeId) {
            sql += ' AND m.id = ?';
            params.push(modalidadeId);
        }

        sql += ' ORDER BY m.nome ASC, gn_atual.ordem_hierarquica ASC, a.nome_completo ASC';

        const [alunosGraduados] = await pool.query(sql, params);

        // 2. Para cada aluno, busca a próxima graduação, a última avaliação técnica e o progresso de golpes
        const alunosAptos = [];

        for (const item of alunosGraduados) {
            // Busca a próxima graduação na ordem hierárquica para a mesma modalidade
            const [proximoNivelRows] = await pool.query(`
                SELECT id, nome, ordem_hierarquica, cor_hex_primaria, porcentagem_minima
                FROM graduacoes_niveis
                WHERE modalidade_id = ? AND ordem_hierarquica = ?
                LIMIT 1
            `, [item.modalidade_id, item.ordem_atual + 1]);

            // Se não houver próxima graduação cadastrada, o aluno já está no nível máximo
            if (proximoNivelRows.length === 0) {
                continue;
            }

            const proximoNivel = proximoNivelRows[0];

            // Busca a última avaliação técnica em aluno_avaliacoes_graduacao
            const [avaliacoes] = await pool.query(`
                SELECT aag.id, aag.percentual_obtido, aag.apto, aag.observacoes_professor,
                       ue.nome AS professor_nome, aag.data_avaliacao
                FROM aluno_avaliacoes_graduacao aag
                LEFT JOIN usuarios_equipe ue ON ue.id = aag.professor_id
                WHERE aag.aluno_id = ? AND aag.graduacao_nivel_id = ?
                ORDER BY aag.id DESC
                LIMIT 1
            `, [item.aluno_id, item.graduacao_atual_id]);

            // Busca a prontidão de golpes técnicos vinculados
            const [golpesVinculados] = await pool.query(`
                SELECT wg.id, agp.status AS status_progresso
                FROM graduacao_nivel_golpes gng
                JOIN wiki_golpes wg ON wg.id = gng.golpe_id
                LEFT JOIN aluno_golpes_progresso agp ON agp.golpe_id = wg.id AND agp.aluno_id = ?
                WHERE gng.graduacao_nivel_id = ?
            `, [item.aluno_id, item.graduacao_atual_id]);

            const totalGolpes = golpesVinculados.length;
            const dominados = golpesVinculados.filter(g => g.status_progresso === 'dominado').length;
            const pctGolpes = totalGolpes > 0 ? Math.round((dominados / totalGolpes) * 100) : 0;

            let isApto = false;
            let percentualAptidao = 0;
            let aptoMotivo = '';

            const avaliacaoFormal = avaliacoes.length > 0 ? avaliacoes[0] : null;

            if (avaliacaoFormal && avaliacaoFormal.apto === 1) {
                isApto = true;
                percentualAptidao = parseFloat(avaliacaoFormal.percentual_obtido) || 100;
                aptoMotivo = `Aprovado pelo professor ${avaliacaoFormal.professor_nome || 'Avaliador'} (${percentualAptidao}%)`;
            } else if (totalGolpes > 0 && pctGolpes >= (item.meta_minima || 70)) {
                isApto = true;
                percentualAptidao = pctGolpes;
                aptoMotivo = `Domínio de ${dominados}/${totalGolpes} técnicas da faixa (${pctGolpes}%)`;
            } else if (avaliacaoFormal && parseFloat(avaliacaoFormal.percentual_obtido) >= (item.meta_minima || 70)) {
                isApto = true;
                percentualAptidao = parseFloat(avaliacaoFormal.percentual_obtido);
                aptoMotivo = `Avaliação atingiu a meta mínima (${percentualAptidao}%)`;
            }

            // Se for considerado apto, inclui na lista
            if (isApto) {
                // Checa se já foi convidado para o evento informado
                let jaConvidado = false;
                let conviteId = null;
                let conviteStatus = null;

                if (eventoId) {
                    const [conviteExistente] = await pool.query(`
                        SELECT id, status FROM evento_graduacao_convites
                        WHERE evento_id = ? AND aluno_id = ?
                    `, [eventoId, item.aluno_id]);

                    if (conviteExistente.length > 0) {
                        jaConvidado = true;
                        conviteId = conviteExistente[0].id;
                        conviteStatus = conviteExistente[0].status;
                    }
                }

                alunosAptos.push({
                    aluno_id: item.aluno_id,
                    nome_completo: item.nome_completo,
                    foto_perfil_url: item.foto_perfil_url,
                    email: item.email,
                    telefone_whatsapp: item.telefone_whatsapp,
                    modalidade_id: item.modalidade_id,
                    modalidade_nome: item.modalidade_nome,
                    graduacao_atual_id: item.graduacao_atual_id,
                    graduacao_atual_nome: item.graduacao_atual_nome,
                    atual_cor_primaria: item.atual_cor_primaria,
                    ordem_atual: item.ordem_atual,
                    graduacao_pretendida_id: proximoNivel.id,
                    graduacao_pretendida_nome: proximoNivel.nome,
                    pretendida_cor_primaria: proximoNivel.cor_hex_primaria,
                    ordem_pretendida: proximoNivel.ordem_hierarquica,
                    percentual_avaliacao: percentualAptidao,
                    apto_motivo: aptoMotivo,
                    ja_convidado: jaConvidado,
                    convite_id: conviteId,
                    convite_status: conviteStatus
                });
            }
        }

        res.json({
            success: true,
            total_aptos: alunosAptos.length,
            data: alunosAptos
        });

    } catch (err) {
        console.error('Erro ao consultar alunos aptos:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar alunos aptos para graduação.' });
    }
});

/**
 * POST /api/exames/eventos/:id/convidar
 * Insere alunos aptos na lista de convite do evento
 */
router.post('/eventos/:id/convidar', authenticateToken, authorizeRoles('admin', 'recepcao', 'professor'), async (req, res) => {
    try {
        const eventoId = parseInt(req.params.id, 10);
        if (isNaN(eventoId)) {
            return res.status(400).json({ success: false, error: 'ID do evento inválido.' });
        }

        // Verifica existência do evento
        const [eventos] = await pool.query('SELECT * FROM eventos_graduacao WHERE id = ?', [eventoId]);
        if (eventos.length === 0) {
            return res.status(404).json({ success: false, error: 'Evento de exame não encontrado.' });
        }
        const evento = eventos[0];

        const { alunos } = req.body;
        if (!Array.isArray(alunos) || alunos.length === 0) {
            return res.status(400).json({ success: false, error: 'Selecione ao menos um aluno apto para convidar.' });
        }

        let convidadosCount = 0;
        const taxaPadrao = parseFloat(evento.taxa_inscricao) || 150.00;

        for (const al of alunos) {
            const alunoId = parseInt(al.aluno_id, 10);
            const modId = parseInt(al.modalidade_id, 10);
            const gradAtualId = parseInt(al.graduacao_atual_id, 10);
            const gradPretId = parseInt(al.graduacao_pretendida_id, 10);
            const pct = al.percentual_avaliacao ? parseFloat(al.percentual_avaliacao) : null;
            const motivo = al.apto_motivo || 'Aluno apto com base nas avaliações e fundamentos da faixa';
            const val = al.valor ? parseFloat(al.valor) : taxaPadrao;

            if (!alunoId || !modId || !gradAtualId || !gradPretId) {
                continue;
            }

            const [result] = await pool.query(`
                INSERT INTO evento_graduacao_convites (
                    evento_id, aluno_id, modalidade_id,
                    graduacao_atual_id, graduacao_pretendida_id,
                    percentual_avaliacao, apto_motivo, valor,
                    status, data_convite
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'convidado', NOW())
                ON DUPLICATE KEY UPDATE
                    valor = VALUES(valor),
                    percentual_avaliacao = VALUES(percentual_avaliacao),
                    apto_motivo = VALUES(apto_motivo)
            `, [
                eventoId, alunoId, modId, gradAtualId, gradPretId, pct, motivo, val
            ]);

            if (result.affectedRows > 0) {
                convidadosCount++;
            }
        }

        // Cria aviso direcionado para manter os alunos informados no portal
        try {
            const dataFmt = new Date(evento.data_evento).toLocaleDateString('pt-BR');
            await pool.query(`
                INSERT INTO avisos_campanhas (titulo, tipo, descricao, data_evento, tag_destaque, ativo)
                VALUES (?, 'campanha', ?, ?, 'Convite Oficial', 1)
            `, [
                `Convites Enviados: ${evento.titulo}`,
                `Os atletas qualificados para o Exame de Graduação de ${dataFmt} já receberam o convite em seu portal. Acesse a área de exames para confirmar presença e taxa.`,
                evento.data_evento
            ]);
        } catch (avisoErr) {
            console.warn('[Exames] Falha ao registrar aviso:', avisoErr.message);
        }

        res.status(201).json({
            success: true,
            message: `${convidadosCount} convite(s) gerado(s) com sucesso para o exame!`,
            total_convidados: convidadosCount,
            convites_enviados: convidadosCount
        });

    } catch (err) {
        console.error('Erro ao convidar alunos para o exame:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao processar convites para o exame.' });
    }
});

/**
 * POST /api/exames/convites/:conviteId/confirmar-manual
 * Permite ao gestor marcar como pago manualmente (ex: pagamento no balcão)
 */
router.post('/convites/:conviteId/confirmar-manual', authenticateToken, authorizeRoles('admin', 'recepcao'), async (req, res) => {
    try {
        const conviteId = parseInt(req.params.conviteId, 10);
        if (isNaN(conviteId)) {
            return res.status(400).json({ success: false, error: 'ID do convite inválido.' });
        }

        const [result] = await pool.query(`
            UPDATE evento_graduacao_convites
            SET status = 'pago',
                data_pagamento = NOW(),
                data_resposta = COALESCE(data_resposta, NOW()),
                asaas_status = 'CONFIRMED'
            WHERE id = ?
        `, [conviteId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Convite não encontrado.' });
        }

        res.json({ success: true, message: 'Inscrição confirmada e marcada como paga com sucesso!' });
    } catch (err) {
        console.error('Erro ao confirmar pagamento manual:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao confirmar inscrição.' });
    }
});

// ============================================================================
// 2. ROTAS DO PORTAL DO ALUNO - ACEITE E PAGAMENTO VIA GATEWAY ASAAS
// ============================================================================

/**
 * GET /api/aluno/meus-exames
 * Retorna todos os convites de exames de graduação do aluno
 */
router.get('/meus-exames', optionalAuth, async (req, res) => {
    try {
        let alunoId = null;
        if (req.user) {
            alunoId = req.user.aluno_id || (req.user.cargo === 'aluno' ? req.user.id : null);
        }
        if (!alunoId && req.query.aluno_id) {
            alunoId = parseInt(req.query.aluno_id, 10);
        }
        if (!alunoId || isNaN(alunoId)) {
            alunoId = 1; // Fallback para prévia/demonstração
        }

        const [convites] = await pool.query(`
            SELECT 
                c.id AS convite_id,
                c.evento_id,
                eg.titulo AS evento_titulo,
                eg.data_evento,
                eg.horario_inicio,
                eg.data_limite_inscricao,
                eg.local_evento,
                eg.descricao AS evento_descricao,
                eg.status AS evento_status,
                c.valor,
                c.status AS convite_status,
                c.data_convite,
                c.data_resposta,
                c.motivo_recusa,
                m.nome AS modalidade_nome,
                gn_atual.id AS graduacao_atual_id,
                gn_atual.nome AS graduacao_atual_nome,
                gn_atual.cor_hex_primaria AS atual_cor_primaria,
                gn_pret.id AS graduacao_pretendida_id,
                gn_pret.nome AS graduacao_pretendida_nome,
                gn_pret.cor_hex_primaria AS pretendida_cor_primaria,
                gn_pret.prajied_icone_url AS pretendida_icone_url,
                c.percentual_avaliacao,
                c.apto_motivo,
                c.asaas_payment_id,
                c.asaas_invoice_url,
                c.asaas_pix_qrcode,
                c.asaas_pix_copia_cola,
                c.asaas_billing_type,
                c.asaas_status,
                c.data_pagamento
            FROM evento_graduacao_convites c
            JOIN eventos_graduacao eg ON eg.id = c.evento_id
            JOIN modalidades m ON m.id = c.modalidade_id
            JOIN graduacoes_niveis gn_atual ON gn_atual.id = c.graduacao_atual_id
            JOIN graduacoes_niveis gn_pret ON gn_pret.id = c.graduacao_pretendida_id
            WHERE c.aluno_id = ?
            ORDER BY eg.data_evento DESC, c.id DESC
        `, [alunoId]);

        res.json({ success: true, data: convites });
    } catch (err) {
        console.error('Erro ao consultar convites do aluno:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao consultar convites de exame.' });
    }
});

/**
 * POST /api/aluno/exames/:conviteId/aceitar
 * O aluno aceita o convite e o sistema gera a cobrança via Gateway Asaas (Pix / Fatura)
 */
router.post('/exames/:conviteId/aceitar', optionalAuth, async (req, res) => {
    try {
        const conviteId = parseInt(req.params.conviteId, 10);
        if (isNaN(conviteId)) {
            return res.status(400).json({ success: false, error: 'ID do convite inválido.' });
        }

        let alunoId = null;
        if (req.user) {
            alunoId = req.user.aluno_id || (req.user.cargo === 'aluno' ? req.user.id : null);
        }
        if (!alunoId && req.body.aluno_id) {
            alunoId = parseInt(req.body.aluno_id, 10);
        }
        if (!alunoId) alunoId = 1;

        // Busca o convite e valida pertencimento
        const [conviteRows] = await pool.query(`
            SELECT c.*, eg.titulo AS evento_titulo, eg.data_evento, eg.data_limite_inscricao,
                   a.nome_completo, a.email, a.cpf, a.telefone_whatsapp,
                   gn_pret.nome AS graduacao_pretendida_nome
            FROM evento_graduacao_convites c
            JOIN eventos_graduacao eg ON eg.id = c.evento_id
            JOIN alunos a ON a.id = c.aluno_id
            JOIN graduacoes_niveis gn_pret ON gn_pret.id = c.graduacao_pretendida_id
            WHERE c.id = ? AND c.aluno_id = ?
        `, [conviteId, alunoId]);

        if (conviteRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Convite não encontrado ou não pertence a este aluno.' });
        }

        const convite = conviteRows[0];

        if (convite.status === 'pago') {
            return res.json({
                success: true,
                message: 'Este exame já foi pago e sua vaga está confirmada!',
                ja_pago: true,
                convite
            });
        }

        const billingType = req.body.billing_type || 'PIX';

        // 1. Cria ou busca o cliente no Gateway Asaas
        const customer = await asaasService.criarOuBuscarCliente({
            nome: convite.nome_completo,
            email: convite.email,
            cpfCnpj: convite.cpf,
            telefone: convite.telefone_whatsapp,
            alunoId: convite.aluno_id
        });

        // 2. Determina a data de vencimento da taxa
        let dueDate = convite.data_limite_inscricao;
        if (!dueDate) {
            const evDate = new Date(convite.data_evento);
            dueDate = evDate.toISOString().split('T')[0];
        }

        // 3. Gera a cobrança no Gateway Asaas
        const cobranca = await asaasService.criarCobranca({
            customerId: customer.id,
            valor: convite.valor,
            vencimento: dueDate,
            descricao: `Taxa de Exame: ${convite.evento_titulo} - Promoção para ${convite.graduacao_pretendida_nome}`,
            externalReference: `convite_${convite.id}_aluno_${convite.aluno_id}`,
            billingType: billingType
        });

        const pixQrCode = cobranca.pixQrCode ? cobranca.pixQrCode.encodedImage : null;
        const pixPayload = cobranca.pixQrCode ? cobranca.pixQrCode.payload : null;

        // 4. Salva os dados do Gateway Asaas no convite e altera status para 'aceito'
        await pool.query(`
            UPDATE evento_graduacao_convites
            SET status = 'aceito',
                data_resposta = NOW(),
                asaas_customer_id = ?,
                asaas_payment_id = ?,
                asaas_invoice_url = ?,
                asaas_pix_qrcode = ?,
                asaas_pix_copia_cola = ?,
                asaas_billing_type = ?,
                asaas_status = ?
            WHERE id = ?
        `, [
            customer.id,
            cobranca.id,
            cobranca.invoiceUrl,
            pixQrCode,
            pixPayload,
            billingType,
            cobranca.status,
            conviteId
        ]);

        res.json({
            success: true,
            message: 'Convite aceito com sucesso! Efetue o pagamento para garantir sua vaga.',
            convite_id: conviteId,
            cobranca: {
                payment_id: cobranca.id,
                asaas_payment_id: cobranca.id,
                invoice_url: cobranca.invoiceUrl,
                asaas_invoice_url: cobranca.invoiceUrl,
                pix_copia_cola: pixPayload,
                asaas_pix_copia_cola: pixPayload,
                pix_qrcode_base64: pixQrCode,
                asaas_pix_qrcode: pixQrCode,
                valor: cobranca.value,
                vencimento: cobranca.dueDate,
                status: cobranca.status,
                is_mock: cobranca.is_mock
            }
        });

    } catch (err) {
        console.error('Erro ao aceitar convite de exame:', err);
        res.status(500).json({ success: false, error: 'Erro ao processar aceite e cobrança Asaas: ' + err.message });
    }
});

/**
 * POST /api/aluno/exames/:conviteId/recusar
 * O aluno recusa o convite para o exame de graduação
 */
router.post('/exames/:conviteId/recusar', optionalAuth, async (req, res) => {
    try {
        const conviteId = parseInt(req.params.conviteId, 10);
        if (isNaN(conviteId)) {
            return res.status(400).json({ success: false, error: 'ID do convite inválido.' });
        }

        let alunoId = null;
        if (req.user) {
            alunoId = req.user.aluno_id || (req.user.cargo === 'aluno' ? req.user.id : null);
        }
        if (!alunoId && req.body.aluno_id) {
            alunoId = parseInt(req.body.aluno_id, 10);
        }
        if (!alunoId) alunoId = 1;

        const { motivo } = req.body;
        const cleanMotivo = motivo ? String(motivo).trim().substring(0, 255) : 'Não poderei comparecer na data do evento';

        const [result] = await pool.query(`
            UPDATE evento_graduacao_convites
            SET status = 'recusado',
                data_resposta = NOW(),
                motivo_recusa = ?
            WHERE id = ? AND aluno_id = ?
        `, [cleanMotivo, conviteId, alunoId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Convite não encontrado ou não pertence a este aluno.' });
        }

        res.json({ success: true, message: 'Resposta registrada com sucesso. Seu professor foi notificado.' });
    } catch (err) {
        console.error('Erro ao recusar convite:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao registrar recusa.' });
    }
});

/**
 * POST /api/aluno/exames/:conviteId/simular-pagamento
 * Simula a liquidação do pagamento Asaas para testes e demonstrações rápidas
 */
router.post('/exames/:conviteId/simular-pagamento', optionalAuth, async (req, res) => {
    try {
        const conviteId = parseInt(req.params.conviteId, 10);
        if (isNaN(conviteId)) {
            return res.status(400).json({ success: false, error: 'ID do convite inválido.' });
        }

        const [result] = await pool.query(`
            UPDATE evento_graduacao_convites
            SET status = 'pago',
                asaas_status = 'RECEIVED',
                data_pagamento = NOW()
            WHERE id = ?
        `, [conviteId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Convite não encontrado.' });
        }

        res.json({
            success: true,
            message: 'Pagamento simulado e confirmado com sucesso no Gateway Asaas!'
        });
    } catch (err) {
        console.error('Erro ao simular pagamento:', err);
        res.status(500).json({ success: false, error: 'Erro ao simular pagamento.' });
    }
});

// ============================================================================
// 3. WEBHOOK ASAAS - NOTIFICAÇÃO AUTOMÁTICA DE LIQUIDAÇÃO
// ============================================================================

/**
 * POST /api/exames/webhook-asaas
 * Recebe webhooks do Asaas quando o Pix ou Boleto/Cartão é pago
 */
router.post('/webhook-asaas', async (req, res) => {
    try {
        const { event, payment } = req.body;
        console.log(`[Webhook Asaas] Evento recebido: ${event} para cobrança ${payment?.id}`);

        if (payment && payment.id) {
            const statusPago = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event);
            if (statusPago) {
                await pool.query(`
                    UPDATE evento_graduacao_convites
                    SET status = 'pago',
                        asaas_status = 'RECEIVED',
                        data_pagamento = NOW()
                    WHERE asaas_payment_id = ?
                `, [payment.id]);
                console.log(`[Webhook Asaas] Convite atualizado para PAGO com sucesso para paymentId: ${payment.id}`);
            } else if (event === 'PAYMENT_OVERDUE') {
                await pool.query(`
                    UPDATE evento_graduacao_convites
                    SET asaas_status = 'OVERDUE'
                    WHERE asaas_payment_id = ?
                `, [payment.id]);
            }
        }

        res.json({ success: true, received: true });
    } catch (err) {
        console.error('[Webhook Asaas] Erro no processamento:', err);
        res.status(500).json({ error: 'Erro no processamento do webhook' });
    }
});

module.exports = router;

