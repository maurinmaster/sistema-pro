const pool = require('../db/connection');
const emailService = require('./emailService');
const whatsappService = require('./whatsappService');

const DEFAULT_PORTAL_URL = 'https://gestor.procombate.com';
const CACHE_TTL_MS = 30000;

const EVENT_CATALOG = [
    {
        key: 'novo_cadastro_aluno',
        categoria: 'Cadastro & Acesso',
        titulo: 'Novo Cadastro de Aluno',
        descricao: 'Enviado quando um novo aluno realiza auto-cadastro ou é cadastrado pela administração.',
        supportsAluno: true,
        supportsAdmin: true,
        variaveis: ['{nome}', '{email}', '{telefone}', '{link}'],
        defaults: {
            aluno_whatsapp: true,
            aluno_email: false,
            admin_whatsapp: true,
            admin_email: true,
            incluir_link: true,
            mensagem_aluno: '🥋 *PRO COMBATE — Bem-vindo(a)!*\n\nOlá, *{nome}*!\nSeu cadastro foi realizado com sucesso em nossa academia.\n• *E-mail de acesso:* {email}\n\nAcesse seu Portal do Aluno pelo link abaixo: {link}',
            mensagem_admin: '🆕 *Novo Cadastro de Aluno*\n\n• *Aluno:* {nome}\n• *E-mail:* {email}\n• *WhatsApp:* {telefone}\n\nGerencie o cadastro no painel administrativo: {link}'
        }
    },
    {
        key: 'matricula_confirmada',
        categoria: 'Matrículas & Status',
        titulo: 'Matrícula Confirmada',
        descricao: 'Disparado quando uma matrícula em plano é criada ou renovada para o aluno.',
        supportsAluno: true,
        supportsAdmin: true,
        variaveis: ['{nome}', '{dia_vencimento}', '{link}'],
        defaults: {
            aluno_whatsapp: true,
            aluno_email: true,
            admin_whatsapp: true,
            admin_email: false,
            incluir_link: true,
            mensagem_aluno: '🥋 *PRO COMBATE — Inscrição / Matrícula Confirmada*\n\nOlá, *{nome}*!\nSua matrícula foi confirmada com sucesso no sistema. Seja bem-vindo(a) aos treinos!\n• *Vencimento:* Todo dia {dia_vencimento}\n\nAcompanhe suas faturas e evolução no Portal do Aluno.',
            mensagem_admin: '📋 *Nova Matrícula Registrada*\n\n• *Aluno:* {nome}\n• *Dia de Vencimento:* {dia_vencimento}'
        }
    },
    {
        key: 'status_matricula_alterado',
        categoria: 'Matrículas & Status',
        titulo: 'Alteração de Status / Plano',
        descricao: 'Disparado ao trancar, destrancar, cancelar, trocar plano ou alterar o status cadastral do aluno.',
        supportsAluno: true,
        supportsAdmin: false,
        variaveis: ['{nome}', '{status}', '{detalhe}', '{link}'],
        defaults: {
            aluno_whatsapp: true,
            aluno_email: true,
            admin_whatsapp: false,
            admin_email: false,
            incluir_link: true,
            mensagem_aluno: '📌 *PRO COMBATE — Atualização Cadastral*\n\nOlá, *{nome}*!\nInformamos que houve uma atualização na sua matrícula/status:\n• *Situação:* {status}\n• *Detalhes:* {detalhe}',
            mensagem_admin: ''
        }
    },
    {
        key: 'pagamento_mensalidade',
        categoria: 'Financeiro',
        titulo: 'Pagamento de Mensalidade Confirmado',
        descricao: 'Disparado quando uma mensalidade é quitada manualmente, via cartão ou webhook Asaas.',
        supportsAluno: true,
        supportsAdmin: true,
        variaveis: ['{nome}', '{valor}', '{metodo}', '{link}'],
        defaults: {
            aluno_whatsapp: true,
            aluno_email: true,
            admin_whatsapp: true,
            admin_email: false,
            incluir_link: true,
            mensagem_aluno: '✅ *PRO COMBATE — Pagamento Confirmado*\n\nOlá, *{nome}*!\nConfirmamos o recebimento da sua mensalidade:\n• *Valor:* {valor}\n• *Forma:* {metodo}\n\nObrigado e bons treinos! 🥊',
            mensagem_admin: '💰 *Pagamento de Mensalidade Recebido*\n\n• *Aluno:* {nome}\n• *Valor:* {valor}\n• *Método:* {metodo}'
        }
    },
    {
        key: 'avaliacao_graduacao',
        categoria: 'Avaliações & Evolução',
        titulo: 'Atualização na Avaliação de Graduação',
        descricao: 'Disparado quando o professor atualiza os critérios e aproveitamento de exame do aluno.',
        supportsAluno: true,
        supportsAdmin: false,
        variaveis: ['{nome}', '{percentual}', '{minimo}', '{status}', '{observacoes}', '{link}'],
        defaults: {
            aluno_whatsapp: true,
            aluno_email: true,
            admin_whatsapp: false,
            admin_email: false,
            incluir_link: true,
            mensagem_aluno: '🥋 *PRO COMBATE — Avaliação Atualizada*\n\nOlá, *{nome}*!\nSua avaliação de graduação foi atualizada:\n• *Aproveitamento:* {percentual}%\n• *Mínimo Exigido:* {minimo}%\n• *Status:* {status}\n{observacoes}',
            mensagem_admin: ''
        }
    },
    {
        key: 'avaliacao_desempenho',
        categoria: 'Avaliações & Evolução',
        titulo: 'Nova Avaliação Técnica RPG (Muay Thai)',
        descricao: 'Disparado quando o instrutor registra uma Avaliação Técnica Gamificada (RPG) com Rank, 5 atributos e status de sparring.',
        supportsAluno: true,
        supportsAdmin: false,
        variaveis: ['{nome}', '{rank}', '{rank_titulo}', '{score_total}', '{apto_sparring}', '{inteligencia}', '{destreza}', '{agilidade}', '{forca}', '{vitalidade}', '{observacoes}', '{link}'],
        defaults: {
            aluno_whatsapp: true,
            aluno_email: true,
            admin_whatsapp: false,
            admin_email: false,
            incluir_link: true,
            mensagem_aluno: '🥋 *PRO COMBATE — Avaliação Técnica RPG*\n\nOlá, *{nome}*!\nSeu instrutor registrou sua nova ficha de combate:\n🏆 *Rank {rank}* ({rank_titulo}) — *{score_total}/100 pts*\n🥊 *Sparring:* {apto_sparring}\n• *Inteligência:* {inteligencia}/20\n• *Destreza:* {destreza}/20\n• *Agilidade:* {agilidade}/20\n• *Força:* {forca}/20\n• *Vitalidade:* {vitalidade}/20\n{observacoes}',
            mensagem_admin: ''
        }
    },
    {
        key: 'promocao_graduacao',
        categoria: 'Avaliações & Evolução',
        titulo: 'Promoção de Graduação / Faixa',
        descricao: 'Disparado quando o aluno é promovido para uma nova faixa ou prajied.',
        supportsAluno: true,
        supportsAdmin: true,
        variaveis: ['{nome}', '{graduacao}', '{link}'],
        defaults: {
            aluno_whatsapp: true,
            aluno_email: true,
            admin_whatsapp: true,
            admin_email: false,
            incluir_link: true,
            mensagem_aluno: '🏆 *PRO COMBATE — Nova Graduação Conquistada!*\n\nParabéns, *{nome}*!\nSua dedicação nos treinos deu resultado e você avançou para:\n• *Nova Graduação:* {graduacao}\n\nContinue treinando firme! 🥋',
            mensagem_admin: '🏆 *Promoção de Graduação*\n\n• *Aluno:* {nome}\n• *Nova Graduação:* {graduacao}'
        }
    },
    {
        key: 'conquista_desbloqueada',
        categoria: 'Avaliações & Evolução',
        titulo: 'Nova Conquista de Luta / Honraria',
        descricao: 'Disparado automaticamente quando o aluno ganha uma conquista do professor (ex: Primeira Luta, 6 Lutas) ou desbloqueia nova insígnia RPG.',
        supportsAluno: true,
        supportsAdmin: true,
        variaveis: ['{nome}', '{conquista}', '{categoria}', '{descricao}', '{professor}', '{data}', '{link}'],
        defaults: {
            aluno_whatsapp: true,
            aluno_email: true,
            admin_whatsapp: false,
            admin_email: false,
            incluir_link: true,
            mensagem_aluno: '🏅 *PRO COMBATE — Nova Conquista Desbloqueada!*\n\nParabéns, *{nome}*!\nVocê acaba de conquistar:\n• *Conquista:* {conquista}\n• *Categoria:* {categoria}\n• *Feito:* {descricao}\n• *Concedida por:* {professor} em {data}\n\nConfira no seu quadro de conquistas do Portal do Aluno!',
            mensagem_admin: '🏅 *Nova Conquista Registrada*\n\n• *Aluno:* {nome}\n• *Conquista:* {conquista} ({categoria})\n• *Professor:* {professor}'
        }
    },
    {
        key: 'convite_exame',
        categoria: 'Exames de Graduação',
        titulo: 'Convite Oficial para Exame',
        descricao: 'Disparado ao convocar alunos elegíveis para um Exame de Graduação.',
        supportsAluno: true,
        supportsAdmin: false,
        variaveis: ['{nome}', '{evento}', '{data}', '{horario}', '{local}', '{link}'],
        defaults: {
            aluno_whatsapp: true,
            aluno_email: true,
            admin_whatsapp: false,
            admin_email: false,
            incluir_link: true,
            mensagem_aluno: '📣 *PRO COMBATE — Convocação de Exame*\n\nOlá, *{nome}*!\nParabéns! Você foi convocado(a) para o exame *{evento}*:\n• *Data:* {data}\n• *Horário:* {horario}\n• *Local:* {local}\n\nAcesse o Portal do Aluno para confirmar sua inscrição.',
            mensagem_admin: ''
        }
    },
    {
        key: 'inscricao_exame',
        categoria: 'Exames de Graduação',
        titulo: 'Inscrição em Exame Registrada',
        descricao: 'Disparado quando o aluno aceita o convite ou se inscreve em um exame.',
        supportsAluno: true,
        supportsAdmin: true,
        variaveis: ['{nome}', '{evento}', '{valor}', '{link}'],
        defaults: {
            aluno_whatsapp: true,
            aluno_email: true,
            admin_whatsapp: true,
            admin_email: false,
            incluir_link: true,
            mensagem_aluno: '🥋 *PRO COMBATE — Inscrição no Exame Registrada*\n\nOlá, *{nome}*!\nSua inscrição no exame *{evento}* foi registrada (taxa: {valor}).\nConclua o pagamento no Portal do Aluno para garantir sua vaga!',
            mensagem_admin: '📝 *Nova Inscrição em Exame*\n\n• *Aluno:* {nome}\n• *Exame:* {evento}\n• *Taxa:* {valor}'
        }
    },
    {
        key: 'recusa_exame',
        categoria: 'Exames de Graduação',
        titulo: 'Recusa de Convite de Exame',
        descricao: 'Alerta para a administração quando um aluno informa que não poderá participar do exame.',
        supportsAluno: false,
        supportsAdmin: true,
        variaveis: ['{nome}', '{evento}', '{motivo}', '{link}'],
        defaults: {
            aluno_whatsapp: false,
            aluno_email: false,
            admin_whatsapp: true,
            admin_email: true,
            incluir_link: true,
            mensagem_aluno: '',
            mensagem_admin: '⚠️ *Recusa de Convite de Exame*\n\n• *Aluno:* {nome}\n• *Exame:* {evento}\n• *Motivo:* {motivo}'
        }
    },
    {
        key: 'pagamento_exame',
        categoria: 'Exames de Graduação',
        titulo: 'Pagamento de Exame Confirmado',
        descricao: 'Disparado na confirmação manual, cartão ou compensação Asaas da taxa de exame.',
        supportsAluno: true,
        supportsAdmin: true,
        variaveis: ['{nome}', '{evento}', '{valor}', '{metodo}', '{link}'],
        defaults: {
            aluno_whatsapp: true,
            aluno_email: true,
            admin_whatsapp: true,
            admin_email: false,
            incluir_link: true,
            mensagem_aluno: '✅ *PRO COMBATE — Pagamento de Exame Confirmado*\n\nOlá, *{nome}*!\nConfirmamos o pagamento de *{valor}* ({metodo}) para o exame *{evento}*.\n\nSua vaga está garantida! Bons treinos! 🥋',
            mensagem_admin: '💰 *Taxa de Exame Paga*\n\n• *Aluno:* {nome}\n• *Exame:* {evento}\n• *Valor:* {valor}\n• *Método:* {metodo}'
        }
    },
    {
        key: 'senha_redefinida_admin',
        categoria: 'Cadastro & Acesso',
        titulo: 'Senha Redefinida pela Administração',
        descricao: 'Aviso de segurança enviado quando a administração redefine a senha de acesso do aluno.',
        supportsAluno: true,
        supportsAdmin: false,
        variaveis: ['{nome}', '{email}', '{link}'],
        defaults: {
            aluno_whatsapp: true,
            aluno_email: true,
            admin_whatsapp: false,
            admin_email: false,
            incluir_link: true,
            mensagem_aluno: '🔐 *PRO COMBATE — Senha Atualizada*\n\nOlá, *{nome}*!\nSua senha de acesso ao Portal do Aluno ({email}) foi redefinida pela administração.\nCaso necessário, acesse o portal pelo link abaixo ou entre em contato com a recepção.',
            mensagem_admin: ''
        }
    }
];

