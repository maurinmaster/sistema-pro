const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');

const VALID_RPG_RANKS = ['D', 'C', 'B', 'A', 'S'];

function parseRpgGraduationRequirements(body = {}) {
    const rawRank = body.rpg_rank_minimo;
    let rpgRankMinimo = null;
    if (rawRank !== undefined && rawRank !== null && String(rawRank).trim() !== '') {
        const up = String(rawRank).trim().toUpperCase();
        if (!VALID_RPG_RANKS.includes(up)) {
            return { error: 'Rank mínimo RPG inválido. Utilize D, C, B, A ou S.' };
        }
        rpgRankMinimo = up;
    }

    const rawMinAttr = body.rpg_pontuacao_minima_atributo;
    let rpgPontuacaoMinimaAtributo = null;
    if (rawMinAttr !== undefined && rawMinAttr !== null && String(rawMinAttr).trim() !== '') {
        const num = Number(rawMinAttr);
        if (!Number.isInteger(num) || num < 1 || num > 20) {
            return { error: 'Pontuação mínima por atributo RPG deve ser um número inteiro entre 1 e 20.' };
        }
        rpgPontuacaoMinimaAtributo = num;
    }

    const rawSpar = body.rpg_exige_apto_sparring;
    const rpgExigeAptoSparring = (rawSpar === true || rawSpar === 1 || rawSpar === '1' || rawSpar === 'true') ? 1 : 0;

    return {
        rpg_rank_minimo: rpgRankMinimo,
        rpg_pontuacao_minima_atributo: rpgPontuacaoMinimaAtributo,
        rpg_exige_apto_sparring: rpgExigeAptoSparring
    };
}

// GET /api/modalidades - Listar modalidades e seus níveis de graduação
router.get('/', authenticateToken, async (req, res) => {
    try {
        const [modalidades] = await pool.query(`
            SELECT id, nome, descricao, sistema_graduacao, ativo 
            FROM modalidades 
            WHERE ativo = 1 
            ORDER BY nome ASC
        `);

        const [niveis] = await pool.query(`
            SELECT id, modalidade_id, nome, cor_hex_primaria, cor_hex_secundaria, graus, ordem_hierarquica, aulas_minimas_exigidas, tempo_minimo_meses, requisitos_lista_json, total_itens, porcentagem_minima, rpg_rank_minimo, rpg_pontuacao_minima_atributo, rpg_exige_apto_sparring, prajied_icone_url
            FROM graduacoes_niveis
            ORDER BY modalidade_id ASC, ordem_hierarquica ASC
        `);

        // Busca os golpes da Wiki associados a cada nível de graduação
        const [niveisGolpes] = await pool.query(`
            SELECT gng.graduacao_nivel_id, wg.id AS golpe_id, wg.nome AS golpe_nome, wg.categoria, wg.nivel_dificuldade, wg.imagem_capa
            FROM graduacao_nivel_golpes gng
            JOIN wiki_golpes wg ON wg.id = gng.golpe_id
            WHERE wg.ativo = 1
            ORDER BY wg.nome ASC
        `);

        // Agrupa níveis por modalidade e anexa os golpes vinculados a cada faixa
        const resultado = modalidades.map(m => ({
            ...m,
            niveis: niveis
                .filter(n => n.modalidade_id === m.id)
                .map(n => {
                    const golpesDoNivel = niveisGolpes.filter(g => g.graduacao_nivel_id === n.id);
                    return {
                        ...n,
                        golpes: golpesDoNivel,
                        golpes_ids: golpesDoNivel.map(g => g.golpe_id)
                    };
                })
        }));

        res.json({ success: true, data: resultado });
    } catch (err) {
        console.error('Erro ao listar modalidades:', err);
        res.status(500).json({ success: false, error: 'Erro ao listar modalidades.' });
    }
});

// GET /api/modalidades/:id/niveis - Obter níveis de uma modalidade
router.get('/:id/niveis', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const [niveis] = await pool.query(`
            SELECT * FROM graduacoes_niveis 
            WHERE modalidade_id = ? 
            ORDER BY ordem_hierarquica ASC
        `, [id]);
        res.json({ success: true, data: niveis });
    } catch (err) {
        console.error('Erro ao obter níveis:', err);
        res.status(500).json({ success: false, error: 'Erro ao listar níveis de graduação.' });
    }
});

