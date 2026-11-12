const { classifyPlanTransition, computeNextDueDate } = require('./domainRules');

/**
 * Serviço de Domínio para Gestão de Matrículas (Contratos) e Geração de Faturas Vinculadas.
 * Centraliza a lógica transacional que antes estava duplicada entre alunos.js e planos.js.
 */
const MatriculaService = {
    /**
     * Garante a existência de uma fatura para a competência atual (evitando duplicidade)
     */
    async ensureCurrentMonthInvoice(conn, { matriculaId, alunoId, valor, diaVencimento = 10, dueDateMode = 'keep_current_month' }) {
        const { competencia, dataVencimento } = computeNextDueDate(diaVencimento, new Date(), dueDateMode);

        const [fatExist] = await conn.query(
            'SELECT id FROM faturas WHERE aluno_id = ? AND competencia = ?',
            [alunoId, competencia]
        );

        if (fatExist.length === 0) {
            await conn.query(`
                INSERT INTO faturas (matricula_id, aluno_id, competencia, valor_original, data_vencimento, status)
                VALUES (?, ?, ?, ?, ?, 'pendente')
            `, [matriculaId, alunoId, competencia, valor, dataVencimento]);
            return true;
        }
        return false;
    },

    /**
     * Cria uma nova matrícula ativa para o aluno (encerrando eventual matrícula ativa anterior)
     * e gera a fatura inicial da competência vigente.
     */
    async createEnrollmentWithInvoice(conn, options) {
        const {
            alunoId,
            planoId,
            diaVencimento = 10,
            valorAcordado,
            descontoMotivo,
            dueDateMode = 'keep_current_month'
        } = options;

        // Se já tiver matrícula ativa, encerra a anterior para manter unicidade de contrato ativo
        await conn.query(
            `UPDATE matriculas SET status = 'cancelada' WHERE aluno_id = ? AND status = 'ativa'`,
            [alunoId]
        );

        let valorFinal = valorAcordado !== null && valorAcordado !== undefined && Number(valorAcordado) > 0
            ? Number(valorAcordado)
            : null;

        if (valorFinal === null) {
            const [planos] = await conn.query('SELECT valor_mensal FROM planos WHERE id = ?', [planoId]);
            valorFinal = planos.length > 0 ? Number(planos[0].valor_mensal) : 0;
        }

        const diaVenc = parseInt(String(diaVencimento), 10) || 10;

        const [matResult] = await conn.query(`
            INSERT INTO matriculas (aluno_id, plano_id, data_inicio, dia_vencimento, valor_acordado, desconto_motivo, status)
            VALUES (?, ?, CURDATE(), ?, ?, ?, 'ativa')
        `, [alunoId, planoId, diaVenc, valorFinal, descontoMotivo || null]);

        const matriculaId = matResult.insertId;

        await this.ensureCurrentMonthInvoice(conn, {
            matriculaId,
            alunoId,
            valor: valorFinal,
            diaVencimento: diaVenc,
            dueDateMode
        });

        // Inicializa automaticamente a primeira faixa/graduação e lista de requisitos nas modalidades do plano
        await this.ensureStudentModalityGraduations(conn, alunoId, planoId);

        return { matriculaId, valorFinal };
    },

    /**
     * Identifica as modalidades do plano matriculado, verifica se possuem graduações cadastradas
     * e insere automaticamente o aluno na primeira faixa com sua lista de especificações técnicas inicializada.
     */
    async ensureStudentModalityGraduations(conn, alunoId, planoId) {
        if (!alunoId || !planoId) return [];

        // 1. Busca todas as modalidades vinculadas ao plano
        const [modRows] = await conn.query(
            'SELECT modalidade_id FROM planos_modalidades WHERE plano_id = ?',
            [planoId]
        );

        const graduacoesInseridas = [];

        for (const { modalidade_id } of modRows) {
            // 2. Verifica se o aluno já possui graduação registrada nesta modalidade
            const [gradExist] = await conn.query(
                'SELECT id FROM aluno_graduacoes WHERE aluno_id = ? AND modalidade_id = ?',
                [alunoId, modalidade_id]
            );

            if (gradExist.length === 0) {
                // 3. Busca a primeira graduação / nível da modalidade (menor ordem hierárquica)
                const [primeiraFaixaRows] = await conn.query(`
                    SELECT id, nome, ordem_hierarquica, requisitos_lista_json, total_itens, porcentagem_minima
                    FROM graduacoes_niveis
                    WHERE modalidade_id = ?
                    ORDER BY ordem_hierarquica ASC
                    LIMIT 1
                `, [modalidade_id]);

                if (primeiraFaixaRows.length > 0) {
                    const primeiraFaixa = primeiraFaixaRows[0];
                    
                    // Insere o aluno na primeira faixa como atual
                    await conn.query(`
                        INSERT INTO aluno_graduacoes (aluno_id, modalidade_id, graduacao_nivel_id, data_graduacao, atual)
                        VALUES (?, ?, ?, CURDATE(), 1)
                    `, [alunoId, modalidade_id, primeiraFaixa.id]);

                    // Inicializa a avaliação da primeira graduação com os tópicos/especificações
                    let reqList = [];
                    try {
                        if (primeiraFaixa.requisitos_lista_json) {
                            reqList = typeof primeiraFaixa.requisitos_lista_json === 'string'
                                ? JSON.parse(primeiraFaixa.requisitos_lista_json)
                                : primeiraFaixa.requisitos_lista_json;
                        }
                    } catch {}
                    if (!Array.isArray(reqList) || reqList.length === 0) {
                        reqList = ['Base e postura', 'Fundamentos técnicos', 'Aplicação prática', 'Defesa e bloqueio', 'Conduta marcial'];
                    }
                    const itensAvaliacao = reqList.map(item => ({ item: String(item).trim(), nota: 0 }));
                    const totalPossivel = itensAvaliacao.length * 5;

                    await conn.query(`
                        INSERT INTO aluno_avaliacoes_graduacao (
                            aluno_id, modalidade_id, graduacao_nivel_id, itens_avaliados_json, total_pontos_obtidos, total_pontos_possiveis, percentual_obtido, apto
                        ) VALUES (?, ?, ?, ?, 0, ?, 0.00, 0)
                        ON DUPLICATE KEY UPDATE graduacao_nivel_id = VALUES(graduacao_nivel_id)
                    `, [alunoId, modalidade_id, primeiraFaixa.id, JSON.stringify(itensAvaliacao), totalPossivel]);

                    graduacoesInseridas.push({
                        modalidadeId: modalidade_id,
                        graduacaoNivelId: primeiraFaixa.id,
                        graduacaoNome: primeiraFaixa.nome
                    });
                }
            }
        }

        return graduacoesInseridas;
    },

    /**
     * Tranca temporariamente uma matrícula ativa e suspende o acesso do aluno
     */
    async lockEnrollment(conn, options) {
        const {
            matriculaId,
            motivo,
            dataRetornoPrevista,
            cancelarFaturasAbertas = true
        } = options;

        const [mats] = await conn.query('SELECT id, aluno_id, status FROM matriculas WHERE id = ?', [matriculaId]);
        if (mats.length === 0) {
            return { error: 'Matrícula não encontrada.', statusCode: 404 };
        }

        const mat = mats[0];
        if (mat.status === 'trancada') {
            return { error: 'Esta matrícula já se encontra trancada.', statusCode: 400 };
        }

        await conn.query(`
            UPDATE matriculas SET
                status = 'trancada',
                data_fim = CURDATE(),
                motivo_cancelamento_trancamento = ?,
                data_retorno_prevista = ?
            WHERE id = ?
        `, [String(motivo).trim(), dataRetornoPrevista || null, matriculaId]);

        await conn.query(`UPDATE alunos SET status = 'trancado' WHERE id = ?`, [mat.aluno_id]);

        if (cancelarFaturasAbertas) {
            await conn.query(`
                UPDATE faturas SET
                    status = 'cancelado',
                    observacoes = CONCAT(COALESCE(observacoes, ''), ' [Cancelada por trancamento de matrícula em ', DATE_FORMAT(NOW(), '%d/%m/%Y'), ']')
                WHERE matricula_id = ? AND status = 'pendente' AND data_vencimento >= CURDATE()
            `, [matriculaId]);
        }

        return { statusCode: 200 };
    },

    /**
     * Destranca / reativa uma matrícula trancada e garante fatura do mês corrente
     */
    async unlockEnrollment(conn, { matriculaId }) {
        const [mats] = await conn.query(
            'SELECT id, aluno_id, plano_id, dia_vencimento, valor_acordado, status FROM matriculas WHERE id = ?',
            [matriculaId]
        );
        if (mats.length === 0) {
            return { error: 'Matrícula não encontrada.', statusCode: 404 };
        }

        const mat = mats[0];
        if (mat.status !== 'trancada') {
            return { error: 'Apenas matrículas trancadas podem ser destrancadas.', statusCode: 400 };
        }

        await conn.query(`
            UPDATE matriculas SET
                status = 'ativa',
                data_fim = NULL,
                data_retorno_prevista = NULL,
                motivo_cancelamento_trancamento = NULL
            WHERE id = ?
        `, [matriculaId]);

        await conn.query(`UPDATE alunos SET status = 'ativo' WHERE id = ?`, [mat.aluno_id]);

        await this.ensureCurrentMonthInvoice(conn, {
            matriculaId,
            alunoId: mat.aluno_id,
            valor: mat.valor_acordado,
            diaVencimento: mat.dia_vencimento,
            dueDateMode: 'plus_5_days_if_past'
        });

        return { statusCode: 200 };
    },

    /**
     * Cancela definitivamente uma matrícula e inativa o aluno
     */
    async cancelEnrollment(conn, { matriculaId, motivo, cancelarFaturasAbertas = true }) {
        const [mats] = await conn.query('SELECT id, aluno_id, status FROM matriculas WHERE id = ?', [matriculaId]);
        if (mats.length === 0) {
            return { error: 'Matrícula não encontrada.', statusCode: 404 };
        }

        const mat = mats[0];
        if (mat.status === 'cancelada') {
            return { error: 'Esta matrícula já se encontra cancelada.', statusCode: 400 };
        }

        await conn.query(`
            UPDATE matriculas SET
                status = 'cancelada',
                data_fim = CURDATE(),
                motivo_cancelamento_trancamento = ?
            WHERE id = ?
        `, [motivo.trim(), matriculaId]);

        await conn.query(`UPDATE alunos SET status = 'inativo' WHERE id = ?`, [mat.aluno_id]);

        if (cancelarFaturasAbertas) {
            await conn.query(`
                UPDATE faturas SET
                    status = 'cancelado',
                    observacoes = CONCAT(COALESCE(observacoes, ''), ' [Cancelada por rescisão contratual em ', DATE_FORMAT(NOW(), '%d/%m/%Y'), ']')
                WHERE matricula_id = ? AND status = 'pendente'
            `, [matriculaId]);
        }

        return { statusCode: 200 };
    },

    /**
     * Realiza Upgrade ou Downgrade de plano mantendo rastreabilidade histórica
     */
    async switchEnrollmentPlan(conn, { matriculaId, novoPlanoId, novoValorAcordado, novoDiaVencimento, motivo }) {
        const [mats] = await conn.query(`
            SELECT m.*, p.nome AS plano_atual_nome, p.valor_mensal AS plano_atual_valor
            FROM matriculas m
            JOIN planos p ON p.id = m.plano_id
            WHERE m.id = ?
        `, [matriculaId]);

        if (mats.length === 0) {
            return { error: 'Matrícula atual não encontrada.', statusCode: 404 };
        }

        const matAtual = mats[0];

        const [novosPlanos] = await conn.query(
            'SELECT id, nome, valor_mensal FROM planos WHERE id = ? AND ativo = 1',
            [novoPlanoId]
        );
        if (novosPlanos.length === 0) {
            return { error: 'Novo plano selecionado não encontrado ou inativo.', statusCode: 404 };
        }

        const novoPlano = novosPlanos[0];

        if (matAtual.plano_id === novoPlano.id) {
            return { error: 'O novo plano selecionado é idêntico ao plano atual.', statusCode: 400 };
        }

        const { isUpgrade, tipoTransicao, valorFinal } = classifyPlanTransition(
            matAtual.plano_atual_valor,
            novoPlano.valor_mensal,
            novoValorAcordado
        );

        const diaVenc = novoDiaVencimento ? parseInt(novoDiaVencimento, 10) : matAtual.dia_vencimento;

        const motivoTransicao = `Migração para plano ${novoPlano.nome} (${tipoTransicao.toUpperCase()})${motivo ? ' - ' + motivo.trim() : ''}`;
        await conn.query(`
            UPDATE matriculas SET
                status = 'cancelada',
                data_fim = CURDATE(),
                motivo_cancelamento_trancamento = ?
            WHERE id = ?
        `, [motivoTransicao, matriculaId]);

        const [resNovaMat] = await conn.query(`
            INSERT INTO matriculas (aluno_id, plano_id, data_inicio, dia_vencimento, valor_acordado, desconto_motivo, status)
            VALUES (?, ?, CURDATE(), ?, ?, ?, 'ativa')
        `, [matAtual.aluno_id, novoPlano.id, diaVenc, valorFinal, motivo ? `Migração: ${motivo}` : null]);

        const novaMatriculaId = resNovaMat.insertId;

        await conn.query(`UPDATE alunos SET status = 'ativo' WHERE id = ?`, [matAtual.aluno_id]);

        const anoMes = new Date().toISOString().slice(0, 7);
        const [fatPendente] = await conn.query(`
            SELECT id
            FROM faturas 
            WHERE aluno_id = ? AND competencia = ? AND status = 'pendente'
            ORDER BY id DESC LIMIT 1
        `, [matAtual.aluno_id, anoMes]);

        if (fatPendente.length > 0) {
            const obsTag = ` [Valor ajustado por ${tipoTransicao}]`;
            await conn.query(`
                UPDATE faturas SET
                    matricula_id = ?,
                    valor_original = ?,
                    observacoes = CONCAT(COALESCE(observacoes, ''), ?)
                WHERE id = ?
            `, [novaMatriculaId, valorFinal, obsTag, fatPendente[0].id]);
        }

        return {
            statusCode: 200,
            data: {
                success: true,
                tipo: tipoTransicao,
                plano_anterior: matAtual.plano_atual_nome,
                novo_plano: novoPlano.nome,
                valor_novo: valorFinal,
                message: `Plano alterado com sucesso! (${isUpgrade ? 'Upgrade' : 'Downgrade'}) de "${matAtual.plano_atual_nome}" para "${novoPlano.nome}".`
            }
        };
    }
};

module.exports = MatriculaService;