const MANUAL_PRESETS = [
    {
        id: 'link_portal',
        nome: 'Link de Acesso ao Sistema (gestor.procombate.com)',
        titulo: 'Acesso ao Portal do Aluno PRO COMBATE',
        incluir_link: true,
        mensagem: '🥋 *PRO COMBATE — Portal do Aluno*\n\nOlá, *{nome}*!\nAcesse nosso sistema oficial para conferir seus treinos, frequência, graduações, faturas e avaliações pelo link abaixo:\n{link}'
    },
    {
        id: 'boas_vindas',
        nome: 'Boas-vindas à Academia PRO COMBATE',
        titulo: 'Bem-vindo(a) à Família PRO COMBATE!',
        incluir_link: true,
        mensagem: '🔥 *Bem-vindo(a) ao PRO COMBATE, {nome}!*\n\nEstamos muito felizes em ter você treinando com a gente! Qualquer dúvida sobre horários, equipamentos ou graduações, conte com nossa equipe.\n\nAcesse seu portal: {link}'
    },
    {
        id: 'lembrete_treino',
        nome: 'Lembrete de Treino / Motivacional',
        titulo: 'Hora de Voltar aos Treinos!',
        incluir_link: true,
        mensagem: '🥊 *PRO COMBATE — Bora treinar, {nome}?*\n\nSentimos sua falta no tatame! A constância faz toda a diferença na sua evolução e preparação para a próxima graduação.\n\nConfira sua frequência no portal: {link}'
    },
    {
        id: 'aviso_feriado',
        nome: 'Aviso de Feriado / Alteração de Horário',
        titulo: 'Comunicado Importante de Horários',
        incluir_link: true,
        mensagem: '📅 *PRO COMBATE — Comunicado de Horários*\n\nOlá, *{nome}*!\nInformamos que neste feriado teremos horário especial de funcionamento. Confira os avisos atualizados no Portal do Aluno.\n\nAcesse: {link}'
    },
    {
        id: 'lembrete_mensalidade',
        nome: 'Lembrete Amigável de Mensalidade',
        titulo: 'Lembrete de Mensalidade',
        incluir_link: true,
        mensagem: '💳 *PRO COMBATE — Lembrete Financeiro*\n\nOlá, *{nome}*!\nPassando para lembrar que sua mensalidade já está disponível para pagamento via PIX ou Cartão diretamente no Portal do Aluno.\n\nAcesse com segurança: {link}'
    },
    {
        id: 'convite_evento',
        nome: 'Convite para Exame / Seminário / Evento',
        titulo: 'Convite Especial PRO COMBATE',
        incluir_link: true,
        mensagem: '🏆 *PRO COMBATE — Evento Especial*\n\nOlá, *{nome}*!\nTeremos um evento especial na academia e sua presença é muito importante. Acesse o portal para conferir todas as informações e garantir sua participação!\n\nConfira aqui: {link}'
    },
    {
        id: 'parabens_conquista',
        nome: 'Parabéns por Nova Conquista / Luta',
        titulo: 'Nova Conquista no PRO COMBATE!',
        incluir_link: true,
        mensagem: '🥊 *PRO COMBATE — Parabéns pela Conquista, {nome}!*\n\nSeu esforço dentro e fora do ringue foi reconhecido! Confira sua nova conquista no seu Portal do Aluno:\n{link}'
    }
];

