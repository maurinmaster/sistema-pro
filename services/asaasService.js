/**
 * PRO COMBATE - Serviço de Integração com Gateway de Pagamento Asaas (v3)
 * Criação de clientes, geração de cobranças (Pix/Boleto/Cartão) e consulta de pagamentos
 */

const crypto = require('crypto');

class AsaasService {
    constructor() {
        this.apiKey = (process.env.ASAAS_API_KEY || '').trim();
        let baseUrl = (process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3').replace(/\/+$/, '');
        if (this.apiKey.startsWith('$aact_prod_') && baseUrl.includes('sandbox.asaas.com')) {
            baseUrl = 'https://api.asaas.com/v3';
        }
        this.baseUrl = baseUrl;
    }

    /**
     * Valida o token recebido no cabeçalho asaas-access-token contra um ou mais tokens
     * configurados em ASAAS_WEBHOOK_TOKEN (separados por vírgula) usando comparação timing-safe.
     */
    isValidWebhookToken(receivedToken) {
        const raw = (process.env.ASAAS_WEBHOOK_TOKEN || '').trim();
        if (!raw) return true;
        if (!receivedToken || typeof receivedToken !== 'string') return false;

        const expectedTokens = raw.split(',').map(t => t.trim()).filter(Boolean);
        if (expectedTokens.length === 0) return true;

        const receivedBuf = Buffer.from(receivedToken.trim(), 'utf8');
        return expectedTokens.some((expected) => {
            const expectedBuf = Buffer.from(expected, 'utf8');
            if (receivedBuf.length !== expectedBuf.length) return false;
            return crypto.timingSafeEqual(receivedBuf, expectedBuf);
        });
    }

    /**
     * Verifica se o gateway Asaas está com credencial configurada
     */
    isConfigured() {
        if (process.env.NODE_ENV === 'test') {
            return false;
        }
        return Boolean(this.apiKey && this.apiKey.length > 10 && !this.apiKey.startsWith('mock_'));
    }

    /**
     * Limpa caracteres não numéricos de CPF/CNPJ/Telefone
     */
    cleanDigits(val) {
        if (!val) return '';
        return String(val).replace(/\D/g, '');
    }

    /**
     * Cabeçalhos HTTP padrão para chamadas à API do Asaas
     */
    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'access_token': this.apiKey,
            'User-Agent': 'ProCombate/1.0'
        };
    }

    /**
     * Cria ou busca um cliente existente no Asaas
     */
    async criarOuBuscarCliente({ nome, email, cpfCnpj, telefone, alunoId }) {
        const cleanCpf = this.cleanDigits(cpfCnpj);
        const cleanPhone = this.cleanDigits(telefone);

        if (!this.isConfigured()) {
            return {
                id: `cus_mock_${alunoId || Date.now()}`,
                name: nome,
                email: email,
                cpfCnpj: cleanCpf || '00000000000',
                phone: cleanPhone || '11999999999',
                is_mock: true
            };
        }

        try {
            // 1. Tenta buscar cliente existente por email ou CPF
            const searchParam = cleanCpf ? `cpfCnpj=${cleanCpf}` : `email=${encodeURIComponent(email)}`;
            const searchRes = await fetch(`${this.baseUrl}/customers?${searchParam}`, {
                method: 'GET',
                headers: this.getHeaders()
            });

            if (searchRes.ok) {
                const searchData = await searchRes.json();
                if (searchData.data && searchData.data.length > 0) {
                    return searchData.data[0];
                }
            }

            // 2. Se não encontrou, cria um novo cliente no Asaas
            const payload = {
                name: nome,
                email: email,
                cpfCnpj: cleanCpf || undefined,
                phone: cleanPhone || undefined,
                mobilePhone: cleanPhone || undefined,
                externalReference: alunoId ? String(alunoId) : undefined
            };

            const createRes = await fetch(`${this.baseUrl}/customers`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(payload)
            });

            const createData = await createRes.json();
            if (!createRes.ok) {
                const msg = createData.errors ? createData.errors.map(e => e.description).join('; ') : 'Erro ao cadastrar cliente no Asaas';
                throw new Error(msg);
            }

            return createData;
        } catch (err) {
            console.error('[AsaasService] Falha ao criar/buscar cliente:', err.message);
            // Em caso de falha de conexão com a API externa, fallback seguro para não travar
            return {
                id: `cus_fallback_${alunoId || Date.now()}`,
                name: nome,
                email: email,
                is_mock: true,
                warning: err.message
            };
        }
    }

    /**
     * Cria uma nova cobrança no Asaas para o Exame de Graduação
     */
    async criarCobranca({ customerId, valor, vencimento, descricao, externalReference, billingType = 'PIX' }) {
        const valNum = parseFloat(valor);
        if (isNaN(valNum) || valNum <= 0) {
            throw new Error('Valor da cobrança deve ser numérico e maior que zero.');
        }

        const validBillingTypes = ['PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED'];
        const bType = validBillingTypes.includes(String(billingType).toUpperCase()) 
            ? String(billingType).toUpperCase() 
            : 'PIX';

        // Data de vencimento (mínimo hoje)
        let dueDate = vencimento;
        if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
            const d = new Date();
            d.setDate(d.getDate() + 3);
            dueDate = d.toISOString().split('T')[0];
        }

        if (!this.isConfigured()) {
            const mockPaymentId = `pay_mock_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            const mockPixCopyPaste = `00020101021226840014br.gov.bcb.pix2562pro-combate-exame-${mockPaymentId}520400005303986540${valNum.toFixed(2)}5802BR5916PRO COMBATE6009SAO PAULO62070503***6304ABCD`;
            
            return {
                id: mockPaymentId,
                customer: customerId,
                value: valNum,
                netValue: valNum,
                billingType: bType,
                status: 'PENDING',
                dueDate: dueDate,
                description: descricao || 'Taxa de Exame de Graduação - PRO COMBATE',
                invoiceUrl: `https://sandbox.asaas.com/i/${mockPaymentId}`,
                bankSlipUrl: null,
                pixQrCode: {
                    encodedImage: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                    payload: mockPixCopyPaste,
                    expirationDate: `${dueDate} 23:59:59`
                },
                is_mock: true
            };
        }

        try {
            const payload = {
                customer: customerId,
                billingType: bType,
                value: valNum,
                dueDate: dueDate,
                description: descricao || 'Taxa de Inscrição no Exame de Graduação',
                externalReference: externalReference || undefined,
                postalService: false
            };

            const res = await fetch(`${this.baseUrl}/payments`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok) {
                const msg = data.errors ? data.errors.map(e => e.description).join('; ') : 'Erro ao gerar cobrança no Asaas';
                throw new Error(msg);
            }

            // Se a cobrança for Pix ou indefinida, busca o QR Code Pix imediatamente
            let pixData = null;
            if (bType === 'PIX' || bType === 'UNDEFINED') {
                try {
                    pixData = await this.obterPixQrCode(data.id);
                } catch (pixErr) {
                    console.warn('[AsaasService] Não foi possível carregar QR Code Pix imediato:', pixErr.message);
                }
            }

            return {
                id: data.id,
                customer: data.customer,
                value: data.value,
                netValue: data.netValue,
                billingType: data.billingType,
                status: data.status,
                dueDate: data.dueDate,
                description: data.description,
                invoiceUrl: data.invoiceUrl,
                bankSlipUrl: data.bankSlipUrl || null,
                pixQrCode: pixData,
                is_mock: false
            };
        } catch (err) {
            console.error('[AsaasService] Falha ao criar cobrança:', err.message);
            throw err;
        }
    }

    /**
     * Obtém o QR Code e chave Copia e Cola para pagamento Pix no Asaas
     */
    async obterPixQrCode(paymentId) {
        if (!paymentId) return null;

        if (!this.isConfigured() || String(paymentId).startsWith('pay_mock_')) {
            return {
                encodedImage: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                payload: `00020101021226840014br.gov.bcb.pix2562pro-combate-pix-${paymentId}5204000053039865802BR5916PRO COMBATE6009SAO PAULO62070503***6304ABCD`,
                expirationDate: '2026-12-31 23:59:59',
                is_mock: true
            };
        }

        try {
            const res = await fetch(`${this.baseUrl}/payments/${paymentId}/pixQrCode`, {
                method: 'GET',
                headers: this.getHeaders()
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                const msg = errData.errors ? errData.errors.map(e => e.description).join('; ') : 'Erro ao buscar Pix QR Code no Asaas';
                throw new Error(msg);
            }

            return await res.json();
        } catch (err) {
            console.error('[AsaasService] Erro ao obter Pix QR Code:', err.message);
            throw err;
        }
    }

    /**
     * Detecta a bandeira do cartão a partir dos primeiros dígitos
     */
    detectCardBrand(number) {
        const clean = String(number || '').replace(/\D/g, '');
        if (/^4/.test(clean)) return 'VISA';
        if (/^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[0-1]|2720)/.test(clean)) return 'MASTERCARD';
        if (/^(4011|4312|4389|4514|4576|5041|5066|5067|5090|6277|6362|6363|6504|6505|6506|6507|6509|6516|6550)/.test(clean)) return 'ELO';
        if (/^3[47]/.test(clean)) return 'AMEX';
        if (/^(606282|3841)/.test(clean)) return 'HIPERCARD';
        return 'DESCONHECIDA';
    }

    /**
     * Processa pagamento direto com cartão de crédito via Asaas
     */
    async pagarComCartao({ paymentId, customerId, valor, vencimento, descricao, externalReference, creditCard, creditCardHolderInfo, remoteIp }) {
        if (!creditCard || !creditCard.number || !creditCard.holderName || !creditCard.expiryMonth || !creditCard.expiryYear || !creditCard.ccv) {
            throw new Error('Todos os dados do cartão de crédito são obrigatórios (número, titular, validade e CVV).');
        }

        const cleanCardNumber = this.cleanDigits(creditCard.number);
        if (cleanCardNumber.length < 13 || cleanCardNumber.length > 19) {
            throw new Error('Número de cartão de crédito inválido.');
        }

        const cleanCcv = this.cleanDigits(creditCard.ccv);
        if (cleanCcv.length < 3 || cleanCcv.length > 4) {
            throw new Error('Código de segurança (CVV) inválido.');
        }

        let expMonth = String(creditCard.expiryMonth).padStart(2, '0');
        let expYear = String(creditCard.expiryYear);
        if (expYear.length === 2) expYear = '20' + expYear;

        const valNum = parseFloat(valor);
        const cardBrand = this.detectCardBrand(cleanCardNumber);
        const last4 = cleanCardNumber.slice(-4);

        if (!this.isConfigured() || (paymentId && String(paymentId).startsWith('pay_mock_'))) {
            const mockId = paymentId || `pay_mock_card_${Date.now()}`;
            return {
                id: mockId,
                status: 'CONFIRMED',
                billingType: 'CREDIT_CARD',
                value: valNum || 100,
                netValue: valNum || 100,
                creditCard: {
                    creditCardNumber: last4,
                    creditCardBrand: cardBrand !== 'DESCONHECIDA' ? cardBrand : 'MASTERCARD'
                },
                is_mock: true
            };
        }

        try {
            const cardPayload = {
                holderName: creditCard.holderName.trim().toUpperCase(),
                number: cleanCardNumber,
                expiryMonth: expMonth,
                expiryYear: expYear,
                ccv: cleanCcv
            };

            const holderPayload = {
                name: (creditCardHolderInfo?.name || creditCard.holderName).trim(),
                email: creditCardHolderInfo?.email || 'financeiro@aluno.com',
                cpfCnpj: this.cleanDigits(creditCardHolderInfo?.cpfCnpj || '00000000000'),
                postalCode: this.cleanDigits(creditCardHolderInfo?.postalCode || '01001000'),
                addressNumber: creditCardHolderInfo?.addressNumber || 'S/N',
                addressComplement: creditCardHolderInfo?.addressComplement || null,
                phone: this.cleanDigits(creditCardHolderInfo?.phone || '11999999999'),
                mobilePhone: this.cleanDigits(creditCardHolderInfo?.phone || '11999999999')
            };

            // Se já tiver um paymentId existente no Asaas
            if (paymentId && !String(paymentId).startsWith('pay_mock_')) {
                const payRes = await fetch(`${this.baseUrl}/payments/${paymentId}/payWithCreditCard`, {
                    method: 'POST',
                    headers: this.getHeaders(),
                    body: JSON.stringify({
                        creditCard: cardPayload,
                        creditCardHolderInfo: holderPayload
                    })
                });

                const payData = await payRes.json();
                if (payRes.ok && (payData.status === 'CONFIRMED' || payData.status === 'RECEIVED')) {
                    return payData;
                } else if (!payRes.ok) {
                    const msg = payData.errors ? payData.errors.map(e => e.description).join('; ') : 'Erro ao processar pagamento com cartão';
                    throw new Error(msg);
                }
            }

            // Caso não tenha paymentId ou precise criar nova cobrança de cartão
            let dueDate = vencimento;
            if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
                dueDate = new Date().toISOString().split('T')[0];
            }

            const createRes = await fetch(`${this.baseUrl}/payments`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    customer: customerId,
                    billingType: 'CREDIT_CARD',
                    value: valNum,
                    dueDate: dueDate,
                    description: descricao || 'Pagamento com Cartão de Crédito - PRO COMBATE',
                    externalReference: externalReference || undefined,
                    creditCard: cardPayload,
                    creditCardHolderInfo: holderPayload,
                    remoteIp: remoteIp || undefined
                })
            });

            const createData = await createRes.json();
            if (!createRes.ok) {
                const msg = createData.errors ? createData.errors.map(e => e.description).join('; ') : 'Erro ao processar cobrança no cartão';
                throw new Error(msg);
            }

            return createData;
        } catch (err) {
            console.error('[AsaasService] Falha ao processar pagamento por cartão:', err.message);
            throw err;
        }
    }

    /**
     * Consulta o status atualizado de uma cobrança no Asaas
     */
    async consultarCobranca(paymentId) {
        if (!paymentId) return null;

        if (!this.isConfigured() || String(paymentId).startsWith('pay_mock_')) {
            return {
                id: paymentId,
                status: 'PENDING',
                is_mock: true
            };
        }

        try {
            const res = await fetch(`${this.baseUrl}/payments/${paymentId}`, {
                method: 'GET',
                headers: this.getHeaders()
            });

            if (!res.ok) {
                throw new Error('Falha ao consultar cobrança no Asaas');
            }

            return await res.json();
        } catch (err) {
            console.error('[AsaasService] Erro ao consultar cobrança:', err.message);
            throw err;
        }
    }
}

module.exports = new AsaasService();

