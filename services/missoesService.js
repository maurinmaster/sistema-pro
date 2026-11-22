/**
 * PRO COMBATE - Domínio de Missões (Missões Automáticas + Quadro de Missões do Professor)
 */
const MISSAO_CATEGORIAS = ['tecnica', 'sparring', 'clinch', 'condicionamento', 'frequencia', 'disciplina'];
const MISSAO_DIFICULDADES = ['facil', 'media', 'dificil', 'epica'];
const MISSAO_PILARES = ['inteligencia', 'destreza', 'agilidade', 'forca', 'vitalidade'];
const MAX_MISSOES_ATIVAS_ALUNO = 3;

const DIFICULDADE_LABELS = {
    facil: 'Fácil',
    media: 'Média',
    dificil: 'Difícil',
    epica: 'Épica'
};

const CATEGORIA_LABELS = {
    tecnica: 'Técnica',
    sparring: 'Sparring',
    clinch: 'Clinch',
    condicionamento: 'Condicionamento',
    frequencia: 'Frequência',
    disciplina: 'Disciplina'
};

/**
 * Valida e sanitiza o payload de criação/edição de uma missão do quadro do professor.
 */
function validateMissaoPayload(body = {}) {
    const titulo = typeof body.titulo === 'string' ? body.titulo.trim() : '';
    if (titulo.length < 3 || titulo.length > 140) {
        return { valid: false, error: 'O título da missão deve ter entre 3 e 140 caracteres.' };
    }

    const descricao = typeof body.descricao === 'string' ? body.descricao.trim() : '';
    if (descricao.length < 5 || descricao.length > 1000) {
        return { valid: false, error: 'A descrição da missão deve ter entre 5 e 1000 caracteres.' };
    }

    const categoria = body.categoria ? String(body.categoria).trim().toLowerCase() : 'tecnica';
    if (!MISSAO_CATEGORIAS.includes(categoria)) {
        return { valid: false, error: 'Categoria de missão inválida.' };
    }

    const dificuldade = body.dificuldade ? String(body.dificuldade).trim().toLowerCase() : 'media';
    if (!MISSAO_DIFICULDADES.includes(dificuldade)) {
        return { valid: false, error: 'Dificuldade de missão inválida.' };
    }

    let pilarFoco = null;
    if (body.pilar_foco !== undefined && body.pilar_foco !== null && String(body.pilar_foco).trim() !== '') {
        const cleanPilar = String(body.pilar_foco).trim().toLowerCase();
        if (!MISSAO_PILARES.includes(cleanPilar)) {
            return { valid: false, error: 'Pilar de foco RPG inválido.' };
        }
        pilarFoco = cleanPilar;
    }

    let modalidadeId = null;
    if (body.modalidade_id !== undefined && body.modalidade_id !== null && String(body.modalidade_id).trim() !== '') {
        const parsedMod = Number(body.modalidade_id);
        if (!Number.isInteger(parsedMod) || parsedMod <= 0) {
            return { valid: false, error: 'Modalidade selecionada é inválida.' };
        }
        modalidadeId = parsedMod;
    }

    const rawXp = (body.recompensa_xp === undefined || body.recompensa_xp === null || body.recompensa_xp === '')
        ? 50
        : Number(body.recompensa_xp);
    if (!Number.isInteger(rawXp) || rawXp < 0 || rawXp > 5000) {
        return { valid: false, error: 'A recompensa em XP deve ser um número inteiro entre 0 e 5000.' };
    }

    const rawTexto = typeof body.recompensa_texto === 'string' ? body.recompensa_texto.trim() : '';
    const recompensaTexto = rawTexto ? rawTexto.slice(0, 120) : null;

    let limiteVagas = null;
    if (body.limite_vagas !== undefined && body.limite_vagas !== null && String(body.limite_vagas).trim() !== '') {
        const parsedVagas = Number(body.limite_vagas);
        if (!Number.isInteger(parsedVagas) || parsedVagas < 1 || parsedVagas > 500) {
            return { valid: false, error: 'O limite de vagas deve estar entre 1 e 500 (ou vazio para ilimitado).' };
        }
        limiteVagas = parsedVagas;
    }

    let prazoDias = null;
    if (body.prazo_dias !== undefined && body.prazo_dias !== null && String(body.prazo_dias).trim() !== '') {
        const parsedPrazo = Number(body.prazo_dias);
        if (!Number.isInteger(parsedPrazo) || parsedPrazo < 1 || parsedPrazo > 365) {
            return { valid: false, error: 'O prazo sugerido em dias deve estar entre 1 e 365.' };
        }
        prazoDias = parsedPrazo;
    }

    const ativo = (body.ativo === false || body.ativo === 0 || body.ativo === '0' || body.ativo === 'false') ? 0 : 1;

    return {
        valid: true,
        data: {
            titulo,
            descricao,
            categoria,
            dificuldade,
            pilar_foco: pilarFoco,
            modalidade_id: modalidadeId,
            recompensa_xp: rawXp,
            recompensa_texto: recompensaTexto,
            limite_vagas: limiteVagas,
            prazo_dias: prazoDias,
            ativo
        }
    };
}