const EVENT_MAP = new Map(EVENT_CATALOG.map(item => [item.key, item]));

class NotificationConfigService {
    constructor() {
        this.tableChecked = false;
        this.cache = null;
        this.cacheAt = 0;
    }

    getCatalog() {
        return EVENT_CATALOG;
    }

    getManualPresets() {
        return MANUAL_PRESETS;
    }

    buildDefaultConfig() {
        const regras = {};
        for (const ev of EVENT_CATALOG) {
            regras[ev.key] = { ...ev.defaults };
        }
        return {
            portal_url: DEFAULT_PORTAL_URL,
            incluir_link_padrao: true,
            admin_whatsapp: '',
            admin_email: '',
            regras
        };
    }

    sanitizePortalUrl(rawUrl) {
        if (typeof rawUrl !== 'string') return DEFAULT_PORTAL_URL;
        const trimmed = rawUrl.trim();
        if (!trimmed || trimmed.length > 255 || !/^https?:\/\/[^\s<>"']+$/i.test(trimmed)) {
            return DEFAULT_PORTAL_URL;
        }
        return trimmed.replace(/\/+$/, '');
    }

    validateAndNormalizeConfig(payload = {}, currentConfig = null) {
        const base = currentConfig ? JSON.parse(JSON.stringify(currentConfig)) : this.buildDefaultConfig();

        const portalUrl = payload.portal_url !== undefined
            ? this.sanitizePortalUrl(payload.portal_url)
            : this.sanitizePortalUrl(base.portal_url);

        const incluirLinkPadrao = payload.incluir_link_padrao !== undefined
            ? Boolean(payload.incluir_link_padrao && payload.incluir_link_padrao !== '0' && payload.incluir_link_padrao !== 'false')
            : Boolean(base.incluir_link_padrao);

        const adminWhatsapp = payload.admin_whatsapp !== undefined
            ? String(payload.admin_whatsapp || '').trim().slice(0, 255)
            : String(base.admin_whatsapp || '').trim().slice(0, 255);

        const adminEmail = payload.admin_email !== undefined
            ? String(payload.admin_email || '').trim().slice(0, 255)
            : String(base.admin_email || '').trim().slice(0, 255);

        const incomingRegras = payload.regras && typeof payload.regras === 'object' ? payload.regras : {};
        const regras = {};

        for (const ev of EVENT_CATALOG) {
            const cur = (base.regras && base.regras[ev.key]) || ev.defaults;
            const inc = (incomingRegras[ev.key] && typeof incomingRegras[ev.key] === 'object') ? incomingRegras[ev.key] : {};

            const toBool = (val, fallback) => {
                if (val === undefined) return Boolean(fallback);
                return Boolean(val && val !== '0' && val !== 'false');
            };

            const sanitizeText = (val, fallback) => {
                if (val === undefined || val === null) return String(fallback || '');
                return String(val).slice(0, 2500);
            };

            regras[ev.key] = {
                aluno_whatsapp: ev.supportsAluno ? toBool(inc.aluno_whatsapp, cur.aluno_whatsapp) : false,
                aluno_email: ev.supportsAluno ? toBool(inc.aluno_email, cur.aluno_email) : false,
                admin_whatsapp: ev.supportsAdmin ? toBool(inc.admin_whatsapp, cur.admin_whatsapp) : false,
                admin_email: ev.supportsAdmin ? toBool(inc.admin_email, cur.admin_email) : false,
                incluir_link: toBool(inc.incluir_link, cur.incluir_link),
                mensagem_aluno: ev.supportsAluno ? sanitizeText(inc.mensagem_aluno, cur.mensagem_aluno) : '',
                mensagem_admin: ev.supportsAdmin ? sanitizeText(inc.mensagem_admin, cur.mensagem_admin) : ''
            };
        }

        return {
            portal_url: portalUrl,
            incluir_link_padrao: incluirLinkPadrao,
            admin_whatsapp: adminWhatsapp,
            admin_email: adminEmail,
            regras
        };
    }

    async ensureTable() {
        if (this.tableChecked) return;
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
        this.tableChecked = true;
    }

    async getConfig() {
        if (this.cache && (Date.now() - this.cacheAt) < CACHE_TTL_MS) {
            return this.cache;
        }

        try {
            await this.ensureTable();
            const [rows] = await pool.query('SELECT * FROM configuracoes_mensagens WHERE id = 1 LIMIT 1');
            if (rows.length === 0) {
                const def = this.buildDefaultConfig();
                this.cache = def;
                this.cacheAt = Date.now();
                return def;
            }

            const row = rows[0];
            let parsedRegras = {};
            try {
                parsedRegras = typeof row.regras_json === 'string' ? JSON.parse(row.regras_json) : (row.regras_json || {});
            } catch {
                parsedRegras = {};
            }

            const merged = this.validateAndNormalizeConfig({
                portal_url: row.portal_url,
                incluir_link_padrao: Boolean(row.incluir_link_padrao),
                admin_whatsapp: row.admin_whatsapp || '',
                admin_email: row.admin_email || '',
                regras: parsedRegras
            });

            this.cache = merged;
            this.cacheAt = Date.now();
            return merged;
        } catch (err) {
            console.warn('[NotificationConfig] Usando configuração padrão (banco indisponível):', err.message);
            return this.buildDefaultConfig();
        }
    }

    async saveConfig(payload) {
        await this.ensureTable();
        const current = await this.getConfig();
        const normalized = this.validateAndNormalizeConfig(payload, current);

        await pool.query(`
            INSERT INTO configuracoes_mensagens (
                id, portal_url, incluir_link_padrao, admin_whatsapp, admin_email, regras_json
            ) VALUES (1, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                portal_url = VALUES(portal_url),
                incluir_link_padrao = VALUES(incluir_link_padrao),
                admin_whatsapp = VALUES(admin_whatsapp),
                admin_email = VALUES(admin_email),
                regras_json = VALUES(regras_json)
        `, [
            normalized.portal_url,
            normalized.incluir_link_padrao ? 1 : 0,
            normalized.admin_whatsapp || null,
            normalized.admin_email || null,
            JSON.stringify(normalized.regras)
        ]);

        this.cache = normalized;
        this.cacheAt = Date.now();
        return normalized;
    }

    async resetConfig(eventKey = null) {
        const current = await this.getConfig();
        const defaults = this.buildDefaultConfig();

        if (eventKey && EVENT_MAP.has(eventKey)) {
            const nextPayload = {
                ...current,
                regras: {
                    ...current.regras,
                    [eventKey]: { ...defaults.regras[eventKey] }
                }
            };
            return await this.saveConfig(nextPayload);
        }

        return await this.saveConfig({
            portal_url: defaults.portal_url,
            incluir_link_padrao: defaults.incluir_link_padrao,
            admin_whatsapp: current.admin_whatsapp || '',
            admin_email: current.admin_email || '',
            regras: defaults.regras
        });
    }

    parseRecipientList(rawStr) {
        if (!rawStr || typeof rawStr !== 'string') return [];
        const items = rawStr
            .split(/[,;\n]+/)
            .map(s => s.trim())
            .filter(Boolean);
        return [...new Set(items)];
    }

    renderTemplate(template, variables = {}, { includeLink = true, portalUrl = DEFAULT_PORTAL_URL } = {}) {
        let text = typeof template === 'string' ? template : '';
        const safeUrl = this.sanitizePortalUrl(portalUrl);

        for (const [key, rawVal] of Object.entries(variables || {})) {
            if (key === 'link') continue;
            const val = rawVal === null || rawVal === undefined ? '' : String(rawVal);
            text = text.split(`{${key}}`).join(val);
        }

        const hasLinkPlaceholder = text.includes('{link}');
        if (includeLink) {
            if (hasLinkPlaceholder) {
                text = text.split('{link}').join(safeUrl);
            } else {
                text = `${text.trimEnd()}\n\n🔗 Acesse o sistema: ${safeUrl}`;
            }
        } else {
            text = text.split('{link}').join('');
        }

        return text
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    stripWhatsAppFormatting(text) {
        if (!text) return '';
        return String(text).replace(/\*([^*\n]+)\*/g, '$1');
    }

    async dispatchEvent(eventKey, context = {}) {
        try {
            const eventMeta = EVENT_MAP.get(eventKey);
            if (!eventMeta) return;

            const config = await this.getConfig();
            const rule = config.regras?.[eventKey] || eventMeta.defaults;
            const portalUrl = config.portal_url || DEFAULT_PORTAL_URL;
            const includeLink = Boolean(config.incluir_link_padrao && rule.incluir_link);

            let aluno = context.aluno || null;
            if (!aluno && context.alunoId) {
                try {
                    await whatsappService.ensureWhatsAppColumn();
                    const [rows] = await pool.query(
                        'SELECT id, nome_completo, email, telefone_whatsapp, COALESCE(receber_whatsapp, 1) AS receber_whatsapp FROM alunos WHERE id = ? AND deleted_at IS NULL LIMIT 1',
                        [context.alunoId]
                    );
                    if (rows.length > 0) {
                        aluno = rows[0];
                    }
                } catch (err) {
                    console.warn('[NotificationConfig] Erro ao buscar aluno para disparo:', err.message);
                }
            }

            const primeiroNome = aluno?.nome_completo
                ? String(aluno.nome_completo).trim().split(/\s+/)[0]
                : (context.variables?.nome ? String(context.variables.nome).trim().split(/\s+/)[0] : 'Atleta');

            const baseVars = {
                nome: primeiroNome,
                nome_completo: aluno?.nome_completo || context.variables?.nome || 'Atleta',
                email: aluno?.email || context.variables?.email || '',
                telefone: aluno?.telefone_whatsapp || context.variables?.telefone || '',
                ...(context.variables || {})
            };

            const tarefas = [];

            // 1. Envios para o Aluno
            if (eventMeta.supportsAluno && aluno) {
                const msgAluno = this.renderTemplate(rule.mensagem_aluno || eventMeta.defaults.mensagem_aluno, baseVars, {
                    includeLink,
                    portalUrl
                });

                if (rule.aluno_whatsapp && context.alunoId) {
                    tarefas.push(whatsappService.notifyAluno(context.alunoId, msgAluno));
                }

                if (rule.aluno_email && aluno.email && String(aluno.email).includes('@')) {
                    tarefas.push(emailService.sendNotificationEmail({
                        toEmail: aluno.email,
                        nomeDestinatario: aluno.nome_completo,
                        badgeText: eventMeta.categoria.toUpperCase(),
                        titulo: eventMeta.titulo,
                        assunto: `${eventMeta.titulo} — PRO COMBATE`,
                        mensagem: this.stripWhatsAppFormatting(msgAluno),
                        detalhes: context.detalhes || [],
                        ctaLabel: includeLink ? 'Acessar gestor.procombate.com' : '',
                        ctaUrl: includeLink ? portalUrl : ''
                    }));
                }
            }

            // 2. Envios para o Admin
            if (eventMeta.supportsAdmin) {
                const adminVars = {
                    ...baseVars,
                    nome: aluno?.nome_completo || context.variables?.nome || 'Atleta'
                };
                const msgAdmin = this.renderTemplate(rule.mensagem_admin || eventMeta.defaults.mensagem_admin, adminVars, {
                    includeLink,
                    portalUrl
                });

                if (rule.admin_whatsapp) {
                    const adminPhones = this.parseRecipientList(config.admin_whatsapp);
                    for (const phone of adminPhones) {
                        tarefas.push(whatsappService.sendTextMessage(phone, msgAdmin));
                    }
                }

                if (rule.admin_email) {
                    const adminEmails = this.parseRecipientList(config.admin_email);
                    for (const adminMail of adminEmails) {
                        if (!adminMail.includes('@')) continue;
                        tarefas.push(emailService.sendNotificationEmail({
                            toEmail: adminMail,
                            nomeDestinatario: 'Administrador',
                            badgeText: 'ALERTA ADMIN',
                            titulo: `[Admin] ${eventMeta.titulo}`,
                            assunto: `[PRO COMBATE Admin] ${eventMeta.titulo}`,
                            mensagem: this.stripWhatsAppFormatting(msgAdmin),
                            detalhes: context.detalhes || [],
                            ctaLabel: includeLink ? 'Abrir Painel Admin' : '',
                            ctaUrl: includeLink ? `${portalUrl.replace(/\/+$/, '')}/admin` : ''
                        }));
                    }
                }
            }

            if (tarefas.length > 0) {
                Promise.allSettled(tarefas).catch(() => {});
            }
        } catch (err) {
            console.warn(`[NotificationConfig] Falha ao disparar evento ${eventKey}:`, err.message);
        }
    }
}

const notificationConfigServiceInstance = new NotificationConfigService();
module.exports = notificationConfigServiceInstance;
