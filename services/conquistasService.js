/**
 * PRO COMBATE - Serviço de Domínio: Conquistas de Luta & Honrarias concedidas pelo Professor
 * Permite ao professor/admin conceder conquistas marciais manuais ao atleta
 * (ex: Primeira Luta, 6 Lutas Oficiais, 6 Vitórias Consecutivas) com exibição no Dossiê 360° e Portal do Aluno.
 */

const PROFESSOR_ACHIEVEMENT_PRESETS = [
    {
        codigo: 'primeira_luta',
        titulo: 'Primeira Luta',
        descricao: 'Realizou sua primeira luta oficial representando a equipe.',
        icone: '🥊',
        categoria: 'Lutas',
        cor_hex: '#f59e0b'
    },
    {
        codigo: 'tres_lutas',
        titulo: '3 Lutas Oficiais',
        descricao: 'Completou 3 lutas oficiais acumulando experiência no ringue.',
        icone: '🔥',
        categoria: 'Lutas',
        cor_hex: '#f97316'
    },
    {
        codigo: 'seis_lutas',
        titulo: '6 Lutas Oficiais',
        descricao: 'Alcançou a marca de 6 lutas oficiais no cartel.',
        icone: '⚔️',
        categoria: 'Lutas',
        cor_hex: '#ef4444'
    },
    {
        codigo: 'dez_lutas',
        titulo: '10 Lutas Oficiais',
        descricao: 'Veterano de ringue com 10 lutas oficiais disputadas.',
        icone: '🏆',
        categoria: 'Lutas',
        cor_hex: '#eab308'
    },
    {
        codigo: 'tres_vitorias_seguidas',
        titulo: '3 Vitórias Consecutivas',
        descricao: 'Conquistou uma sequência invicta de 3 vitórias seguidas.',
        icone: '⚡',
        categoria: 'Vitórias',
        cor_hex: '#10b981'
    },
    {
        codigo: 'seis_vitorias_seguidas',
        titulo: '6 Vitórias Consecutivas',
        descricao: 'Sequência dominante de 6 vitórias consecutivas no ringue.',
        icone: '👑',
        categoria: 'Vitórias',
        cor_hex: '#a855f7'
    },
    {
        codigo: 'vitoria_nocaute',
        titulo: 'Vitória por Nocaute / TKO',
        descricao: 'Venceu combate oficial por nocaute ou nocaute técnico.',
        icone: '💥',
        categoria: 'Vitórias',
        cor_hex: '#ef4444'
    },
    {
        codigo: 'campeao_torneio',
        titulo: 'Campeão de Campeonato',
        descricao: 'Subiu no topo do pódio conquistando título em competição oficial.',
        icone: '🥇',
        categoria: 'Campeonatos',
        cor_hex: '#fbbf24'
    }
];

const ALLOWED_CATEGORIES = ['Lutas', 'Vitórias', 'Campeonatos', 'Mérito no Tatame'];
const ALLOWED_ICONS = ['🥊', '🏆', '👑', '🔥', '⚡', '🥇', '💥', '⚔️', '🛡️', '⭐', '🥋', '🏅'];

let schemaPromise = null;