// GET /api/modalidades/equipe/professores - Listar professores avaliadores (sem expor contatos pessoais)
router.get('/equipe/professores', authenticateToken, async (req, res) => {
    try {
        const [professores] = await pool.query(`
            SELECT id, nome, cargo 
            FROM usuarios_equipe 
            WHERE ativo = 1 
            ORDER BY nome ASC
        `);
        res.json({ success: true, data: professores });
    } catch (err) {
        console.error('Erro ao listar professores:', err);
        res.status(500).json({ success: false, error: 'Erro ao listar equipe.' });
    }
});

// ==========================================
// CRUD DE MODALIDADES (Admin e Professor)
// ==========================================

// POST /api/modalidades - Cadastrar nova modalidade
router.post('/', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const { nome, descricao, sistema_graduacao } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({ success: false, error: 'O nome da modalidade é obrigatório.' });
        }

        const [result] = await pool.query(`
            INSERT INTO modalidades (nome, descricao, sistema_graduacao, ativo)
            VALUES (?, ?, ?, 1)
        `, [
            nome.trim(),
            descricao ? descricao.trim() : null,
            sistema_graduacao ? sistema_graduacao.trim() : 'Faixas e Graus'
        ]);

        res.status(201).json({
            success: true,
            message: `Modalidade "${nome}" cadastrada com sucesso!`,
            id: result.insertId
        });
    } catch (err) {
        console.error('Erro ao criar modalidade:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao cadastrar modalidade.' });
    }
});

// PUT /api/modalidades/:id - Editar modalidade
router.put('/:id', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, descricao, sistema_graduacao, ativo = 1 } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({ success: false, error: 'O nome da modalidade é obrigatório.' });
        }

        const [result] = await pool.query(`
            UPDATE modalidades SET
                nome = ?,
                descricao = ?,
                sistema_graduacao = ?,
                ativo = ?
            WHERE id = ?
        `, [
            nome.trim(),
            descricao ? descricao.trim() : null,
            sistema_graduacao ? sistema_graduacao.trim() : null,
            ativo ? 1 : 0,
            id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Modalidade não encontrada.' });
        }

        res.json({ success: true, message: 'Modalidade atualizada com sucesso!' });
    } catch (err) {
        console.error('Erro ao editar modalidade:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao atualizar modalidade.' });
    }
});

// DELETE /api/modalidades/:id - Inativar ou excluir modalidade
router.delete('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const { id } = req.params;

        // Verifica se existem alunos com graduação nesta modalidade
        const [alunosGrad] = await pool.query('SELECT COUNT(*) AS total FROM aluno_graduacoes WHERE modalidade_id = ?', [id]);
        if (alunosGrad[0].total > 0) {
            // Inativação lógica para manter integridade histórica
            await pool.query('UPDATE modalidades SET ativo = 0 WHERE id = ?', [id]);
            return res.json({
                success: true,
                message: `A modalidade possui ${alunosGrad[0].total} registros de graduações de alunos e foi inativada para preservar o histórico.`
            });
        }

        // Se não houver vínculos, pode remover fisicamente
        await pool.query('DELETE FROM modalidades WHERE id = ?', [id]);
        res.json({ success: true, message: 'Modalidade removida com sucesso!' });
    } catch (err) {
        console.error('Erro ao excluir modalidade:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao excluir modalidade.' });
    }
});

// ==========================================
// CRUD DE GRADUAÇÕES / NÍVEIS DE FAIXA
// ==========================================

