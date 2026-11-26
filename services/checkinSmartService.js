/**
 * PRO COMBATE - Serviço de Domínio: Check-in Inteligente por Horário & Calendário de Presenças
 * Funções puras 100% testáveis sem dependência de banco ou HTTP.
 */

function toTitleWord(word = '') {
    const str = String(word || '').trim();
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Gera nomes curtos para exibição abaixo da foto no grid de check-in.
 * Usa o primeiro nome e diferencia homônimos com a inicial do último sobrenome (ex.: "Lucas S.").
 */
function getDisplayShortNames(alunos = []) {
    const counts = new Map();
    const parsedList = alunos.map((aluno) => {
        const raw = String(aluno?.nome_completo || aluno?.aluno_nome || '').trim();
        const parts = raw ? raw.split(/\s+/).filter(Boolean) : [];
        const firstRaw = parts[0] || 'Atleta';
        const firstKey = firstRaw.toLowerCase();
        counts.set(firstKey, (counts.get(firstKey) || 0) + 1);
        return {
            id: Number(aluno?.id || aluno?.aluno_id || 0),
            firstDisplay: toTitleWord(firstRaw),
            firstKey,
            lastInitial: parts.length > 1 ? parts[parts.length - 1].charAt(0).toUpperCase() : ''
        };
    });

    const result = new Map();
    for (const item of parsedList) {
        const isDup = (counts.get(item.firstKey) || 0) > 1;
        const shortName = (isDup && item.lastInitial)
            ? `${item.firstDisplay} ${item.lastInitial}.`
            : item.firstDisplay;
        result.set(item.id, shortName);
    }
    return result;
}

/**
 * Calcula a menor distância circular em minutos entre dois horários do dia (0..720).
 */
function circularMinutesDiff(minA, minB) {
    const a = ((Number(minA) || 0) % 1440 + 1440) % 1440;
    const b = ((Number(minB) || 0) % 1440 + 1440) % 1440;
    const diff = Math.abs(a - b);
    return Math.min(diff, 1440 - diff);
}

/**
 * Normaliza uma entrada de data/hora para formato YYYY-MM-DD (usado no calendário).
 */
function extractIsoDate(val) {
    if (!val) return '';
    if (val instanceof Date && !isNaN(val.getTime())) {
        return val.toISOString().slice(0, 10);
    }
    const str = String(val).trim();
    const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
}

/**
 * Retorna data e hora exatas no fuso GMT-3 (America/Bahia — Feira de Santana, BA),
 * independente do fuso horário do SO ou do servidor MySQL.
 */
function getBrazilNowParts(referenceDate = new Date()) {
    const baseMs = referenceDate instanceof Date && !isNaN(referenceDate.getTime())
        ? referenceDate.getTime()
        : Date.now();
    // Brasil/Bahia é fixo em UTC-03:00 (sem horário de verão)
    const brDate = new Date(baseMs - (3 * 60 * 60 * 1000));
    const ano = brDate.getUTCFullYear();
    const mes = brDate.getUTCMonth() + 1;
    const dia = brDate.getUTCDate();
    const hora = brDate.getUTCHours();
    const minuto = brDate.getUTCMinutes();
    const segundo = brDate.getUTCSeconds();

    const mm = String(mes).padStart(2, '0');
    const dd = String(dia).padStart(2, '0');
    const hh = String(hora).padStart(2, '0');
    const mi = String(minuto).padStart(2, '0');
    const ss = String(segundo).padStart(2, '0');

    return {
        ano,
        mes,
        dia,
        hora,
        minuto,
        segundo,
        dateIso: `${ano}-${mm}-${dd}`,
        timeHm: `${hh}:${mi}`,
        sqlDateTime: `${ano}-${mm}-${dd} ${hh}:${mi}:${ss}`,
        minutesOfDay: (hora * 60) + minuto
    };
}

/**
 * Classifica e ordena alunos para o grid de check-in inteligente:
 * - Grupo 0 (Topo absoluto): alunos sem nenhum check-in anterior (1º Check-in)
 * - Grupo 1 (Horário atual / filtro): alunos que costumam treinar na faixa de horário (±windowMinutes)
 * - Grupo 2 (Demais horários): ordenados pela menor distância ao horário atual/alvo
 */
function rankStudentsForSmartCheckin(alunos = [], historyStatsMap = new Map(), options = {}) {
    const currentMinutes = Number.isFinite(Number(options.currentMinutes))
        ? Number(options.currentMinutes)
        : 12 * 60;
    const windowMinutes = Number.isFinite(Number(options.windowMinutes)) && Number(options.windowMinutes) > 0
        ? Number(options.windowMinutes)
        : 90;
    const selectedHour = (options.selectedHour !== null && options.selectedHour !== undefined && options.selectedHour !== '')
        ? Number(options.selectedHour)
        : null;
    const validSelectedHour = Number.isInteger(selectedHour) && selectedHour >= 0 && selectedHour <= 23
        ? selectedHour
        : null;

    const targetMinutes = validSelectedHour !== null
        ? (validSelectedHour * 60 + 30)
        : currentMinutes;

    const shortNames = getDisplayShortNames(alunos);

    const enriched = alunos.map((aluno) => {
        const id = Number(aluno.id || aluno.aluno_id);
        const stats = historyStatsMap instanceof Map
            ? historyStatsMap.get(id)
            : (historyStatsMap && historyStatsMap[id]);

        const totalCheckins = Number(stats?.total_checkins || 0);
        const minutosHistorico = Array.isArray(stats?.minutos_historico)
            ? stats.minutos_historico.map(Number).filter(n => Number.isFinite(n) && n >= 0 && n < 1440)
            : [];

        const isPrimeiroCheckin = totalCheckins === 0;

        // Calcula hora habitual predominante (moda de horas inteiras, desempate pela mais próxima do alvo)
        const hourCounts = new Map();
        for (const m of minutosHistorico) {
            const h = Math.floor(m / 60);
            hourCounts.set(h, (hourCounts.get(h) || 0) + 1);
        }

        let habitualHora = null;
        let maxHourCount = -1;
        for (const [h, cnt] of hourCounts.entries()) {
            const distCand = circularMinutesDiff(h * 60 + 30, targetMinutes);
            const distBest = habitualHora !== null ? circularMinutesDiff(habitualHora * 60 + 30, targetMinutes) : Infinity;
            if (cnt > maxHourCount || (cnt === maxHourCount && distCand < distBest)) {
                maxHourCount = cnt;
                habitualHora = h;
            }
        }

        // Quantos check-ins históricos caem dentro da janela de horário alvo
        let checkinsNaFaixa = 0;
        let minDistancia = 720;

        for (const m of minutosHistorico) {
            const d = circularMinutesDiff(m, targetMinutes);
            if (d < minDistancia) minDistancia = d;
            if (validSelectedHour !== null) {
                if (Math.floor(m / 60) === validSelectedHour || d <= 45) {
                    checkinsNaFaixa++;
                }
            } else if (d <= windowMinutes) {
                checkinsNaFaixa++;
            }
        }

        let prioridadeGrupo = 2;
        if (isPrimeiroCheckin) {
            prioridadeGrupo = 0;
        } else if (checkinsNaFaixa > 0) {
            prioridadeGrupo = 1;
        }

        const habitualLabel = isPrimeiroCheckin
            ? '1º Check-in'
            : (habitualHora !== null ? `${String(habitualHora).padStart(2, '0')}h` : 'Ativo');

        return {
            ...aluno,
            id,
            nome_curto: shortNames.get(id) || toTitleWord((aluno.nome_completo || '').split(/\s+/)[0] || 'Atleta'),
            total_checkins_historico: totalCheckins,
            is_primeiro_checkin: isPrimeiroCheckin,
            prioridade_grupo: prioridadeGrupo,
            horario_habitual_hora: habitualHora,
            horario_habitual_label: habitualLabel,
            checkins_na_faixa: checkinsNaFaixa,
            distancia_min: isPrimeiroCheckin ? 0 : minDistancia
        };
    });

    enriched.sort((a, b) => {
        if (a.prioridade_grupo !== b.prioridade_grupo) {
            return a.prioridade_grupo - b.prioridade_grupo;
        }
        if (a.prioridade_grupo === 1) {
            if (b.checkins_na_faixa !== a.checkins_na_faixa) {
                return b.checkins_na_faixa - a.checkins_na_faixa;
            }
            if (a.distancia_min !== b.distancia_min) {
                return a.distancia_min - b.distancia_min;
            }
        }
        if (a.prioridade_grupo === 2 && a.distancia_min !== b.distancia_min) {
            return a.distancia_min - b.distancia_min;
        }
        return String(a.nome_completo || '').localeCompare(String(b.nome_completo || ''), 'pt-BR');
    });

    return enriched;
}

/**
 * Agrupa os horários (horas cheias 0..23) mais usados nos check-ins históricos da academia.
 */
function extractDetectedHours(historyRows = []) {
    const map = new Map();
    for (const row of historyRows) {
        const hora = Number(row?.hora);
        if (!Number.isInteger(hora) || hora < 0 || hora > 23) continue;
        const qtd = Number(row?.qtd ?? 1);
        map.set(hora, (map.get(hora) || 0) + (Number.isFinite(qtd) && qtd > 0 ? qtd : 1));
    }

    return Array.from(map.entries())
        .map(([hora, total]) => ({
            hora,
            label: `${String(hora).padStart(2, '0')}h`,
            total
        }))
        .sort((a, b) => a.hora - b.hora);
}

/**
 * Constrói a matriz mensal do Calendário de Presenças do Aluno (presente, ausente, bloqueado, descanso, futuro, antes_cadastro).
 */
function buildAttendanceCalendarMonth(year, month1to12, checkinsList = [], options = {}) {
    const safeYear = Math.min(Math.max(parseInt(year, 10) || new Date().getFullYear(), 2020), 2100);
    const safeMonth = Math.min(Math.max(parseInt(month1to12, 10) || (new Date().getMonth() + 1), 1), 12);

    const todayIso = extractIsoDate(options.todayIso) || new Date().toISOString().slice(0, 10);
    const cadastroIso = extractIsoDate(options.dataCadastro);

    const byDate = new Map();
    for (const chk of checkinsList || []) {
        const dataIso = extractIsoDate(chk.data_local || chk.data_hora_checkin);
        if (!dataIso) continue;
        if (!byDate.has(dataIso)) byDate.set(dataIso, []);
        byDate.get(dataIso).push({
            id: Number(chk.id) || null,
            hora: chk.hora_local || (typeof chk.data_hora_checkin === 'string' && chk.data_hora_checkin.length >= 16
                ? chk.data_hora_checkin.slice(11, 16)
                : ''),
            modalidade_nome: chk.modalidade_nome || '',
            turma_nome: chk.turma_nome || 'Treino Livre',
            metodo: chk.metodo || '',
            status: chk.status || 'aprovado'
        });
    }

    const firstDateObj = new Date(Date.UTC(safeYear, safeMonth - 1, 1));
    const primeiroDiaSemana = firstDateObj.getUTCDay(); // 0=Dom .. 6=Sáb
    const totalDias = new Date(Date.UTC(safeYear, safeMonth, 0)).getUTCDate();

    const dias = [];
    const totais = {
        presentes: 0,
        ausentes: 0,
        bloqueados: 0,
        futuros: 0,
        descanso: 0,
        taxa_frequencia: 0
    };

    const mmStr = String(safeMonth).padStart(2, '0');

    for (let day = 1; day <= totalDias; day++) {
        const ddStr = String(day).padStart(2, '0');
        const dateIso = `${safeYear}-${mmStr}-${ddStr}`;
        const weekday = new Date(Date.UTC(safeYear, safeMonth - 1, day)).getUTCDay();
        const dayCheckins = byDate.get(dateIso) || [];
        const hasApproved = dayCheckins.some(c => c.status === 'aprovado');
        const hasBlocked = dayCheckins.length > 0 && !hasApproved;

        let estado = 'ausente';
        if (hasApproved) {
            estado = 'presente';
            totais.presentes++;
        } else if (hasBlocked) {
            estado = 'bloqueado';
            totais.bloqueados++;
        } else if (dateIso > todayIso) {
            estado = 'futuro';
            totais.futuros++;
        } else if (cadastroIso && dateIso < cadastroIso) {
            estado = 'antes_cadastro';
        } else if (weekday === 0) {
            estado = 'descanso';
            totais.descanso++;
        } else {
            estado = 'ausente';
            totais.ausentes++;
        }

        dias.push({
            dia: day,
            data: dateIso,
            dia_semana: weekday,
            hoje: dateIso === todayIso,
            estado,
            checkins: dayCheckins
        });
    }

    const baseTaxa = totais.presentes + totais.ausentes;
    totais.taxa_frequencia = baseTaxa > 0 ? Math.round((totais.presentes / baseTaxa) * 100) : 0;

    return {
        ano: safeYear,
        mes: safeMonth,
        primeiro_dia_semana: primeiroDiaSemana,
        total_dias: totalDias,
        dias,
        totais
    };
}

module.exports = {
    getDisplayShortNames,
    circularMinutesDiff,
    extractIsoDate,
    getBrazilNowParts,
    rankStudentsForSmartCheckin,
    extractDetectedHours,
    buildAttendanceCalendarMonth
};