/**
 * Monta as missões automáticas do aluno a partir da avaliação RPG, frequência semanal,
 * trava de exame e prontidão técnica da faixa.
 */
function buildAutomaticMissions({ avaliacaoRpg = null, streak = null, prontidaoExame = null } = {}) {
    const missoes = [];

    // 1. Missões geradas automaticamente pelos 2 critérios de menor pontuação na Avaliação RPG
    const foco = avaliacaoRpg?.atual?.foco_evolucao || null;
    if (foco && Array.isArray(foco.criterios)) {
        for (const crit of foco.criterios) {
            const notaAtual = Math.max(0, Math.min(5, Number(crit.nota ?? 0)));
            const metaNota = 5;
            const proximoAlvo = Math.min(5, notaAtual + 1);
            const concl = notaAtual >= 5;

            missoes.push({
                id: `auto_rpg_${crit.id}`,
                origem: 'automatica',
                tipo: 'foco_rpg',
                titulo: concl
                    ? `Manter Excelência: ${crit.nome}`
                    : `Evoluir ${crit.nome}`,
                descricao: concl
                    ? `Critério com nota máxima (5/5) no pilar ${crit.pilar_nome || crit.pilar}. Continue mantendo a consistência.`
                    : `Nota atual ${notaAtual}/5 no pilar ${crit.pilar_nome || crit.pilar}. Busque ao menos ${proximoAlvo}/5 na próxima avaliação.`,
                pilar: crit.pilar || null,
                pilar_nome: crit.pilar_nome || crit.pilar || 'Técnica',
                pilar_cor: crit.pilar_cor || '#38bdf8',
                progresso_atual: notaAtual,
                progresso_meta: metaNota,
                progresso_pct: Math.round((notaAtual / metaNota) * 100),
                status: concl ? 'concluida' : 'em_andamento',
                badge_texto: 'Foco RPG'
            });
        }
    }

    // 2. Missão automática de Frequência Semanal
    if (streak && Number(streak.meta_semana) > 0) {
        const atualSem = Math.max(0, Number(streak.total_semana || 0));
        const metaSem = Math.max(1, Number(streak.meta_semana));
        const concl = Boolean(streak.meta_atingida) || atualSem >= metaSem;

        missoes.push({
            id: 'auto_frequencia_semanal',
            origem: 'automatica',
            tipo: 'frequencia_semanal',
            titulo: 'Constância Semanal no Tatame',
            descricao: concl
                ? `Meta semanal concluída (${atualSem}/${metaSem} treinos registrados). Excelente ritmo!`
                : `Complete ${metaSem} check-ins nesta semana para manter seu ritmo de evolução (${atualSem}/${metaSem}).`,
            pilar: 'vitalidade',
            pilar_nome: 'Frequência',
            pilar_cor: '#f97316',
            progresso_atual: Math.min(atualSem, metaSem),
            progresso_meta: metaSem,
            progresso_pct: Math.min(100, Math.round((atualSem / metaSem) * 100)),
            status: concl ? 'concluida' : 'em_andamento',
            badge_texto: 'Semanal'
        });
    }

    // 3. Missão automática de Requisitos RPG para o Próximo Exame (se configurados)
    const reqExame = avaliacaoRpg?.requisitos_exame || null;
    if (reqExame && reqExame.possui_requisitos_rpg) {
        const pct = Math.max(0, Math.min(100, Number(reqExame.progresso_pct || 0)));
        const elegivel = Boolean(reqExame.elegivel);
        const proxPend = Array.isArray(reqExame.pendencias) && reqExame.pendencias.length > 0
            ? reqExame.pendencias[0]
            : 'Todos os requisitos RPG atingidos para o exame!';

        missoes.push({
            id: 'auto_trava_exame_rpg',
            origem: 'automatica',
            tipo: 'exame_graduacao',
            titulo: `Rumo ao Exame: ${reqExame.proxima_graduacao_nome || 'Próxima Graduação'}`,
            descricao: elegivel
                ? 'Você atingiu todos os requisitos técnicos RPG exigidos para esta graduação!'
                : `Pendência prioritária: ${proxPend}`,
            pilar: 'inteligencia',
            pilar_nome: 'Graduação',
            pilar_cor: elegivel ? '#10b981' : '#f59e0b',
            progresso_atual: pct,
            progresso_meta: 100,
            progresso_pct: pct,
            status: elegivel ? 'concluida' : 'em_andamento',
            badge_texto: 'Exame RPG'
        });
    }

    // 4. Missão automática de Currículo de Golpes da Faixa (Wiki)
    if (prontidaoExame && Number(prontidaoExame.total_golpes) > 0) {
        const dom = Math.max(0, Number(prontidaoExame.golpes_dominados || 0));
        const tot = Math.max(1, Number(prontidaoExame.total_golpes));
        const pct = Math.min(100, Math.round((dom / tot) * 100));
        const concl = dom >= tot;

        missoes.push({
            id: 'auto_curriculo_wiki',
            origem: 'automatica',
            tipo: 'curriculo_wiki',
            titulo: `Dominar Técnicas da Faixa (${prontidaoExame.nivel_nome || 'Atual'})`,
            descricao: concl
                ? `Você já marcou todos os ${tot} movimentos da sua faixa atual como dominados.`
                : `${dom} de ${tot} golpes marcados como dominados na Wiki Técnica.`,
            pilar: 'destreza',
            pilar_nome: 'Wiki Técnica',
            pilar_cor: '#a855f7',
            progresso_atual: dom,
            progresso_meta: tot,
            progresso_pct: pct,
            status: concl ? 'concluida' : 'em_andamento',
            badge_texto: 'Currículo'
        });
    }

    return missoes;
}

