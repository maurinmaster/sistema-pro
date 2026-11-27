const fs = require('fs');

/**
 * Regras Puras de Domínio (100% testáveis unitariamente sem dependência de banco ou HTTP)
 */

/**
 * Calcula a idade exata em anos a partir de uma data de nascimento
 */
function calculateAge(birthDateInput, referenceDate = new Date()) {
    if (!birthDateInput) return null;
    const birthDate = birthDateInput instanceof Date ? birthDateInput : new Date(birthDateInput);
    if (isNaN(birthDate.getTime())) return null;

    let age = referenceDate.getFullYear() - birthDate.getFullYear();
    const m = referenceDate.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && referenceDate.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}

/**
 * Valida se um aluno é menor de idade e se os dados do responsável legal foram informados
 */
function validateMinorGuardian(birthDateInput, responsavelNome, responsavelTelefone, referenceDate = new Date()) {
    const age = calculateAge(birthDateInput, referenceDate);
    if (age === null) {
        return { valid: false, isMinor: false, age: null, error: 'Data de nascimento inválida.' };
    }
    const isMinor = age < 18;
    if (isMinor && (!responsavelNome || !String(responsavelNome).trim() || !responsavelTelefone || !String(responsavelTelefone).trim())) {
        return {
            valid: false,
            isMinor: true,
            age,
            error: 'Para alunos menores de 18 anos, o nome e telefone do responsável são obrigatórios.'
        };
    }
    return { valid: true, isMinor, age, error: null };
}

/**
 * Avalia elegibilidade de check-in do aluno com base no status cadastral e faturas em atraso
 */
function evaluateCheckinEligibility(alunoStatus, faturasAtrasadasCount = 0) {
    if (alunoStatus === 'bloqueado') {
        return { status: 'bloqueado', motivoBloqueio: 'Aluno bloqueado na secretaria' };
    }
    if (alunoStatus === 'trancado') {
        return { status: 'bloqueado', motivoBloqueio: 'Matrícula trancada' };
    }
    if (alunoStatus === 'inativo') {
        return { status: 'bloqueado', motivoBloqueio: 'Aluno inativo' };
    }

    if (Number(faturasAtrasadasCount) > 0) {
        return { status: 'aprovado', motivoBloqueio: 'Possui fatura em atraso (Notificado)' };
    }

    return { status: 'aprovado', motivoBloqueio: null };
}

/**
 * Classifica transição contratual entre planos (Upgrade vs Downgrade) e define valor acordado final
 */
function classifyPlanTransition(valorPlanoAtual, valorPlanoNovo, novoValorAcordado) {
    const atual = Number(valorPlanoAtual) || 0;
    const novo = Number(valorPlanoNovo) || 0;
    const isUpgrade = novo > atual;
    const tipoTransicao = isUpgrade ? 'upgrade' : 'downgrade';

    const acordadoParsed = novoValorAcordado !== undefined && novoValorAcordado !== null
        ? Number(novoValorAcordado)
        : NaN;

    const valorFinal = !isNaN(acordadoParsed) && acordadoParsed > 0 ? acordadoParsed : novo;

    return {
        isUpgrade,
        tipoTransicao,
        valorFinal
    };
}

/**
 * Extrai ano, mês (0..11) e dia (1..31) no fuso horário America/Bahia (-03:00)
 */
function getBahiaDateParts(referenceDate = new Date()) {
    const ref = referenceDate instanceof Date && !isNaN(referenceDate.getTime())
        ? referenceDate
        : new Date();
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Bahia',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(ref);
        const year = Number(parts.find(p => p.type === 'year')?.value);
        const month = Number(parts.find(p => p.type === 'month')?.value) - 1;
        const day = Number(parts.find(p => p.type === 'day')?.value);
        if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day) && day >= 1 && day <= 31) {
            return { year, month, day };
        }
    } catch {
        // Fallback para ambiente sem suporte ao timezone IANA
    }
    return {
        year: ref.getFullYear(),
        month: ref.getMonth(),
        day: ref.getDate()
    };
}

/**
 * Retorna o dia atual do mês (1..31) no fuso horário America/Bahia
 */
function getCurrentDueDay(referenceDate = new Date()) {
    return getBahiaDateParts(referenceDate).day;
}

/**
 * Normaliza o dia de vencimento para o intervalo válido de calendário (1..31)
 */
function normalizeDueDay(diaVencimento, fallbackDay = getCurrentDueDay()) {
    const safeFallback = Math.min(Math.max(parseInt(String(fallbackDay), 10) || 1, 1), 31);
    if (diaVencimento === undefined || diaVencimento === null || String(diaVencimento).trim() === '') {
        return safeFallback;
    }
    const parsed = parseInt(String(diaVencimento).trim(), 10);
    if (!Number.isInteger(parsed)) {
        return safeFallback;
    }
    return Math.min(Math.max(parsed, 1), 31);
}

/**
 * Valida explicitamente o dia de vencimento recebido na API (1..31),
 * assumindo o dia atual quando omitido ou vazio.
 */
