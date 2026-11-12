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
 * Calcula a competência (YYYY-MM) e a data de vencimento (YYYY-MM-DD) para geração de fatura
 */
function computeNextDueDate(diaVencimento = 10, referenceDate = new Date(), mode = 'next_month_if_past') {
    const dia = Math.min(Math.max(parseInt(String(diaVencimento), 10) || 10, 1), 28);
    const competencia = referenceDate.toISOString().slice(0, 7);
    const vencimento = new Date(referenceDate.getTime());
    vencimento.setDate(dia);

    if (vencimento < referenceDate) {
        if (mode === 'plus_5_days_if_past') {
            const plus5 = new Date(referenceDate.getTime());
            plus5.setDate(referenceDate.getDate() + 5);
            return {
                competencia,
                dataVencimento: plus5.toISOString().slice(0, 10)
            };
        }
        if (mode === 'next_month_if_past') {
            vencimento.setMonth(vencimento.getMonth() + 1);
        }
    }

    return {
        competencia,
        dataVencimento: vencimento.toISOString().slice(0, 10)
    };
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
    computeNextDueDate,
    hasValidImageSignature
};