/**
 * Valida se o aluno pode aceitar uma missão do Quadro de Missões do Professor.
 */
function canStudentAcceptMission({ missao, activeCount = 0, currentEnrollment = null, totalAceites = 0 } = {}) {
    if (!missao || !Number(missao.ativo)) {
        return { allowed: false, error: 'Esta missão não está mais ativa no quadro.' };
    }

    if (currentEnrollment && currentEnrollment.status) {
        const st = String(currentEnrollment.status);
        if (st === 'em_andamento') {
            return { allowed: false, error: 'Você já está realizando esta missão no momento.' };
        }
        if (st === 'aguardando_validacao') {
            return { allowed: false, error: 'Esta missão já foi enviada e aguarda validação do professor.' };
        }
        if (st === 'concluida') {
            return { allowed: false, error: 'Você já concluiu esta missão anteriormente.' };
        }
    }

    if (Number(activeCount) >= MAX_MISSOES_ATIVAS_ALUNO) {
        return {
            allowed: false,
            error: `Você atingiu o limite máximo de ${MAX_MISSOES_ATIVAS_ALUNO} missões simultâneas. Conclua ou abandone uma missão antes de escolher outra.`
        };
    }

    if (missao.limite_vagas !== null && missao.limite_vagas !== undefined && Number(missao.limite_vagas) > 0) {
        if (Number(totalAceites) >= Number(missao.limite_vagas)) {
            return { allowed: false, error: 'As vagas para esta missão já foram preenchidas.' };
        }
    }

    return { allowed: true };
}

module.exports = {
    MISSAO_CATEGORIAS,
    MISSAO_DIFICULDADES,
    MISSAO_PILARES,
    MAX_MISSOES_ATIVAS_ALUNO,
    DIFICULDADE_LABELS,
    CATEGORIA_LABELS,
    validateMissaoPayload,
    buildAutomaticMissions,
    canStudentAcceptMission
};
