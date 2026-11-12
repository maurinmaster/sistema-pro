const pool = require('./connection');
const bcrypt = require('bcryptjs');

async function seed() {
    console.log('🧹 Limpando banco de dados sistema_pro e iniciando novo seed...');

    try {
        const defaultHash = await bcrypt.hash('123456', 10);

        // Desativa checagem de chaves estrangeiras para limpeza completa
        await pool.query('SET FOREIGN_KEY_CHECKS = 0');
        await pool.query('TRUNCATE TABLE sessoes_usuarios');
        await pool.query('TRUNCATE TABLE redefinicoes_senha');
        await pool.query('TRUNCATE TABLE verificacoes_email');
        await pool.query('TRUNCATE TABLE tentativas_login');
        await pool.query('TRUNCATE TABLE usuarios_alunos');
        await pool.query('TRUNCATE TABLE aluno_avaliacoes_graduacao');
        await pool.query('TRUNCATE TABLE aluno_graduacoes');
        await pool.query('TRUNCATE TABLE checkins');
        await pool.query('TRUNCATE TABLE faturas');
        await pool.query('TRUNCATE TABLE matriculas');
        await pool.query('TRUNCATE TABLE planos_modalidades');
        await pool.query('TRUNCATE TABLE turmas');
        await pool.query('TRUNCATE TABLE planos');
        await pool.query('TRUNCATE TABLE graduacoes_niveis');
        await pool.query('TRUNCATE TABLE alunos');
        await pool.query('TRUNCATE TABLE modalidades');
        await pool.query('TRUNCATE TABLE usuarios_equipe');
        await pool.query('SET FOREIGN_KEY_CHECKS = 1');

        console.log('✓ Tabelas truncadas e limpas.');

        // 1. Usuários da Equipe (Admin, Professores de Muay Thai e Recepção)
        await pool.query(`
            INSERT INTO usuarios_equipe (id, nome, email, senha_hash, cargo, telefone, ativo) VALUES
            (1, 'Mestre Carlos Silva', 'carlos.mestre@ctpro.com.br', ?, 'admin', '(11) 98111-2233', 1),
            (2, 'Profª. Camila Nakata (Kru)', 'camila.muay@ctpro.com.br', ?, 'professor', '(11) 98222-3344', 1),
            (3, 'Prof. Marcos "Demolidor" Santos', 'marcos.muay@ctpro.com.br', ?, 'professor', '(11) 98333-4455', 1),
            (4, 'Juliana Mendes', 'atendimento@ctpro.com.br', ?, 'recepcao', '(11) 98444-5566', 1);
        `, [defaultHash, defaultHash, defaultHash, defaultHash]);

        // 2. Modalidade Única Cadastrada: Muay Thai
        await pool.query(`
            INSERT INTO modalidades (id, nome, descricao, sistema_graduacao, ativo) VALUES
            (1, 'Muay Thai', 'A arte das oito armas: socos, cotoveladas, joelhadas e chutes potentes com clinch tailandês.', 'Prajied / Kruang', 1);
        `);

        // 3. Graduações Níveis (Muay Thai Tradicional) com Requisitos e Porcentagem Mínima
        await pool.query(`
            INSERT INTO graduacoes_niveis (id, modalidade_id, nome, cor_hex_primaria, cor_hex_secundaria, graus, ordem_hierarquica, aulas_minimas_exigidas, tempo_minimo_meses, requisitos_lista_json, total_itens, porcentagem_minima) VALUES
            (1, 1, 'Prajied Branco (Iniciante)', '#F8FAFC', '#94A3B8', 0, 1, 30, 3,
             '["Base e postura tradicional (Guarda e Teep)", "Jab e Direto com rotação do quadril", "Chute circular na coxa (Low Kick / Tei Kha)", "Defesa de bloqueio com a canela (Check)", "Clinch básico e joelhada frontal (Khao Tron)"]',
             5, 70.00),

            (2, 1, 'Prajied Amarelo', '#EAB308', '#CA8A04', 0, 2, 50, 4,
             '["Combinações soco-chute fluidas", "Cotovelada frontal e diagonal (Sok Tad / Sok Ti)", "Saída de clinch e desequilíbrio lateral", "Chute circular nas costelas (Middle Kick / Tei Lam Tua)", "Sparring técnico controlado de 3 rounds"]',
             5, 75.00),

            (3, 1, 'Prajied Amarelo e Branco', '#EAB308', '#FFFFFF', 0, 3, 60, 4,
             '["Contragolpe em cruzado e pêndulo", "Joelhada curvada (Khao Khong)", "Controle de nuca e giro no clinch", "Esquiva de chute e rasteira de apoio", "Resistência aeróbica em pao e saco pesado"]',
             5, 75.00),

            (4, 1, 'Prajied Laranja', '#F97316', '#EA580C', 0, 4, 80, 6,
             '["Execução do Wai Kru Ram Muay", "Combinações de 4 golpes com cotovelada", "Defesa de clinch com contra-ataque de joelho", "Sparring com intensidade moderada a forte", "Condicionamento físico marcial (100 chutes contínuos)"]',
             5, 80.00),

            (5, 1, 'Prajied Verde', '#22C55E', '#16A34A', 0, 5, 100, 6,
             '["Domínio completo das 8 armas em combate", "Clinch de competição com projeção e joelhadas", "Variações avançadas de cotovelo giratório (Sok Klab)", "Sparring avançado de 5 rounds", "Postura, respeito e liderança no dojo"]',
             5, 85.00);
        `);

        // 4. Planos
        await pool.query(`
            INSERT INTO planos (id, nome, descricao, valor_mensal, periodicidade_meses, limite_checkins_semana, tolerancia_inadimplencia_dias, ativo) VALUES
            (1, 'Muay Thai Fitness & Fundamentos (2x/sem)', 'Ideal para condicionamento físico, queima calórica e defesa pessoal.', 159.90, 1, 2, 5, 1),
            (2, 'Muay Thai Total Kombat (Livre)', 'Acesso ilimitado às aulas técnicas, sparring monitorado e clinch.', 199.90, 1, NULL, 5, 1),
            (3, 'Muay Thai Black Belt Fighter (Anual)', 'Plano avançado anual com foco em graduação marcial contínua.', 139.90, 12, NULL, 5, 1);
        `);

        await pool.query(`
            INSERT INTO planos_modalidades (plano_id, modalidade_id) VALUES
            (1, 1),
            (2, 1),
            (3, 1);
        `);

        // 5. Turmas
        await pool.query(`
            INSERT INTO turmas (id, modalidade_id, professor_id, nome, dias_semana, horario_inicio, horario_fim, capacidade_maxima, ativo) VALUES
            (1, 1, 2, 'Muay Thai Matinal (Fundamentos)', 'SEG,QUA,SEX', '07:00:00', '08:15:00', 25, 1),
            (2, 1, 3, 'Muay Thai Almoço Express', 'TER,QUI', '12:00:00', '13:15:00', 20, 1),
            (3, 1, 2, 'Muay Thai Noturno Geral', 'SEG,TER,QUA,QUI', '19:00:00', '20:15:00', 30, 1),
            (4, 1, 3, 'Muay Thai Sparring & Clinch Avançado', 'SEX', '19:30:00', '21:00:00', 20, 1);
        `);

        // 6. 8 Alunos Cadastrados (4 Mulheres e 4 Homens)
        await pool.query(`
            INSERT INTO alunos 
            (id, nome_completo, cpf, data_nascimento, genero, email, telefone_whatsapp, responsavel_nome, responsavel_cpf, responsavel_telefone, contato_emergencia_nome, contato_emergencia_fone, tipo_sanguineo, observacoes_medicas, foto_perfil_url, senha_app_hash, status)
            VALUES
            (1, 'Beatriz Alcantara Rocha', '412.593.109-88', '1998-09-23', 'F', 'beatriz.rocha@email.com', '(11) 97655-2211', NULL, NULL, NULL, 'Roberto Rocha (Pai)', '(11) 97655-2200', 'A+', 'Atestado médico de aptidão física regularizado.', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80', ?, 'ativo'),
            (2, 'Lucas Vinicius Silveira', '284.912.840-19', '1995-04-12', 'M', 'lucas.silveira@email.com', '(11) 98711-4433', NULL, NULL, NULL, 'Mariana Silveira (Esposa)', '(11) 98711-4434', 'O+', 'Condromalácia patelar leve no joelho esquerdo compensada.', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80', ?, 'ativo'),
            (3, 'Mariana Souza Freitas', '391.029.485-62', '1993-11-05', 'F', 'mariana.freitas@email.com', '(11) 96544-7788', NULL, NULL, NULL, 'Julio Freitas (Irmão)', '(11) 96544-7799', 'AB+', 'Sem restrições cardiovasculares.', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&q=80', ?, 'ativo'),
            (4, 'Gabriel Henrique de Oliveira', '521.849.201-44', '2000-02-17', 'M', 'gabriel.henrique@email.com', '(11) 99123-8877', NULL, NULL, NULL, 'Fernanda Oliveira (Mãe)', '(11) 99123-8800', 'B+', 'Cirurgia no ombro direito totalmente reabilitada.', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80', ?, 'ativo'),
            (5, 'Larissa Vasconcelos Prado', '619.283.475-92', '2001-01-19', 'F', 'larissa.v@email.com', '(11) 98399-4411', NULL, NULL, NULL, 'Carla Vasconcelos (Mãe)', '(11) 98399-4400', 'A-', 'Alergia a anti-inflamatórios.', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80', ?, 'ativo'),
            (6, 'Thiago Barreto Neves', '182.938.475-01', '1989-08-30', 'M', 'thiago.barreto@email.com', '(11) 97188-2938', NULL, NULL, NULL, 'Patricia Neves (Irmã)', '(11) 97188-2900', 'O+', 'Fortalecimento lombar sob controle.', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80', ?, 'ativo'),
            (7, 'Camila Eduarda Ribeiro', '789.234.561-00', '1996-07-14', 'F', 'camila.ribeiro@email.com', '(11) 97112-9900', NULL, NULL, NULL, 'Marcos Ribeiro (Pai)', '(11) 97112-9911', 'O+', 'Atleta competitiva sem comorbidades.', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80', ?, 'ativo'),
            (8, 'Rodrigo Lima Falcão', '732.190.485-11', '1991-05-14', 'M', 'rodrigo.falcao@email.com', '(11) 99344-5522', NULL, NULL, NULL, 'Silvia Falcão (Esposa)', '(11) 99344-5500', 'O+', 'Sem restrições médicas.', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=300&q=80', ?, 'ativo');
        `, [
            defaultHash, defaultHash, defaultHash, defaultHash,
            defaultHash, defaultHash, defaultHash, defaultHash
        ]);

        // 6.1. Contas de Autenticação Relacionais (usuarios_alunos)
        await pool.query(`
            INSERT INTO usuarios_alunos (aluno_id, email, senha_hash, status, email_verificado) VALUES
            (1, 'beatriz.rocha@email.com', ?, 'ativo', 1),
            (2, 'lucas.silveira@email.com', ?, 'ativo', 1),
            (3, 'mariana.freitas@email.com', ?, 'ativo', 1),
            (4, 'gabriel.henrique@email.com', ?, 'ativo', 1),
            (5, 'larissa.v@email.com', ?, 'ativo', 1),
            (6, 'thiago.barreto@email.com', ?, 'ativo', 1),
            (7, 'camila.ribeiro@email.com', ?, 'ativo', 1),
            (8, 'rodrigo.falcao@email.com', ?, 'ativo', 1);
        `, [
            defaultHash, defaultHash, defaultHash, defaultHash,
            defaultHash, defaultHash, defaultHash, defaultHash
        ]);

        // 7. Matrículas Ativas para Todos os 8 Alunos
        await pool.query(`
            INSERT INTO matriculas (id, aluno_id, plano_id, data_inicio, data_fim, dia_vencimento, valor_acordado, status) VALUES
            (1, 1, 2, '2025-06-01', NULL, 10, 199.90, 'ativa'),
            (2, 2, 1, '2025-04-10', NULL, 5, 159.90, 'ativa'),
            (3, 3, 1, '2025-08-01', NULL, 10, 159.90, 'ativa'),
            (4, 4, 2, '2025-05-15', NULL, 15, 199.90, 'ativa'),
            (5, 5, 3, '2026-02-01', NULL, 10, 139.90, 'ativa'),
            (6, 6, 1, '2025-09-01', NULL, 5, 159.90, 'ativa'),
            (7, 7, 2, '2025-01-10', NULL, 10, 199.90, 'ativa'),
            (8, 8, 1, '2026-01-15', NULL, 15, 159.90, 'ativa');
        `);

        // 8. Faturas Recentes
        await pool.query(`
            INSERT INTO faturas (id, matricula_id, aluno_id, competencia, valor_original, valor_pago, data_vencimento, data_pagamento, metodo_pagamento, status) VALUES
            (1, 1, 1, '2026-10', 199.90, 199.90, '2026-10-10', '2026-10-08 14:20:00', 'pix', 'pago'),
            (2, 2, 2, '2026-10', 159.90, 159.90, '2026-10-05', '2026-10-04 10:15:00', 'cartao_credito', 'pago'),
            (3, 3, 3, '2026-10', 159.90, 159.90, '2026-10-10', '2026-10-09 18:30:00', 'pix', 'pago'),
            (4, 4, 4, '2026-10', 199.90, 199.90, '2026-10-15', '2026-10-15 08:45:00', 'pix', 'pago'),
            (5, 5, 5, '2026-10', 139.90, 139.90, '2026-10-10', '2026-10-10 11:20:00', 'boleto', 'pago'),
            (6, 6, 6, '2026-10', 159.90, 159.90, '2026-10-05', '2026-10-05 16:10:00', 'pix', 'pago'),
            (7, 7, 7, '2026-10', 199.90, 199.90, '2026-10-10', '2026-10-07 19:00:00', 'cartao_credito', 'pago'),
            (8, 8, 8, '2026-10', 159.90, 159.90, '2026-10-15', '2026-10-14 12:40:00', 'pix', 'pago'),
            (9, 1, 1, '2026-11', 199.90, NULL, '2026-11-10', NULL, NULL, 'pendente'),
            (10, 3, 3, '2026-11', 159.90, NULL, '2026-11-10', NULL, NULL, 'pendente');
        `);

        // 9. Histórico de Graduações de Muay Thai
        await pool.query(`
            INSERT INTO aluno_graduacoes (id, aluno_id, modalidade_id, graduacao_nivel_id, data_graduacao, professor_avaliador_id, observacoes, atual) VALUES
            -- Beatriz (F): Prajied Amarelo (Level 2)
            (1, 1, 1, 1, '2025-06-01', 2, 'Iniciada no Prajied Branco.', 0),
            (2, 1, 1, 2, '2025-11-20', 2, 'Excelente aproveitamento técnico nas cotoveladas e chutes.', 1),

            -- Lucas (M): Prajied Laranja (Level 4)
            (3, 2, 1, 1, '2025-04-10', 3, 'Iniciado no Prajied Branco.', 0),
            (4, 2, 1, 2, '2025-08-15', 3, 'Promovido com louvor ao Prajied Amarelo.', 0),
            (5, 2, 1, 3, '2025-12-10', 2, 'Promovido ao Prajied Amarelo e Branco.', 0),
            (6, 2, 1, 4, '2026-04-18', 3, 'Excelente Wai Kru e consistência no clinch.', 1),

            -- Mariana (F): Prajied Branco (Level 1)
            (7, 3, 1, 1, '2025-08-01', 2, 'Excelente dedicação e postura marcial nos treinos.', 1),

            -- Gabriel (M): Prajied Amarelo e Branco (Level 3)
            (8, 4, 1, 1, '2025-05-15', 3, 'Iniciado no Prajied Branco.', 0),
            (9, 4, 1, 2, '2025-10-05', 3, 'Promovido ao Prajied Amarelo.', 0),
            (10, 4, 1, 3, '2026-03-12', 2, 'Excelente potência e controle de distância.', 1),

            -- Larissa (F): Prajied Branco (Level 1)
            (11, 5, 1, 1, '2026-02-01', 2, 'Iniciada no Prajied Branco com ótima frequência.', 1),

            -- Thiago (M): Prajied Amarelo (Level 2)
            (12, 6, 1, 1, '2025-09-01', 3, 'Iniciado no Prajied Branco.', 0),
            (13, 6, 1, 2, '2026-02-15', 3, 'Promovido com ótimo bloqueio e contra-ataques.', 1),

            -- Camila (F): Prajied Verde (Level 5)
            (14, 7, 1, 1, '2024-06-01', 2, 'Iniciada no Prajied Branco.', 0),
            (15, 7, 1, 2, '2024-10-10', 2, 'Promovida ao Prajied Amarelo.', 0),
            (16, 7, 1, 3, '2025-02-14', 3, 'Promovida ao Prajied Amarelo e Branco.', 0),
            (17, 7, 1, 4, '2025-07-20', 2, 'Promovida ao Prajied Laranja.', 0),
            (18, 7, 1, 5, '2026-02-28', 2, 'Atleta destacada. Domínio de ringue exemplar.', 1),

            -- Rodrigo (M): Prajied Branco (Level 1)
            (19, 8, 1, 1, '2026-01-15', 3, 'Iniciado no Prajied Branco.', 1);
        `);

        // 10. Avaliações de Graduação (Itens de 5 Notas e Aptidão)
        await pool.query(`
            INSERT INTO aluno_avaliacoes_graduacao 
            (aluno_id, modalidade_id, graduacao_nivel_id, professor_id, itens_avaliados_json, total_pontos_obtidos, total_pontos_possiveis, percentual_obtido, apto, observacoes_professor)
            VALUES
            -- Mariana (F): Avaliada no Prajied Branco -> 23/25 = 92% (Min: 70%) -> APTO = 1
            (3, 1, 1, 2, 
             '[{"item":"Base e postura tradicional (Guarda e Teep)","nota":5},{"item":"Jab e Direto com rotação do quadril","nota":5},{"item":"Chute circular na coxa (Low Kick / Tei Kha)","nota":4},{"item":"Defesa de bloqueio com a canela (Check)","nota":4},{"item":"Clinch básico e joelhada frontal (Khao Tron)","nota":5}]',
             23, 25, 92.00, 1, 'Mariana demonstrou evolução impecável! Guarda firme, chutes fortes e ótimo clinch. Apta para a próxima fase!'),

            -- Beatriz (F): Avaliada no Prajied Amarelo -> 20/25 = 80% (Min: 75%) -> APTO = 1
            (1, 1, 2, 2,
             '[{"item":"Combinações soco-chute fluidas","nota":4},{"item":"Cotovelada frontal e diagonal (Sok Tad / Sok Ti)","nota":4},{"item":"Saída de clinch e desequilíbrio lateral","nota":4},{"item":"Chute circular nas costelas (Middle Kick / Tei Lam Tua)","nota":4},{"item":"Sparring técnico controlado de 3 rounds","nota":4}]',
             20, 25, 80.00, 1, 'Ótima fluidez nas combinações e excelente postura no clinch. Apta para o Prajied Amarelo e Branco.'),

            -- Lucas (M): Avaliado no Prajied Laranja -> 19/25 = 76% (Min: 80%) -> APTO = 0 (Em evolução)
            (2, 1, 4, 3,
             '[{"item":"Execução do Wai Kru Ram Muay","nota":4},{"item":"Combinações de 4 golpes com cotovelada","nota":4},{"item":"Defesa de clinch com contra-ataque de joelho","nota":4},{"item":"Sparring com intensidade moderada a forte","nota":3},{"item":"Condicionamento físico marcial (100 chutes contínuos)","nota":4}]',
             19, 25, 76.00, 0, 'Excelente técnica de braço! Ajustar ritmo de sparring para atingir o percentual mínimo de 80% exigido no exame de Prajied Verde.'),

            -- Gabriel (M): Avaliado no Prajied Amarelo e Branco -> 21/25 = 84% (Min: 75%) -> APTO = 1
            (4, 1, 3, 3,
             '[{"item":"Contragolpe em cruzado e pêndulo","nota":4},{"item":"Joelhada curvada (Khao Khong)","nota":4},{"item":"Controle de nuca e giro no clinch","nota":4},{"item":"Esquiva de chute e rasteira de apoio","nota":4},{"item":"Resistência aeróbica em pao e saco pesado","nota":5}]',
             21, 25, 84.00, 1, 'Gás de luta impressionante e joelhadas muito precisas. Apto para o Prajied Laranja.');
        `);

        // 10. Check-ins Reais Espalhados nas Últimas 12 Semanas
        console.log('✓ Gerando histórico real de check-ins das últimas 12 semanas para todos os 8 alunos...');
        const checkinValues = [];
        const turmasIds = [1, 2, 3, 4];
        const metodos = ['reconhecimento_facial', 'app_aluno', 'manual_professor'];

        for (let alunoId = 1; alunoId <= 8; alunoId++) {
            const baseWeeklyDays = (alunoId % 2 === 0) ? [1, 3, 5] : [2, 4, 6];

            for (let week = 11; week >= 0; week--) {
                for (const dayOffset of baseWeeklyDays) {
                    const daysAgo = (week * 7) + dayOffset;
                    const turmaId = turmasIds[(alunoId + week + dayOffset) % turmasIds.length];
                    const metodo = metodos[(alunoId + week) % metodos.length];
                    const hour = turmaId === 1 ? '07:12:00' : (turmaId === 2 ? '12:05:00' : '19:10:00');

                    checkinValues.push(`(${alunoId}, 1, ${turmaId}, DATE_SUB(DATE_ADD(CURDATE(), INTERVAL 0 DAY), INTERVAL ${daysAgo} DAY) + INTERVAL '${hour}' HOUR_SECOND, '${metodo}', 'aprovado')`);
                }
            }
        }

        await pool.query(`
            INSERT INTO checkins (aluno_id, modalidade_id, turma_id, data_hora_checkin, metodo, status) VALUES
            ${checkinValues.join(',\n')}
        `);
        console.log(`✓ ${checkinValues.length} check-ins reais inseridos.`);

        console.log('✅ Seed finalizado com sucesso! Banco limpo e funcional.');
    } catch (err) {
        console.error('❌ Erro no seed:', err);
    } finally {
        process.exit(0);
    }
}

seed();
