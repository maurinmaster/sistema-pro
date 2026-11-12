require('dotenv').config();
const pool = require('./connection');

async function seedPainel() {
    console.log('🌱 Populando dados do Painel do Aluno (avisos, campanhas, conquistas, medidas)...');

    // 1. Avisos e Campanhas
    await pool.query('DELETE FROM avisos_campanhas');
    await pool.query(`
        INSERT INTO avisos_campanhas (id, titulo, tipo, descricao, data_evento, tag_destaque, ativo) VALUES
        (1, 'Exame de Graduação de Fim de Ano', 'evento', 'Avaliações técnicas com entrega oficial de Prajieds e faixas no tatame principal.', '2026-11-28', 'Exame Oficial', 1),
        (2, 'Campanha Amigo no Tatame (Ganhe 1 Mês)', 'campanha', 'Traga um amigo para aula experimental e ganhe 1 mensalidade grátis se ele se matricular!', '2026-11-30', 'Campanha Ativa', 1),
        (3, 'Seminário de Defesa Pessoal & Clinch', 'evento', 'Workshop exclusivo com foco em técnicas de clinch tailandês e projeções marciais.', '2026-12-05', 'Workshop Especial', 1),
        (4, 'Treino Especial de Sparring aos Sábados', 'aviso', 'Aos sábados, treino livre monitorado das 10h às 12h com protetores obrigatórios.', NULL, 'Aviso Importante', 1);
    `);
    console.log('✓ Avisos e Campanhas inseridos.');

    // 2. Conquistas
    await pool.query('DELETE FROM aluno_conquistas');
    await pool.query('DELETE FROM conquistas');
    await pool.query(`
        INSERT INTO conquistas (id, codigo, titulo, descricao, icone, categoria, criterio_tipo, criterio_valor) VALUES
        (1, 'primeiro_treino', 'Primeiro Passo', 'Completou seu primeiro treino oficial no tatame.', '🥋', 'Início', 'checkins', 1),
        (2, 'guerreiro_10', 'Guerreiro Dedicado', 'Alcançou a marca de 10 treinos concluídos.', '🥊', 'Frequência', 'checkins', 10),
        (3, 'disciplina_ouro', 'Disciplina de Ferro', 'Completou mais de 30 treinos com assiduidade exemplar.', '🔥', 'Frequência', 'checkins', 30),
        (4, 'primeira_graduacao', 'Graduado de Honra', 'Aprovado na avaliação técnica e conquistou novo grau/faixa.', '🏆', 'Graduação', 'graduacao', 1),
        (5, 'forma_marcial', 'Condicionamento Pro', 'Registrou medidas físicas e manteve IMC e peso na meta marcial.', '⚡', 'Saúde & Foco', 'medidas', 1),
        (6, 'tatame_invicto', 'Constância Total', 'Manteve 100% de presença nas semanas do plano contratado.', '🥇', 'Constância', 'semanas', 4);
    `);
    console.log('✓ Conquistas inseridas.');

    // 3. Vincular Conquistas aos Alunos
    await pool.query(`
        INSERT INTO aluno_conquistas (aluno_id, conquista_id, data_desbloqueio) VALUES
        (1, 1, '2026-08-10 19:30:00'),
        (1, 2, '2026-09-02 20:00:00'),
        (1, 3, '2026-10-15 19:45:00'),
        (1, 4, '2026-10-20 21:00:00'),
        (1, 5, '2026-10-25 18:00:00'),
        (4, 1, '2026-08-12 19:30:00'),
        (4, 2, '2026-09-05 20:00:00'),
        (4, 3, '2026-10-18 19:45:00');
    `);

    // 4. Atualizar medidas e skins dos alunos
    await pool.query("UPDATE alunos SET peso_kg = 58.5, altura_cm = 165, torax_cm = 88, cintura_cm = 68, quadril_cm = 94, avatar_tom = 'branca', avatar_cabelo = 'cabelo-mulher-1.png' WHERE id = 1");
    await pool.query("UPDATE alunos SET peso_kg = 62.0, altura_cm = 168, torax_cm = 90, cintura_cm = 70, quadril_cm = 96, avatar_tom = 'negra', avatar_cabelo = 'cabelo-mulher-3.png' WHERE id = 7");
    await pool.query("UPDATE alunos SET peso_kg = 74.0, altura_cm = 175, torax_cm = 102, cintura_cm = 80, quadril_cm = 98, avatar_tom = 'branca', avatar_cabelo = 'cabelo-homem-1.png' WHERE id = 4");
    await pool.query("UPDATE alunos SET peso_kg = 82.5, altura_cm = 180, torax_cm = 108, cintura_cm = 85, quadril_cm = 101, avatar_tom = 'negra', avatar_cabelo = 'cabelo-homem-2.png' WHERE id = 2");
    await pool.query("UPDATE alunos SET peso_kg = 70.0, altura_cm = 172, torax_cm = 96, cintura_cm = 78, quadril_cm = 95, avatar_tom = 'branca', avatar_cabelo = 'cabelo-homem-1.png' WHERE avatar_tom IS NULL");
    
    // Atualizar prajied_icone_url nas graduações de Muay Thai
    await pool.query("UPDATE graduacoes_niveis SET prajied_icone_url = '/assets/prajied/prajied-1.png' WHERE id = 1");
    await pool.query("UPDATE graduacoes_niveis SET prajied_icone_url = '/assets/prajied/prajied-2.png' WHERE id = 2");
    await pool.query("UPDATE graduacoes_niveis SET prajied_icone_url = '/assets/prajied/prajied-3.png' WHERE id = 3");
    await pool.query("UPDATE graduacoes_niveis SET prajied_icone_url = '/assets/prajied/prajied-4.png' WHERE id = 4");
    await pool.query("UPDATE graduacoes_niveis SET prajied_icone_url = '/assets/prajied/prajied-5.png' WHERE id = 5");
    console.log('✓ Medidas físicas, avatares e ícones de prajied atualizados.');

    // 5. Histórico de Avaliações Físicas (Comparativo de Evolução)
    await pool.query('DELETE FROM aluno_historico_medidas');
    await pool.query(`
        INSERT INTO aluno_historico_medidas 
        (aluno_id, data_medicao, peso_kg, altura_cm, torax_cm, cintura_cm, quadril_cm, braco_cm, coxa_cm, imc, imc_classificacao, observacoes) VALUES
        (1, '2026-08-15', 62.00, 165, 86.00, 74.00, 98.00, 27.00, 56.00, 22.8, 'Saudável (Ideal)', 'Avaliação inicial de admissão no Muay Thai'),
        (1, '2026-09-15', 60.50, 165, 87.00, 71.00, 96.00, 27.50, 55.00, 22.2, 'Saudável (Ideal)', 'Reavaliação 30 dias - redução de gordura corporal'),
        (1, '2026-10-15', 59.20, 165, 88.00, 69.00, 95.00, 28.00, 54.50, 21.7, 'Saudável (Ideal)', 'Reavaliação 60 dias - ganho de tônus muscular'),
        (1, '2026-10-31', 58.50, 165, 88.00, 68.00, 94.00, 28.50, 54.00, 21.5, 'Saudável (Ideal)', 'Avaliação pré-exame de graduação'),
        (4, '2026-08-20', 78.00, 175, 98.00, 86.00, 102.00, 34.00, 60.00, 25.5, 'Sobrepeso Leve', 'Início dos treinos de combate'),
        (4, '2026-09-20', 76.00, 175, 100.00, 83.00, 100.00, 35.00, 59.00, 24.8, 'Saudável (Ideal)', 'Redução de gordura e ganho peitoral'),
        (4, '2026-10-25', 74.00, 175, 102.00, 80.00, 98.00, 36.00, 58.50, 24.2, 'Saudável (Ideal)', 'Fase de definição muscular excelente');
    `);
    console.log('✓ Histórico de avaliações físicas inserido.');

    // 6. Avaliações de Desempenho (Clinch, Sparring e Condicionamento)
    await pool.query('DELETE FROM aluno_avaliacoes_desempenho');
    await pool.query(`
        INSERT INTO aluno_avaliacoes_desempenho
        (aluno_id, professor_id, data_avaliacao, nota_clinch_sparring, nota_condicionamento, observacoes) VALUES
        (1, 1, '2026-08-10', 6.5, 6.0, 'Início do clinch, base ainda instável, boa energia.'),
        (1, 1, '2026-09-05', 7.2, 7.0, 'Evolução na esgrima e joelhadas curtas. Fôlego melhorou.'),
        (1, 1, '2026-10-02', 8.0, 7.8, 'Ótimo controle de cabeça no clinch e saídas limpas no sparring.'),
        (1, 1, '2026-10-28', 8.8, 8.5, 'Excelente timing de entrada, bloqueio firme e resistência muscular alta.'),
        (4, 1, '2026-08-15', 7.0, 7.5, 'Força boa no clinch, dosar gás para rounds finais.'),
        (4, 1, '2026-09-18', 7.8, 8.0, 'Melhor absorção de golpes e combinações de boxe.'),
        (4, 1, '2026-10-22', 8.5, 8.8, 'Sparring consistente, pressão constante e ótimo cardio.');
    `);
    console.log('✓ Avaliações de desempenho (Clinch, Sparring & Condicionamento) inseridas.');

    console.log('✅ Base de dados do Painel do Aluno pronta!');
    process.exit(0);
}

seedPainel().catch(err => {
    console.error('❌ Erro no seedPainel:', err);
    process.exit(1);
});
