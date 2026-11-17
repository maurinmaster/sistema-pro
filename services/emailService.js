/**
 * PRO COMBATE - Serviço de E-mails Transacionais
 * Envio de Códigos de Verificação e Redefinição de Senha via Nodemailer / SMTP
 */

const nodemailer = require('nodemailer');

class EmailService {
    constructor() {
        this.transporter = null;
        this.initTransporter();
    }

    initTransporter() {
        const host = process.env.SMTP_HOST;
        const port = parseInt(process.env.SMTP_PORT || '587', 10);
        const secure = process.env.SMTP_SECURE === 'true' || port === 465;
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;

        if (host && user && pass) {
            this.transporter = nodemailer.createTransport({
                host,
                port,
                secure,
                auth: {
                    user,
                    pass
                },
                tls: {
                    // Evita falhas com certificados auto-assinados de provedores locais
                    rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false'
                }
            });
            console.log(`📧 [EmailService] SMTP configurado: ${host}:${port} (${user})`);
        } else {
            this.transporter = null;
            console.warn('⚠️ [EmailService] Variáveis SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS) não configuradas no .env. E-mails serão logados no console.');
        }
    }

    getFromAddress() {
        const user = process.env.SMTP_USER;
        const host = (process.env.SMTP_HOST || '').toLowerCase();

        // Para provedores como Gmail, o e-mail de envio deve bater com o usuário autenticado
        if (host.includes('gmail') && user) {
            const rawFrom = process.env.SMTP_FROM || 'GESTOR-PRO';
            const nameMatch = rawFrom.match(/^"?([^"<]+)"?/);
            const displayName = nameMatch ? nameMatch[1].trim() : 'GESTOR-PRO';
            return `"${displayName}" <${user}>`;
        }