// POST /api/modalidades/:id/niveis - Cadastrar nível de graduação para uma modalidade
router.post('/:id/niveis', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const modalidade_id = req.params.id;
        const {
            nome,
            cor_hex_primaria = '#FFFFFF',
            cor_hex_secundaria = '#1E293B',
            graus = 0,
            ordem_hierarquica,
            aulas_minimas_exigidas,
            tempo_minimo_meses,
            requisitos_lista = [],
            porcentagem_minima = 70.00,
            prajied_icone_url = null,
            golpes_ids = []
        } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({ success: false, error: 'O nome da faixa/graduação é obrigatório.' });
        }

        // Processa lista de especificações / requisitos técnicos
        let reqList = [];
        if (Array.isArray(requisitos_lista)) {
            reqList = requisitos_lista;
        } else if (typeof requisitos_lista === 'string' && requisitos_lista.trim()) {
            try {
                const parsed = JSON.parse(requisitos_lista);
                if (Array.isArray(parsed)) reqList = parsed;
            } catch {
                reqList = requisitos_lista.split('\n');
            }
        }
        const cleanedReqs = reqList
            .map(r => String(r || '').trim())
            .filter(r => r.length > 0)
            .slice(0, 30); // Limite de 30 especificações por faixa

        const totalItens = cleanedReqs.length;
        const minPct = Math.min(Math.max(parseFloat(porcentagem_minima) || 70.00, 10.00), 100.00);
        const rpgReqs = parseRpgGraduationRequirements(req.body);
        if (rpgReqs.error) {
            return res.status(400).json({ success: false, error: rpgReqs.error });
        }

        // Calcula a ordem hierárquica automaticamente se não for passada
        let ordem = ordem_hierarquica;
        if (!ordem) {
            const [maxOrdem] = await pool.query(
                'SELECT COALESCE(MAX(ordem_hierarquica), 0) + 1 AS prox FROM graduacoes_niveis WHERE modalidade_id = ?',
                [modalidade_id]
            );
            ordem = maxOrdem[0].prox;
        }

        const [result] = await pool.query(`
            INSERT INTO graduacoes_niveis (
                modalidade_id, nome, cor_hex_primaria, cor_hex_secundaria, graus, 
                ordem_hierarquica, aulas_minimas_exigidas, tempo_minimo_meses,
                requisitos_lista_json, total_itens, porcentagem_minima,
                rpg_rank_minimo, rpg_pontuacao_minima_atributo, rpg_exige_apto_sparring,
                prajied_icone_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            modalidade_id,
            nome.trim(),
            cor_hex_primaria,
            cor_hex_secundaria || null,
            graus || 0,
            ordem,
            aulas_minimas_exigidas ? parseInt(aulas_minimas_exigidas, 10) : null,
            tempo_minimo_meses ? parseInt(tempo_minimo_meses, 10) : null,
            JSON.stringify(cleanedReqs),
            totalItens,
            minPct,
            rpgReqs.rpg_rank_minimo,
            rpgReqs.rpg_pontuacao_minima_atributo,
            rpgReqs.rpg_exige_apto_sparring,
            prajied_icone_url ? String(prajied_icone_url).trim() : null
        ]);

        const nivelId = result.insertId;

        // Associa os golpes técnicos da Wiki a esta faixa
        const idsArray = Array.isArray(golpes_ids) ? golpes_ids : [];
        for (const gId of idsArray) {
            const idVal = parseInt(gId, 10);
            if (!isNaN(idVal)) {
                await pool.query(
                    'INSERT IGNORE INTO graduacao_nivel_golpes (graduacao_nivel_id, golpe_id) VALUES (?, ?)',
                    [nivelId, idVal]
                );
            }
        }

        res.status(201).json({
            success: true,
            message: `Graduação "${nome}" cadastrada com sucesso!`,
            id: nivelId
        });
    } catch (err) {
        console.error('Erro ao cadastrar nível de graduação:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, error: 'Já existe uma faixa cadastrada com essa ordem hierárquica.' });
        }
        res.status(500).json({ success: false, error: 'Erro interno ao cadastrar nível de graduação.' });
    }
});

// PUT /api/modalidades/niveis/:nivelId - Editar nível de graduação
router.put('/niveis/:nivelId', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const { nivelId } = req.params;
        const {
            nome,
            cor_hex_primaria,
            cor_hex_secundaria,
            graus,
            ordem_hierarquica,
            aulas_minimas_exigidas,
            tempo_minimo_meses,
            requisitos_lista,
            porcentagem_minima,
            prajied_icone_url,
            golpes_ids
        } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({ success: false, error: 'O nome da faixa/graduação é obrigatório.' });
        }

        // Processa lista de especificações / requisitos técnicos se informada
        let reqList = [];
        if (Array.isArray(requisitos_lista)) {
            reqList = requisitos_lista;
        } else if (typeof requisitos_lista === 'string' && requisitos_lista.trim()) {
            try {
                const parsed = JSON.parse(requisitos_lista);
                if (Array.isArray(parsed)) reqList = parsed;
            } catch {
                reqList = requisitos_lista.split('\n');
            }
        }
        const cleanedReqs = reqList
            .map(r => String(r || '').trim())
            .filter(r => r.length > 0)
            .slice(0, 30);

        const totalItens = cleanedReqs.length;
        const minPct = Math.min(Math.max(parseFloat(porcentagem_minima) || 70.00, 10.00), 100.00);
        const rpgReqs = parseRpgGraduationRequirements(req.body);
        if (rpgReqs.error) {
            return res.status(400).json({ success: false, error: rpgReqs.error });
        }

        const [result] = await pool.query(`
            UPDATE graduacoes_niveis SET
                nome = ?,
                cor_hex_primaria = ?,
                cor_hex_secundaria = ?,
                graus = ?,
                ordem_hierarquica = ?,
                aulas_minimas_exigidas = ?,
                tempo_minimo_meses = ?,
                requisitos_lista_json = ?,
                total_itens = ?,
                porcentagem_minima = ?,
                rpg_rank_minimo = ?,
                rpg_pontuacao_minima_atributo = ?,
                rpg_exige_apto_sparring = ?,
                prajied_icone_url = ?
            WHERE id = ?
        `, [
            nome.trim(),
            cor_hex_primaria,
            cor_hex_secundaria || null,
            graus || 0,
            ordem_hierarquica || 1,
            aulas_minimas_exigidas ? parseInt(aulas_minimas_exigidas, 10) : null,
            tempo_minimo_meses ? parseInt(tempo_minimo_meses, 10) : null,
            JSON.stringify(cleanedReqs),
            totalItens,
            minPct,
            rpgReqs.rpg_rank_minimo,
            rpgReqs.rpg_pontuacao_minima_atributo,
            rpgReqs.rpg_exige_apto_sparring,
            prajied_icone_url ? String(prajied_icone_url).trim() : null,
            nivelId
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Nível de graduação não encontrado.' });
        }

        // Se informada lista de golpes_ids, sincroniza com graduacao_nivel_golpes
        if (golpes_ids !== undefined) {
            await pool.query('DELETE FROM graduacao_nivel_golpes WHERE graduacao_nivel_id = ?', [nivelId]);
            const idsArray = Array.isArray(golpes_ids) ? golpes_ids : [];
            for (const gId of idsArray) {
                const idVal = parseInt(gId, 10);
                if (!isNaN(idVal)) {
                    await pool.query(
                        'INSERT IGNORE INTO graduacao_nivel_golpes (graduacao_nivel_id, golpe_id) VALUES (?, ?)',
                        [nivelId, idVal]
                    );
                }
            }
        }

        res.json({ success: true, message: 'Nível de graduação atualizado com sucesso!' });
    } catch (err) {
        console.error('Erro ao atualizar nível de graduação:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, error: 'Ordem hierárquica já utilizada por outra faixa nesta modalidade.' });
        }
        res.status(500).json({ success: false, error: 'Erro interno ao atualizar nível de graduação.' });
    }
});

// DELETE /api/modalidades/niveis/:nivelId - Excluir nível de graduação
router.delete('/niveis/:nivelId', authenticateToken, authorizeRoles('admin', 'professor'), async (req, res) => {
    try {
        const { nivelId } = req.params;

        // Verifica se há alunos com esse nível
        const [vinculos] = await pool.query('SELECT COUNT(*) AS total FROM aluno_graduacoes WHERE graduacao_nivel_id = ?', [nivelId]);
        if (vinculos[0].total > 0) {
            return res.status(409).json({
                success: false,
                error: `Não é possível excluir esta faixa pois existem ${vinculos[0].total} registros de alunos graduados nela.`
            });
        }

        const [result] = await pool.query('DELETE FROM graduacoes_niveis WHERE id = ?', [nivelId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Nível de graduação não encontrado.' });
        }

        res.json({ success: true, message: 'Nível de graduação excluído com sucesso!' });
    } catch (err) {
        console.error('Erro ao excluir nível de graduação:', err);
        res.status(500).json({ success: false, error: 'Erro interno ao excluir nível de graduação.' });
    }
});

module.exports = router;
