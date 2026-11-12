/**
 * Seed inicial demonstrativo para a Wiki de Golpes e Movimentos Técnicos
 */

const pool = require('./connection');

async function seedWiki() {
    console.log('🥋 Semeando dados iniciais para a Wiki de Golpes...');

    const [modalidades] = await pool.query(`SELECT id FROM modalidades WHERE nome LIKE '%Muay%' LIMIT 1`);
    const muayThaiId = modalidades.length > 0 ? modalidades[0].id : null;

    // Verifica se já existem golpes
    const [existentes] = await pool.query(`SELECT COUNT(*) AS total FROM wiki_golpes`);
    if (existentes[0].total > 0) {
        console.log('ℹ️ Wiki de Golpes já contém registros. Pulando seed.');
        return;
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // 1. Teep (Chute Frontal de Muay Thai)
        const [g1] = await conn.query(`
            INSERT INTO wiki_golpes (nome, modalidade_id, categoria, nivel_dificuldade, descricao_geral, ativo)
            VALUES (?, ?, ?, ?, ?, 1)
        `, [
            'Teep (Chute Frontal)',
            muayThaiId,
            'Chute',
            'iniciante',
            'Golpe fundamental de controle de distância, quebra de ritmo e bloqueio do avanço adversário. Utiliza a planta do pé ou a bola do pé (metatarso).'
        ]);

        const golpeId1 = g1.insertId;

        await conn.query(`
            INSERT INTO wiki_golpe_passos (golpe_id, ordem, titulo, descricao, imagem_url)
            VALUES 
            (?, 1, 'Postura e Elevação do Joelho', 'A partir da base de guarda de Muay Thai, transfira o peso para a perna traseira e eleve o joelho da perna de ataque na altura do abdômen, mantendo o pé flexionado.', NULL),
            (?, 2, 'Projeção do Quadril e Extensão', 'Empurre o quadril para a frente de forma explosiva enquanto estende a perna retilinea em direção ao tronco ou plexo solar do oponente.', NULL),
            (?, 3, 'Ponto de Contato e Retração Rápida', 'Faça contato com a almofada do pé (metatarso), desferindo o empurrão/impacto, e recolha a perna imediatamente na mesma trajetória para evitar ser pego.', NULL)
        `, [golpeId1, golpeId1, golpeId1]);

        // 2. Chute Circular Médio (Roundhouse Kick)
        const [g2] = await conn.query(`
            INSERT INTO wiki_golpes (nome, modalidade_id, categoria, nivel_dificuldade, descricao_geral, ativo)
            VALUES (?, ?, ?, ?, ?, 1)
        `, [
            'Chute Circular (Roundhouse Kick)',
            muayThaiId,
            'Chute',
            'intermediario',
            'Um dos golpes mais potentes do Muay Thai. Utiliza a tíbia (canela) como superfície de impacto através de rotação total do quadril e pivô no pé de apoio.'
        ]);

        const golpeId2 = g2.insertId;

        await conn.query(`
            INSERT INTO wiki_golpe_passos (golpe_id, ordem, titulo, descricao, imagem_url)
            VALUES 
            (?, 1, 'Passo Diagonal e Pivô', 'Dê um passo em 45 graus para fora com o pé de base, subindo na ponta do pé para permitir a rotação livre do quadril.', NULL),
            (?, 2, 'Giro de Quadril e Balanço de Braço', 'Gire o quadril transversalmente como um taco de beisebol, arremessando o braço do mesmo lado para baixo para gerar torque e velocidade.', NULL),
            (?, 3, 'Impacto com a Tíbia e Retorno à Base', 'Acerte a costela ou braço do oponente com o terço médio da tíbia (canela). Complete a rotação ou recolha imediatamente mantendo a guarda alta.', NULL)
        `, [golpeId2, golpeId2, golpeId2]);

        // 3. Jab Reto
        const [g3] = await conn.query(`
            INSERT INTO wiki_golpes (nome, modalidade_id, categoria, nivel_dificuldade, descricao_geral, ativo)
            VALUES (?, ?, ?, ?, ?, 1)
        `, [
            'Jab Reto',
            muayThaiId,
            'Soco',
            'iniciante',
            'Golpe retilíneo com a mão da frente para medir distância, pontuar e preparar combinações potentes.'
        ]);

        const golpeId3 = g3.insertId;

        await conn.query(`
            INSERT INTO wiki_golpe_passos (golpe_id, ordem, titulo, descricao, imagem_url)
            VALUES 
            (?, 1, 'Guarda Alta e Alinhamento', 'Mantenha os cotovelos fechados protegendo as costelas e os punhos na altura das maçãs do rosto.', NULL),
            (?, 2, 'Extensão Retilínea e Pronação', 'Estenda o braço da frente em linha reta, rotacionando a palma da mão para baixo no momento do estalo final.', NULL),
            (?, 3, 'Ombro Protegendo o Queixo e Retração', 'O ombro esquerdo sobe colado à mandíbula para proteger de contragolpes. Recolha a mão à guarda pelo mesmo caminho.', NULL)
        `, [golpeId3, golpeId3, golpeId3]);

        await conn.commit();
        console.log('✅ 3 Golpes técnicos cadastrados com sucesso na Wiki!');
    } catch (err) {
        await conn.rollback();
        console.error('❌ Erro no seed da wiki:', err);
    } finally {
        conn.release();
    }
}

if (require.main === module) {
    seedWiki().then(() => process.exit());
}

module.exports = { seedWiki };

