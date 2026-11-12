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

async function runMigrations() {
    console.log('🔄 Verificando integridade e migrations do banco de dados...');
    try {
        await ensureColumn('matriculas', 'motivo_cancelamento_trancamento', 'VARCHAR(255) NULL AFTER desconto_motivo');
        await ensureColumn('matriculas', 'data_retorno_prevista', 'DATE NULL AFTER motivo_cancelamento_trancamento');

        // Colunas de especificações e requisitos em graduacoes_niveis
        await ensureColumn('graduacoes_niveis', 'requisitos_lista_json', 'JSON NULL');
        await ensureColumn('graduacoes_niveis', 'total_itens', 'INT UNSIGNED NOT NULL DEFAULT 0');
        await ensureColumn('wiki_golpes', 'imagem_capa', 'VARCHAR(255) NULL AFTER descricao_geral');
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

        // 6. Colunas de Medidas Físicas e Skin do Atleta na tabela alunos (Conforme Print do Painel)
        await ensureColumn('alunos', 'peso_kg', 'DECIMAL(5,2) NULL DEFAULT 72.00');
        await ensureColumn('alunos', 'altura_cm', 'INT UNSIGNED NULL DEFAULT 170');
        await ensureColumn('alunos', 'torax_cm', 'DECIMAL(5,2) NULL DEFAULT 98.00');
        await ensureColumn('alunos', 'cintura_cm', 'DECIMAL(5,2) NULL DEFAULT 82.00');
        await ensureColumn('alunos', 'quadril_cm', 'DECIMAL(5,2) NULL DEFAULT 96.00');
        await ensureColumn('alunos', 'skin_fighter', "VARCHAR(100) NULL DEFAULT 'mt-skin-1.jpg'");
        await ensureColumn('alunos', 'avatar_tom', "VARCHAR(20) NULL DEFAULT 'branca'");
        await ensureColumn('alunos', 'avatar_cabelo', "VARCHAR(100) NULL DEFAULT 'cabelo-homem-1.png'");

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
                local_evento VARCHAR(200) NULL DEFAULT 'Dojo Central - Kaizen CT',
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