function parseDueDay(rawValue, referenceDate = new Date()) {
    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
        return { valid: true, value: getCurrentDueDay(referenceDate) };
    }
    const trimmed = String(rawValue).trim();
    if (!/^\d{1,2}$/.test(trimmed)) {
        return { valid: false, error: 'O dia de vencimento deve ser um número inteiro entre 1 e 31.' };
    }
    const num = Number(trimmed);
    if (!Number.isInteger(num) || num < 1 || num > 31) {
        return { valid: false, error: 'O dia de vencimento deve ser um número inteiro entre 1 e 31.' };
    }
    return { valid: true, value: num };
}

function lastDayOfMonth(year, monthIndexZeroBased) {
    return new Date(Date.UTC(year, monthIndexZeroBased + 1, 0)).getUTCDate();
}

function formatYMD(year, monthIndexZeroBased, day) {
    return `${year}-${String(monthIndexZeroBased + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Calcula a competência (YYYY-MM) e a data de vencimento (YYYY-MM-DD) para geração de fatura,
 * suportando dias 1..31 com ajuste automático para o último dia real em meses mais curtos.
 */
function computeNextDueDate(diaVencimento, referenceDate = new Date(), mode = 'next_month_if_past') {
    const { year: refYear, month: refMonth, day: refDay } = getBahiaDateParts(referenceDate);
    const dia = normalizeDueDay(diaVencimento, refDay);
    const competencia = `${refYear}-${String(refMonth + 1).padStart(2, '0')}`;
    const effectiveDayThisMonth = Math.min(dia, lastDayOfMonth(refYear, refMonth));

    if (effectiveDayThisMonth < refDay) {
        if (mode === 'plus_5_days_if_past') {
            const plus5 = new Date(Date.UTC(refYear, refMonth, refDay + 5));
            return {
                competencia,
                dataVencimento: formatYMD(plus5.getUTCFullYear(), plus5.getUTCMonth(), plus5.getUTCDate())
            };
        }
        if (mode === 'next_month_if_past') {
            const nextMonthRef = new Date(Date.UTC(refYear, refMonth + 1, 1));
            const nextYear = nextMonthRef.getUTCFullYear();
            const nextMonth = nextMonthRef.getUTCMonth();
            const nextDay = Math.min(dia, lastDayOfMonth(nextYear, nextMonth));
            return {
                competencia,
                dataVencimento: formatYMD(nextYear, nextMonth, nextDay)
            };
        }
    }

    return {
        competencia,
        dataVencimento: formatYMD(refYear, refMonth, effectiveDayThisMonth)
    };
}

/**
 * Decide se uma nova fatura deve ser gerada na competência atual e com qual valor,
 * ignorando faturas canceladas e considerando créditos de faturas já pagas na mesma competência.
 */
function calculateCompetenceInvoiceAmount(planValue, existingInvoices = []) {
    const targetValue = Number(planValue) || 0;
    if (targetValue <= 0) {
        return { shouldCreate: false, amount: 0, reason: 'zero_plan_value', observacoes: null };
    }

    const activeInvoices = (existingInvoices || []).filter(inv => inv && inv.status !== 'cancelado');

    const hasOpenInvoice = activeInvoices.some(inv => inv.status === 'pendente' || inv.status === 'atrasado');
    if (hasOpenInvoice) {
        return { shouldCreate: false, amount: 0, reason: 'existing_open_invoice', observacoes: null };
    }

    const totalPaid = activeInvoices
        .filter(inv => inv.status === 'pago' || inv.status === 'isento')
        .reduce((sum, inv) => sum + (Number(inv.valor_pago ?? inv.valor_original) || 0), 0);

    if (totalPaid <= 0) {
        return { shouldCreate: true, amount: Number(targetValue.toFixed(2)), reason: 'new_competence_invoice', observacoes: null };
    }

    const diff = Number((targetValue - totalPaid).toFixed(2));
    if (diff > 0) {
        return {
            shouldCreate: true,
            amount: diff,
            reason: 'upgrade_difference',
            observacoes: 'Diferença de plano sobre fatura já quitada na competência'
        };
    }

    return { shouldCreate: false, amount: 0, reason: 'already_paid_in_competence', observacoes: null };
}

/**
 * Valida a assinatura binária (magic bytes) de arquivos de imagem (JPEG, PNG, WEBP)
 */
function hasValidImageSignature(filePath) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(12);
        const bytesRead = fs.readSync(fd, buffer, 0, 12, 0);
        fs.closeSync(fd);

        if (bytesRead < 4) return false;

        // JPEG: FF D8 FF
        if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
            return true;
        }
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (
            bytesRead >= 8 &&
            buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
            buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
        ) {
            return true;
        }
        // WEBP: RIFF....WEBP
        if (
            bytesRead >= 12 &&
            buffer.toString('ascii', 0, 4) === 'RIFF' &&
            buffer.toString('ascii', 8, 12) === 'WEBP'
        ) {
            return true;
        }
        // GIF: GIF87a ou GIF89a
        if (bytesRead >= 6) {
            const sig = buffer.toString('ascii', 0, 6).toUpperCase();
            if (sig === 'GIF87A' || sig === 'GIF89A') {
                return true;
            }
        }
        return false;
    } catch {
        return false;
    }
}

module.exports = {
    calculateAge,
    validateMinorGuardian,
    evaluateCheckinEligibility,
    classifyPlanTransition,
    getCurrentDueDay,
    normalizeDueDay,
    parseDueDay,
    computeNextDueDate,
    calculateCompetenceInvoiceAmount,
    hasValidImageSignature
};