async function ensureProfessorAchievementsSchema(pool) {
    if (!pool) return;
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS aluno_conquistas_manuais (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                aluno_id BIGINT UNSIGNED NOT NULL,
                professor_id BIGINT UNSIGNED NULL,
                codigo_preset VARCHAR(60) NULL,
                titulo VARCHAR(100) NOT NULL,
                descricao VARCHAR(255) NOT NULL,
                icone VARCHAR(20) NOT NULL DEFAULT '🥊',
                categoria VARCHAR(40) NOT NULL DEFAULT 'Lutas',
                cor_hex VARCHAR(10) NOT NULL DEFAULT '#f59e0b',
                data_conquista DATE NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_acm_aluno_data (aluno_id, data_conquista DESC, id DESC),
                CONSTRAINT fk_acm_aluno FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
                CONSTRAINT fk_acm_prof FOREIGN KEY (professor_id) REFERENCES usuarios_equipe(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS conquistas_modelos_custom (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                titulo VARCHAR(100) NOT NULL,
                descricao VARCHAR(255) NOT NULL,
                icone VARCHAR(20) NOT NULL DEFAULT '🥊',
                categoria VARCHAR(40) NOT NULL DEFAULT 'Lutas',
                cor_hex VARCHAR(10) NOT NULL DEFAULT '#f59e0b',
                criado_por BIGINT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                CONSTRAINT fk_cmc_prof FOREIGN KEY (criado_por) REFERENCES usuarios_equipe(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    })().catch((err) => {
        schemaPromise = null;
        throw err;
    });

    return schemaPromise;
}

function validateProfessorAchievementPayload(body = {}) {
    const titulo = String(body.titulo || '').trim();
    if (titulo.length < 3 || titulo.length > 100) {
        return {
            valid: false,
            error: 'Informe um título válido para a conquista (entre 3 e 100 caracteres).'
        };
    }

    const descricao = String(body.descricao || '').trim();
    if (descricao.length < 3 || descricao.length > 255) {
        return {
            valid: false,
            error: 'Informe uma descrição válida para a conquista (entre 3 e 255 caracteres).'
        };
    }

    const rawCat = String(body.categoria || '').trim();
    const categoria = ALLOWED_CATEGORIES.includes(rawCat) ? rawCat : 'Lutas';

    const rawIcon = String(body.icone || '').trim();
    const icone = ALLOWED_ICONS.includes(rawIcon) ? rawIcon : '🥊';

    const rawColor = String(body.cor_hex || '').trim();
    const corHex = /^#[0-9A-Fa-f]{6}$/.test(rawColor) ? rawColor.toLowerCase() : '#f59e0b';

    let dataConquista = String(body.data_conquista || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataConquista)) {
        dataConquista = new Date().toISOString().split('T')[0];
    }

    let codigoPreset = null;
    if (body.codigo_preset !== undefined && body.codigo_preset !== null) {
        const rawCode = String(body.codigo_preset).trim().toLowerCase();
        if (/^[a-z0-9_]{1,60}$/.test(rawCode)) {
            codigoPreset = rawCode;
        }
    }

    return {
        valid: true,
        data: {
            codigo_preset: codigoPreset,
            titulo,
            descricao,
            icone,
            categoria,
            cor_hex: corHex,
            data_conquista: dataConquista
        }
    };
}

function formatDateIso(val) {
    if (!val) return null;
    if (val instanceof Date && !isNaN(val.getTime())) {
        return val.toISOString().split('T')[0];
    }
    const str = String(val).trim();
    const m = str.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : str;
}

function normalizeProfessorAchievementRow(row = {}) {
    return {
        id: Number(row.id) || null,
        aluno_id: Number(row.aluno_id) || null,
        professor_id: row.professor_id ? Number(row.professor_id) : null,
        codigo_preset: row.codigo_preset || null,
        titulo: String(row.titulo || '').trim(),
        descricao: String(row.descricao || '').trim(),
        icone: ALLOWED_ICONS.includes(String(row.icone || '').trim()) ? String(row.icone).trim() : '🥊',
        categoria: ALLOWED_CATEGORIES.includes(String(row.categoria || '').trim()) ? String(row.categoria).trim() : 'Lutas',
        cor_hex: /^#[0-9A-Fa-f]{6}$/.test(String(row.cor_hex || '').trim()) ? String(row.cor_hex).trim() : '#f59e0b',
        data_conquista: formatDateIso(row.data_conquista),
        professor_nome: row.professor_nome ? String(row.professor_nome).trim() : 'Não Informado',
        origem: 'professor',
        desbloqueada: true
    };
}

function validateCustomTemplatePayload(body = {}) {
    const base = validateProfessorAchievementPayload(body);
    if (!base.valid) return base;
    const { titulo, descricao, icone, categoria, cor_hex } = base.data;
    return {
        valid: true,
        data: { titulo, descricao, icone, categoria, cor_hex }
    };
}

function normalizeCustomTemplateRow(row = {}) {
    const idNum = Number(row.id) || null;
    return {
        id: idNum,
        codigo: idNum ? `custom_${idNum}` : null,
        titulo: String(row.titulo || '').trim(),
        descricao: String(row.descricao || '').trim(),
        icone: ALLOWED_ICONS.includes(String(row.icone || '').trim()) ? String(row.icone).trim() : '🥊',
        categoria: ALLOWED_CATEGORIES.includes(String(row.categoria || '').trim()) ? String(row.categoria).trim() : 'Lutas',
        cor_hex: /^#[0-9A-Fa-f]{6}$/.test(String(row.cor_hex || '').trim()) ? String(row.cor_hex).trim() : '#f59e0b',
        custom: true
    };
}

module.exports = {
    PROFESSOR_ACHIEVEMENT_PRESETS,
    ALLOWED_CATEGORIES,
    ALLOWED_ICONS,
    ensureProfessorAchievementsSchema,
    validateProfessorAchievementPayload,
    normalizeProfessorAchievementRow,
    validateCustomTemplatePayload,
    normalizeCustomTemplateRow
};
