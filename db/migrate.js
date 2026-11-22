const pool = require('./connection');

/**
 * Garante de forma idempotente que colunas adicionadas durante a evolução do sistema
 * existam no banco de dados MySQL.
 */
async function ensureColumn(tableName, columnName, columnDefinition) {
    const dbName = process.env.DB_NAME || 'sistema_pro';
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS count 
         FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [dbName, tableName, columnName]
    );

    if (rows[0].count === 0) {
        await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnDefinition}`);
        console.log(`🔧 [Migration] Coluna '${columnName}' adicionada na tabela '${tableName}'.`);
    }
}

async function ensureBaseTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS usuarios_equipe (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(120) NOT NULL,
            email VARCHAR(120) NOT NULL UNIQUE,
            senha_hash VARCHAR(255) NOT NULL,
            cargo ENUM('admin', 'recepcao', 'professor') NOT NULL DEFAULT 'professor',
            telefone VARCHAR(20) NULL,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS alunos (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            nome_completo VARCHAR(150) NOT NULL,
            cpf VARCHAR(14) UNIQUE NULL,
            data_nascimento DATE NOT NULL,
            genero ENUM('M', 'F', 'Outro') NULL,
            email VARCHAR(120) UNIQUE NULL,
            senha_app_hash VARCHAR(255) NULL,
            telefone_whatsapp VARCHAR(20) NOT NULL,
            responsavel_nome VARCHAR(150) NULL,
            responsavel_cpf VARCHAR(14) NULL,
            responsavel_telefone VARCHAR(20) NULL,
            contato_emergencia_nome VARCHAR(120) NULL,
            contato_emergencia_fone VARCHAR(20) NULL,
            tipo_sanguineo VARCHAR(5) NULL,
            observacoes_medicas TEXT NULL,
            foto_perfil_url VARCHAR(255) NULL,
            face_foto_base_url VARCHAR(255) NULL,
            face_descriptor JSON NULL,
            consentimento_biometria_lgpd BOOLEAN NOT NULL DEFAULT FALSE,
            status ENUM('ativo', 'inativo', 'trancado', 'bloqueado', 'experimental') NOT NULL DEFAULT 'ativo',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_alunos_status (status),
            INDEX idx_alunos_nome (nome_completo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS modalidades (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(60) NOT NULL,
            descricao TEXT NULL,
            sistema_graduacao VARCHAR(50) NULL,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS graduacoes_niveis (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            modalidade_id INT UNSIGNED NOT NULL,
            nome VARCHAR(80) NOT NULL,
            cor_hex_primaria VARCHAR(7) NULL,
            cor_hex_secundaria VARCHAR(7) NULL,
            graus INT UNSIGNED NOT NULL DEFAULT 0,
            ordem_hierarquica INT UNSIGNED NOT NULL,
            aulas_minimas_exigidas INT UNSIGNED NULL,
            tempo_minimo_meses INT UNSIGNED NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_gradnivel_modalidade FOREIGN KEY (modalidade_id) REFERENCES modalidades(id) ON DELETE CASCADE,
            CONSTRAINT uq_modalidade_ordem UNIQUE (modalidade_id, ordem_hierarquica)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS aluno_graduacoes (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            aluno_id BIGINT UNSIGNED NOT NULL,
            modalidade_id INT UNSIGNED NOT NULL,
            graduacao_nivel_id INT UNSIGNED NOT NULL,
            data_graduacao DATE NOT NULL,
            professor_avaliador_id BIGINT UNSIGNED NULL,
            certificado_url VARCHAR(255) NULL,
            observacoes TEXT NULL,
            atual BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_agrad_aluno FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
            CONSTRAINT fk_agrad_modalidade FOREIGN KEY (modalidade_id) REFERENCES modalidades(id) ON DELETE RESTRICT,
            CONSTRAINT fk_agrad_nivel FOREIGN KEY (graduacao_nivel_id) REFERENCES graduacoes_niveis(id) ON DELETE RESTRICT,
            CONSTRAINT fk_agrad_professor FOREIGN KEY (professor_avaliador_id) REFERENCES usuarios_equipe(id) ON DELETE SET NULL,
            INDEX idx_aluno_grad_vigente (aluno_id, modalidade_id, atual)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS planos (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(80) NOT NULL,
            descricao TEXT NULL,
            valor_mensal DECIMAL(10,2) NOT NULL,
            periodicidade_meses INT UNSIGNED NOT NULL DEFAULT 1,
            limite_checkins_semana TINYINT UNSIGNED NULL,
            tolerancia_inadimplencia_dias TINYINT UNSIGNED NOT NULL DEFAULT 5,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS planos_modalidades (
            plano_id INT UNSIGNED NOT NULL,
            modalidade_id INT UNSIGNED NOT NULL,
            PRIMARY KEY (plano_id, modalidade_id),
            CONSTRAINT fk_pm_plano FOREIGN KEY (plano_id) REFERENCES planos(id) ON DELETE CASCADE,
            CONSTRAINT fk_pm_modalidade FOREIGN KEY (modalidade_id) REFERENCES modalidades(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS matriculas (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            aluno_id BIGINT UNSIGNED NOT NULL,
            plano_id INT UNSIGNED NOT NULL,
            data_inicio DATE NOT NULL,
            data_fim DATE NULL,
            dia_vencimento TINYINT UNSIGNED NOT NULL,
            valor_acordado DECIMAL(10,2) NOT NULL,
            desconto_motivo VARCHAR(100) NULL,
            status ENUM('ativa', 'trancada', 'cancelada', 'vencida') NOT NULL DEFAULT 'ativa',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_mat_aluno FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE RESTRICT,
            CONSTRAINT fk_mat_plano FOREIGN KEY (plano_id) REFERENCES planos(id) ON DELETE RESTRICT,
            INDEX idx_matricula_aluno_status (aluno_id, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS faturas (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            matricula_id BIGINT UNSIGNED NOT NULL,
            aluno_id BIGINT UNSIGNED NOT NULL,
            competencia CHAR(7) NOT NULL,
            valor_original DECIMAL(10,2) NOT NULL,
            valor_desconto DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            valor_juros_multa DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            valor_pago DECIMAL(10,2) NULL,
            data_vencimento DATE NOT NULL,
            data_pagamento DATETIME NULL,
            metodo_pagamento ENUM('pix', 'cartao_credito', 'cartao_debito', 'dinheiro', 'boleto') NULL,
            status ENUM('pendente', 'pago', 'atrasado', 'cancelado', 'isento') NOT NULL DEFAULT 'pendente',
            gateway_id_externo VARCHAR(120) NULL,
            observacoes VARCHAR(255) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_fat_matricula FOREIGN KEY (matricula_id) REFERENCES matriculas(id) ON DELETE RESTRICT,
            CONSTRAINT fk_fat_aluno FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE RESTRICT,
            INDEX idx_faturas_vencimento_status (data_vencimento, status),
            INDEX idx_faturas_aluno_status (aluno_id, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS turmas (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            modalidade_id INT UNSIGNED NOT NULL,
            professor_id BIGINT UNSIGNED NULL,
            nome VARCHAR(80) NOT NULL,
            dias_semana VARCHAR(30) NOT NULL,
            horario_inicio TIME NOT NULL,
            horario_fim TIME NOT NULL,
            capacidade_maxima SMALLINT UNSIGNED NULL,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            CONSTRAINT fk_turma_modalidade FOREIGN KEY (modalidade_id) REFERENCES modalidades(id) ON DELETE CASCADE,
            CONSTRAINT fk_turma_professor FOREIGN KEY (professor_id) REFERENCES usuarios_equipe(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS checkins (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            aluno_id BIGINT UNSIGNED NOT NULL,
            modalidade_id INT UNSIGNED NOT NULL,
            turma_id INT UNSIGNED NULL,
            data_hora_checkin DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            metodo ENUM('app_aluno', 'manual_professor', 'reconhecimento_facial') NOT NULL,
            foto_capturada_url VARCHAR(255) NULL,
            face_match_score DECIMAL(5,2) NULL,
            status ENUM('aprovado', 'pendente_confirmacao', 'bloqueado') NOT NULL DEFAULT 'aprovado',
            motivo_bloqueio VARCHAR(120) NULL,
            validado_por_usuario_id BIGINT UNSIGNED NULL,
            CONSTRAINT fk_chk_aluno FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
            CONSTRAINT fk_chk_modalidade FOREIGN KEY (modalidade_id) REFERENCES modalidades(id) ON DELETE RESTRICT,
            CONSTRAINT fk_chk_turma FOREIGN KEY (turma_id) REFERENCES turmas(id) ON DELETE SET NULL,
            CONSTRAINT fk_chk_validador FOREIGN KEY (validado_por_usuario_id) REFERENCES usuarios_equipe(id) ON DELETE SET NULL,
            INDEX idx_checkins_aluno_data (aluno_id, data_hora_checkin),
            INDEX idx_checkins_modalidade_data (modalidade_id, data_hora_checkin)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS avisos (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            autor_id BIGINT UNSIGNED NULL,
            titulo VARCHAR(150) NOT NULL,
            mensagem TEXT NOT NULL,
            imagem_banner_url VARCHAR(255) NULL,
            categoria ENUM('geral', 'exame_graduacao', 'seminario', 'feriado', 'financeiro') NOT NULL DEFAULT 'geral',
            publico_alvo ENUM('todos', 'modalidade_especifica', 'turma_especifica', 'aluno_especifico') NOT NULL DEFAULT 'todos',
            modalidade_alvo_id INT UNSIGNED NULL,
            turma_alvo_id INT UNSIGNED NULL,
            aluno_alvo_id BIGINT UNSIGNED NULL,
            fixado_topo BOOLEAN NOT NULL DEFAULT FALSE,
            data_publicacao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            data_expiracao DATETIME NULL,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            CONSTRAINT fk_aviso_autor FOREIGN KEY (autor_id) REFERENCES usuarios_equipe(id) ON DELETE SET NULL,
            CONSTRAINT fk_aviso_modalidade FOREIGN KEY (modalidade_alvo_id) REFERENCES modalidades(id) ON DELETE CASCADE,
            CONSTRAINT fk_aviso_turma FOREIGN KEY (turma_alvo_id) REFERENCES turmas(id) ON DELETE CASCADE,
            CONSTRAINT fk_aviso_aluno FOREIGN KEY (aluno_alvo_id) REFERENCES alunos(id) ON DELETE CASCADE,
            INDEX idx_avisos_ativos (ativo, data_expiracao, fixado_topo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS avisos_lidos (
            aviso_id BIGINT UNSIGNED NOT NULL,
            aluno_id BIGINT UNSIGNED NOT NULL,
            lido_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (aviso_id, aluno_id),
            CONSTRAINT fk_alido_aviso FOREIGN KEY (aviso_id) REFERENCES avisos(id) ON DELETE CASCADE,
            CONSTRAINT fk_alido_aluno FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
}

async function runMigrations() {
    console.log('🔄 Verificando integridade e migrations do banco de dados...');
    try {
        await ensureBaseTables();
        await ensureColumn('matriculas', 'motivo_cancelamento_trancamento', 'VARCHAR(255) NULL AFTER desconto_motivo');
        await ensureColumn('matriculas', 'data_retorno_prevista', 'DATE NULL AFTER motivo_cancelamento_trancamento');

        // Colunas de especificações e requisitos em graduacoes_niveis
        await ensureColumn('graduacoes_niveis', 'requisitos_lista_json', 'JSON NULL');
        await ensureColumn('graduacoes_niveis', 'total_itens', 'INT UNSIGNED NOT NULL DEFAULT 0');
        await ensureColumn('graduacoes_niveis', 'porcentagem_minima', 'DECIMAL(5,2) NOT NULL DEFAULT 70.00');
        await ensureColumn('graduacoes_niveis', 'prajied_icone_url', 'VARCHAR(255) NULL');

        // Tabela de avaliações dos alunos nas especificações da graduação
        await pool.query(`
            CREATE TABLE IF NOT EXISTS aluno_avaliacoes_graduacao (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                aluno_id BIGINT UNSIGNED NOT NULL,
                modalidade_id INT UNSIGNED NOT NULL,
                graduacao_nivel_id INT UNSIGNED NOT NULL,
                professor_id BIGINT UNSIGNED NULL,
                itens_avaliados_json JSON NOT NULL,
                total_pontos_obtidos INT UNSIGNED NOT NULL DEFAULT 0,
                total_pontos_possiveis INT UNSIGNED NOT NULL DEFAULT 0,
                percentual_obtido DECIMAL(5,2) NOT NULL DEFAULT 0.00,
                apto TINYINT(1) NOT NULL DEFAULT 0,
                observacoes_professor TEXT NULL,
                data_avaliacao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_aluno_mod_grad (aluno_id, modalidade_id, graduacao_nivel_id),
                FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
                FOREIGN KEY (modalidade_id) REFERENCES modalidades(id) ON DELETE CASCADE,
                FOREIGN KEY (graduacao_nivel_id) REFERENCES graduacoes_niveis(id) ON DELETE CASCADE,
                FOREIGN KEY (professor_id) REFERENCES usuarios_equipe(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 1. Tabela relacional de Usuários de Alunos (login, senha e status)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios_alunos (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                aluno_id BIGINT UNSIGNED NOT NULL UNIQUE,
                email VARCHAR(120) NOT NULL UNIQUE,
                senha_hash VARCHAR(255) NOT NULL,
                status ENUM('ativo', 'inativo', 'pendente_verificacao', 'bloqueado') NOT NULL DEFAULT 'pendente_verificacao',
                email_verificado TINYINT(1) NOT NULL DEFAULT 0,
                ultimo_login TIMESTAMP NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_email (email),
                INDEX idx_status (status),
                FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 2. Sessão do Usuário (token hash, ip_endereco, user_agent, expira_em)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sessoes_usuarios (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                usuario_id BIGINT UNSIGNED NOT NULL,
                token_hash VARCHAR(64) NOT NULL,
                ip_endereco VARCHAR(45) NULL,
                user_agent TEXT NULL,
                expira_em DATETIME NOT NULL,
                revogado TINYINT(1) NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_token_hash (token_hash),
                INDEX idx_usuario_id (usuario_id),
                FOREIGN KEY (usuario_id) REFERENCES usuarios_alunos(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 3. Tentativas de Login (email, ip_endereco, sucesso, motivo_falha)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tentativas_login (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(120) NOT NULL,
                ip_endereco VARCHAR(45) NULL,
                sucesso TINYINT(1) NOT NULL DEFAULT 0,
                motivo_falha VARCHAR(100) NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_email_tentativas (email),
                INDEX idx_ip_tentativas (ip_endereco),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 4. Redefinição de Senha (gerenciar fluxo de esqueci a senha)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS redefinicoes_senha (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                usuario_id BIGINT UNSIGNED NOT NULL,
                token_hash VARCHAR(64) NOT NULL,
                codigo_recuperacao VARCHAR(10) NULL,
                expira_em DATETIME NOT NULL,
                usado TINYINT(1) NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_token_redefinicao (token_hash),
                INDEX idx_usuario_redefinicao (usuario_id),
                FOREIGN KEY (usuario_id) REFERENCES usuarios_alunos(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 5. Verificação de Email (garantir validade do email logo após cadastro)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS verificacoes_email (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                usuario_id BIGINT UNSIGNED NOT NULL,
                token_hash VARCHAR(64) NOT NULL,
                codigo_verificacao VARCHAR(10) NOT NULL,
                expira_em DATETIME NOT NULL,
                verificado TINYINT(1) NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_token_verificacao (token_hash),
                INDEX idx_usuario_codigo (usuario_id, codigo_verificacao),
                FOREIGN KEY (usuario_id) REFERENCES usuarios_alunos(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 6. Colunas de Medidas Físicas e Skin do Atleta na tabela alunos (Sem valores fictícios por padrão)
        await ensureColumn('alunos', 'peso_kg', 'DECIMAL(5,2) NULL DEFAULT NULL');
        await ensureColumn('alunos', 'altura_cm', 'INT UNSIGNED NULL DEFAULT NULL');
        await ensureColumn('alunos', 'torax_cm', 'DECIMAL(5,2) NULL DEFAULT NULL');
        await ensureColumn('alunos', 'cintura_cm', 'DECIMAL(5,2) NULL DEFAULT NULL');
        await ensureColumn('alunos', 'quadril_cm', 'DECIMAL(5,2) NULL DEFAULT NULL');
        await ensureColumn('alunos', 'skin_fighter', "VARCHAR(100) NULL DEFAULT 'mt-skin-1.jpg'");
        await ensureColumn('alunos', 'avatar_tom', "VARCHAR(20) NULL DEFAULT 'branca'");
        await ensureColumn('alunos', 'avatar_cabelo', "VARCHAR(100) NULL DEFAULT 'cabelo-homem-1.png'");

        // Garante que os defaults no banco de dados sejam NULL para novos cadastros
        await pool.query(`ALTER TABLE alunos MODIFY COLUMN peso_kg DECIMAL(5,2) NULL DEFAULT NULL`).catch(() => {});
        await pool.query(`ALTER TABLE alunos MODIFY COLUMN altura_cm INT UNSIGNED NULL DEFAULT NULL`).catch(() => {});
        await pool.query(`ALTER TABLE alunos MODIFY COLUMN torax_cm DECIMAL(5,2) NULL DEFAULT NULL`).catch(() => {});
        await pool.query(`ALTER TABLE alunos MODIFY COLUMN cintura_cm DECIMAL(5,2) NULL DEFAULT NULL`).catch(() => {});
        await pool.query(`ALTER TABLE alunos MODIFY COLUMN quadril_cm DECIMAL(5,2) NULL DEFAULT NULL`).catch(() => {});

        // 7. Tabela de Avisos, Eventos e Campanhas da Academia
        await pool.query(`
            CREATE TABLE IF NOT EXISTS avisos_campanhas (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                titulo VARCHAR(150) NOT NULL,
                tipo ENUM('aviso', 'campanha', 'evento') NOT NULL DEFAULT 'aviso',
                descricao TEXT NOT NULL,
                data_evento DATE NULL,
                tag_destaque VARCHAR(50) NULL,
                ativo TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ativo (ativo),
                INDEX idx_tipo (tipo)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 8. Tabela de Conquistas e Badges
        await pool.query(`
            CREATE TABLE IF NOT EXISTS conquistas (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                codigo VARCHAR(50) NOT NULL UNIQUE,
                titulo VARCHAR(100) NOT NULL,
                descricao VARCHAR(255) NOT NULL,
                icone VARCHAR(50) NOT NULL DEFAULT '🏆',
                categoria VARCHAR(50) NOT NULL DEFAULT 'Geral',
                criterio_tipo VARCHAR(50) NOT NULL DEFAULT 'checkins',
                criterio_valor INT NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 9. Tabela relacional de Conquistas Desbloqueadas pelos Alunos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS aluno_conquistas (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                aluno_id BIGINT UNSIGNED NOT NULL,
                conquista_id INT UNSIGNED NOT NULL,
                data_desbloqueio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_aluno_conquista (aluno_id, conquista_id),
                FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
                FOREIGN KEY (conquista_id) REFERENCES conquistas(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 10. Histórico de Dados Físicos para Comparativo de Evolução
        await pool.query(`
            CREATE TABLE IF NOT EXISTS aluno_historico_medidas (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                aluno_id BIGINT UNSIGNED NOT NULL,
                data_medicao DATE NOT NULL,
                peso_kg DECIMAL(5,2) NOT NULL,
                altura_cm INT UNSIGNED NOT NULL,
                torax_cm DECIMAL(5,2) NULL,
                cintura_cm DECIMAL(5,2) NULL,
                quadril_cm DECIMAL(5,2) NULL,
                braco_cm DECIMAL(5,2) NULL,
                coxa_cm DECIMAL(5,2) NULL,
                imc DECIMAL(4,1) NOT NULL,
                imc_classificacao VARCHAR(50) NOT NULL,
                observacoes VARCHAR(255) NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_aluno_data (aluno_id, data_medicao DESC),
                FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 11. Avaliações Contínuas de Desempenho (Clinch, Sparring e Condicionamento)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS aluno_avaliacoes_desempenho (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                aluno_id BIGINT UNSIGNED NOT NULL,
                professor_id BIGINT UNSIGNED NULL,
                data_avaliacao DATE NOT NULL,
                nota_clinch_sparring DECIMAL(4,1) NOT NULL DEFAULT 0.0,
                nota_condicionamento DECIMAL(4,1) NOT NULL DEFAULT 0.0,
                observacoes TEXT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_aluno_data (aluno_id, data_avaliacao DESC),
                FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
                FOREIGN KEY (professor_id) REFERENCES usuarios_equipe(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 12. Wiki de Golpes e Movimentos (Biblioteca Técnica com Passos e Fotos)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS wiki_golpes (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(150) NOT NULL,
                modalidade_id INT UNSIGNED NULL,
                categoria VARCHAR(80) NULL,
                nivel_dificuldade ENUM('iniciante', 'intermediario', 'avancado') NOT NULL DEFAULT 'iniciante',
                descricao_geral TEXT NULL,
                ativo TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_wiki_golpes_modalidade (modalidade_id),
                INDEX idx_wiki_golpes_ativo (ativo),
                FOREIGN KEY (modalidade_id) REFERENCES modalidades(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        await ensureColumn('wiki_golpes', 'imagem_capa', 'VARCHAR(255) NULL AFTER descricao_geral');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS wiki_golpe_passos (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                golpe_id INT UNSIGNED NOT NULL,
                ordem INT NOT NULL DEFAULT 1,
                titulo VARCHAR(150) NULL,
                descricao TEXT NOT NULL,
                imagem_url VARCHAR(255) NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_wiki_passos_golpe (golpe_id, ordem),
                FOREIGN KEY (golpe_id) REFERENCES wiki_golpes(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 13. Associação de Golpes e Movimentos Técnicos às Faixas / Níveis de Graduação
        await pool.query(`
            CREATE TABLE IF NOT EXISTS graduacao_nivel_golpes (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                graduacao_nivel_id INT UNSIGNED NOT NULL,
                golpe_id INT UNSIGNED NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_nivel_golpe (graduacao_nivel_id, golpe_id),
                INDEX idx_gng_nivel (graduacao_nivel_id),
                INDEX idx_gng_golpe (golpe_id),
                FOREIGN KEY (graduacao_nivel_id) REFERENCES graduacoes_niveis(id) ON DELETE CASCADE,
                FOREIGN KEY (golpe_id) REFERENCES wiki_golpes(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 14. Progresso Individual do Aluno nos Golpes e Técnicas da Wiki
        await pool.query(`
            CREATE TABLE IF NOT EXISTS aluno_golpes_progresso (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                aluno_id BIGINT UNSIGNED NOT NULL,
                golpe_id INT UNSIGNED NOT NULL,
                status ENUM('em_treino', 'dominado') NOT NULL DEFAULT 'em_treino',
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_aluno_golpe_progresso (aluno_id, golpe_id),
                INDEX idx_agp_aluno (aluno_id),
                INDEX idx_agp_status (status),
                FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
                FOREIGN KEY (golpe_id) REFERENCES wiki_golpes(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Colunas de customização e títulos do avatar do atleta
        await ensureColumn('alunos', 'avatar_luva', "VARCHAR(50) NOT NULL DEFAULT 'padrao' AFTER avatar_cabelo");
        await ensureColumn('alunos', 'titulo_ativo', "VARCHAR(100) NOT NULL DEFAULT 'Iniciante Focado' AFTER avatar_luva");

        // 15. Eventos de Exame de Graduação
        await pool.query(`
            CREATE TABLE IF NOT EXISTS eventos_graduacao (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                titulo VARCHAR(150) NOT NULL,
                modalidade_id INT UNSIGNED NULL,
                data_evento DATE NOT NULL,
                horario_inicio TIME NULL DEFAULT '09:00:00',
                data_limite_inscricao DATE NULL,
                local_evento VARCHAR(200) NULL DEFAULT 'Dojo Central - Pro Combate',
                taxa_inscricao DECIMAL(10,2) NOT NULL DEFAULT 150.00,
                descricao TEXT NULL,
                status ENUM('rascunho', 'aberto', 'em_andamento', 'concluido', 'cancelado') NOT NULL DEFAULT 'aberto',
                criado_por_usuario_id BIGINT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_evg_data (data_evento),
                INDEX idx_evg_status (status),
                INDEX idx_evg_mod (modalidade_id),
                FOREIGN KEY (modalidade_id) REFERENCES modalidades(id) ON DELETE SET NULL,
                FOREIGN KEY (criado_por_usuario_id) REFERENCES usuarios_equipe(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 16. Convites e Inscrições dos Alunos nos Eventos de Graduação com Gateway Asaas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS evento_graduacao_convites (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                evento_id BIGINT UNSIGNED NOT NULL,
                aluno_id BIGINT UNSIGNED NOT NULL,
                modalidade_id INT UNSIGNED NOT NULL,
                graduacao_atual_id INT UNSIGNED NOT NULL,
                graduacao_pretendida_id INT UNSIGNED NOT NULL,
                percentual_avaliacao DECIMAL(5,2) NULL,
                apto_motivo VARCHAR(255) NULL DEFAULT 'Apto pela avaliação técnica',
                valor DECIMAL(10,2) NOT NULL DEFAULT 150.00,
                status ENUM('convidado', 'aceito', 'pago', 'recusado', 'cancelado') NOT NULL DEFAULT 'convidado',
                data_convite TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                data_resposta TIMESTAMP NULL,
                motivo_recusa VARCHAR(255) NULL,
                asaas_customer_id VARCHAR(80) NULL,
                asaas_payment_id VARCHAR(80) NULL,
                asaas_invoice_url VARCHAR(255) NULL,
                asaas_pix_qrcode TEXT NULL,
                asaas_pix_copia_cola TEXT NULL,
                asaas_billing_type VARCHAR(30) NULL DEFAULT 'PIX',
                asaas_status VARCHAR(50) NULL DEFAULT 'PENDING',
                data_pagamento TIMESTAMP NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_evento_aluno (evento_id, aluno_id),
                INDEX idx_egc_evento (evento_id),
                INDEX idx_egc_aluno (aluno_id),
                INDEX idx_egc_status (status),
                INDEX idx_egc_asaas_pay (asaas_payment_id),
                FOREIGN KEY (evento_id) REFERENCES eventos_graduacao(id) ON DELETE CASCADE,
                FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
                FOREIGN KEY (modalidade_id) REFERENCES modalidades(id) ON DELETE CASCADE,
                FOREIGN KEY (graduacao_atual_id) REFERENCES graduacoes_niveis(id) ON DELETE CASCADE,
                FOREIGN KEY (graduacao_pretendida_id) REFERENCES graduacoes_niveis(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 17. Colunas de integração do Gateway Asaas em faturas de mensalidade
        await ensureColumn('faturas', 'asaas_customer_id', 'VARCHAR(80) NULL AFTER gateway_id_externo');
        await ensureColumn('faturas', 'asaas_payment_id', 'VARCHAR(80) NULL AFTER asaas_customer_id');
        await ensureColumn('faturas', 'asaas_invoice_url', 'VARCHAR(255) NULL AFTER asaas_payment_id');
        await ensureColumn('faturas', 'asaas_pix_qrcode', 'TEXT NULL AFTER asaas_invoice_url');
        await ensureColumn('faturas', 'asaas_pix_copia_cola', 'TEXT NULL AFTER asaas_pix_qrcode');
        await ensureColumn('faturas', 'asaas_status', "VARCHAR(50) NULL DEFAULT 'PENDING' AFTER asaas_pix_copia_cola");

        // 18. Quesitos Técnicos do Professor (Clinch, Socos, Chutes, Postura de 0 a 10)
        await ensureColumn('aluno_avaliacoes_desempenho', 'nota_clinch', 'DECIMAL(4,1) NOT NULL DEFAULT 0.0 AFTER data_avaliacao');
        await ensureColumn('aluno_avaliacoes_desempenho', 'nota_socos', 'DECIMAL(4,1) NOT NULL DEFAULT 0.0 AFTER nota_clinch');
        await ensureColumn('aluno_avaliacoes_desempenho', 'nota_chutes', 'DECIMAL(4,1) NOT NULL DEFAULT 0.0 AFTER nota_socos');
        await ensureColumn('aluno_avaliacoes_desempenho', 'nota_postura', 'DECIMAL(4,1) NOT NULL DEFAULT 0.0 AFTER nota_chutes');

        // 18b. Avaliação Técnica Gamificada (Estilo RPG - Muay Thai: 20 critérios / 5 pilares / Rank D..S)
        await ensureColumn('aluno_avaliacoes_desempenho', 'modelo_avaliacao', "VARCHAR(20) NOT NULL DEFAULT 'legado' AFTER data_avaliacao");
        await ensureColumn('aluno_avaliacoes_desempenho', 'apto_sparring', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER modelo_avaliacao');
        await ensureColumn('aluno_avaliacoes_desempenho', 'score_inteligencia', 'TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER apto_sparring');
        await ensureColumn('aluno_avaliacoes_desempenho', 'score_destreza', 'TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER score_inteligencia');
        await ensureColumn('aluno_avaliacoes_desempenho', 'score_agilidade', 'TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER score_destreza');
        await ensureColumn('aluno_avaliacoes_desempenho', 'score_forca', 'TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER score_agilidade');
        await ensureColumn('aluno_avaliacoes_desempenho', 'score_vitalidade', 'TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER score_forca');
        await ensureColumn('aluno_avaliacoes_desempenho', 'score_total', 'TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER score_vitalidade');
        await ensureColumn('aluno_avaliacoes_desempenho', 'rank_combate', "VARCHAR(2) NOT NULL DEFAULT 'D' AFTER score_total");
        await ensureColumn('aluno_avaliacoes_desempenho', 'rank_titulo', "VARCHAR(40) NOT NULL DEFAULT 'Iniciante' AFTER rank_combate");
        await ensureColumn('aluno_avaliacoes_desempenho', 'criterios_json', 'JSON NULL AFTER rank_titulo');

        // 18c. Requisitos RPG opcionais por nível de graduação (Trava de Progressão p/ Exame)
        await ensureColumn('graduacoes_niveis', 'rpg_rank_minimo', 'VARCHAR(2) NULL DEFAULT NULL AFTER porcentagem_minima');
        await ensureColumn('graduacoes_niveis', 'rpg_pontuacao_minima_atributo', 'TINYINT UNSIGNED NULL DEFAULT NULL AFTER rpg_rank_minimo');
        await ensureColumn('graduacoes_niveis', 'rpg_exige_apto_sparring', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER rpg_pontuacao_minima_atributo');

        // 19. Soft delete e lixeira para cadastros de alunos
        await ensureColumn('alunos', 'deleted_at', 'DATETIME NULL DEFAULT NULL AFTER updated_at');
        await pool.query('ALTER TABLE alunos ADD INDEX idx_alunos_deleted_at (deleted_at)').catch(() => {});

        // 19b. Preferência de recebimento de mensagens via WhatsApp
        await ensureColumn('alunos', 'receber_whatsapp', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER telefone_whatsapp');

        // 19c. Configurações centralizadas de envio de mensagens (WhatsApp e E-mail)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS configuracoes_mensagens (
                id INT UNSIGNED PRIMARY KEY DEFAULT 1,
                portal_url VARCHAR(255) NOT NULL DEFAULT 'https://gestor.procombate.com',
                incluir_link_padrao TINYINT(1) NOT NULL DEFAULT 1,
                admin_whatsapp VARCHAR(255) NULL DEFAULT NULL,
                admin_email VARCHAR(255) NULL DEFAULT NULL,
                regras_json LONGTEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 19d. Log histórico de envios de E-mail e WhatsApp
        await pool.query(`
            CREATE TABLE IF NOT EXISTS mensagens_envios_logs (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                canal ENUM('email', 'whatsapp') NOT NULL,
                tipo VARCHAR(60) NOT NULL DEFAULT 'sistema',
                destinatario VARCHAR(180) NOT NULL,
                assunto VARCHAR(200) NULL DEFAULT NULL,
                status ENUM('enviado', 'simulado', 'ignorado', 'erro') NOT NULL,
                erro_detalhe VARCHAR(500) NULL DEFAULT NULL,
                message_id VARCHAR(180) NULL DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_msg_logs_created (created_at),
                INDEX idx_msg_logs_canal_status (canal, status),
                INDEX idx_msg_logs_dest (destinatario)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 19e. Quadro de Missões criado pelo Professor e Adesão dos Alunos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS missoes_quadro (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                titulo VARCHAR(140) NOT NULL,
                descricao TEXT NOT NULL,
                categoria VARCHAR(40) NOT NULL DEFAULT 'tecnica',
                dificuldade ENUM('facil', 'media', 'dificil', 'epica') NOT NULL DEFAULT 'media',
                pilar_foco VARCHAR(30) NULL DEFAULT NULL,
                modalidade_id INT UNSIGNED NULL DEFAULT NULL,
                recompensa_xp INT UNSIGNED NOT NULL DEFAULT 50,
                recompensa_texto VARCHAR(120) NULL DEFAULT NULL,
                limite_vagas INT UNSIGNED NULL DEFAULT NULL,
                prazo_dias INT UNSIGNED NULL DEFAULT NULL,
                ativo TINYINT(1) NOT NULL DEFAULT 1,
                criado_por BIGINT UNSIGNED NULL DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_missoes_quadro_ativo (ativo, modalidade_id),
                CONSTRAINT fk_missoes_quadro_mod FOREIGN KEY (modalidade_id) REFERENCES modalidades(id) ON DELETE SET NULL,
                CONSTRAINT fk_missoes_quadro_prof FOREIGN KEY (criado_por) REFERENCES usuarios_equipe(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS aluno_missoes (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                aluno_id BIGINT UNSIGNED NOT NULL,
                missao_id INT UNSIGNED NOT NULL,
                status ENUM('em_andamento', 'aguardando_validacao', 'concluida', 'cancelada') NOT NULL DEFAULT 'em_andamento',
                nota_aluno VARCHAR(300) NULL DEFAULT NULL,
                feedback_professor VARCHAR(300) NULL DEFAULT NULL,
                validado_por BIGINT UNSIGNED NULL DEFAULT NULL,
                aceita_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                solicitada_conclusao_em DATETIME NULL DEFAULT NULL,
                concluida_em DATETIME NULL DEFAULT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_aluno_missao (aluno_id, missao_id),
                INDEX idx_aluno_missoes_status (status),
                CONSTRAINT fk_aluno_missoes_aluno FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
                CONSTRAINT fk_aluno_missoes_missao FOREIGN KEY (missao_id) REFERENCES missoes_quadro(id) ON DELETE CASCADE,
                CONSTRAINT fk_aluno_missoes_validador FOREIGN KEY (validado_por) REFERENCES usuarios_equipe(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Seed inicial idempotente de missões para o Quadro de Missões
        const [missoesCount] = await pool.query('SELECT COUNT(*) AS total FROM missoes_quadro');
        if (missoesCount[0].total === 0) {
            await pool.query(`
                INSERT INTO missoes_quadro (titulo, descricao, categoria, dificuldade, pilar_foco, modalidade_id, recompensa_xp, recompensa_texto, ativo) VALUES
                ('100 Chutes Circulares Limpos no Saco', 'Executar 50 chutes com cada perna mantendo quadril rotacionado, guarda alta e retorno na base equilibrada.', 'tecnica', 'facil', 'destreza', NULL, 50, '+50 XP Técnico', 1),
                ('3 Rounds de Clinch Técnico Controlado', 'Realizar 3 rounds focando em postura ereta, controle de nuca/biceps e saídas rápidas sem travar a respiração.', 'clinch', 'media', 'forca', NULL, 100, '+100 XP & Destaque no Clinch', 1),
                ('Desafio da Guarda Alta sob Fadiga', 'Finalizar o último round do treino mantendo os dois cotovelos fechados e queixo protegido sem baixar a guarda.', 'sparring', 'dificil', 'vitalidade', NULL, 150, '+150 XP Resistência Elite', 1),
                ('Leitura & Contra-Ataque: 5 Sequências Limpas', 'Durante drill técnico ou sparring controlado, responder imediatamente após defesa/aparo com combinação limpa.', 'tecnica', 'media', 'inteligencia', NULL, 100, '+100 XP Leitura Tática', 1)
            `);
            console.log('🎯 [Bootstrap] Missões iniciais adicionadas ao Quadro de Missões.');
        }

        // 19f. Persistência de Sessão WhatsApp (Baileys) no MySQL para reconexão após deploys/reinícios
        await pool.query(`
            CREATE TABLE IF NOT EXISTS whatsapp_auth_state (
                session_id VARCHAR(64) NOT NULL DEFAULT 'default',
                data_key VARCHAR(191) NOT NULL,
                data_value LONGTEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (session_id, data_key)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 20. Garante que todo atleta cadastrado sem graduação receba a primeira graduação inicial
        const [alunosSemGrad] = await pool.query(`
            SELECT a.id FROM alunos a
            LEFT JOIN aluno_graduacoes ag ON ag.aluno_id = a.id
            WHERE a.deleted_at IS NULL AND ag.id IS NULL
        `);

        if (alunosSemGrad.length > 0) {
            const [mods] = await pool.query(`
                SELECT id FROM modalidades WHERE ativo = 1 ORDER BY (nome LIKE '%Muay%') DESC, id ASC LIMIT 1
            `);
            if (mods.length > 0) {
                const modId = mods[0].id;
                const [niveis] = await pool.query(`
                    SELECT id FROM graduacoes_niveis WHERE modalidade_id = ? ORDER BY ordem_hierarquica ASC, id ASC LIMIT 1
                `, [modId]);
                if (niveis.length > 0) {
                    const nivelId = niveis[0].id;
                    for (const a of alunosSemGrad) {
                        await pool.query(`
                            INSERT INTO aluno_graduacoes (aluno_id, modalidade_id, graduacao_nivel_id, data_graduacao, observacoes, atual)
                            VALUES (?, ?, ?, CURDATE(), 'Graduação inicial automática.', 1)
                        `, [a.id, modId, nivelId]);
                    }
                    console.log(`🥋 [Migration] Primeira graduação atribuída para ${alunosSemGrad.length} atletas que estavam sem nível.`);
                }
            }
        }

        // 21. Bootstrap idempotente de dados básicos caso o banco esteja recém-criado/vazio
        const [eqCount] = await pool.query('SELECT COUNT(*) AS total FROM usuarios_equipe');
        if (eqCount[0].total === 0) {
            const bcrypt = require('bcryptjs');
            const defaultHash = await bcrypt.hash('123456', 10);
            await pool.query(`
                INSERT IGNORE INTO usuarios_equipe (id, nome, email, senha_hash, cargo, telefone, ativo) VALUES
                (1, 'Mestre Carlos Silva', 'carlos.mestre@ctpro.com.br', ?, 'admin', '(11) 98111-2233', 1),
                (2, 'Profª. Camila Nakata (Kru)', 'camila.muay@ctpro.com.br', ?, 'professor', '(11) 98222-3344', 1),
                (3, 'Prof. Marcos "Demolidor" Santos', 'marcos.muay@ctpro.com.br', ?, 'professor', '(11) 98333-4455', 1),
                (4, 'Juliana Mendes', 'atendimento@ctpro.com.br', ?, 'recepcao', '(11) 98444-5566', 1),
                (5, 'Administrador Pro Combate', 'procombatesanda@gmail.com', ?, 'admin', '(11) 99999-9999', 1)
            `, [defaultHash, defaultHash, defaultHash, defaultHash, defaultHash]);
            console.log('👤 [Bootstrap] Usuários iniciais da equipe criados.');
        }

        const [modCount] = await pool.query('SELECT COUNT(*) AS total FROM modalidades');
        if (modCount[0].total === 0) {
            await pool.query(`
                INSERT IGNORE INTO modalidades (id, nome, descricao, sistema_graduacao, ativo) VALUES
                (1, 'Muay Thai', 'A arte das oito armas: socos, cotoveladas, joelhadas e chutes potentes com clinch tailandês.', 'Prajied / Kruang', 1)
            `);
            await pool.query(`
                INSERT IGNORE INTO graduacoes_niveis (id, modalidade_id, nome, cor_hex_primaria, cor_hex_secundaria, graus, ordem_hierarquica, aulas_minimas_exigidas, tempo_minimo_meses, requisitos_lista_json, total_itens, porcentagem_minima, prajied_icone_url) VALUES
                (1, 1, 'Prajied Branco (Iniciante)', '#F8FAFC', '#94A3B8', 0, 1, 30, 3,
                 '["Base e postura tradicional (Guarda e Teep)", "Jab e Direto com rotação do quadril", "Chute circular na coxa (Low Kick / Tei Kha)", "Defesa de bloqueio com a canela (Check)", "Clinch básico e joelhada frontal (Khao Tron)"]',
                 5, 70.00, '/assets/prajied/prajied-1.png'),
                (2, 1, 'Prajied Amarelo', '#EAB308', '#CA8A04', 0, 2, 50, 4,
                 '["Combinações soco-chute fluidas", "Cotovelada frontal e diagonal (Sok Tad / Sok Ti)", "Saída de clinch e desequilíbrio lateral", "Chute circular nas costelas (Middle Kick / Tei Lam Tua)", "Sparring técnico controlado de 3 rounds"]',
                 5, 75.00, '/assets/prajied/prajied-2.png'),
                (3, 1, 'Prajied Amarelo e Branco', '#EAB308', '#FFFFFF', 0, 3, 60, 4,
                 '["Contragolpe em cruzado e pêndulo", "Joelhada curvada (Khao Khong)", "Controle de nuca e giro no clinch", "Esquiva de chute e rasteira de apoio", "Resistência aeróbica em pao e saco pesado"]',
                 5, 75.00, '/assets/prajied/prajied-3.png'),
                (4, 1, 'Prajied Laranja', '#F97316', '#EA580C', 0, 4, 80, 6,
                 '["Execução do Wai Kru Ram Muay", "Combinações de 4 golpes com cotovelada", "Defesa de clinch com contra-ataque de joelho", "Sparring com intensidade moderada a forte", "Condicionamento físico marcial (100 chutes contínuos)"]',
                 5, 80.00, '/assets/prajied/prajied-4.png'),
                (5, 1, 'Prajied Verde', '#22C55E', '#16A34A', 0, 5, 100, 6,
                 '["Domínio completo das 8 armas em combate", "Clinch de competição com projeção e joelhadas", "Variações avançadas de cotovelo giratório (Sok Klab)", "Sparring avançado de 5 rounds", "Postura, respeito e liderança no dojo"]',
                 5, 85.00, '/assets/prajied/prajied-5.png')
            `);
            await pool.query(`
                INSERT IGNORE INTO planos (id, nome, descricao, valor_mensal, periodicidade_meses, limite_checkins_semana, tolerancia_inadimplencia_dias, ativo) VALUES
                (1, 'Muay Thai Fitness & Fundamentos (2x/sem)', 'Ideal para condicionamento físico, queima calórica e defesa pessoal.', 159.90, 1, 2, 5, 1),
                (2, 'Muay Thai Total Kombat (Livre)', 'Acesso ilimitado às aulas técnicas, sparring monitorado e clinch.', 199.90, 1, NULL, 5, 1),
                (3, 'Muay Thai Black Belt Fighter (Anual)', 'Plano avançado anual com foco em graduação marcial contínua.', 139.90, 12, NULL, 5, 1)
            `);
            await pool.query(`
                INSERT IGNORE INTO planos_modalidades (plano_id, modalidade_id) VALUES
                (1, 1),
                (2, 1),
                (3, 1)
            `);
            await pool.query(`
                INSERT IGNORE INTO turmas (id, modalidade_id, professor_id, nome, dias_semana, horario_inicio, horario_fim, capacidade_maxima, ativo) VALUES
                (1, 1, 2, 'Muay Thai Matinal (Fundamentos)', 'SEG,QUA,SEX', '07:00:00', '08:15:00', 25, 1),
                (2, 1, 3, 'Muay Thai Almoço Express', 'TER,QUI', '12:00:00', '13:15:00', 20, 1),
                (3, 1, 2, 'Muay Thai Noturno Geral', 'SEG,TER,QUA,QUI', '19:00:00', '20:15:00', 30, 1),
                (4, 1, 3, 'Muay Thai Sparring & Clinch Avançado', 'SEX', '19:30:00', '21:00:00', 20, 1)
            `);
            console.log('🥋 [Bootstrap] Modalidade, graduações, planos e turmas iniciais criados.');
        }

        const [conqCount] = await pool.query('SELECT COUNT(*) AS total FROM conquistas');
        if (conqCount[0].total === 0) {
            await pool.query(`
                INSERT IGNORE INTO conquistas (id, codigo, titulo, descricao, icone, categoria, criterio_tipo, criterio_valor) VALUES
                (1, 'primeiro_treino', 'Primeiro Passo', 'Completou seu primeiro treino oficial no tatame.', '🥋', 'Início', 'checkins', 1),
                (2, 'guerreiro_10', 'Guerreiro Dedicado', 'Alcançou a marca de 10 treinos concluídos.', '🥊', 'Frequência', 'checkins', 10),
                (3, 'disciplina_ouro', 'Disciplina de Ferro', 'Completou mais de 30 treinos com assiduidade exemplar.', '🔥', 'Frequência', 'checkins', 30),
                (4, 'primeira_graduacao', 'Graduado de Honra', 'Aprovado na avaliação técnica e conquistou novo grau/faixa.', '🏆', 'Graduação', 'graduacao', 1),
                (5, 'forma_marcial', 'Condicionamento Pro', 'Registrou medidas físicas e manteve IMC e peso na meta marcial.', '⚡', 'Saúde & Foco', 'medidas', 1),
                (6, 'tatame_invicto', 'Constância Total', 'Manteve 100% de presença nas semanas do plano contratado.', '🥇', 'Constância', 'semanas', 4)
            `);
            console.log('🏆 [Bootstrap] Conquistas iniciais criadas.');
        }

        const { ensureUploadTable, syncUploadsOnBoot } = require('../services/uploadStorage');
        await ensureUploadTable();
        await syncUploadsOnBoot().catch((err) => {
            console.warn('⚠️ [UploadStorage] Aviso na sincronização de uploads:', err.message);
        });

        const { ensurePaymentLogsTable } = require('../services/paymentLogService');
        await ensurePaymentLogsTable();

        const { seedWiki } = require('./seed-wiki');
        await seedWiki().catch(() => {});

        console.log('✅ Schema do banco de dados sincronizado com sucesso!');
    } catch (err) {
        console.error('❌ Erro ao executar migrations:', err.message);
        process.exitCode = 1;
    } finally {
        if (require.main === module) {
            process.exit();
        }
    }
}

if (require.main === module) {
    runMigrations();
}

module.exports = { runMigrations };