        return process.env.SMTP_FROM || `"PRO COMBATE" <${user || 'procombatesanda@gmail.com'}>`;
    }

    /**
     * Envia e-mail com código de 6 dígitos para verificação de conta
     */
    async sendVerificationEmail(toEmail, nomeDestinatario, codigo) {
        const from = this.getFromAddress();
        const nome = (nomeDestinatario || 'Atleta').split(' ')[0];

        const subject = `${codigo} é o seu código de confirmação • PRO COMBATE`;

        const textContent = `Olá, ${nome}!\n\n` +
            `Seu código de verificação para ativar sua conta no PRO COMBATE é:\n\n` +
            `👉 ${codigo}\n\n` +
            `Este código expira em 24 horas. Se você não solicitou este cadastro, desconsidere este e-mail.\n\n` +
            `Equipe PRO COMBATE`;

        const htmlContent = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Código de Ativação</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #090d16; padding: 32px 16px;">
                <tr>
                    <td align="center">
                        <table role="presentation" width="100%" style="max-width: 520px; background-color: #0f172a; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.08); overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                            <!-- Cabeçalho -->
                            <tr>
                                <td style="padding: 32px 28px 20px 28px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.06);">
                                    <div style="display: inline-block; padding: 6px 14px; background-color: rgba(2, 132, 199, 0.15); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 9999px; color: #38bdf8; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">
                                        🥋 Artes Marciais • CT PRO
                                    </div>
                                    <h1 style="margin: 14px 0 0 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">
                                        PRO <span style="color: #38bdf8;">COMBATE</span>
                                    </h1>
                                </td>
                            </tr>

                            <!-- Conteúdo -->
                            <tr>
                                <td style="padding: 28px 28px 24px 28px;">
                                    <h2 style="margin: 0 0 12px 0; color: #ffffff; font-size: 18px; font-weight: 700;">
                                        Olá, ${nome}! 👋
                                    </h2>
                                    <p style="margin: 0 0 20px 0; color: #94a3b8; font-size: 14px; line-height: 1.5;">
                                        Obrigado por se cadastrar no <strong>PRO COMBATE</strong>. Para ativar seu acesso ao portal de treinos e graduações, utilize o código de segurança abaixo:
                                    </p>

                                    <!-- Caixa do Código -->
                                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
                                        <tr>
                                            <td align="center" style="background: linear-gradient(135deg, rgba(2, 132, 199, 0.15), rgba(99, 102, 241, 0.1)); border: 2px dashed #0284c7; border-radius: 12px; padding: 22px;">
                                                <div style="font-size: 11px; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px;">
                                                    Seu Código de Ativação
                                                </div>
                                                <div style="font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #ffffff;">
                                                    ${codigo}
                                                </div>
                                                <div style="font-size: 12px; color: #94a3b8; margin-top: 6px;">
                                                    Válido por 24 horas
                                                </div>
                                            </td>
                                        </tr>
                                    </table>

                                    <p style="margin: 0 0 12px 0; color: #64748b; font-size: 12px; line-height: 1.4;">
                                        🔒 <strong>Dica de segurança:</strong> Nunca compartilhe este código com ninguém. Nossa equipe nunca pedirá seu código por mensagem ou telefone.
                                    </p>
                                    <p style="margin: 0; color: #64748b; font-size: 12px; line-height: 1.4;">
                                        Se você não realizou este cadastro, pode ignorar este e-mail com segurança.
                                    </p>
                                </td>
                            </tr>

                            <!-- Rodapé -->
                            <tr>
                                <td style="padding: 16px 28px 24px 28px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.06); color: #64748b; font-size: 11px;">
                                    © ${new Date().getFullYear()} PRO COMBATE. Todos os direitos reservados.<br>
                                    Gestão Profissional de Artes Marciais & Atletas.
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        `;

        return this.sendMail({
            from,
            to: toEmail,
            subject,
            text: textContent,
            html: htmlContent
        }, codigo);
    }

    /**
     * Envia e-mail com código de 6 dígitos para redefinição de senha
     */
    async sendPasswordResetEmail(toEmail, nomeDestinatario, codigo) {
        const from = this.getFromAddress();
        const nome = (nomeDestinatario || 'Atleta').split(' ')[0];

        const subject = `${codigo} é o seu código para redefinir sua senha • PRO COMBATE`;

        const textContent = `Olá, ${nome}!\n\n` +
            `Recebemos uma solicitação para redefinir a senha da sua conta no PRO COMBATE.\n\n` +
            `Seu código de recuperação é:\n\n` +
            `👉 ${codigo}\n\n` +
            `Este código expira em 1 hora. Se você não solicitou a troca de senha, sua conta continua segura e você pode ignorar este e-mail.\n\n` +
            `Equipe PRO COMBATE`;

        const htmlContent = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Recuperação de Senha</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #090d16; padding: 32px 16px;">
                <tr>
                    <td align="center">
                        <table role="presentation" width="100%" style="max-width: 520px; background-color: #0f172a; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.08); overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                            <!-- Cabeçalho -->
                            <tr>
                                <td style="padding: 32px 28px 20px 28px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.06);">
                                    <div style="display: inline-block; padding: 6px 14px; background-color: rgba(2, 132, 199, 0.15); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 9999px; color: #38bdf8; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">
                                        🔑 Redefinição de Senha
                                    </div>
                                    <h1 style="margin: 14px 0 0 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">
                                        PRO <span style="color: #38bdf8;">COMBATE</span>
                                    </h1>
                                </td>
                            </tr>

                            <!-- Conteúdo -->
                            <tr>
                                <td style="padding: 28px 28px 24px 28px;">
                                    <h2 style="margin: 0 0 12px 0; color: #ffffff; font-size: 18px; font-weight: 700;">
                                        Olá, ${nome}!
                                    </h2>
                                    <p style="margin: 0 0 20px 0; color: #94a3b8; font-size: 14px; line-height: 1.5;">
                                        Recebemos um pedido para alterar a senha da sua conta de atleta. Use o código abaixo no portal para criar sua nova senha:
                                    </p>

                                    <!-- Caixa do Código -->
                                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
                                        <tr>
                                            <td align="center" style="background: linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(2, 132, 199, 0.1)); border: 2px dashed #f59e0b; border-radius: 12px; padding: 22px;">
                                                <div style="font-size: 11px; font-weight: 700; color: #f59e0b; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px;">
                                                    Código de Recuperação
                                                </div>
                                                <div style="font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #ffffff;">
                                                    ${codigo}
                                                </div>
                                                <div style="font-size: 12px; color: #94a3b8; margin-top: 6px;">
                                                    Expira em 1 hora
                                                </div>
                                            </td>
                                        </tr>
                                    </table>

                                    <p style="margin: 0 0 12px 0; color: #64748b; font-size: 12px; line-height: 1.4;">
                                        Se você não fez essa solicitação, fique tranquilo: sua senha atual não foi alterada e sua conta permanece segura.
                                    </p>
                                </td>
                            </tr>

                            <!-- Rodapé -->
                            <tr>
                                <td style="padding: 16px 28px 24px 28px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.06); color: #64748b; font-size: 11px;">
                                    © ${new Date().getFullYear()} PRO COMBATE. Todos os direitos reservados.
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        `;

        return this.sendMail({
            from,
            to: toEmail,
            subject,
            text: textContent,
            html: htmlContent
        }, codigo);
    }

    /**
     * Helper de envio real ou fallback para log
     */
    async sendMail(mailOptions, codigo) {
        if (!this.transporter) {
            console.log(`\n======================================================`);
            console.log(`[SIMULAÇÃO DE EMAIL] Destinatário: ${mailOptions.to}`);
            console.log(`[SIMULAÇÃO DE EMAIL] Assunto:      ${mailOptions.subject}`);
            console.log(`[SIMULAÇÃO DE EMAIL] CÓDIGO:       >>> ${codigo} <<<`);
            console.log(`💡 Para envio real, preencha SMTP_HOST, SMTP_PORT, SMTP_USER e SMTP_PASS no .env`);
            console.log(`======================================================\n`);
            return {
                success: true,
                simulated: true,
                message: 'E-mail simulado no console pois SMTP não está configurado no .env.'
            };
        }

        try {
            const info = await this.transporter.sendMail(mailOptions);
            console.log(`✅ [EmailService] E-mail enviado com sucesso para ${mailOptions.to} (ID: ${info.messageId})`);
            return {
                success: true,
                simulated: false,
                messageId: info.messageId
            };
        } catch (err) {
            console.error(`❌ [EmailService] Erro ao enviar e-mail para ${mailOptions.to}:`, err.message);
            throw err;
        }
    }

    /**
     * Escapa caracteres HTML para evitar injeção em templates de e-mail.
     */
    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Constrói um template HTML padronizado com a identidade PRO COMBATE.
     */
    buildBrandedEmailHtml({
        badgeText = 'COMUNICADO OFICIAL',
        titulo = 'Aviso da Academia',
        saudacao = 'Olá,',
        mensagem = '',
        detalhes = [],
        ctaLabel = '',
        ctaUrl = ''
    }) {
        const safeBadge = this.escapeHtml(badgeText);
        const safeTitulo = this.escapeHtml(titulo);
        const safeSaudacao = this.escapeHtml(saudacao);
        const safeMensagemHtml = this.escapeHtml(mensagem).replace(/\r?\n/g, '<br>');

        const validDetalhes = Array.isArray(detalhes)
            ? detalhes.filter(d => d && d.label && d.value !== undefined && d.value !== null && String(d.value).trim() !== '')
            : [];

        const detalhesHtml = validDetalhes.length > 0
            ? `
                <div style="margin: 20px 0; background-color: #11141c; border: 1px solid #262c3a; border-radius: 10px; padding: 14px 16px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                        ${validDetalhes.map(d => `
                            <tr>
                                <td style="padding: 6px 0; color: #94a3b8; font-size: 13px; width: 40%; vertical-align: top;">${this.escapeHtml(d.label)}</td>
                                <td style="padding: 6px 0; color: #f8fafc; font-size: 13px; font-weight: 600; text-align: right; vertical-align: top;">${this.escapeHtml(d.value)}</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
            `
            : '';

        const safeUrl = typeof ctaUrl === 'string' && /^https?:\/\//i.test(ctaUrl.trim()) ? ctaUrl.trim() : '';
        const ctaHtml = safeUrl && ctaLabel
            ? `
                <div style="margin-top: 24px; text-align: center;">
                    <a href="${this.escapeHtml(safeUrl)}" style="display: inline-block; background-color: #f97316; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 24px; border-radius: 8px;">
                        ${this.escapeHtml(ctaLabel)}
                    </a>
                </div>
            `
            : '';

        return `
            <div style="background-color: #0b0e14; padding: 28px 16px; font-family: Arial, Helvetica, sans-serif; color: #e2e8f0;">
                <div style="max-width: 560px; margin: 0 auto; background-color: #161a23; border: 1px solid #262c3a; border-radius: 14px; overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #1b202c 0%, #12161f 100%); padding: 22px 24px; border-bottom: 1px solid #262c3a;">
                        <div style="font-size: 11px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #fb923c; margin-bottom: 8px;">
                            ${safeBadge}
                        </div>
                        <h1 style="margin: 0; font-size: 20px; line-height: 1.3; color: #ffffff; font-weight: 700;">
                            ${safeTitulo}
                        </h1>
                    </div>
                    <div style="padding: 24px;">
                        <p style="margin: 0 0 14px 0; font-size: 15px; color: #f8fafc; font-weight: 600;">
                            ${safeSaudacao}
                        </p>
                        <div style="font-size: 14px; line-height: 1.65; color: #cbd5e1;">
                            ${safeMensagemHtml}
                        </div>
                        ${detalhesHtml}
                        ${ctaHtml}
                    </div>
                    <div style="padding: 16px 24px; background-color: #11141c; border-top: 1px solid #262c3a; text-align: center;">
                        <p style="margin: 0; font-size: 12px; color: #64748b;">
                            PRO COMBATE • Portal do Aluno<br>
                            Este é um e-mail automático, por favor não responda.
                        </p>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Envia uma notificação por e-mail para um aluno de forma segura e não-bloqueante.
     */
    async sendNotificationEmail({
        toEmail,
        nomeDestinatario = '',
        badgeText = 'COMUNICADO',
        titulo = 'Aviso PRO COMBATE',
        assunto,
        mensagem = '',
        detalhes = [],
        ctaLabel = 'Acessar Portal do Aluno',
        ctaUrl = process.env.PORTAL_URL || 'https://gestor.procombate.com/portal-aluno.html'
    }) {
        const cleanEmail = typeof toEmail === 'string' ? toEmail.trim() : '';
        if (!cleanEmail || !cleanEmail.includes('@')) {
            return { success: false, skipped: true, reason: 'E-mail inválido ou ausente' };
        }

        const primeiroNome = nomeDestinatario ? String(nomeDestinatario).trim().split(/\s+/)[0] : '';
        const saudacao = primeiroNome ? `Olá, ${primeiroNome}!` : 'Olá!';
        const subject = assunto || `${titulo} — PRO COMBATE`;

        const html = this.buildBrandedEmailHtml({
            badgeText,
            titulo,
            saudacao,
            mensagem,
            detalhes,
            ctaLabel,
            ctaUrl
        });

        const detalhesTexto = Array.isArray(detalhes) && detalhes.length > 0
            ? '\n\n' + detalhes.filter(d => d && d.label && d.value !== undefined).map(d => `${d.label}: ${d.value}`).join('\n')
            : '';

        const text = `${saudacao}\n\n${titulo}\n${mensagem}${detalhesTexto}\n\nAcesse o Portal do Aluno: ${ctaUrl}\n\nPRO COMBATE`;

        try {
            const info = await this.sendMail({
                from: this.getFromAddress(),
                to: cleanEmail,
                subject,
                text,
                html
            });
            return { success: true, messageId: info?.messageId || null };
        } catch (err) {
            console.warn(`[EmailService] Falha ao enviar notificação para ${cleanEmail}:`, err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * Envia notificações em lote (batches de 10) sem interromper em falhas individuais.
     */
    async sendBulkNotificationEmails(recipients, payloadOrBuilder) {
        if (!Array.isArray(recipients) || recipients.length === 0) {
            return { total_destinatarios: 0, enviados: 0, falhas: 0 };
        }

        const seen = new Set();
        const validRecipients = [];
        for (const r of recipients) {
            const email = typeof r?.email === 'string' ? r.email.trim() : '';
            if (!email || !email.includes('@')) continue;
            const key = email.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            validRecipients.push({
                ...r,
                email,
                nome: r.nome_completo || r.nome || ''
            });
        }

        let enviados = 0;
        let falhas = 0;
        const BATCH_SIZE = 10;

        for (let i = 0; i < validRecipients.length; i += BATCH_SIZE) {
            const batch = validRecipients.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(
                batch.map(recipient => {
                    const payload = typeof payloadOrBuilder === 'function'
                        ? payloadOrBuilder(recipient)
                        : payloadOrBuilder;
                    return this.sendNotificationEmail({
                        ...payload,
                        toEmail: recipient.email,
                        nomeDestinatario: recipient.nome
                    });
                })
            );

            for (const res of results) {
                if (res.status === 'fulfilled' && res.value?.success) {
                    enviados++;
                } else {
                    falhas++;
                }
            }
        }

        return {
            total_destinatarios: validRecipients.length,
            enviados,
            falhas
        };
    }
}

// Exporta instância única (Singleton)
const emailServiceInstance = new EmailService();
module.exports = emailServiceInstance;

