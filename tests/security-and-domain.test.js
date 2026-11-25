process.env.NODE_ENV = 'test';
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const {
    calculateAge,
    validateMinorGuardian,
    evaluateCheckinEligibility,
    classifyPlanTransition,
    computeNextDueDate,
    hasValidImageSignature
} = require('../services/domainRules');

const UI = require('../public/js/ui');
const { JWT_SECRET, createRateLimiter } = require('../middlewares/auth');
const app = require('../server');
const pool = require('../db/connection');

// ============================================================================
// 1. TESTES UNITÁRIOS DE REGRAS DE DOMÍNIO (services/domainRules.js)
// ============================================================================
test('Regras de Domínio: calculateAge e validateMinorGuardian', () => {
    const refDate = new Date('2026-10-28T12:00:00Z');

    assert.equal(calculateAge('2012-06-15', refDate), 14);
    assert.equal(calculateAge('1995-04-12', refDate), 31);
    assert.equal(calculateAge('invalid-date', refDate), null);

    // Menor sem responsável deve ser rejeitado
    const minorFail = validateMinorGuardian('2012-06-15', '', '', refDate);
    assert.equal(minorFail.valid, false);
    assert.equal(minorFail.isMinor, true);

    // Menor com nome e telefone de responsável deve ser aprovado
    const minorOk = validateMinorGuardian('2012-06-15', 'Marcos Carvalho', '(11) 98833-1100', refDate);
    assert.equal(minorOk.valid, true);
    assert.equal(minorOk.isMinor, true);

    // Maior de idade não exige responsável
    const adultOk = validateMinorGuardian('1998-09-23', null, null, refDate);
    assert.equal(adultOk.valid, true);
    assert.equal(adultOk.isMinor, false);
});

test('Regras de Domínio: evaluateCheckinEligibility', () => {
    assert.deepEqual(evaluateCheckinEligibility('bloqueado', 0), {
        status: 'bloqueado',
        motivoBloqueio: 'Aluno bloqueado na secretaria'
    });
    assert.deepEqual(evaluateCheckinEligibility('trancado', 0), {
        status: 'bloqueado',
        motivoBloqueio: 'Matrícula trancada'
    });
    assert.deepEqual(evaluateCheckinEligibility('inativo', 0), {
        status: 'bloqueado',
        motivoBloqueio: 'Aluno inativo'
    });
    assert.deepEqual(evaluateCheckinEligibility('ativo', 2), {
        status: 'aprovado',
        motivoBloqueio: 'Possui fatura em atraso (Notificado)'
    });
    assert.deepEqual(evaluateCheckinEligibility('ativo', 0), {
        status: 'aprovado',
        motivoBloqueio: null
    });
});

test('Regras de Domínio: classifyPlanTransition e computeNextDueDate', () => {
    const upgrade = classifyPlanTransition(159.90, 219.90, undefined);
    assert.equal(upgrade.isUpgrade, true);
    assert.equal(upgrade.tipoTransicao, 'upgrade');
    assert.equal(upgrade.valorFinal, 219.90);

    const downgradeComAcordo = classifyPlanTransition(219.90, 169.90, 149.90);
    assert.equal(downgradeComAcordo.isUpgrade, false);
    assert.equal(downgradeComAcordo.tipoTransicao, 'downgrade');
    assert.equal(downgradeComAcordo.valorFinal, 149.90);

    const refDate = new Date('2026-10-20T12:00:00Z');
    const nextMonth = computeNextDueDate(10, refDate, 'next_month_if_past');
    assert.equal(nextMonth.competencia, '2026-10');
    assert.equal(nextMonth.dataVencimento, '2026-11-10');
});

// ============================================================================
// 2. TESTES DE SANITIZAÇÃO XSS E EVENTBUS NO FRONTEND (public/js/ui.js)
// ============================================================================
test('Segurança Frontend: UI.escapeHtml, UI.sanitizeUrl e UI.sanitizeColor', () => {
    const xssPayload = `<img src=x onerror="alert('xss')">&'`;
    const escaped = UI.escapeHtml(xssPayload);
    assert.ok(!escaped.includes('<img'));
    assert.equal(escaped, '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;&amp;&#39;');

    // Bloqueio de javascript: e data: em URLs de imagens
    assert.equal(UI.sanitizeUrl('javascript:alert(1)', '/fallback.png'), '/fallback.png');
    assert.equal(UI.sanitizeUrl('data:text/html,<script>alert(1)</script>', '/fallback.png'), '/fallback.png');
    assert.equal(UI.sanitizeUrl('/uploads/alunos/aluno-123.jpg', '/fallback.png'), '/uploads/alunos/aluno-123.jpg');

    // Bloqueio de CSS injection em cores
    assert.equal(UI.sanitizeColor('red; background:url(javascript:alert(1))', '#000000'), '#000000');
    assert.equal(UI.sanitizeColor('#2563EB', '#000000'), '#2563EB');

    // EventBus desacoplado
    let receivedPayload = null;
    UI.on('test:event', (data) => { receivedPayload = data; });
    UI.emit('test:event', { alunoId: 42 });
    assert.deepEqual(receivedPayload, { alunoId: 42 });

    // Formatação tolerante de entradas (Lei de Postel)
    assert.equal(UI.formatCPF('12345678901'), '123.456.789-01');
    assert.equal(UI.formatPhone('11988887777'), '(11) 98888-7777');
    assert.equal(UI.formatPhone('1133334444'), '(11) 3333-4444');
});

// ============================================================================
// 3. TESTES DE ASSINATURA BINÁRIA (MAGIC BYTES) DE UPLOAD (routes/alunos.js)
// ============================================================================
test('Segurança de Upload: hasValidImageSignature valida magic bytes reais', () => {
    const tmpDir = os.tmpdir();
    const validJpg = path.join(tmpDir, `test-valid-${Date.now()}.jpg`);
    const validPng = path.join(tmpDir, `test-valid-${Date.now()}.png`);
    const validGif = path.join(tmpDir, `test-valid-${Date.now()}.gif`);
    const fakeJpg = path.join(tmpDir, `test-fake-${Date.now()}.jpg`);

    try {
        // JPEG real começa com FF D8 FF E0
        fs.writeFileSync(validJpg, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]));
        // PNG real começa com 89 50 4E 47 0D 0A 1A 0A
        fs.writeFileSync(validPng, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]));
        // GIF real começa com GIF89a
        fs.writeFileSync(validGif, Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00', 'binary'));
        // Arquivo malicioso disfarçado de .jpg
        fs.writeFileSync(fakeJpg, '<?php system($_GET["cmd"]); ?>');

        assert.equal(hasValidImageSignature(validJpg), true);
        assert.equal(hasValidImageSignature(validPng), true);
        assert.equal(hasValidImageSignature(validGif), true);
        assert.equal(hasValidImageSignature(fakeJpg), false);
    } finally {
        [validJpg, validPng, validGif, fakeJpg].forEach(f => {
            try { fs.unlinkSync(f); } catch { /* ignore */ }
        });
    }
});

// ============================================================================
// 4. TESTES DE INTEGRAÇÃO HTTP: AUTENTICAÇÃO, RBAC, HEADERS E RATE LIMITER
// ============================================================================
test('Segurança da API: Headers HTTP, Autenticação Obrigatória e RBAC por Cargo', async () => {
    const server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        // 4.1. Verifica cabeçalhos de segurança no Healthcheck
        const healthRes = await fetch(`${baseUrl}/api/health`);
        assert.equal(healthRes.status, 200);
        assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(healthRes.headers.get('x-frame-options'), 'DENY');
        assert.equal(healthRes.headers.get('x-powered-by'), null);
        assert.ok(healthRes.headers.get('content-security-policy')?.includes("default-src 'self'"));

        // 4.2. Rotas protegidas devem negar acesso sem token (HTTP 401)
        const protectedEndpoints = [
            '/api/dashboard/stats',
            '/api/alunos',
            '/api/modalidades',
            '/api/modalidades/equipe/professores',
            '/api/planos',
            '/api/checkins/turmas',
            '/api/faturas'
        ];

        for (const endpoint of protectedEndpoints) {
            const res = await fetch(`${baseUrl}${endpoint}`);
            assert.equal(res.status, 401, `Endpoint ${endpoint} deveria exigir autenticação (401)`);
        }

        // 4.3. RBAC: Perfil 'professor' deve ser bloqueado (HTTP 403) em rotas financeiras e administrativas
        const profToken = jwt.sign(
            { id: 2, nome: 'Prof. Teste', email: 'prof@ctpro.com.br', cargo: 'professor' },
            JWT_SECRET,
            { algorithm: 'HS256', expiresIn: '5m' }
        );

        const faturasRes = await fetch(`${baseUrl}/api/faturas`, {
            headers: { Authorization: `Bearer ${profToken}` }
        });
        assert.equal(faturasRes.status, 403, 'Professor não deve acessar listagem de faturas');

        const deleteAlunoRes = await fetch(`${baseUrl}/api/alunos/1`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${profToken}` }
        });
        assert.equal(deleteAlunoRes.status, 403, 'Professor não deve poder excluir/inativar alunos');
    } finally {
        server.close();
    }
});

// ============================================================================
// 5. TESTES DO NOVO SISTEMA DE AUTO-CADASTRO E AUTENTICAÇÃO RELACIONAL
// ============================================================================
test('Segurança e Autenticação: Fluxo completo de Auto-cadastro, Verificação de E-mail, Auditoria e Sessões', async () => {
    const server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    const testEmail = `atleta.teste.${Date.now()}@exemplo.com`;

    try {
        // 5.1. Validação de menor de 18 anos sem responsável deve retornar HTTP 400
        const minorFailRes = await fetch(`${baseUrl}/api/auth/cadastro-aluno`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nome_completo: 'Jovem Guerreiro Menor',
                data_nascimento: '2012-05-10',
                genero: 'M',
                email: testEmail,
                senha: 'senhaSegura123',
                telefone_whatsapp: '(11) 99999-1111',
                responsavel_nome: '',
                responsavel_telefone: ''
            })
        });
        assert.equal(minorFailRes.status, 400, 'Cadastro de menor sem responsável deve ser rejeitado');
        const minorFailBody = await minorFailRes.json();
        assert.equal(minorFailBody.success, false);

        // 5.1b. Cadastro sem foto de perfil deve ser rejeitado (foto obrigatória)
        const noPhotoRes = await fetch(`${baseUrl}/api/auth/cadastro-aluno`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nome_completo: 'Guerreiro Sem Foto',
                data_nascimento: '1998-07-20',
                genero: 'M',
                email: testEmail,
                senha: 'minhaSenhaForte2026',
                telefone_whatsapp: '(11) 98888-2222',
                consentimento_biometria_lgpd: 1
            })
        });
        assert.equal(noPhotoRes.status, 400, 'Cadastro sem foto de perfil deve ser rejeitado');
        const noPhotoBody = await noPhotoRes.json();
        assert.equal(noPhotoBody.success, false);

        // 5.2. Auto-cadastro bem-sucedido com dados válidos
        const cadRes = await fetch(`${baseUrl}/api/auth/cadastro-aluno`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nome_completo: 'Guerreiro Teste Silva',
                data_nascimento: '1998-07-20',
                genero: 'M',
                cpf: null,
                email: testEmail,
                senha: 'minhaSenhaForte2026',
                telefone_whatsapp: '(11) 98888-2222',
                foto_perfil_url: '/uploads/alunos/foto-teste.jpg',
                consentimento_biometria_lgpd: 1
            })
        });
        assert.equal(cadRes.status, 201, 'Cadastro com dados válidos deve retornar 201');
        const cadBody = await cadRes.json();
        assert.equal(cadBody.success, true);
        assert.ok(cadBody.aluno_id > 0);
        assert.ok(cadBody.usuario_id > 0);
        assert.ok(cadBody.codigo_verificacao_dev);

        const codigoGerado = cadBody.codigo_verificacao_dev;

        // 5.3. Verifica integridade no banco de dados (tabelas relacionais)
        const [uaRows] = await pool.query('SELECT * FROM usuarios_alunos WHERE email = ?', [testEmail]);
        assert.equal(uaRows.length, 1);
        assert.equal(uaRows[0].status, 'pendente_verificacao');
        assert.equal(uaRows[0].email_verificado, 0);

        const [verifRows] = await pool.query('SELECT * FROM verificacoes_email WHERE usuario_id = ?', [uaRows[0].id]);
        assert.equal(verifRows.length, 1);
        assert.equal(verifRows[0].codigo_verificacao, codigoGerado);
        assert.equal(verifRows[0].verificado, 0);

        // 5.4. Tentativa de validação com código incorreto deve falhar (HTTP 400)
        const wrongCodeRes = await fetch(`${baseUrl}/api/auth/verificar-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, codigo: '999999' })
        });
        assert.equal(wrongCodeRes.status, 400);

        // 5.5. Validação com código correto ativa o usuário e gera sessão
        const verifyOkRes = await fetch(`${baseUrl}/api/auth/verificar-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, codigo: codigoGerado })
        });
        assert.equal(verifyOkRes.status, 200);
        const verifyOkBody = await verifyOkRes.json();
        assert.equal(verifyOkBody.success, true);
        assert.ok(verifyOkBody.token, 'Deve retornar token JWT válido ao ativar');

        // Confirma ativação no banco
        const [uaActive] = await pool.query('SELECT * FROM usuarios_alunos WHERE email = ?', [testEmail]);
        assert.equal(uaActive[0].status, 'ativo');
        assert.equal(uaActive[0].email_verificado, 1);

        // 5.6. Login do aluno cadastrado registra auditoria (tentativas_login) e sessão (sessoes_usuarios)
        const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, senha: 'minhaSenhaForte2026' })
        });
        assert.equal(loginRes.status, 200);
        const loginBody = await loginRes.json();
        assert.equal(loginBody.success, true);
        assert.equal(loginBody.user.cargo, 'aluno');

        // Verifica registro em sessoes_usuarios
        const [sessRows] = await pool.query('SELECT * FROM sessoes_usuarios WHERE usuario_id = ?', [uaActive[0].id]);
        assert.ok(sessRows.length >= 1, 'Deve possuir registro de sessão ativa');
        assert.ok(sessRows[0].token_hash.length === 64, 'Token hash deve ser SHA-256');

        // Verifica registro em tentativas_login
        const [tentRows] = await pool.query('SELECT * FROM tentativas_login WHERE email = ?', [testEmail]);
        assert.ok(tentRows.length >= 1, 'Tentativa de login deve ser auditada');
        assert.equal(tentRows[tentRows.length - 1].sucesso, 1);

        // 5.7. Fluxo de Esqueci a Senha e Redefinição
        const forgotRes = await fetch(`${baseUrl}/api/auth/esqueci-senha`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail })
        });
        assert.equal(forgotRes.status, 200);
        const forgotBody = await forgotRes.json();
        assert.ok(forgotBody.codigo_recuperacao_dev);

        const resetRes = await fetch(`${baseUrl}/api/auth/redefinir-senha`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail,
                codigo: forgotBody.codigo_recuperacao_dev,
                nova_senha: 'novaSenhaAlterada2026'
            })
        });
        assert.equal(resetRes.status, 200);

        // Login com a nova senha deve funcionar
        const loginNewRes = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, senha: 'novaSenhaAlterada2026' })
        });
        assert.equal(loginNewRes.status, 200);

    } finally {
        server.close();
    }
});

test('Segurança da API: Rate Limiter bloqueia excesso de requisições (HTTP 429)', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 2, message: 'Bloqueado por rate limit' });

    const runMiddleware = () => {
        let statusCode = 200;
        let jsonBody = null;
        let nextCalled = false;
        const req = { ip: '192.168.1.99', headers: {} };
        const res = {
            setHeader() {},
            status(code) { statusCode = code; return this; },
            json(payload) { jsonBody = payload; return this; }
        };
        limiter(req, res, () => { nextCalled = true; });
        return { statusCode, jsonBody, nextCalled };
    };

    assert.equal(runMiddleware().nextCalled, true);
    assert.equal(runMiddleware().nextCalled, true);
    const thirdAttempt = runMiddleware();
    assert.equal(thirdAttempt.nextCalled, false);
    assert.equal(thirdAttempt.statusCode, 429);
    assert.equal(thirdAttempt.jsonBody.error, 'Bloqueado por rate limit');
});

test('Serviço de E-mail: Geração e Envio de Códigos Transacionais', async () => {
    const emailService = require('../services/emailService');

    // Teste de e-mail de ativação
    const resVerif = await emailService.sendVerificationEmail('novo.atleta@exemplo.com', 'Lucas Santos', '123456');
    assert.equal(resVerif.success, true);

    // Teste de e-mail de recuperação de senha
    const resReset = await emailService.sendPasswordResetEmail('novo.atleta@exemplo.com', 'Lucas Santos', '654321');
    assert.equal(resReset.success, true);

    // Teste de sanitização HTML e construção de template de notificação
    const htmlSeguro = emailService.buildBrandedEmailHtml({
        badgeText: '<script>alert(1)</script>',
        titulo: 'Aviso <b>Importante</b>',
        saudacao: 'Olá, Lucas!',
        mensagem: 'Treino amanhã\nConfirmado!',
        detalhes: [{ label: 'Status', value: '<img src=x onerror=alert(1)>' }],
        ctaLabel: 'Abrir Portal',
        ctaUrl: 'javascript:alert(1)'
    });
    assert.equal(htmlSeguro.includes('<script>'), false);
    assert.equal(htmlSeguro.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
    assert.equal(htmlSeguro.includes('javascript:alert(1)'), false);
    assert.equal(htmlSeguro.includes('Treino amanhã<br>Confirmado!'), true);

    // Teste de envio de notificação individual e em lote
    const resNotif = await emailService.sendNotificationEmail({
        toEmail: 'atleta@exemplo.com',
        nomeDestinatario: 'Lucas Santos',
        titulo: 'Avaliação Atualizada',
        mensagem: 'Você atingiu 92% de aproveitamento.'
    });
    assert.equal(resNotif.success, true);

    const resInvalid = await emailService.sendNotificationEmail({
        toEmail: '',
        titulo: 'Teste',
        mensagem: 'Sem e-mail'
    });
    assert.equal(resInvalid.success, false);
    assert.equal(resInvalid.skipped, true);

    const resBulk = await emailService.sendBulkNotificationEmails([
        { email: 'a@exemplo.com', nome_completo: 'Aluno A' },
        { email: 'A@exemplo.com', nome_completo: 'Aluno A Duplicado' },
        { email: 'b@exemplo.com', nome_completo: 'Aluno B' },
        { email: '', nome_completo: 'Sem Email' }
    ], {
        titulo: 'Aviso Geral',
        mensagem: 'Comunicado de teste.'
    });
    assert.equal(resBulk.total_destinatarios, 2);
    assert.equal(resBulk.enviados, 2);
    assert.equal(resBulk.falhas, 0);
});

test('Serviço de WhatsApp (Baileys): Normalização, Status e Envio Seguro', async () => {
    const whatsappService = require('../services/whatsappService');

    assert.equal(whatsappService.normalizePhoneToDigits('(11) 98888-7777'), '5511988887777');
    assert.equal(whatsappService.normalizePhoneToDigits('5511988887777'), '5511988887777');
    assert.equal(whatsappService.normalizePhoneToDigits('12345'), null);

    const status = whatsappService.getStatus();
    assert.equal(status.status, 'disconnected');

    const skipRes = await whatsappService.sendTextMessage('(11) 98888-7777', 'Teste');
    assert.equal(skipRes.success, false);
    assert.equal(skipRes.skipped, true);

    const baileys = await whatsappService.loadBaileys();
    assert.equal(typeof baileys.default, 'function');
    assert.equal(typeof baileys.useMultiFileAuthState, 'function');
});

test('Configurações de Mensagens: Catálogo, Validação, Templates e Link do Portal', () => {
    const notificationConfigService = require('../services/notificationConfigService');

    const catalog = notificationConfigService.getCatalog();
    assert.equal(catalog.length, 12);

    const presets = notificationConfigService.getManualPresets();
    assert.ok(presets.length >= 6);
    assert.equal(presets.some(p => p.id === 'link_portal'), true);

    // Renderização com placeholder {link}
    const comPlaceholder = notificationConfigService.renderTemplate(
        'Olá {nome}! Valor: {valor}. Acesse {link}',
        { nome: 'Lucas', valor: 'R$ 120,00' },
        { includeLink: true, portalUrl: 'https://gestor.procombate.com/' }
    );
    assert.equal(comPlaceholder, 'Olá Lucas! Valor: R$ 120,00. Acesse https://gestor.procombate.com');

    // Renderização sem placeholder {link} mas com includeLink: true deve anexar no final
    const anexado = notificationConfigService.renderTemplate(
        'Olá {nome}! Pagamento aprovado.',
        { nome: 'Maria' },
        { includeLink: true, portalUrl: 'https://gestor.procombate.com' }
    );
    assert.equal(anexado.includes('https://gestor.procombate.com'), true);

    // Renderização com includeLink: false deve remover {link}
    const semLink = notificationConfigService.renderTemplate(
        'Olá {nome}! Veja aqui: {link}',
        { nome: 'Carlos' },
        { includeLink: false, portalUrl: 'https://gestor.procombate.com' }
    );
    assert.equal(semLink.includes('https://gestor.procombate.com'), false);
    assert.equal(semLink.includes('{link}'), false);

    // Validação deve rejeitar URL perigosa e ignorar chaves desconhecidas
    const normalized = notificationConfigService.validateAndNormalizeConfig({
        portal_url: 'javascript:alert(1)',
        incluir_link_padrao: false,
        admin_whatsapp: ' 11999998888 ',
        regras: {
            chave_inexistente: { aluno_whatsapp: true },
            avaliacao_graduacao: {
                aluno_whatsapp: false,
                aluno_email: true,
                incluir_link: false,
                mensagem_aluno: 'Custom {nome}'
            }
        }
    });
    assert.equal(normalized.portal_url, 'https://gestor.procombate.com');
    assert.equal(normalized.incluir_link_padrao, false);
    assert.equal(normalized.admin_whatsapp, '11999998888');
    assert.equal(normalized.regras.chave_inexistente, undefined);
    assert.equal(normalized.regras.avaliacao_graduacao.aluno_whatsapp, false);
    assert.equal(normalized.regras.avaliacao_graduacao.aluno_email, true);
    assert.equal(normalized.regras.avaliacao_graduacao.incluir_link, false);
    assert.equal(normalized.regras.avaliacao_graduacao.mensagem_aluno, 'Custom {nome}');
});

test('Log de Mensagens: Sanitização e Registro Não-Bloqueante', async () => {
    const messageLogService = require('../services/messageLogService');

    const sanitized = messageLogService.sanitizeLogPayload({
        canal: 'invalido',
        tipo: 'a'.repeat(100),
        destinatario: 'd'.repeat(250),
        assunto: 's'.repeat(250),
        status: 'desconhecido',
        erro_detalhe: 'e'.repeat(700),
        message_id: 'm'.repeat(250)
    });

    assert.equal(sanitized.canal, 'email');
    assert.equal(sanitized.status, 'erro');
    assert.equal(sanitized.tipo.length, 60);
    assert.equal(sanitized.destinatario.length, 180);
    assert.equal(sanitized.assunto.length, 200);
    assert.equal(sanitized.erro_detalhe.length, 500);
    assert.equal(sanitized.message_id.length, 180);

    // Registro não deve lançar exceção mesmo com banco local offline
    await messageLogService.recordLog({
        canal: 'whatsapp',
        tipo: 'teste',
        destinatario: '5511999998888',
        assunto: 'Teste não bloqueante',
        status: 'enviado'
    });

    // Metadados de paginação do histórico de envios
    const pag1 = messageLogService.buildPaginationMeta({ page: 1, limit: 15, total: 42 });
    assert.deepEqual(pag1, {
        page: 1,
        limit: 15,
        total: 42,
        total_pages: 3,
        offset: 0,
        has_prev: false,
        has_next: true,
        from: 1,
        to: 15
    });

    const pag2 = messageLogService.buildPaginationMeta({ page: 2, limit: 15, total: 42 });
    assert.equal(pag2.offset, 15);
    assert.equal(pag2.from, 16);
    assert.equal(pag2.to, 30);
    assert.equal(pag2.has_prev, true);
    assert.equal(pag2.has_next, true);

    const pagClamp = messageLogService.buildPaginationMeta({ page: 99, limit: 500, total: 42 });
    assert.equal(pagClamp.limit, 100);
    assert.equal(pagClamp.page, 1);
    assert.equal(pagClamp.total_pages, 1);
    assert.equal(pagClamp.from, 1);
    assert.equal(pagClamp.to, 42);

    const pagLowLimit = messageLogService.buildPaginationMeta({ page: -3, limit: 1, total: 0 });
    assert.deepEqual(pagLowLimit, {
        page: 1,
        limit: 5,
        total: 0,
        total_pages: 1,
        offset: 0,
        has_prev: false,
        has_next: false,
        from: 0,
        to: 0
    });
});

test('Painel do Aluno: Consulta Consolidada, Histórico de Medidas e Comparativo de Evolução', async () => {
    const painelRoutes = require('../routes/painelAluno');
    assert.ok(painelRoutes);

    // Consulta direta ao pool dos dados do painel do aluno 1
    const [aluno] = await pool.query('SELECT id, nome_completo, peso_kg, altura_cm FROM alunos WHERE id = 1');
    assert.ok(aluno.length > 0);
    assert.equal(aluno[0].id, 1);

    // Teste de cálculo de IMC
    const peso = parseFloat(aluno[0].peso_kg);
    const alturaM = parseInt(aluno[0].altura_cm, 10) / 100;
    const imc = parseFloat((peso / (alturaM * alturaM)).toFixed(1));
    assert.ok(imc > 15 && imc < 45);

    // Verifica se avisos e conquistas estão disponíveis
    const [avisos] = await pool.query('SELECT COUNT(*) AS total FROM avisos_campanhas WHERE ativo = 1');
    assert.ok(avisos[0].total >= 1);

    const [conquistas] = await pool.query('SELECT COUNT(*) AS total FROM conquistas');
    assert.ok(conquistas[0].total >= 1);

    // Verifica integridade do histórico físico e comparativo de evolução
    const [historico] = await pool.query(`
        SELECT id, peso_kg, altura_cm, imc, data_medicao
        FROM aluno_historico_medidas
        WHERE aluno_id = 1
        ORDER BY data_medicao ASC
    `);
    assert.ok(historico.length >= 2, 'Aluno 1 deve possuir pelo menos 2 registros no histórico para comparativo');
    
    // Verifica cálculo de delta entre primeira e última medição
    const primeira = historico[0];
    const ultima = historico[historico.length - 1];
    const deltaPeso = Number((parseFloat(ultima.peso_kg) - parseFloat(primeira.peso_kg)).toFixed(1));
    assert.ok(!isNaN(deltaPeso), 'Delta de peso deve ser numérico');

    // Verifica Prajied de Muay Thai da aluna 1 e ícone configurado
    const [gradMuayThai] = await pool.query(`
        SELECT ag.id, gn.nome AS nivel_nome, gn.cor_hex_primaria, gn.cor_hex_secundaria, gn.prajied_icone_url
        FROM aluno_graduacoes ag
        JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
        JOIN modalidades m ON m.id = ag.modalidade_id
        WHERE ag.aluno_id = 1 AND ag.atual = 1 AND m.nome LIKE '%Muay%'
    `);
    assert.equal(gradMuayThai.length, 1, 'Aluno 1 deve ter uma graduação ativa de Muay Thai');
    assert.ok(gradMuayThai[0].cor_hex_primaria.startsWith('#'), 'Cor primária do Prajied deve ser HEX válido');
    assert.ok(gradMuayThai[0].cor_hex_secundaria.startsWith('#'), 'Cor secundária do Prajied deve ser HEX válido');
    assert.ok(gradMuayThai[0].prajied_icone_url.includes('prajied'), 'Graduação deve conter URL do ícone de Prajied');

    // Verifica regras de Avatar por Gênero e Customização de Tom de Pele e Cabelo
    const [alunaF] = await pool.query('SELECT genero, avatar_tom, avatar_cabelo FROM alunos WHERE id = 1');
    assert.equal(alunaF[0].genero, 'F', 'Aluno 1 deve ser do sexo feminino');
    assert.ok(['branca', 'negra'].includes(alunaF[0].avatar_tom || 'branca'));
    assert.ok(alunaF[0].avatar_cabelo.startsWith('cabelo-mulher-'), 'Aluna feminina deve usar cabelo feminino');

    const [alunoM] = await pool.query('SELECT genero, avatar_tom, avatar_cabelo FROM alunos WHERE id = 4');
    assert.equal(alunoM[0].genero, 'M', 'Aluno 4 deve ser do sexo masculino');
    assert.ok(['branca', 'negra'].includes(alunoM[0].avatar_tom || 'branca'));
    assert.ok(alunoM[0].avatar_cabelo.startsWith('cabelo-homem-'), 'Aluno masculino deve usar cabelo masculino');

    // Verifica integridade das Avaliações de Desempenho (Clinch-Sparring e Condicionamento)
    const [desempenhoRows] = await pool.query(`
        SELECT id, nota_clinch_sparring, nota_condicionamento, data_avaliacao
        FROM aluno_avaliacoes_desempenho
        WHERE aluno_id = 1
        ORDER BY data_avaliacao ASC
    `);
    assert.ok(desempenhoRows.length >= 2, 'Aluno 1 deve possuir registros de avaliação de desempenho');
    const firstDes = desempenhoRows[0];
    assert.ok(Number(firstDes.nota_clinch_sparring) >= 0 && Number(firstDes.nota_clinch_sparring) <= 10, 'Nota Clinch-Sparring deve estar entre 0 e 10');
    assert.ok(Number(firstDes.nota_condicionamento) >= 0 && Number(firstDes.nota_condicionamento) <= 10, 'Nota Condicionamento deve estar entre 0 e 10');
});

test('Wiki de Golpes & Movimentos: Cadastro, Passos Sequenciais, Fotos e Validações', async () => {
    // 1. Consulta golpes cadastrados na Wiki
    const [golpes] = await pool.query(`
        SELECT wg.id, wg.nome, wg.categoria, wg.nivel_dificuldade,
               COUNT(wgp.id) AS total_passos
        FROM wiki_golpes wg
        LEFT JOIN wiki_golpe_passos wgp ON wgp.golpe_id = wg.id
        WHERE wg.ativo = 1
        GROUP BY wg.id
    `);
    assert.ok(golpes.length >= 1, 'Deve haver ao menos 1 golpe cadastrado na Wiki');

    const primeiroGolpe = golpes[0];
    assert.ok(primeiroGolpe.nome.length > 0, 'O nome do golpe não pode ser vazio');
    assert.ok(primeiroGolpe.total_passos >= 1, 'O golpe deve possuir ao menos 1 passo de execução');

    // 2. Consulta os passos do primeiro golpe
    const [passos] = await pool.query(`
        SELECT id, ordem, titulo, descricao, imagem_url
        FROM wiki_golpe_passos
        WHERE golpe_id = ?
        ORDER BY ordem ASC
    `, [primeiroGolpe.id]);

    assert.equal(passos.length, primeiroGolpe.total_passos, 'A quantidade de passos deve bater com a contagem');
    passos.forEach((passo, idx) => {
        assert.equal(passo.ordem, idx + 1, 'A ordem dos passos deve ser estritamente sequencial (1, 2, 3...)');
        assert.ok(passo.descricao && passo.descricao.trim().length > 0, 'A descrição de cada passo é obrigatória');
    });
});

test('Portal do Aluno: Currículo de Técnicas e Golpes Vinculados à Faixa Atual', async () => {
    // 1. Obtém graduação ativa da aluna 1 (Prajied Amarelo, nivel_id = 2)
    const [gradAtual] = await pool.query(`
        SELECT ag.graduacao_nivel_id, gn.nome AS nivel_nome
        FROM aluno_graduacoes ag
        JOIN graduacoes_niveis gn ON gn.id = ag.graduacao_nivel_id
        WHERE ag.aluno_id = 1 AND ag.atual = 1
        LIMIT 1
    `);
    assert.ok(gradAtual.length > 0, 'Aluno 1 deve possuir uma graduação ativa');
    const nivelId = gradAtual[0].graduacao_nivel_id;

    // 2. Consulta os golpes vinculados a esse nível via graduacao_nivel_golpes
    const [golpesFaixa] = await pool.query(`
        SELECT wg.id, wg.nome, wg.categoria, wg.nivel_dificuldade, wg.imagem_capa,
               COUNT(wgp.id) AS total_passos
        FROM graduacao_nivel_golpes gng
        JOIN wiki_golpes wg ON wg.id = gng.golpe_id
        LEFT JOIN wiki_golpe_passos wgp ON wgp.golpe_id = wg.id
        WHERE gng.graduacao_nivel_id = ?
        GROUP BY wg.id
        ORDER BY wg.categoria ASC, wg.nome ASC
    `, [nivelId]);

    assert.ok(golpesFaixa.length > 0, `Nível ${nivelId} (${gradAtual[0].nivel_nome}) deve possuir ao menos 1 técnica vinculada`);
    golpesFaixa.forEach(g => {
        assert.ok(g.nome && g.nome.length > 0, 'Técnica vinculada deve possuir nome');
        assert.ok(g.categoria && g.categoria.length > 0, 'Técnica vinculada deve possuir categoria');
    });

    // 3. Verifica diferenciação explícita entre Faixa Atual e Faixas Anteriores
    const [faixasProgresso] = await pool.query(`
        SELECT gn.id AS nivel_id, gn.nome AS nivel_nome, gn.ordem_hierarquica,
               (gn.id = ?) AS is_atual
        FROM graduacoes_niveis gn
        WHERE gn.modalidade_id = 1 AND gn.ordem_hierarquica <= 2
        ORDER BY gn.ordem_hierarquica DESC
    `, [nivelId]);

    assert.ok(faixasProgresso.length >= 2, 'Deve haver graduação atual e ao menos uma anterior para o aluno');
    const faixaAtualItem = faixasProgresso.find(f => f.is_atual === 1);
    const faixaAnteriorItem = faixasProgresso.find(f => f.is_atual === 0);

    assert.ok(faixaAtualItem, 'Deve identificar explicitamente a faixa atual');
    assert.ok(faixaAnteriorItem, 'Deve identificar explicitamente a faixa anterior');
    assert.ok(faixaAtualItem.ordem_hierarquica > faixaAnteriorItem.ordem_hierarquica, 'Faixa atual deve ter ordem superior à anterior');
});

test('Portal do Aluno SPA: Arquitetura de Visão Dinâmica (Dashboard vs Wiki) sem recarregamento', async () => {
    const fs = require('fs');
    const path = require('path');

    // 1. Verifica marcação HTML das duas views SPA
    const htmlPath = path.join(__dirname, '..', 'public', 'painel-aluno.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(htmlContent.includes('id="spa-view-dashboard"'), 'HTML deve conter o container da visão Dashboard (#spa-view-dashboard)');
    assert.ok(htmlContent.includes('id="spa-view-wiki"'), 'HTML deve conter o container da visão Wiki (#spa-view-wiki)');
    assert.ok(htmlContent.includes('switchView(\'dashboard\')'), 'HTML deve possuir gatilho de retorno para o Dashboard via switchView');
    assert.ok(htmlContent.includes('switchView(\'wiki\')'), 'HTML deve possuir gatilho de abertura da Wiki via switchView');
    assert.ok(htmlContent.includes('id="wiki-spa-belts-tabs"'), 'HTML da Wiki SPA deve conter as abas de seleção de faixas');
    assert.ok(htmlContent.includes('id="wiki-spa-cards-grid"'), 'HTML da Wiki SPA deve conter a grade de cards');

    // 2. Verifica script JS com funções de controle e sanitização
    const jsPath = path.join(__dirname, '..', 'public', 'js', 'painel-aluno.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    assert.ok(jsContent.includes('switchView(viewName'), 'JS deve conter a função switchView');
    assert.ok(jsContent.includes('renderWikiSpaView()'), 'JS deve conter a função renderWikiSpaView');
    assert.ok(jsContent.includes('renderWikiSpaBeltTabs()'), 'JS deve conter a função renderWikiSpaBeltTabs');
    assert.ok(jsContent.includes('obterGolpesWikiSpa()'), 'JS deve conter a função de filtragem obterGolpesWikiSpa');
    assert.ok(jsContent.includes('renderWikiSpaGrid()'), 'JS deve conter a função de renderização renderWikiSpaGrid');
    assert.ok(jsContent.includes('wiki-spa-expanded'), 'JS deve expandir o grid com a classe wiki-spa-expanded');
    assert.ok(jsContent.includes('escapeHtml('), 'JS deve sanitizar saídas com escapeHtml');
    assert.ok(jsContent.includes('sanitizeUrl('), 'JS deve sanitizar URLs com sanitizeUrl');

    // 3. Verifica estilos CSS para suporte a expansão e transição
    const cssPath = path.join(__dirname, '..', 'public', 'css', 'painel-aluno.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    assert.ok(cssContent.includes('.dashboard-shell.wiki-spa-expanded'), 'CSS deve definir expansão sem a coluna direita para a Wiki');
    assert.ok(cssContent.includes('.spa-view'), 'CSS deve definir a classe base .spa-view com animação de fade');
});

test('Portal do Aluno Gamificação: Fogo de Frequência (Streak), Prontidão de Faixa e Recompensas do Avatar', async () => {
    // 1. Testa cálculo da régua semanal dos 7 dias e persistência na base
    const [semanaRow] = await pool.query('SELECT YEARWEEK(CURDATE(), 1) as cur_yw');
    assert.ok(semanaRow[0]?.cur_yw, 'MySQL deve calcular semana do ano com YEARWEEK');

    const [checkinsAluno1] = await pool.query(`
        SELECT COUNT(*) as total_geral FROM checkins WHERE aluno_id = 1 AND status = 'aprovado'
    `);
    const totalCheckins = checkinsAluno1[0]?.total_geral || 0;
    assert.ok(totalCheckins >= 30, 'Aluno 1 deve possuir histórico de check-ins aprovados');

    // 2. Testa persistência e cálculo de prontidão de técnicas (aluno_golpes_progresso)
    // Marca golpe 2 como dominado e golpe 4 como em_treino
    await pool.query(`
        INSERT INTO aluno_golpes_progresso (aluno_id, golpe_id, status)
        VALUES (1, 2, 'dominado'), (1, 4, 'em_treino')
        ON DUPLICATE KEY UPDATE status = VALUES(status)
    `);

    const [progressoRows] = await pool.query(`
        SELECT golpe_id, status FROM aluno_golpes_progresso WHERE aluno_id = 1 AND golpe_id IN (2, 4)
    `);
    const golpe2 = progressoRows.find(p => p.golpe_id === 2);
    const golpe4 = progressoRows.find(p => p.golpe_id === 4);
    assert.equal(golpe2?.status, 'dominado', 'Golpe 2 deve estar gravado como dominado');
    assert.equal(golpe4?.status, 'em_treino', 'Golpe 4 deve estar gravado como em_treino');

    // 3. Testa regras de desbloqueio de Luvas e Títulos do Lutador
    const [alunoRow] = await pool.query('SELECT avatar_luva, titulo_ativo FROM alunos WHERE id = 1');
    assert.ok(alunoRow[0], 'Registro do aluno deve existir');
    assert.ok('avatar_luva' in alunoRow[0], 'Coluna avatar_luva deve existir na tabela alunos');
    assert.ok('titulo_ativo' in alunoRow[0], 'Coluna titulo_ativo deve existir na tabela alunos');

    // 4. Testa elementos HTML e seletores de UI dos 3 novos recursos
    const htmlPath = path.join(__dirname, '..', 'public', 'painel-aluno.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(htmlContent.includes('streak-hero-card'), 'HTML deve conter card de Fogo de Frequência');
    assert.ok(htmlContent.includes('weekly-streak-ruler'), 'HTML deve conter régua semanal dos 7 dias');
    assert.ok(htmlContent.includes('next-rank-card'), 'HTML deve conter card de Próxima Graduação');
    assert.ok(!htmlContent.includes('readiness-hero-card'), 'Card readiness-hero-card deve ter sido retirado no desktop');
    assert.ok(!htmlContent.includes('activity-growth-card'), 'Card activity-growth-card deve ter sido retirado no desktop');
    assert.ok(htmlContent.includes('gloves-options-grid'), 'HTML deve conter grid de opções de luvas no modal');
    assert.ok(htmlContent.includes('titles-options-grid'), 'HTML deve conter grid de opções de títulos no modal');
    assert.ok(htmlContent.includes('header-athlete-title'), 'HTML deve conter exibição do título de honra no cabeçalho');

    // 5. Testa regras CSS correspondentes
    const cssPath = path.join(__dirname, '..', 'public', 'css', 'painel-aluno.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    assert.ok(cssContent.includes('.engagement-hero-grid'), 'CSS deve definir grid de engajamento');
    assert.ok(cssContent.includes('.streak-flame-badge'), 'CSS deve definir badge de fogo do streak');
    assert.ok(cssContent.includes('.weekly-streak-ruler'), 'CSS deve definir régua horizontal dos 7 dias');
    assert.ok(cssContent.includes('.readiness-target-marker'), 'CSS deve definir marcador de meta da prontidão');
    assert.ok(cssContent.includes('.btn-golpe-status-toggle'), 'CSS deve definir botão interativo de alternância de status de golpe');
    assert.ok(cssContent.includes('.glove-choice-card'), 'CSS deve definir card de seleção de luva');
    assert.ok(cssContent.includes('.title-choice-card'), 'CSS deve definir card de seleção de título');

    // 6. Testa script JS com métodos de gamificação
    const jsPath = path.join(__dirname, '..', 'public', 'js', 'painel-aluno.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    assert.ok(jsContent.includes('renderStreak('), 'JS deve implementar renderStreak');
    assert.ok(jsContent.includes('renderReadinessCard('), 'JS deve implementar renderReadinessCard');
    assert.ok(jsContent.includes('toggleProgressoGolpe('), 'JS deve implementar toggleProgressoGolpe');
    assert.ok(jsContent.includes('btn-golpe-status-toggle'), 'JS deve renderizar botão interativo no card de técnica');
});

// ============================================================================
// 9. TESTES DE EXAMES DE GRADUAÇÃO & GATEWAY DE PAGAMENTO ASAAS
// ============================================================================
test('Exames de Graduação & Gateway Asaas: Fluxo completo de criação de evento, detecção de alunos aptos, convites e liquidação', async () => {
    const server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    const adminToken = jwt.sign(
        { id: 1, cargo: 'admin', nome: 'Mestre Administrador' },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    let eventoId = null;
    let conviteId = null;

    try {
        // 9.1. Criação de Evento de Exame de Graduação
        const criarEventoRes = await fetch(`${baseUrl}/api/exames/eventos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({
                titulo: 'Exame de Teste Automatizado 2026',
                modalidade_id: 1, // Muay Thai
                data_evento: '2026-12-20',
                horario_inicio: '10:00',
                data_limite_inscricao: '2026-12-18',
                taxa_inscricao: 175.00,
                local_evento: 'Tatame Principal - CT Kaizen',
                descricao: 'Orientações oficiais de exame para homologação e teste automatizado',
                status: 'aberto'
            })
        });

        assert.equal(criarEventoRes.status, 201, 'Criação de evento deve retornar HTTP 201');
        const criarEventoBody = await criarEventoRes.json();
        assert.equal(criarEventoBody.success, true);
        assert.ok(criarEventoBody.data && criarEventoBody.data.id, 'Deve retornar ID do evento criado');
        eventoId = criarEventoBody.data.id;

        // 9.2. Consulta de Alunos Aptos
        const aptosRes = await fetch(`${baseUrl}/api/exames/alunos-aptos?evento_id=${eventoId}&modalidade_id=1`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.equal(aptosRes.status, 200, 'Consulta de aptos deve retornar 200');
        const aptosBody = await aptosRes.json();
        assert.equal(aptosBody.success, true);
        assert.ok(Array.isArray(aptosBody.data), 'Deve retornar array de alunos aptos');
        assert.ok(aptosBody.data.length > 0, 'Deve identificar alunos aptos na modalidade');

        const alunoApto = aptosBody.data[0];
        assert.ok(alunoApto.aluno_id > 0, 'Aluno deve ter ID');
        assert.ok(alunoApto.graduacao_pretendida_id > 0, 'Aluno deve ter faixa pretendida calculada');
        assert.ok(alunoApto.percentual_avaliacao >= 70, 'Percentual deve atender o critério de aptidão');

        // 9.3. Envio de Convite para o Aluno Apto
        const convidarRes = await fetch(`${baseUrl}/api/exames/eventos/${eventoId}/convidar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({
                alunos: [{
                    aluno_id: alunoApto.aluno_id,
                    modalidade_id: alunoApto.modalidade_id,
                    graduacao_atual_id: alunoApto.graduacao_atual_id,
                    graduacao_pretendida_id: alunoApto.graduacao_pretendida_id,
                    percentual_avaliacao: alunoApto.percentual_avaliacao,
                    apto_motivo: alunoApto.apto_motivo
                }]
            })
        });

        assert.equal(convidarRes.status, 201, 'Envio de convites deve retornar 201');
        const convidarBody = await convidarRes.json();
        assert.equal(convidarBody.success, true);
        assert.equal(convidarBody.convites_enviados, 1);

        // 9.4. Consulta do Aluno no Portal do Aluno (/api/aluno/meus-exames)
        const meusExamesRes = await fetch(`${baseUrl}/api/aluno/meus-exames?aluno_id=${alunoApto.aluno_id}`);
        assert.equal(meusExamesRes.status, 200, 'Consulta de exames do aluno deve retornar 200');
        const meusExamesBody = await meusExamesRes.json();
        assert.equal(meusExamesBody.success, true);
        const conviteRecebido = meusExamesBody.data.find(c => c.evento_id === eventoId);
        assert.ok(conviteRecebido, 'Convite deve constar na lista de exames do atleta');
        assert.equal(conviteRecebido.convite_status, 'convidado');
        conviteId = conviteRecebido.convite_id;

        // 9.5. Aceite do Convite e Geração de Cobrança Asaas (PIX)
        const aceitarRes = await fetch(`${baseUrl}/api/aluno/exames/${conviteId}/aceitar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                aluno_id: alunoApto.aluno_id,
                billing_type: 'PIX'
            })
        });
        assert.equal(aceitarRes.status, 200, 'Aceite do convite deve retornar 200');
        const aceitarBody = await aceitarRes.json();
        assert.equal(aceitarBody.success, true);
        assert.ok(aceitarBody.cobranca, 'Deve retornar objeto da cobrança Asaas');
        assert.ok(aceitarBody.cobranca.asaas_payment_id, 'Deve conter payment_id do Asaas');
        assert.ok(aceitarBody.cobranca.asaas_pix_qrcode || aceitarBody.cobranca.asaas_pix_copia_cola, 'Deve conter QR Code PIX ou Copia e Cola');

        const paymentId = aceitarBody.cobranca.asaas_payment_id;

        // 9.6. Simulação do Webhook de Confirmação de Pagamento do Asaas
        const webhookRes = await fetch(`${baseUrl}/api/exames/webhook-asaas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event: 'PAYMENT_RECEIVED',
                payment: {
                    id: paymentId,
                    customer: 'cus_mock123',
                    value: 175.00,
                    netValue: 173.00,
                    billingType: 'PIX',
                    status: 'RECEIVED',
                    externalReference: `convite_${conviteId}_aluno_${alunoApto.aluno_id}`
                }
            })
        });
        assert.equal(webhookRes.status, 200, 'Webhook Asaas deve responder 200');
        const webhookBody = await webhookRes.json();
        assert.equal(webhookBody.success, true);

        // 9.7. Valida se no banco o status virou 'pago'
        const [rowsConvite] = await pool.query(
            'SELECT status, data_pagamento FROM evento_graduacao_convites WHERE id = ?',
            [conviteId]
        );
        assert.equal(rowsConvite.length, 1);
        assert.equal(rowsConvite[0].status, 'pago', 'Status do convite deve estar quitado como pago');
        assert.ok(rowsConvite[0].data_pagamento, 'Data de pagamento deve estar preenchida');

    } finally {
        // Limpeza dos dados criados durante o teste
        if (conviteId) {
            await pool.query('DELETE FROM evento_graduacao_convites WHERE id = ?', [conviteId]).catch(() => {});
        }
        if (eventoId) {
            await pool.query('DELETE FROM eventos_graduacao WHERE id = ?', [eventoId]).catch(() => {});
        }
        server.close();
    }
});

test('Plano do Aluno, Gestão de Atraso e Pagamento Asaas (PIX / Baixa Manual do Administrador)', async () => {
    const server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    let faturaId = null;

    try {
        // 1. Gera token de autenticação de administrador
        const adminToken = jwt.sign(
            { id: 1, cargo: 'admin', nome: 'Admin Master' },
            JWT_SECRET,
            { expiresIn: '1h', algorithm: 'HS256' }
        );

        // 2. Cria uma fatura de teste vencida para o Aluno 1
        const [matRows] = await pool.query('SELECT id FROM matriculas WHERE aluno_id = 1 AND status = "ativa" LIMIT 1');
        assert.ok(matRows.length > 0, 'Aluno 1 deve possuir matrícula ativa');
        const matriculaId = matRows[0].id;

        const [insertFat] = await pool.query(`
            INSERT INTO faturas (matricula_id, aluno_id, competencia, valor_original, data_vencimento, status)
            VALUES (?, 1, '2026-09', 199.90, '2026-09-10', 'pendente')
        `, [matriculaId]);
        faturaId = insertFat.insertId;

        // 3. Testa consulta do Painel do Aluno (/api/aluno/meu-painel)
        const painelRes = await fetch(`${baseUrl}/api/aluno/meu-painel?aluno_id=1`);
        assert.equal(painelRes.status, 200);
        const painelBody = await painelRes.json();
        assert.ok(painelBody.plano, 'Deve retornar dados do plano do aluno');
        assert.equal(painelBody.plano.has_atraso, true, 'Deve identificar atraso financeiro devido à fatura de 09/2026');
        assert.equal(painelBody.plano.status_financeiro, 'atrasado');
        assert.ok(painelBody.plano.total_atrasadas >= 1);
        assert.ok(painelBody.plano.fatura_aberta, 'Deve apontar a fatura em aberto');

        // 4. Testa geração de cobrança PIX Asaas pelo Aluno (/api/aluno/faturas/:id/gerar-asaas)
        const gerarRes = await fetch(`${baseUrl}/api/aluno/faturas/${faturaId}/gerar-asaas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ aluno_id: 1 })
        });
        assert.equal(gerarRes.status, 200);
        const gerarBody = await gerarRes.json();
        assert.equal(gerarBody.success, true);
        assert.ok(gerarBody.data.asaas_payment_id, 'Deve conter ID de cobrança Asaas');
        assert.ok(gerarBody.data.asaas_pix_copia_cola, 'Deve conter Pix Copia e Cola');

        // 5. Testa simulação / verificação de pagamento via Asaas
        const verifyRes = await fetch(`${baseUrl}/api/aluno/faturas/${faturaId}/verificar-asaas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ aluno_id: 1, simular_confirmacao: true })
        });
        assert.equal(verifyRes.status, 200);
        const verifyBody = await verifyRes.json();
        assert.equal(verifyBody.success, true);
        assert.equal(verifyBody.pago, true);

        // Valida no banco se a fatura foi quitada
        const [fatBanco] = await pool.query('SELECT status, data_pagamento, metodo_pagamento FROM faturas WHERE id = ?', [faturaId]);
        assert.equal(fatBanco[0].status, 'pago');
        assert.equal(fatBanco[0].metodo_pagamento, 'pix');
        assert.ok(fatBanco[0].data_pagamento);

        // 6. Testa Baixa Manual pelo Administrador (/api/faturas/:id/pagar)
        // Cria uma segunda fatura para testar baixa manual no balcão em dinheiro
        const [insertFat2] = await pool.query(`
            INSERT INTO faturas (matricula_id, aluno_id, competencia, valor_original, data_vencimento, status)
            VALUES (?, 1, '2026-08', 199.90, '2026-08-10', 'pendente')
        `, [matriculaId]);
        const faturaId2 = insertFat2.insertId;

        const manualRes = await fetch(`${baseUrl}/api/faturas/${faturaId2}/pagar`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({
                metodo_pagamento: 'dinheiro',
                valor_pago: 199.90,
                observacoes: 'Recebido em espécie na recepção'
            })
        });
        assert.equal(manualRes.status, 200);
        const manualBody = await manualRes.json();
        assert.equal(manualBody.success, true);

        const [fatBanco2] = await pool.query('SELECT status, metodo_pagamento, asaas_status FROM faturas WHERE id = ?', [faturaId2]);
        assert.equal(fatBanco2[0].status, 'pago');
        assert.equal(fatBanco2[0].metodo_pagamento, 'dinheiro');
        assert.equal(fatBanco2[0].asaas_status, 'RECEIVED_MANUALLY');

        // Limpeza da segunda fatura
        await pool.query('DELETE FROM faturas WHERE id = ?', [faturaId2]);

    } finally {
        if (faturaId) {
            await pool.query('DELETE FROM faturas WHERE id = ?', [faturaId]).catch(() => {});
        }
        server.close();
    }
});

// ============================================================================
// 11. HISTÓRICO FINANCEIRO UNIFICADO: FATURAS E GRADUAÇÕES (ASAAS + MANUAL)
// ============================================================================
test('Portal do Aluno: Histórico Financeiro Unificado (Mensalidades + Graduações, Asaas e Manual Balcão)', async () => {
    const server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    let faturaManualId = null;
    let faturaAsaasId = null;

    try {
        const [matRows] = await pool.query('SELECT id FROM matriculas WHERE aluno_id = 1 AND status = "ativa" LIMIT 1');
        assert.ok(matRows.length > 0, 'Aluno 1 deve possuir matrícula ativa');
        const matriculaId = matRows[0].id;

        // 1. Cria Fatura Manual Quitada no Balcão em Dinheiro
        const [resMan] = await pool.query(`
            INSERT INTO faturas (matricula_id, aluno_id, competencia, valor_original, valor_pago, data_vencimento, data_pagamento, status, metodo_pagamento, asaas_status)
            VALUES (?, 1, '2026-07', 150.00, 150.00, '2026-07-10', '2026-07-09', 'pago', 'dinheiro', 'RECEIVED_MANUALLY')
        `, [matriculaId]);
        faturaManualId = resMan.insertId;

        // 2. Cria Fatura Aberta Futura Gerada no Gateway Asaas
        const [resAsaas] = await pool.query(`
            INSERT INTO faturas (matricula_id, aluno_id, competencia, valor_original, data_vencimento, status, metodo_pagamento, asaas_payment_id, asaas_status)
            VALUES (?, 1, '2027-01', 180.00, DATE_ADD(CURDATE(), INTERVAL 15 DAY), 'pendente', 'pix', 'pay_asaas_teste_123', 'PENDING')
        `, [matriculaId]);
        faturaAsaasId = resAsaas.insertId;

        // 3. Consulta Endpoint Unificado de Histórico Financeiro
        const resHistorico = await fetch(`${baseUrl}/api/aluno/historico-financeiro?aluno_id=1`);
        assert.equal(resHistorico.status, 200);
        const data = await resHistorico.json();

        assert.equal(data.success, true);
        assert.ok(data.resumo, 'Deve retornar objeto resumo');
        assert.ok(data.resumo.total_pago >= 150.00, 'Total pago deve contabilizar a fatura manual quitada');
        assert.ok(data.resumo.total_pendente >= 180.00, 'Total pendente deve contabilizar a fatura Asaas pendente');
        assert.ok(data.resumo.qtd_total >= 2);
        assert.ok(Array.isArray(data.itens), 'Deve retornar lista de itens');

        // 4. Valida se a fatura manual foi classificada corretamente
        const itemManual = data.itens.find(i => i.fatura_id === faturaManualId);
        assert.ok(itemManual, 'Fatura manual deve constar no histórico');
        assert.equal(itemManual.tipo, 'mensalidade');
        assert.equal(itemManual.origem_pagamento, 'manual');
        assert.equal(itemManual.origem_label, 'Manual / Balcão');
        assert.equal(itemManual.status, 'pago');
        assert.equal(itemManual.status_label, 'Pago');

        // 5. Valida se a fatura Asaas foi classificada com origem Asaas
        const itemAsaas = data.itens.find(i => i.fatura_id === faturaAsaasId);
        assert.ok(itemAsaas, 'Fatura Asaas deve constar no histórico');
        assert.equal(itemAsaas.tipo, 'mensalidade');
        assert.equal(itemAsaas.origem_pagamento, 'asaas');
        assert.equal(itemAsaas.origem_label, 'Pagamento Online');
        assert.equal(itemAsaas.status, 'pendente');

    } finally {
        if (faturaManualId) {
            await pool.query('DELETE FROM faturas WHERE id = ?', [faturaManualId]).catch(() => {});
        }
        if (faturaAsaasId) {
            await pool.query('DELETE FROM faturas WHERE id = ?', [faturaAsaasId]).catch(() => {});
        }
        server.close();
    }
});

// ============================================================================
// 12. AVALIAÇÕES TÉCNICAS (CLINCH, SOCOS, CHUTES, POSTURA) - ADMIN & PORTAL
// ============================================================================
test('Avaliações Técnicas do Professor (Clinch, Socos, Chutes, Postura) e Exibição no Painel do Aluno', async () => {
    const server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    let avaliacaoId = null;

    try {
        const profToken = jwt.sign(
            { id: 1, cargo: 'professor', nome: 'Mestre Anderson' },
            JWT_SECRET,
            { expiresIn: '1h', algorithm: 'HS256' }
        );

        // 1. Professor registra Avaliação Técnica RPG com 20 critérios (0 a 5)
        const rpgService = require('../services/rpgEvaluationService');
        const criteriosPayload = {};
        rpgService.RPG_CRITERIA.forEach((c) => {
            criteriosPayload[c.id] = 4;
        });

        const postRes = await fetch(`${baseUrl}/api/alunos/1/avaliacoes-desempenho`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${profToken}`
            },
            body: JSON.stringify({
                modelo_avaliacao: 'rpg',
                data_avaliacao: '2026-11-12',
                apto_sparring: true,
                criterios: criteriosPayload,
                observacoes_instrutor: 'Excelente base e evolução nos 5 pilares RPG'
            })
        });

        assert.equal(postRes.status, 201);
        const postData = await postRes.json();
        assert.equal(postData.success, true);
        assert.ok(postData.data.id, 'Deve retornar o ID da avaliação criada');
        avaliacaoId = postData.data.id;

        assert.equal(postData.data.score_total, 80);
        assert.equal(postData.data.rank_combate, 'A');
        assert.equal(postData.data.pilares.inteligencia, 16);

        // 2. Consulta Meu Painel e valida que a avaliação RPG aparece consolidada
        const painelRes = await fetch(`${baseUrl}/api/aluno/meu-painel?aluno_id=1`);
        assert.equal(painelRes.status, 200);
        const painelData = await painelRes.json();

        assert.equal(painelData.success, true);
        assert.ok(painelData.avaliacao_rpg?.atual, 'Deve retornar objeto avaliacao_rpg.atual');
        assert.equal(painelData.avaliacao_rpg.atual.score_total, 80);
        assert.equal(painelData.avaliacao_rpg.atual.rank_combate, 'A');

    } finally {
        if (avaliacaoId) {
            await pool.query('DELETE FROM aluno_avaliacoes_desempenho WHERE id = ?', [avaliacaoId]).catch(() => {});
        }
        server.close();
    }
});

// ============================================================================
// 13. GESTÃO DE ALUNOS: REDEFINIÇÃO DE SENHA, SOFT DELETE E LIXEIRA DE CADASTROS
// ============================================================================
test('Gestão de Alunos: Redefinição de Senha, Soft Delete, Lixeira e Exclusão Permanente', async () => {
    const server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    let alunoCriadoId = null;
    let alunoTrashId = null;

    try {
        const adminToken = jwt.sign(
            { id: 1, cargo: 'admin', nome: 'Admin Master' },
            JWT_SECRET,
            { expiresIn: '1h', algorithm: 'HS256' }
        );

        // 1. Cria aluno temporário completo com registros associados
        const [alunoIns] = await pool.query(`
            INSERT INTO alunos (nome_completo, cpf, data_nascimento, genero, email, telefone_whatsapp, status)
            VALUES ('Aluno Teste Exclusao', '99988877700', '1995-05-10', 'M', 'aluno.delete.test@exemplo.com', '11988887777', 'ativo')
        `);
        alunoCriadoId = alunoIns.insertId;

        // Cria usuário de login
        const defaultHash = await bcrypt.hash('SenhaAntiga@123', 10);
        await pool.query(`
            INSERT INTO usuarios_alunos (aluno_id, email, senha_hash, status, email_verificado)
            VALUES (?, 'aluno.delete.test@exemplo.com', ?, 'ativo', 1)
        `, [alunoCriadoId, defaultHash]);

        // Cria matrícula e fatura vinculadas
        const [planos] = await pool.query('SELECT id FROM planos LIMIT 1');
        const planoId = planos[0].id;
        const [matIns] = await pool.query(`
            INSERT INTO matriculas (aluno_id, plano_id, data_inicio, data_fim, valor_acordado, status)
            VALUES (?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 MONTH), 199.90, 'ativa')
        `, [alunoCriadoId, planoId]);
        const matId = matIns.insertId;

        await pool.query(`
            INSERT INTO faturas (matricula_id, aluno_id, competencia, valor_original, data_vencimento, status)
            VALUES (?, ?, '2026-11', 199.90, CURDATE(), 'pendente')
        `, [matId, alunoCriadoId]);

        // 2. Testa Redefinição de Senha Administrativa (POST /api/alunos/:id/resetar-senha)
        const novaSenhaTeste = 'Kaizen@Forte2026';
        const resetRes = await fetch(`${baseUrl}/api/alunos/${alunoCriadoId}/resetar-senha`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({ nova_senha: novaSenhaTeste })
        });

        assert.equal(resetRes.status, 200);
        const resetBody = await resetRes.json();
        assert.equal(resetBody.success, true);
        assert.equal(resetBody.nova_senha, novaSenhaTeste);

        // Valida que a nova senha foi persistida e valida com bcrypt
        const [userRows] = await pool.query('SELECT senha_hash FROM usuarios_alunos WHERE aluno_id = ?', [alunoCriadoId]);
        assert.ok(userRows.length > 0);
        const passwordMatches = await bcrypt.compare(novaSenhaTeste, userRows[0].senha_hash);
        assert.equal(passwordMatches, true, 'Nova senha deve ser autenticável com bcrypt');

        // 3. Testa Soft Delete (DELETE /api/alunos/:id -> move para a Lixeira)
        const softDeleteRes = await fetch(`${baseUrl}/api/alunos/${alunoCriadoId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });

        assert.equal(softDeleteRes.status, 200);
        const softDeleteBody = await softDeleteRes.json();
        assert.equal(softDeleteBody.success, true);

        // Valida que deleted_at foi preenchido no banco
        const [alunoSoft] = await pool.query('SELECT id, deleted_at FROM alunos WHERE id = ?', [alunoCriadoId]);
        assert.ok(alunoSoft[0].deleted_at !== null, 'Campo deleted_at deve estar preenchido');

        // Valida que o aluno NÃO aparece mais na listagem principal de alunos
        const listRes = await fetch(`${baseUrl}/api/alunos?busca=Aluno%20Teste%20Exclusao`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const listData = await listRes.json();
        assert.equal(listData.data.some(a => a.id === alunoCriadoId), false, 'Aluno na lixeira não deve aparecer na lista ativa');

        // 4. Testa Consulta da Lixeira (GET /api/alunos/lixeira)
        const lixeiraRes = await fetch(`${baseUrl}/api/alunos/lixeira`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.equal(lixeiraRes.status, 200);
        const lixeiraData = await lixeiraRes.json();
        assert.equal(lixeiraData.success, true);
        assert.ok(lixeiraData.data.some(a => a.id === alunoCriadoId), 'Aluno deve constar na listagem da lixeira');

        // 5. Testa Restauração da Lixeira (POST /api/alunos/:id/restaurar)
        const restaurarRes = await fetch(`${baseUrl}/api/alunos/${alunoCriadoId}/restaurar`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.equal(restaurarRes.status, 200);
        const restaurarData = await restaurarRes.json();
        assert.equal(restaurarData.success, true);

        // Valida que deleted_at voltou a ser NULL
        const [alunoRestaurado] = await pool.query('SELECT id, deleted_at FROM alunos WHERE id = ?', [alunoCriadoId]);
        assert.equal(alunoRestaurado[0].deleted_at, null, 'deleted_at deve voltar a ser NULL após restauração');

        // 6. Testa Exclusão Permanente (DELETE /api/alunos/:id/permanente)
        const permDeleteRes = await fetch(`${baseUrl}/api/alunos/${alunoCriadoId}/permanente`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.equal(permDeleteRes.status, 200);
        const permDeleteData = await permDeleteRes.json();
        assert.equal(permDeleteData.success, true);

        // Valida que o aluno e seus registros dependentes foram completamente removidos (Hard Delete)
        const [checkAluno] = await pool.query('SELECT id FROM alunos WHERE id = ?', [alunoCriadoId]);
        assert.equal(checkAluno.length, 0, 'Registro do aluno deve ter sido removido do banco');

        const [checkMat] = await pool.query('SELECT id FROM matriculas WHERE aluno_id = ?', [alunoCriadoId]);
        assert.equal(checkMat.length, 0, 'Matrícula vinculada deve ter sido removida');

        const [checkFat] = await pool.query('SELECT id FROM faturas WHERE aluno_id = ?', [alunoCriadoId]);
        assert.equal(checkFat.length, 0, 'Fatura vinculada deve ter sido removida');

        alunoCriadoId = null; // Removido com sucesso

        // 7. Testa Esvaziamento da Lixeira (POST /api/alunos/lixeira/esvaziar)
        const [trashIns] = await pool.query(`
            INSERT INTO alunos (nome_completo, cpf, data_nascimento, genero, email, telefone_whatsapp, status, deleted_at)
            VALUES ('Aluno Lixeira Bulk', '88877766600', '1998-08-20', 'F', 'aluno.trash.bulk@exemplo.com', '11977776666', 'ativo', NOW())
        `);
        alunoTrashId = trashIns.insertId;

        const esvaziarRes = await fetch(`${baseUrl}/api/alunos/lixeira/esvaziar`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.equal(esvaziarRes.status, 200);
        const esvaziarData = await esvaziarRes.json();
        assert.equal(esvaziarData.success, true);

        const [checkTrash] = await pool.query('SELECT id FROM alunos WHERE id = ?', [alunoTrashId]);
        assert.equal(checkTrash.length, 0, 'Aluno na lixeira deve ter sido excluído permanentemente pelo esvaziar');
        alunoTrashId = null;

    } finally {
        if (alunoCriadoId) {
            await pool.query('DELETE FROM faturas WHERE aluno_id = ?', [alunoCriadoId]).catch(() => {});
            await pool.query('DELETE FROM matriculas WHERE aluno_id = ?', [alunoCriadoId]).catch(() => {});
            await pool.query('DELETE FROM usuarios_alunos WHERE aluno_id = ?', [alunoCriadoId]).catch(() => {});
            await pool.query('DELETE FROM alunos WHERE id = ?', [alunoCriadoId]).catch(() => {});
        }
        if (alunoTrashId) {
            await pool.query('DELETE FROM alunos WHERE id = ?', [alunoTrashId]).catch(() => {});
        }
        server.close();
    }
});

// ============================================================================
// 14. PAINEL DO ALUNO: ALUNO NOVO SEM DADOS SINTÉTICOS OU FICTÍCIOS
// ============================================================================
test('Painel do Aluno: Aluno recém-cadastrado deve iniciar com a 1ª graduação e sem medidas/faturas fictícias', async () => {
    const server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    let novoAlunoId = null;

    try {
        const adminToken = jwt.sign(
            { id: 1, email: 'admin@sistema.com', cargo: 'admin' },
            process.env.JWT_SECRET || 'jwt_secret_dev_123456',
            { expiresIn: '1h' }
        );

        // 1. Cadastra novo aluno via API sem especificar graduação manualmente
        const cadRes = await fetch(`${baseUrl}/api/alunos`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                nome_completo: 'Atleta Iniciante Automatico',
                cpf: '11122233344',
                data_nascimento: '2000-01-01',
                genero: 'M',
                email: 'iniciante.auto@exemplo.com',
                senha: 'Senha@123',
                telefone_whatsapp: '11999998888',
                status: 'ativo'
            })
        });

        assert.equal(cadRes.status, 201, 'Cadastro deve retornar 201');
        const cadData = await cadRes.json();
        assert.equal(cadData.success, true);
        novoAlunoId = cadData.id;

        // 2. Consulta painel consolidado do novo aluno
        const resPainel = await fetch(`${baseUrl}/api/aluno/meu-painel?aluno_id=${novoAlunoId}`);
        assert.equal(resPainel.status, 200);
        const dataPainel = await resPainel.json();

        assert.equal(dataPainel.success, true);
        assert.equal(dataPainel.aluno.nome_completo, 'Atleta Iniciante Automatico');

        // Medidas devem ser estritamente nulas sem fallbacks artificiais
        assert.equal(dataPainel.aluno.medidas.peso_kg, null, 'Peso não deve inventar valor fictício');
        assert.equal(dataPainel.aluno.medidas.altura_cm, null, 'Altura não deve inventar valor fictício');
        assert.equal(dataPainel.aluno.medidas.torax_cm, null, 'Tórax não deve conter valor padrão fixo');
        assert.equal(dataPainel.aluno.medidas.cintura_cm, null, 'Cintura não deve conter valor padrão fixo');
        assert.equal(dataPainel.aluno.medidas.quadril_cm, null, 'Quadril não deve conter valor padrão fixo');
        assert.equal(dataPainel.aluno.medidas.imc, null, 'IMC não deve ser calculado com dados fictícios');
        assert.equal(dataPainel.aluno.medidas.imc_classificacao, 'Não aferido');
        assert.equal(dataPainel.aluno.medidas.dias_ultima_checagem, 'Sem aferição');
        assert.equal(dataPainel.aluno.medidas.shape_name, 'Aguardando Avaliação');

        // Situação de plano e financeira
        assert.equal(dataPainel.plano, null, 'Aluno sem matrícula não deve ter objeto de plano');

        // Todo atleta cadastrado já inicia com a primeira graduação
        assert.ok(dataPainel.graduacao.atual, 'Aluno deve iniciar com graduação inicial');
        assert.equal(dataPainel.graduacao.atual.nivel_nome, 'Prajied Branco (Iniciante)');
        assert.ok(dataPainel.graduacao.muay_thai, 'Deve vincular Prajied de Muay Thai');
        assert.equal(dataPainel.graduacao.muay_thai.ordem_hierarquica, 1);

        // Mas sem avaliação fake do professor
        assert.equal(dataPainel.graduacao.avaliacao, null, 'Aluno novo sem avaliação não deve ter pontuação ou aptidão fake');
        assert.equal(dataPainel.prontidao_exame.apto_exame, false, 'Aluno novo não deve estar apto para exame de imediato');
        assert.equal(dataPainel.prontidao_exame.percentual_prontidao, 0, 'Prontidão deve iniciar em 0%');
        assert.equal(dataPainel.frequencia.activity_growth.length, 0, 'Activity growth não deve conter semanas sintéticas simuladas');

        // 3. Professor lança avaliação técnica de graduação com 80% (Apto)
        const evalRes = await fetch(`${baseUrl}/api/alunos/${novoAlunoId}/avaliacoes-graduacao`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                modalidade_id: 1,
                graduacao_nivel_id: dataPainel.graduacao.atual.nivel_id,
                itens_avaliados: [
                    { item: 'Base e postura', nota: 4 },
                    { item: 'Jab e Direto', nota: 4 },
                    { item: 'Low Kick', nota: 4 },
                    { item: 'Check', nota: 4 },
                    { item: 'Clinch', nota: 4 }
                ],
                observacoes: 'Excelente desempenho técnico'
            })
        });
        assert.equal(evalRes.status, 200);

        // 4. Consulta novamente o painel do atleta e verifica se o score de elegibilidade foi atualizado
        const resPainelPosEval = await fetch(`${baseUrl}/api/aluno/meu-painel?aluno_id=${novoAlunoId}`);
        assert.equal(resPainelPosEval.status, 200);
        const dataPosEval = await resPainelPosEval.json();

        assert.ok(dataPosEval.graduacao.avaliacao, 'Deve conter avaliação do professor após lançamento');
        assert.equal(dataPosEval.graduacao.avaliacao.percentual_obtido, 80, 'Score de elegibilidade deve refletir 80%');
        assert.ok(Array.isArray(dataPosEval.graduacao.avaliacoes) && dataPosEval.graduacao.avaliacoes.length === 1, 'Deve retornar lista de avaliações detalhadas de graduação');
        const avDetalhe = dataPosEval.graduacao.avaliacoes[0];
        assert.equal(avDetalhe.observacoes_professor, 'Excelente desempenho técnico');
        assert.equal(avDetalhe.total_pontos_obtidos, 20);
        assert.equal(avDetalhe.total_pontos_possiveis, 25);
        assert.equal(avDetalhe.apto, true);
        assert.equal(avDetalhe.itens_avaliados.length, 5);
        assert.deepEqual(avDetalhe.itens_avaliados[0], { item: 'Base e postura', nota: 4 });
        assert.deepEqual(avDetalhe.itens_avaliados[4], { item: 'Clinch', nota: 4 });
        assert.equal(dataPosEval.graduacao.avaliacao.apto, true, 'Deve estar apto com 80% (mínimo 70%)');

        // 5. Consulta histórico financeiro
        const resFin = await fetch(`${baseUrl}/api/aluno/historico-financeiro?aluno_id=${novoAlunoId}`);
        assert.equal(resFin.status, 200);
        const dataFin = await resFin.json();

        assert.equal(dataFin.success, true);
        assert.equal(dataFin.resumo.status_financeiro, 'sem_faturas');
        assert.equal(dataFin.resumo.total_pago, 0);
        assert.equal(dataFin.resumo.total_pendente, 0);
        assert.equal(dataFin.itens.length, 0, 'Aluno novo não deve ter faturas geradas');

    } finally {
        if (novoAlunoId) {
            await pool.query('DELETE FROM aluno_avaliacoes_graduacao WHERE aluno_id = ?', [novoAlunoId]).catch(() => {});
            await pool.query('DELETE FROM aluno_graduacoes WHERE aluno_id = ?', [novoAlunoId]).catch(() => {});
            await pool.query('DELETE FROM alunos WHERE id = ?', [novoAlunoId]).catch(() => {});
        }
        server.close();
    }
});

test('Exames de Graduação: Aluno elegível visualiza exame aberto com taxa e realiza inscrição gerando cobrança Asaas', async () => {
    const server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    let alunoId = null;
    let eventoId = null;
    let conviteId = null;

    try {
        // 1. Cria evento de exame com data futura
        const [evIns] = await pool.query(`
            INSERT INTO eventos_graduacao (
                titulo, modalidade_id, data_evento, horario_inicio, data_limite_inscricao,
                local_evento, taxa_inscricao, descricao, status
            ) VALUES (
                'Exame Especial de Teste Convocacao', 1, DATE_ADD(CURDATE(), INTERVAL 15 DAY),
                '10:00:00', DATE_ADD(CURDATE(), INTERVAL 14 DAY),
                'Tatame Central - CT Kaizen', 125.00, 'Trazer luvas e uniforme oficial', 'aberto'
            )
        `);
        eventoId = evIns.insertId;

        // 2. Cria atleta de teste com 1ª graduação
        const [alunoIns] = await pool.query(`
            INSERT INTO alunos (nome_completo, cpf, data_nascimento, genero, email, telefone_whatsapp, status)
            VALUES ('Atleta Elegivel Exame', '12399988800', '1998-04-12', 'M', 'elegivel.exame@exemplo.com', '11977776666', 'ativo')
        `);
        alunoId = alunoIns.insertId;

        const [niveis] = await pool.query('SELECT id FROM graduacoes_niveis WHERE modalidade_id = 1 ORDER BY ordem_hierarquica ASC LIMIT 2');
        const nivelAtualId = niveis[0].id;

        await pool.query(`
            INSERT INTO aluno_graduacoes (aluno_id, modalidade_id, graduacao_nivel_id, data_graduacao, atual)
            VALUES (?, 1, ?, CURDATE(), 1)
        `, [alunoId, nivelAtualId]);

        // 3. Cadastra avaliação técnica deixando o atleta APTO (85%)
        await pool.query(`
            INSERT INTO aluno_avaliacoes_graduacao (
                aluno_id, modalidade_id, graduacao_nivel_id,
                professor_id, percentual_obtido, apto, data_avaliacao, itens_avaliados_json
            ) VALUES (?, 1, ?, 1, 85.00, 1, CURDATE(), '[]')
        `, [alunoId, nivelAtualId]);

        // 4. Consulta painel do atleta e valida dados enriquecidos do exame
        const resPainel = await fetch(`${baseUrl}/api/aluno/meu-painel?aluno_id=${alunoId}`);
        assert.equal(resPainel.status, 200);
        const dataPainel = await resPainel.json();

        assert.equal(dataPainel.success, true);
        assert.ok(dataPainel.graduacao.avaliacao.apto, 'Atleta deve estar apto/elegível');
        assert.ok(dataPainel.exame_proximo, 'Deve retornar o próximo exame aberto');
        assert.equal(dataPainel.exame_proximo.id, eventoId);
        assert.equal(Number(dataPainel.exame_proximo.taxa_inscricao), 125.00, 'Taxa do exame deve ser retornada');
        assert.equal(dataPainel.exame_proximo.local_evento, 'Tatame Central - CT Kaizen');

        // 5. Realiza a inscrição direta no exame pelo endpoint do atleta
        const resInscricao = await fetch(`${baseUrl}/api/aluno/exames/${eventoId}/inscrever`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ aluno_id: alunoId, billing_type: 'PIX' })
        });
        assert.equal(resInscricao.status, 200);
        const dataInscricao = await resInscricao.json();

        assert.equal(dataInscricao.success, true);
        assert.ok(dataInscricao.convite_id, 'Deve retornar o ID do convite gerado');
        conviteId = dataInscricao.convite_id;
        assert.ok(dataInscricao.cobranca, 'Deve conter os dados de cobrança');
        assert.ok(dataInscricao.cobranca.asaas_payment_id, 'Deve ter ID de pagamento Asaas gerado');
        assert.equal(Number(dataInscricao.cobranca.valor), 125.00);

        // 6. Consulta novamente o painel do atleta e verifica se o status foi atualizado para 'aceito'
        const resPainelPos = await fetch(`${baseUrl}/api/aluno/meu-painel?aluno_id=${alunoId}`);
        const dataPainelPos = await resPainelPos.json();

        assert.equal(dataPainelPos.exame_proximo.convite_status, 'aceito', 'Status do convite deve ser aceito');
        assert.equal(dataPainelPos.exame_proximo.convite_id, conviteId);

    } finally {
        if (conviteId) {
            await pool.query('DELETE FROM evento_graduacao_convites WHERE id = ?', [conviteId]).catch(() => {});
        }
        if (alunoId) {
            await pool.query('DELETE FROM aluno_avaliacoes_graduacao WHERE aluno_id = ?', [alunoId]).catch(() => {});
            await pool.query('DELETE FROM aluno_graduacoes WHERE aluno_id = ?', [alunoId]).catch(() => {});
            await pool.query('DELETE FROM alunos WHERE id = ?', [alunoId]).catch(() => {});
        }
        if (eventoId) {
            await pool.query('DELETE FROM eventos_graduacao WHERE id = ?', [eventoId]).catch(() => {});
        }
        server.close();
    }
});

test('Exames de Graduação: Aluno recusa exame (desistência) e Administrador pode reativar caso o aluno mude de ideia', async () => {
    const server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    let alunoId = null;
    let eventoId = null;
    let conviteId = null;

    try {
        const adminToken = jwt.sign(
            { id: 1, cargo: 'admin', nome: 'Admin Master' },
            JWT_SECRET,
            { expiresIn: '1h', algorithm: 'HS256' }
        );

        // 1. Cria evento de exame
        const [evIns] = await pool.query(`
            INSERT INTO eventos_graduacao (
                titulo, modalidade_id, data_evento, horario_inicio,
                local_evento, taxa_inscricao, status
            ) VALUES (
                'Exame Teste Recusa e Reativacao', 1, DATE_ADD(CURDATE(), INTERVAL 20 DAY),
                '09:30:00', 'Tatame Kaizen', 110.00, 'aberto'
            )
        `);
        eventoId = evIns.insertId;

        // 2. Cria atleta
        const [alunoIns] = await pool.query(`
            INSERT INTO alunos (nome_completo, cpf, data_nascimento, genero, email, telefone_whatsapp, status)
            VALUES ('Atleta Desistente Teste', '45678912300', '1996-07-22', 'M', 'desistente.exame@exemplo.com', '11966665555', 'ativo')
        `);
        alunoId = alunoIns.insertId;

        const [niveis] = await pool.query('SELECT id FROM graduacoes_niveis WHERE modalidade_id = 1 ORDER BY ordem_hierarquica ASC LIMIT 2');
        const nivelAtualId = niveis[0].id;

        await pool.query(`
            INSERT INTO aluno_graduacoes (aluno_id, modalidade_id, graduacao_nivel_id, data_graduacao, atual)
            VALUES (?, 1, ?, CURDATE(), 1)
        `, [alunoId, nivelAtualId]);

        // 3. Aluno recusa o exame diretamente ("Não posso participar")
        const resRecusa = await fetch(`${baseUrl}/api/aluno/exames/${eventoId}/recusar-evento`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ aluno_id: alunoId, motivo: 'Viagem de trabalho inadiável' })
        });
        assert.equal(resRecusa.status, 200);
        const dataRecusa = await resRecusa.json();
        assert.equal(dataRecusa.success, true);

        // 4. Consulta painel do aluno e verifica status = 'recusado'
        const resPainel = await fetch(`${baseUrl}/api/aluno/meu-painel?aluno_id=${alunoId}`);
        const dataPainel = await resPainel.json();
        assert.equal(dataPainel.exame_proximo.convite_status, 'recusado', 'Status deve constar como recusado');
        conviteId = dataPainel.exame_proximo.convite_id;
        assert.ok(conviteId, 'Convite deve ter sido registrado');

        // 5. Administrador visualiza convite com status recusado e motivo
        const resEventoAdmin = await fetch(`${baseUrl}/api/exames/eventos/${eventoId}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.equal(resEventoAdmin.status, 200);
        const dataEventoAdmin = await resEventoAdmin.json();
        const conviteAdmin = dataEventoAdmin.data.convites.find(c => c.convite_id === conviteId);
        assert.ok(conviteAdmin, 'Convite deve constar na lista do admin');
        assert.equal(conviteAdmin.convite_status, 'recusado');
        assert.equal(conviteAdmin.motivo_recusa, 'Viagem de trabalho inadiável');

        // 6. Aluno mudou de ideia: Administrador reativa a inscrição
        const resReativar = await fetch(`${baseUrl}/api/exames/convites/${conviteId}/reativar`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' }
        });
        assert.equal(resReativar.status, 200);
        const dataReativar = await resReativar.json();
        assert.equal(dataReativar.success, true);

        // 7. Consulta novamente o painel do atleta e valida que o status voltou para 'convidado'
        const resPainelPosReativar = await fetch(`${baseUrl}/api/aluno/meu-painel?aluno_id=${alunoId}`);
        const dataPainelPosReativar = await resPainelPosReativar.json();
        assert.equal(dataPainelPosReativar.exame_proximo.convite_status, 'convidado', 'Status deve voltar para convidado após reativação');

    } finally {
        if (conviteId) {
            await pool.query('DELETE FROM evento_graduacao_convites WHERE id = ?', [conviteId]).catch(() => {});
        }
        if (alunoId) {
            await pool.query('DELETE FROM aluno_graduacoes WHERE aluno_id = ?', [alunoId]).catch(() => {});
            await pool.query('DELETE FROM alunos WHERE id = ?', [alunoId]).catch(() => {});
        }
        if (eventoId) {
            await pool.query('DELETE FROM eventos_graduacao WHERE id = ?', [eventoId]).catch(() => {});
        }
        server.close();
    }
});

test('Pagamento por Cartão de Crédito: Validações de segurança e quitação de mensalidades e exames', async () => {
    const http = require('http');
    const app = require('../server');
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    let alunoId = null;
    let matriculaId = null;
    let faturaId = null;
    let eventoId = null;
    let conviteId = null;

    try {
        // 1. Cria aluno de teste
        const [alunoRes] = await pool.query(`
            INSERT INTO alunos (nome_completo, email, cpf, telefone_whatsapp, data_nascimento, status)
            VALUES (?, ?, ?, ?, '1998-05-15', 'ativo')
        `, [`Atleta Cartão Teste ${Date.now()}`, `cartao.${Date.now()}@teste.com`, '12345678901', '11988887777']);
        alunoId = alunoRes.insertId;

        // Cria matrícula ativa
        const [planRows] = await pool.query('SELECT id FROM planos LIMIT 1');
        const planoId = planRows.length > 0 ? planRows[0].id : 1;
        const [matRes] = await pool.query(`
            INSERT INTO matriculas (aluno_id, plano_id, data_inicio, valor_acordado, dia_vencimento, status)
            VALUES (?, ?, CURDATE(), 150.00, 10, 'ativa')
        `, [alunoId, planoId]);
        matriculaId = matRes.insertId;

        // 2. Cria fatura pendente
        const [fatRes] = await pool.query(`
            INSERT INTO faturas (matricula_id, aluno_id, competencia, valor_original, data_vencimento, status)
            VALUES (?, ?, '11/2026', 150.00, '2026-11-25', 'pendente')
        `, [matriculaId, alunoId]);
        faturaId = fatRes.insertId;

        // 3. Testa rejeição com dados de cartão incompletos/inválidos
        const resInvalido = await fetch(`${baseUrl}/api/aluno/faturas/${faturaId}/pagar-cartao`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                aluno_id: alunoId,
                numero_cartao: '123', // número inválido
                nome_impresso: 'TESTE',
                mes_validade: '12',
                ano_validade: '28',
                cvv: '12' // CVV muito curto
            })
        });
        assert.equal(resInvalido.status, 400, 'Deve rejeitar cartão com dados inválidos');

        // 4. Paga mensalidade com dados válidos de cartão
        const resValido = await fetch(`${baseUrl}/api/aluno/faturas/${faturaId}/pagar-cartao`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                aluno_id: alunoId,
                numero_cartao: '4111 1111 1111 1111',
                nome_impresso: 'ALUNO TESTE CARTAO',
                mes_validade: '12',
                ano_validade: '2028',
                cvv: '123',
                cpf_titular: '12345678901'
            })
        });
        assert.equal(resValido.status, 200, 'Pagamento com cartão válido deve ser aprovado');
        const dataValido = await resValido.json();
        assert.equal(dataValido.success, true);
        assert.equal(dataValido.pago, true);
        assert.equal(dataValido.detalhes.bandeira, 'VISA');
        assert.equal(dataValido.detalhes.ultimos4, '1111');

        // 5. Verifica se a fatura foi atualizada no banco
        const [faturasDb] = await pool.query('SELECT status, metodo_pagamento, valor_pago FROM faturas WHERE id = ?', [faturaId]);
        assert.equal(faturasDb[0].status, 'pago');
        assert.equal(faturasDb[0].metodo_pagamento, 'cartao_credito');
        assert.equal(Number(faturasDb[0].valor_pago), 150.00);

        // 6. Tenta pagar a mesma fatura de novo -> deve recusar pois já está paga
        const resDuplicado = await fetch(`${baseUrl}/api/aluno/faturas/${faturaId}/pagar-cartao`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                aluno_id: alunoId,
                numero_cartao: '4111 1111 1111 1111',
                nome_impresso: 'ALUNO TESTE CARTAO',
                mes_validade: '12',
                ano_validade: '2028',
                cvv: '123'
            })
        });
        assert.equal(resDuplicado.status, 400, 'Deve rejeitar fatura já quitada');

        // 7. Testa pagamento de exame de graduação com cartão
        const [modRows] = await pool.query('SELECT id FROM modalidades LIMIT 1');
        const modId = modRows.length > 0 ? modRows[0].id : 1;
        const [gradRows] = await pool.query('SELECT id FROM graduacoes_niveis WHERE modalidade_id = ? ORDER BY ordem_hierarquica LIMIT 2', [modId]);
        const gradAtualId = gradRows[0]?.id || 1;
        const gradPretId = gradRows[1]?.id || 2;

        const [evRes] = await pool.query(`
            INSERT INTO eventos_graduacao (titulo, modalidade_id, data_evento, taxa_inscricao, status)
            VALUES (?, ?, '2026-12-30', 175.00, 'aberto')
        `, [`Exame Cartao ${Date.now()}`, modId]);
        eventoId = evRes.insertId;

        const [convRes] = await pool.query(`
            INSERT INTO evento_graduacao_convites (evento_id, aluno_id, modalidade_id, graduacao_atual_id, graduacao_pretendida_id, valor, status)
            VALUES (?, ?, ?, ?, ?, 175.00, 'convidado')
        `, [eventoId, alunoId, modId, gradAtualId, gradPretId]);
        conviteId = convRes.insertId;

        const resCardExame = await fetch(`${baseUrl}/api/aluno/exames/${conviteId}/pagar-cartao`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                aluno_id: alunoId,
                numero_cartao: '5502 0999 8888 4444',
                nome_impresso: 'ALUNO TESTE EXAME',
                mes_validade: '08',
                ano_validade: '29',
                cvv: '999'
            })
        });
        assert.equal(resCardExame.status, 200, 'Taxa de exame paga com cartão deve ser aprovada');
        const dataCardExame = await resCardExame.json();
        assert.equal(dataCardExame.success, true);
        assert.equal(dataCardExame.pago, true);
        assert.equal(dataCardExame.detalhes.bandeira, 'MASTERCARD');
        assert.equal(dataCardExame.detalhes.ultimos4, '4444');

        // 8. Verifica atualização do convite no banco de dados
        const [conviteDb] = await pool.query('SELECT status, asaas_billing_type FROM evento_graduacao_convites WHERE id = ?', [conviteId]);
        assert.equal(conviteDb[0].status, 'pago');
        assert.equal(conviteDb[0].asaas_billing_type, 'CREDIT_CARD');

    } finally {
        if (conviteId) {
            await pool.query('DELETE FROM evento_graduacao_convites WHERE id = ?', [conviteId]).catch(() => {});
        }
        if (eventoId) {
            await pool.query('DELETE FROM eventos_graduacao WHERE id = ?', [eventoId]).catch(() => {});
        }
        if (faturaId) {
            await pool.query('DELETE FROM faturas WHERE id = ?', [faturaId]).catch(() => {});
        }
        if (matriculaId) {
            await pool.query('DELETE FROM matriculas WHERE id = ?', [matriculaId]).catch(() => {});
        }
        if (alunoId) {
            await pool.query('DELETE FROM alunos WHERE id = ?', [alunoId]).catch(() => {});
        }
        server.close();
    }
});

test('Deploy & PWA Mobile: Remoção de acessos rápidos de login, hardening e suporte Android/iOS', () => {
    const fs = require('fs');
    const path = require('path');

    const rootDir = path.join(__dirname, '..');
    const indexHtml = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
    const authJs = fs.readFileSync(path.join(rootDir, 'public', 'js', 'auth.js'), 'utf8');
    const painelHtml = fs.readFileSync(path.join(rootDir, 'public', 'painel-aluno.html'), 'utf8');
    const manifestPath = path.join(rootDir, 'public', 'manifest.json');
    const swPath = path.join(rootDir, 'public', 'sw.js');
    const appleIconPath = path.join(rootDir, 'public', 'assets', 'icons', 'apple-touch-icon.png');
    const icon192Path = path.join(rootDir, 'public', 'assets', 'icons', 'icon-192.png');
    const icon512Path = path.join(rootDir, 'public', 'assets', 'icons', 'icon-512.png');

    assert.equal(indexHtml.includes('data-quick-login'), false, 'Login não deve conter botões de acesso rápido');
    assert.equal(indexHtml.includes('Padrão: 123456'), false, 'Login não deve expor dica de senha padrão');
    assert.equal(authJs.includes('data-quick-login'), false, 'auth.js não deve manter listener de acesso rápido');
    assert.equal(authJs.includes('/aluno.html'), false, 'auth.js deve redirecionar aluno para /painel');

    assert.ok(fs.existsSync(manifestPath), 'manifest.json deve existir');
    assert.ok(fs.existsSync(swPath), 'sw.js deve existir');
    assert.ok(fs.existsSync(appleIconPath) && hasValidImageSignature(appleIconPath), 'apple-touch-icon.png válido deve existir');
    assert.ok(fs.existsSync(icon192Path) && hasValidImageSignature(icon192Path), 'icon-192.png válido deve existir');
    assert.ok(fs.existsSync(icon512Path) && hasValidImageSignature(icon512Path), 'icon-512.png válido deve existir');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.start_url, '/painel');
    assert.equal(manifest.display, 'standalone');

    assert.ok(painelHtml.includes('apple-mobile-web-app-capable'), 'painel-aluno.html deve suportar iOS standalone');
    assert.ok(painelHtml.includes('rel="manifest" href="/manifest.json'), 'painel-aluno.html deve referenciar manifest.json');
    assert.ok(painelHtml.includes('viewport-fit=cover'), 'painel-aluno.html deve suportar safe-area viewport-fit=cover');
});

test('Domínio Financeiro: Regras de faturamento na competência após cancelamento ou plano pago ativo', async () => {
    const { calculateCompetenceInvoiceAmount } = require('../services/domainRules');
    const MatriculaService = require('../services/matriculaService');

    // 1. Fatura cancelada na competência NÃO bloqueia nova cobrança ao contratar outro plano
    const afterCancel = calculateCompetenceInvoiceAmount(180, [
        { id: 1, status: 'cancelado', valor_original: 150, valor_pago: null }
    ]);
    assert.equal(afterCancel.shouldCreate, true);
    assert.equal(afterCancel.amount, 180);
    assert.equal(afterCancel.reason, 'new_competence_invoice');

    // 2. Plano novo de mesmo valor ou menor com fatura já PAGA na competência não cobra em duplicidade
    const sameOrDowngradePaid = calculateCompetenceInvoiceAmount(150, [
        { id: 2, status: 'pago', valor_original: 180, valor_pago: 180 }
    ]);
    assert.equal(sameOrDowngradePaid.shouldCreate, false);
    assert.equal(sameOrDowngradePaid.reason, 'already_paid_in_competence');

    // 3. Plano novo mais caro com fatura já PAGA na competência gera apenas a diferença
    const upgradePaid = calculateCompetenceInvoiceAmount(250, [
        { id: 3, status: 'pago', valor_original: 180, valor_pago: 180 }
    ]);
    assert.equal(upgradePaid.shouldCreate, true);
    assert.equal(upgradePaid.amount, 70);
    assert.equal(upgradePaid.reason, 'upgrade_difference');

    // 4. Fatura pendente ou atrasada ativa evita duplicidade
    const openInvoice = calculateCompetenceInvoiceAmount(200, [
        { id: 4, status: 'atrasado', valor_original: 200, valor_pago: null }
    ]);
    assert.equal(openInvoice.shouldCreate, false);
    assert.equal(openInvoice.reason, 'existing_open_invoice');

    // 5. Teste transacional simulado: cancelar matrícula atrasada e contratar novo plano reativa aluno e gera nova fatura
    const queries = [];
    const mockConn = {
        async query(sql, params = []) {
            queries.push({ sql, params });
            if (sql.includes('SELECT id, aluno_id, status FROM matriculas WHERE id = ?')) {
                return [[{ id: 10, aluno_id: 5, status: 'ativa' }]];
            }
            if (sql.includes('SELECT id FROM matriculas WHERE aluno_id = ? AND status = \'ativa\'')) {
                return [[]];
            }
            if (sql.includes('SELECT valor_mensal FROM planos WHERE id = ?')) {
                return [[{ valor_mensal: 199.9 }]];
            }
            if (sql.includes('INSERT INTO matriculas')) {
                return [{ insertId: 11 }];
            }
            if (sql.includes('FROM faturas') && sql.includes("status != 'cancelado'")) {
                return [[]];
            }
            if (sql.includes('SELECT modalidade_id FROM planos_modalidades')) {
                return [[]];
            }
            return [{ affectedRows: 1 }];
        }
    };

    const cancelRes = await MatriculaService.cancelEnrollment(mockConn, {
        matriculaId: 10,
        motivo: 'Desistência antes do pagamento',
        cancelarFaturasAbertas: true
    });
    assert.equal(cancelRes.statusCode, 200);
    assert.ok(
        queries.some(q => q.sql.includes("status IN ('pendente', 'atrasado')") && q.sql.includes("status = 'cancelado'")),
        'Cancelamento deve cancelar tanto faturas pendentes quanto atrasadas'
    );

    const enrollRes = await MatriculaService.createEnrollmentWithInvoice(mockConn, {
        alunoId: 5,
        planoId: 2,
        diaVencimento: 10
    });
    assert.equal(enrollRes.matriculaId, 11);
    assert.ok(
        queries.some(q => q.sql.includes("UPDATE alunos SET status = 'ativo' WHERE id = ?")),
        'Nova matrícula deve reativar o status do aluno'
    );
    assert.ok(
        queries.some(q => q.sql.includes('INSERT INTO faturas')),
        'Nova matrícula após cancelamento deve gerar nova fatura pendente'
    );
});

test('Gateway Asaas: Extração estruturada de falhas e sanitização de dados sensíveis em logs', () => {
    const PaymentLogService = require('../services/paymentLogService');
    const asaasService = require('../services/asaasService');

    const err = asaasService.buildAsaasError(
        400,
        { errors: [{ code: 'invalid_cpfCnpj', description: 'O CPF/CNPJ informado é inválido.' }] },
        'Erro padrão',
        'criar_cliente'
    );
    const info = PaymentLogService.extractAsaasErrorInfo(err);
    assert.equal(info.httpStatus, 400);
    assert.equal(info.codigoErro, 'invalid_cpfCnpj');
    assert.equal(info.mensagemErro, 'O CPF/CNPJ informado é inválido.');

    const sanitized = JSON.parse(PaymentLogService.sanitizeDetails({
        access_token: 'secret_key',
        creditCard: { number: '4111111111111111', ccv: '999' },
        errors: [{ code: 'invalid_cpfCnpj', description: 'O CPF/CNPJ informado é inválido.' }]
    }));
    assert.equal(sanitized.access_token, '[REDACTED]');
    assert.equal(sanitized.creditCard, '[REDACTED]');
    assert.equal(sanitized.errors[0].code, 'invalid_cpfCnpj');
});

test('Conciliação de Pagamentos: Classificação Gateway vs Manual/Avulso e Referências Externas', () => {
    const rec = require('../services/paymentReconciliationService');

    // Mapeamento válido para ENUM metodo_pagamento da tabela faturas
    assert.equal(rec.mapAsaasBillingTypeToMetodo('CREDIT_CARD'), 'cartao_credito');
    assert.equal(rec.mapAsaasBillingTypeToMetodo('DEBIT_CARD'), 'cartao_debito');
    assert.equal(rec.mapAsaasBillingTypeToMetodo('BOLETO'), 'boleto');
    assert.equal(rec.mapAsaasBillingTypeToMetodo('PIX'), 'pix');
    assert.equal(rec.mapAsaasBillingTypeToMetodo('RECEIVED_IN_CASH'), 'dinheiro');
    assert.equal(rec.mapAsaasBillingTypeToMetodo('UNDEFINED'), 'pix');

    // Status online vs manual
    assert.equal(rec.isAsaasStatusPaidOnline('RECEIVED'), true);
    assert.equal(rec.isAsaasStatusPaidOnline('CONFIRMED'), true);
    assert.equal(rec.isAsaasStatusPaidOnline('RECEIVED_MANUALLY'), false);
    assert.equal(rec.isAsaasStatusPaidOnline('RECEIVED_IN_CASH'), false);
    assert.equal(rec.isAsaasStatusManual('RECEIVED_MANUALLY'), true);
    assert.equal(rec.isAsaasStatusManual('RECEIVED_IN_CASH'), true);

    // Extração segura de externalReference
    assert.deepEqual(rec.parseExternalReference('fatura_42_aluno_7'), { tipo: 'fatura', id: 42, alunoId: 7 });
    assert.deepEqual(rec.parseExternalReference('convite_19_aluno_3'), { tipo: 'convite', id: 19, alunoId: 3 });
    assert.equal(rec.parseExternalReference('invalid_ref'), null);

    // Classificação de exames: baixa manual antiga ambígua vs pagamento online real
    const exameLegacyManual = rec.classifyConvitePaymentOrigin({
        status: 'pago',
        asaas_payment_id: 'pay_123456',
        asaas_invoice_url: 'https://sandbox.asaas.com/i/pay_123456',
        asaas_billing_type: 'PIX',
        asaas_status: 'CONFIRMED'
    });
    assert.equal(exameLegacyManual.origem, 'manual');
    assert.equal(exameLegacyManual.badgeText, '✓ Pago (Manual)');

    const examePixOnline = rec.classifyConvitePaymentOrigin({
        status: 'pago',
        asaas_payment_id: 'pay_123456',
        asaas_billing_type: 'PIX',
        asaas_status: 'RECEIVED'
    });
    assert.equal(examePixOnline.origem, 'online');
    assert.equal(examePixOnline.badgeText, '✓ Pago (Online)');

    const exameCartaoOnline = rec.classifyConvitePaymentOrigin({
        status: 'pago',
        asaas_payment_id: 'pay_999',
        asaas_billing_type: 'CREDIT_CARD',
        asaas_status: 'CONFIRMED'
    });
    assert.equal(exameCartaoOnline.origem, 'online');

    const exameManualNovo = rec.classifyConvitePaymentOrigin({
        status: 'pago',
        asaas_payment_id: 'pay_123456',
        asaas_billing_type: 'MANUAL',
        asaas_status: 'RECEIVED_MANUALLY'
    });
    assert.equal(exameManualNovo.origem, 'manual');

    // Classificação de faturas: avulsa paga manualmente mesmo com pix/cartão vs gateway
    const faturaManualPix = rec.classifyFaturaPaymentOrigin({
        status: 'pago',
        metodo_pagamento: 'pix',
        asaas_payment_id: 'pay_fat_1',
        asaas_status: 'RECEIVED_MANUALLY'
    });
    assert.equal(faturaManualPix.origem, 'manual');

    const faturaOnlinePix = rec.classifyFaturaPaymentOrigin({
        status: 'pago',
        metodo_pagamento: 'pix',
        asaas_payment_id: 'pay_fat_2',
        asaas_status: 'RECEIVED'
    });
    assert.equal(faturaOnlinePix.origem, 'online');

    const faturaPagaComStatusAsaasPendente = rec.classifyFaturaPaymentOrigin({
        status: 'pago',
        metodo_pagamento: 'pix',
        asaas_payment_id: 'pay_fat_3',
        asaas_status: 'PENDING'
    });
    assert.equal(faturaPagaComStatusAsaasPendente.origem, 'manual');
});

test('Avaliação Técnica RPG (Muay Thai): 20 Critérios, Trava de Sparring, Ranks e Deltas', () => {
    const rpg = require('../services/rpgEvaluationService');

    assert.equal(rpg.RPG_PILLARS.length, 5);
    assert.equal(rpg.RPG_CRITERIA.length, 20);

    const sparringIds = rpg.RPG_CRITERIA.filter(c => c.isSparring).map(c => c.id);
    assert.deepEqual(sparringIds, [
        'controle_emocional_sparring',
        'controle_tecnica_sparring',
        'controle_forca_golpes'
    ]);

    // Sem apto_sparring definido deve falhar
    const missingSpar = rpg.evaluateRpgPayload({ criterios: {} });
    assert.equal(missingSpar.valid, false);

    // Nota fora do intervalo 0..5 ou decimal deve falhar
    const baseAllFive = {};
    rpg.RPG_CRITERIA.forEach((c) => { baseAllFive[c.id] = 5; });
    const invalidDecimal = rpg.evaluateRpgPayload({
        apto_sparring: true,
        criterios: { ...baseAllFive, precisao: 4.5 }
    });
    assert.equal(invalidDecimal.valid, false);

    // Regra de trava: apto_sparring = false limita [SPARRING] ao máximo 3
    const lockedRes = rpg.evaluateRpgPayload({
        apto_sparring: false,
        data_avaliacao: '2026-11-21',
        criterios: baseAllFive,
        observacoes_instrutor: 'Focar em guarda antes do sparring livre.'
    });
    assert.equal(lockedRes.valid, true);
    assert.equal(lockedRes.data.trava_sparring_aplicada, true);
    assert.equal(lockedRes.data.criterios.controle_emocional_sparring, 3);
    assert.equal(lockedRes.data.criterios.controle_tecnica_sparring, 3);
    assert.equal(lockedRes.data.criterios.controle_forca_golpes, 3);
    assert.equal(lockedRes.data.score_inteligencia, 18);
    assert.equal(lockedRes.data.score_destreza, 18);
    assert.equal(lockedRes.data.score_agilidade, 20);
    assert.equal(lockedRes.data.score_forca, 18);
    assert.equal(lockedRes.data.score_vitalidade, 20);
    assert.equal(lockedRes.data.score_total, 94);
    assert.equal(lockedRes.data.rank_combate, 'S');

    // Faixas oficiais de Rank
    assert.equal(rpg.classifyRpgRank(0).codigo, 'D');
    assert.equal(rpg.classifyRpgRank(25).codigo, 'D');
    assert.equal(rpg.classifyRpgRank(26).codigo, 'C');
    assert.equal(rpg.classifyRpgRank(50).codigo, 'C');
    assert.equal(rpg.classifyRpgRank(51).codigo, 'B');
    assert.equal(rpg.classifyRpgRank(75).codigo, 'B');
    assert.equal(rpg.classifyRpgRank(76).codigo, 'A');
    assert.equal(rpg.classifyRpgRank(90).codigo, 'A');
    assert.equal(rpg.classifyRpgRank(91).codigo, 'S');
    assert.equal(rpg.classifyRpgRank(100).codigo, 'S');

    // Cálculo de deltas evolutivos
    const curNorm = rpg.normalizeRpgRow({
        modelo_avaliacao: 'rpg',
        apto_sparring: 1,
        score_inteligencia: 16,
        score_destreza: 14,
        score_agilidade: 15,
        score_forca: 13,
        score_vitalidade: 17,
        score_total: 75,
        rank_combate: 'B',
        rank_titulo: 'Combatente'
    });
    const prevNorm = rpg.normalizeRpgRow({
        modelo_avaliacao: 'rpg',
        apto_sparring: 0,
        score_inteligencia: 14,
        score_destreza: 15,
        score_agilidade: 13,
        score_forca: 13,
        score_vitalidade: 14,
        score_total: 69,
        rank_combate: 'B',
        rank_titulo: 'Combatente'
    });
    const deltas = rpg.computeRpgDeltas(curNorm, prevNorm);
    assert.deepEqual(deltas, {
        score_total: 6,
        pilares: {
            inteligencia: 2,
            destreza: -1,
            agilidade: 2,
            forca: 0,
            vitalidade: 3
        }
    });
});

test('Gamificação Avançada RPG: Arquétipo, Insígnias, Foco de Evolução e Trava de Exame', () => {
    const rpg = require('../services/rpgEvaluationService');

    // 1. Arquétipo: Sem pontuação vs Equilíbrio vs Todos os 10 pares em ambas as ordens
    assert.equal(rpg.computeFighterArchetype({ inteligencia: 0, destreza: 0, agilidade: 0, forca: 0, vitalidade: 0 }, 0).titulo, 'Em Formação');

    const balanced = rpg.computeFighterArchetype({ inteligencia: 14, destreza: 15, agilidade: 16, forca: 15, vitalidade: 14 }, 74);
    assert.equal(balanced.titulo, 'Lutador Completo (All-Rounder)');
    assert.equal(balanced.equilibrado, true);

    const pairCases = [
        ['inteligencia', 'destreza', 'Estrategista Cirúrgico'],
        ['forca', 'vitalidade', 'Tanque de Pressão'],
        ['agilidade', 'destreza', 'Velocista / Francoatirador'],
        ['inteligencia', 'forca', 'Controlador de Clinch'],
        ['inteligencia', 'agilidade', 'Contra-Atacante Fantasma'],
        ['agilidade', 'vitalidade', 'Ritmo Incessante'],
        ['destreza', 'forca', 'Nocauteador Técnico'],
        ['destreza', 'vitalidade', 'Guerreiro Resiliente'],
        ['inteligencia', 'vitalidade', 'Mestre da Cadência'],
        ['agilidade', 'forca', 'Explosão Pura']
    ];

    for (const [p1, p2, expectedTitle] of pairCases) {
        const pillarsA = { inteligencia: 6, destreza: 6, agilidade: 6, forca: 6, vitalidade: 6, [p1]: 18, [p2]: 15 };
        const pillarsB = { inteligencia: 6, destreza: 6, agilidade: 6, forca: 6, vitalidade: 6, [p1]: 15, [p2]: 18 };
        assert.equal(rpg.computeFighterArchetype(pillarsA, 51).titulo, expectedTitle, `Ordem ${p1}>${p2}`);
        assert.equal(rpg.computeFighterArchetype(pillarsB, 51).titulo, expectedTitle, `Ordem ${p2}>${p1}`);
    }

    // 2. Insígnias: verificação individual e trava de sparring em "Parceiro de Confiança"
    const baseFour = {};
    rpg.RPG_CRITERIA.forEach((c) => { baseFour[c.id] = 4; });

    const onlyMuralha = rpg.computeRpgBadges({ ...baseFour, defesas: 5, manutencao_guarda_fadiga: 5 }, true);
    assert.equal(onlyMuralha.find(b => b.id === 'muralha').desbloqueada, true);
    assert.equal(onlyMuralha.filter(b => b.desbloqueada).length, 1);

    const partialClinch = rpg.computeRpgBadges({ ...baseFour, dominio_clinch_tatico: 5, saidas_clinch: 5, forca_isometrica_clinch: 4 }, true);
    assert.equal(partialClinch.find(b => b.id === 'rei_do_clinch').desbloqueada, false);

    const fullClinchAndSniper = rpg.computeRpgBadges({
        ...baseFour,
        dominio_clinch_tatico: 5, saidas_clinch: 5, forca_isometrica_clinch: 5,
        precisao: 5, contra_ataques: 5,
        resistencia_cardiovascular: 5, recuperacao_entre_rounds: 5,
        jogo_pernas_footwork: 5, tempo_reacao: 5,
        controle_forca_golpes: 5, controle_emocional_sparring: 5
    }, true);
    assert.equal(fullClinchAndSniper.find(b => b.id === 'rei_do_clinch').desbloqueada, true);
    assert.equal(fullClinchAndSniper.find(b => b.id === 'sniper').desbloqueada, true);
    assert.equal(fullClinchAndSniper.find(b => b.id === 'pulmao_de_aco').desbloqueada, true);
    assert.equal(fullClinchAndSniper.find(b => b.id === 'intocavel').desbloqueada, true);
    assert.equal(fullClinchAndSniper.find(b => b.id === 'parceiro_confianca').desbloqueada, true);

    const sparringLockedBadge = rpg.computeRpgBadges({ ...baseFour, controle_forca_golpes: 5, controle_emocional_sparring: 5 }, false);
    assert.equal(sparringLockedBadge.find(b => b.id === 'parceiro_confianca').desbloqueada, false);

    // 3. Foco de Evolução ("Missão Atual"): escolhe os 2 piores e desempata pelo pilar mais baixo
    const focusMap = {};
    rpg.RPG_CRITERIA.forEach((c) => { focusMap[c.id] = 4; });
    focusMap.contra_ataques = 2;        // inteligencia (pilar = 14)
    focusMap.saidas_clinch = 2;         // agilidade (pilar = 11)
    focusMap.potencia_impacto = 2;      // forca (pilar = 9)
    focusMap.explosao_combinacoes = 1;  // forca (pilar = 9)
    focusMap.forca_isometrica_clinch = 2;

    const focusPilares = { inteligencia: 14, destreza: 16, agilidade: 11, forca: 9, vitalidade: 16 };
    const focusRes = rpg.computeTrainingFocus(focusMap, focusPilares);
    assert.ok(focusRes);
    assert.equal(focusRes.criterios.length, 2);
    assert.equal(focusRes.criterios[0].id, 'explosao_combinacoes');
    assert.equal(focusRes.criterios[0].nota, 1);
    assert.equal(focusRes.criterios[1].pilar, 'forca'); // empate nota 2 quebrado pelo menor pilar (forca=9)
    assert.equal(focusRes.criterios[1].nota, 2);
    assert.ok(focusRes.mensagem.includes('Melhorar'));

    // 4. Requisitos de Exame (Trava de Progressão)
    const noLock = rpg.evaluateExamProgressionLock(null, { id: 2, nome: 'Prajied Amarelo' });
    assert.equal(noLock.possui_requisitos_rpg, false);
    assert.equal(noLock.elegivel, true);

    const avalIncompleta = rpg.normalizeRpgRow({
        modelo_avaliacao: 'rpg',
        apto_sparring: 0,
        score_inteligencia: 11,
        score_destreza: 10,
        score_agilidade: 10,
        score_forca: 8,
        score_vitalidade: 9,
        score_total: 48,
        rank_combate: 'C',
        rank_titulo: 'Praticante'
    });
    const nextNivelComTrava = {
        id: 3,
        nome: 'Prajied Azul Claro',
        rpg_rank_minimo: 'B',
        rpg_pontuacao_minima_atributo: 10,
        rpg_exige_apto_sparring: 1
    };
    const lockFail = rpg.evaluateExamProgressionLock(avalIncompleta, nextNivelComTrava);
    assert.equal(lockFail.possui_requisitos_rpg, true);
    assert.equal(lockFail.elegivel, false);
    assert.ok(lockFail.progresso_pct > 0 && lockFail.progresso_pct < 100);
    assert.ok(lockFail.pendencias.some(p => p.includes('Rank B')));
    assert.ok(lockFail.pendencias.some(p => p.includes('Força: 8/10')));
    assert.ok(lockFail.pendencias.some(p => p.includes('Vitalidade: 9/10')));
    assert.ok(lockFail.pendencias.some(p => p.includes('Apto para Sparring')));

    const avalApta = rpg.normalizeRpgRow({
        modelo_avaliacao: 'rpg',
        apto_sparring: 1,
        score_inteligencia: 14,
        score_destreza: 13,
        score_agilidade: 12,
        score_forca: 11,
        score_vitalidade: 15,
        score_total: 65,
        rank_combate: 'B',
        rank_titulo: 'Combatente'
    });
    const lockPass = rpg.evaluateExamProgressionLock(avalApta, nextNivelComTrava);
    assert.equal(lockPass.elegivel, true);
    assert.equal(lockPass.progresso_pct, 100);
    assert.equal(lockPass.pendencias.length, 0);
});

test('Quadro de Missões e Missões Automáticas: Validação, Geração Automática e Limite de Aceite', () => {
    const missoes = require('../services/missoesService');

    // 1. Validação de payload do Quadro de Missões
    assert.equal(missoes.validateMissaoPayload({ titulo: 'Oi', descricao: 'Desc ok' }).valid, false);
    assert.equal(missoes.validateMissaoPayload({ titulo: 'Chute Circular', descricao: 'abc' }).valid, false);
    assert.equal(missoes.validateMissaoPayload({ titulo: 'Chute Circular', descricao: 'Treinar 100 chutes', dificuldade: 'insana' }).valid, false);
    assert.equal(missoes.validateMissaoPayload({ titulo: 'Chute Circular', descricao: 'Treinar 100 chutes', categoria: 'corrida' }).valid, false);
    assert.equal(missoes.validateMissaoPayload({ titulo: 'Chute Circular', descricao: 'Treinar 100 chutes', recompensa_xp: 99999 }).valid, false);

    const validMissao = missoes.validateMissaoPayload({
        titulo: '  100 Chutes no Saco  ',
        descricao: 'Manter a base firme e retorno imediato da guarda.',
        categoria: 'tecnica',
        dificuldade: 'dificil',
        pilar_foco: 'destreza',
        modalidade_id: '1',
        recompensa_xp: 120,
        recompensa_texto: 'Destaque da Semana',
        limite_vagas: 20,
        prazo_dias: 7,
        ativo: true
    });
    assert.equal(validMissao.valid, true);
    assert.equal(validMissao.data.titulo, '100 Chutes no Saco');
    assert.equal(validMissao.data.modalidade_id, 1);
    assert.equal(validMissao.data.recompensa_xp, 120);
    assert.equal(validMissao.data.ativo, 1);

    // 2. Geração de missões automáticas (com RPG + Frequência + Exame + Wiki e sem RPG)
    const semRpg = missoes.buildAutomaticMissions({
        avaliacaoRpg: null,
        streak: { total_semana: 2, meta_semana: 3, meta_atingida: false },
        prontidaoExame: { total_golpes: 10, golpes_dominados: 4, nivel_nome: 'Prajied Branco', apto_exame: false }
    });
    assert.equal(semRpg.length, 2);
    assert.equal(semRpg[0].tipo, 'frequencia_semanal');
    assert.equal(semRpg[1].tipo, 'curriculo_wiki');

    const comRpg = missoes.buildAutomaticMissions({
        avaliacaoRpg: {
            atual: {
                foco_evolucao: {
                    criterios: [
                        { id: 'saidas_clinch', nome: 'Saídas de clinch', pilar: 'agilidade', pilar_nome: 'Agilidade', pilar_cor: '#22c55e', nota: 1 },
                        { id: 'controle_distancia', nome: 'Controle de distância', pilar: 'inteligencia', pilar_nome: 'Inteligência', pilar_cor: '#38bdf8', nota: 2 }
                    ]
                }
            },
            requisitos_exame: {
                possui_requisitos_rpg: true,
                proxima_graduacao_nome: 'Prajied Amarelo',
                progresso_pct: 60,
                elegivel: false,
                pendencias: ['Rank B: faltam +5 pts']
            }
        },
        streak: { total_semana: 3, meta_semana: 3, meta_atingida: true },
        prontidaoExame: { total_golpes: 5, golpes_dominados: 5, nivel_nome: 'Prajied Branco', apto_exame: true }
    });
    assert.equal(comRpg.length, 5);
    assert.equal(comRpg[0].tipo, 'foco_rpg');
    assert.equal(comRpg[0].progresso_pct, 20);
    assert.equal(comRpg[2].status, 'concluida');
    assert.equal(comRpg[3].tipo, 'exame_graduacao');
    assert.equal(comRpg[4].status, 'concluida');

    // 3. Regras de aceite do Quadro do Professor
    const activeMissao = { id: 1, ativo: 1, limite_vagas: 2 };
    assert.equal(missoes.canStudentAcceptMission({ missao: { id: 1, ativo: 0 }, activeCount: 0 }).allowed, false);
    assert.equal(missoes.canStudentAcceptMission({ missao: activeMissao, activeCount: 0, currentEnrollment: { status: 'em_andamento' } }).allowed, false);
    assert.equal(missoes.canStudentAcceptMission({ missao: activeMissao, activeCount: 0, currentEnrollment: { status: 'aguardando_validacao' } }).allowed, false);
    assert.equal(missoes.canStudentAcceptMission({ missao: activeMissao, activeCount: 0, currentEnrollment: { status: 'concluida' } }).allowed, false);
    assert.equal(missoes.canStudentAcceptMission({ missao: activeMissao, activeCount: 3 }).allowed, false);
    assert.equal(missoes.canStudentAcceptMission({ missao: activeMissao, activeCount: 0, totalAceites: 2 }).allowed, false);
    assert.equal(missoes.canStudentAcceptMission({ missao: activeMissao, activeCount: 1, currentEnrollment: { status: 'cancelada' }, totalAceites: 1 }).allowed, true);
});

test('WhatsApp Persistência MySQL: Criptografia AES-256-GCM, Auth State e Backoff de Reconexão', async () => {
    const whatsappService = require('../services/whatsappService');
    const authStore = require('../services/whatsappAuthStore');
    const baileys = await whatsappService.loadBaileys();

    // 1. Criptografia AES-256-GCM e fallback seguro
    const payloadJson = JSON.stringify({ hello: 'world', num: 42 });
    const encrypted = authStore.encryptPayload(payloadJson, 'chave-super-secreta');
    assert.ok(encrypted.startsWith('enc:v1:'));
    assert.equal(authStore.decryptPayload(encrypted, 'chave-super-secreta'), payloadJson);
    assert.equal(authStore.decryptPayload(encrypted, 'chave-errada'), null);
    assert.equal(authStore.decryptPayload(payloadJson, 'chave-super-secreta'), payloadJson);
    assert.equal(authStore.encryptPayload(payloadJson, ''), payloadJson);

    // 2. Pool MySQL em memória simulando reinício entre deploys
    const dbRows = new Map();
    const mockPool = {
        async query(sql, params = []) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            if (normalized.startsWith('INSERT INTO whatsapp_auth_state')) {
                const [sid, key, val] = params;
                dbRows.set(`${sid}::${key}`, val);
                return [{ affectedRows: 1 }];
            }
            if (normalized.startsWith('SELECT 1 AS ok FROM whatsapp_auth_state')) {
                const [sid] = params;
                return [dbRows.has(`${sid}::creds`) ? [{ ok: 1 }] : []];
            }
            if (normalized.startsWith('SELECT data_value FROM whatsapp_auth_state')) {
                const [sid, key] = params;
                const val = dbRows.get(`${sid}::${key}`);
                return [val !== undefined ? [{ data_value: val }] : []];
            }
            if (normalized.startsWith('SELECT data_key, data_value FROM whatsapp_auth_state')) {
                const [sid, ...keys] = params;
                const found = [];
                for (const k of keys) {
                    const val = dbRows.get(`${sid}::${k}`);
                    if (val !== undefined) found.push({ data_key: k, data_value: val });
                }
                return [found];
            }
            if (normalized.startsWith('DELETE FROM whatsapp_auth_state WHERE session_id = ? AND data_key = ?')) {
                const [sid, key] = params;
                dbRows.delete(`${sid}::${key}`);
                return [{ affectedRows: 1 }];
            }
            if (normalized.startsWith('DELETE FROM whatsapp_auth_state WHERE session_id = ?')) {
                const [sid] = params;
                for (const k of Array.from(dbRows.keys())) {
                    if (k.startsWith(`${sid}::`)) dbRows.delete(k);
                }
                return [{ affectedRows: 1 }];
            }
            return [[]];
        }
    };

    const secret = 'segredo-jwt-ambiente';
    assert.equal(await authStore.hasSavedSession(mockPool), false);

    const firstBoot = await authStore.useMysqlAuthState(mockPool, { baileys, secret });
    assert.ok(Buffer.isBuffer(firstBoot.state.creds.noiseKey.private));
    const originalPrivHex = Buffer.from(firstBoot.state.creds.noiseKey.private).toString('hex');

    await firstBoot.saveCreds();
    assert.equal(await authStore.hasSavedSession(mockPool), true);
    assert.ok(String(dbRows.get('default::creds')).startsWith('enc:v1:'));

    await firstBoot.state.keys.set({
        'pre-key': { '1': { private: Buffer.from([1, 2, 3]), public: Buffer.from([4, 5, 6]) } },
        'app-state-sync-key': { 'k1': { keyData: Buffer.from([9, 8, 7]) } }
    });

    // Simula novo deploy / reinício carregando do MySQL em outra instância
    const secondBoot = await authStore.useMysqlAuthState(mockPool, { baileys, secret });
    assert.ok(Buffer.isBuffer(secondBoot.state.creds.noiseKey.private));
    assert.equal(Buffer.from(secondBoot.state.creds.noiseKey.private).toString('hex'), originalPrivHex);

    const preKeys = await secondBoot.state.keys.get('pre-key', ['1', '999']);
    assert.ok(Buffer.isBuffer(preKeys['1'].private));
    assert.equal(preKeys['1'].private.toString('hex'), '010203');
    assert.equal(preKeys['999'], null);

    const syncKeys = await secondBoot.state.keys.get('app-state-sync-key', ['k1']);
    assert.ok(syncKeys['k1']);
    assert.equal(Buffer.from(syncKeys['k1'].keyData).toString('hex'), '090807');

    // Remoção de chave específica e limpeza total no logout
    await secondBoot.state.keys.set({ 'pre-key': { '1': null } });
    const afterRemove = await secondBoot.state.keys.get('pre-key', ['1']);
    assert.equal(afterRemove['1'], null);

    await authStore.clearSavedSession(mockPool);
    assert.equal(await authStore.hasSavedSession(mockPool), false);

    // 3. Backoff de reconexão (erro transitório vs conflito 440)
    assert.equal(whatsappService.computeReconnectDelayMs(1), 2000);
    assert.equal(whatsappService.computeReconnectDelayMs(2), 4000);
    assert.equal(whatsappService.computeReconnectDelayMs(3), 8000);
    assert.equal(whatsappService.computeReconnectDelayMs(6), 60000);
    assert.equal(whatsappService.computeReconnectDelayMs(9), 60000);
    assert.equal(whatsappService.computeReconnectDelayMs(1, { isConflict: true }), 15000);
    assert.equal(whatsappService.computeReconnectDelayMs(2, { isConflict: true }), 30000);
    assert.equal(whatsappService.computeReconnectDelayMs(5, { isConflict: true }), 60000);
});

test('Regras de Domínio: Elegibilidade Unificada e Consistência de Exames de Graduação', () => {
    const examEligibilityService = require('../services/examEligibilityService');

    const niveis = [
        { id: 1, nome: 'Prajied Branco', ordem_hierarquica: 1, cor_hex_primaria: '#ffffff', cor_hex_secundaria: null, porcentagem_minima: 70 },
        { id: 2, nome: 'Prajied Amarelo', ordem_hierarquica: 3, cor_hex_primaria: '#eab308', cor_hex_secundaria: null, porcentagem_minima: 70 },
        { id: 3, nome: 'Prajied Amarelo e Branco', ordem_hierarquica: 5, cor_hex_primaria: '#eab308', cor_hex_secundaria: '#ffffff', porcentagem_minima: 70 },
        {
            id: 4,
            nome: 'Prajied Verde',
            ordem_hierarquica: 7,
            cor_hex_primaria: '#16a34a',
            cor_hex_secundaria: null,
            porcentagem_minima: 70,
            rpg_rank_minimo: 'A',
            rpg_pontuacao_minima_atributo: 12,
            rpg_exige_apto_sparring: 1
        }
    ];

    // 1. findNextLevel respeitando lacunas na ordem_hierarquica e retorno null no topo
    assert.equal(examEligibilityService.findNextLevel(niveis, 1)?.id, 2);
    assert.equal(examEligibilityService.findNextLevel(niveis, 3)?.id, 3);
    assert.equal(examEligibilityService.findNextLevel(niveis, 7), null);

    // 2. detectInviteBeltConflict identificando regressão, faixa já conquistada e alteração
    const conflitoRegressao = examEligibilityService.detectInviteBeltConflict({
        inviteAtualId: 2,
        invitePretendidaId: 2,
        invitePretendidaOrdem: 3,
        currentRealBelt: { nivel_id: 4, nome: 'Prajied Verde', ordem_hierarquica: 7 }
    });
    assert.equal(conflitoRegressao.divergente, true);
    assert.equal(conflitoRegressao.tipo, 'regressao');

    const conflitoConquistada = examEligibilityService.detectInviteBeltConflict({
        inviteAtualId: 2,
        invitePretendidaId: 3,
        invitePretendidaOrdem: 5,
        currentRealBelt: { nivel_id: 3, nome: 'Prajied Amarelo e Branco', ordem_hierarquica: 5 }
    });
    assert.equal(conflitoConquistada.divergente, true);
    assert.equal(conflitoConquistada.tipo, 'ja_conquistada');

    const conflitoAlterada = examEligibilityService.detectInviteBeltConflict({
        inviteAtualId: 1,
        invitePretendidaId: 3,
        invitePretendidaOrdem: 5,
        currentRealBelt: { nivel_id: 2, nome: 'Prajied Amarelo', ordem_hierarquica: 3 }
    });
    assert.equal(conflitoAlterada.divergente, true);
    assert.equal(conflitoAlterada.tipo, 'faixa_atual_alterada');

    const semConflito = examEligibilityService.detectInviteBeltConflict({
        inviteAtualId: 2,
        invitePretendidaId: 3,
        invitePretendidaOrdem: 5,
        currentRealBelt: { nivel_id: 2, nome: 'Prajied Amarelo', ordem_hierarquica: 3 }
    });
    assert.equal(semConflito.divergente, false);

    // 3. evaluateStudentExamEligibility com RPG sem trava
    const eligRpgOk = examEligibilityService.evaluateStudentExamEligibility({
        currentBelt: niveis[0],
        nextBelt: niveis[1],
        formalEval: null,
        rpgEval: {
            is_rpg: true,
            score_total: 82,
            rank_combate: 'A',
            apto_sparring: true,
            pilares: { inteligencia: 16, destreza: 17, agilidade: 16, forca: 16, vitalidade: 17 }
        },
        wikiProgress: null
    });
    assert.equal(eligRpgOk.apto, true);
    assert.equal(eligRpgOk.fonte, 'rpg');
    assert.equal(eligRpgOk.percentual, 82);

    // 4. evaluateStudentExamEligibility bloqueado por trava RPG (apto_sparring = false)
    const eligTrava = examEligibilityService.evaluateStudentExamEligibility({
        currentBelt: niveis[2],
        nextBelt: niveis[3],
        formalEval: { apto: 1, percentual_obtido: 90 },
        rpgEval: {
            is_rpg: true,
            score_total: 84,
            rank_combate: 'A',
            apto_sparring: false,
            pilares: { inteligencia: 17, destreza: 17, agilidade: 17, forca: 16, vitalidade: 17 }
        },
        wikiProgress: null
    });
    assert.equal(eligTrava.apto, false);
    assert.equal(eligTrava.fonte, 'trava_rpg');
    assert.ok(eligTrava.bloqueios.length > 0);

    // 5. evaluateStudentExamEligibility via avaliação formal, Wiki, sem avaliação e nível máximo
    const eligFormal = examEligibilityService.evaluateStudentExamEligibility({
        currentBelt: niveis[0],
        nextBelt: niveis[1],
        formalEval: { apto: 1, percentual_obtido: 85, professor_nome: 'Mestre' },
        rpgEval: null,
        wikiProgress: null
    });
    assert.equal(eligFormal.apto, true);
    assert.equal(eligFormal.fonte, 'avaliacao_graduacao');

    const eligWiki = examEligibilityService.evaluateStudentExamEligibility({
        currentBelt: niveis[0],
        nextBelt: niveis[1],
        formalEval: null,
        rpgEval: null,
        wikiProgress: { total_golpes: 10, golpes_dominados: 8 }
    });
    assert.equal(eligWiki.apto, true);
    assert.equal(eligWiki.fonte, 'wiki_golpes');
    assert.equal(eligWiki.percentual, 80);

    const eligSemAval = examEligibilityService.evaluateStudentExamEligibility({
        currentBelt: niveis[0],
        nextBelt: niveis[1],
        formalEval: null,
        rpgEval: null,
        wikiProgress: { total_golpes: 10, golpes_dominados: 0 }
    });
    assert.equal(eligSemAval.apto, false);
    assert.equal(eligSemAval.motivo, 'Sem avaliação registrada para a faixa atual');

    const eligMax = examEligibilityService.evaluateStudentExamEligibility({
        currentBelt: niveis[3],
        nextBelt: null
    });
    assert.equal(eligMax.apto, false);
    assert.equal(eligMax.fonte, 'nivel_maximo');
});

test('Regras de Domínio: Retrocesso de Graduação (Visão 360)', () => {
    const examEligibilityService = require('../services/examEligibilityService');

    const niveis = [
        { id: 1, nome: 'Prajied Branco', ordem_hierarquica: 1, cor_hex_primaria: '#ffffff', cor_hex_secundaria: null },
        { id: 2, nome: 'Prajied Amarelo', ordem_hierarquica: 3, cor_hex_primaria: '#eab308', cor_hex_secundaria: null },
        { id: 3, nome: 'Prajied Verde', ordem_hierarquica: 6, cor_hex_primaria: '#16a34a', cor_hex_secundaria: null }
    ];

    // 1. findPreviousLevel tolerando lacunas e retornando null na inicial
    assert.equal(examEligibilityService.findPreviousLevel(niveis, 6)?.id, 2);
    assert.equal(examEligibilityService.findPreviousLevel(niveis, 3)?.id, 1);
    assert.equal(examEligibilityService.findPreviousLevel(niveis, 1), null);

    // 2. Modo restore_history: remove promoção indevida e reativa a anterior
    const planRestore = examEligibilityService.resolveGraduationRollbackPlan({
        historyForModality: [
            { id: 10, graduacao_nivel_id: 1, nivel_nome: 'Prajied Branco', ordem_hierarquica: 1, atual: 0, data_graduacao: '2026-01-10' },
            { id: 15, graduacao_nivel_id: 2, nivel_nome: 'Prajied Amarelo', ordem_hierarquica: 3, atual: 1, data_graduacao: '2026-11-24', cor_hex_primaria: '#eab308' }
        ],
        levelsForModality: niveis
    });
    assert.equal(planRestore.allowed, true);
    assert.equal(planRestore.mode, 'restore_history');
    assert.equal(planRestore.deleteGradId, 15);
    assert.equal(planRestore.restoreGradId, 10);
    assert.equal(planRestore.toLevel.id, 1);

    // 3. Modo step_down_level: registro único acima da faixa inicial desce 1 faixa
    const planStepDown = examEligibilityService.resolveGraduationRollbackPlan({
        historyForModality: [
            { id: 22, graduacao_nivel_id: 3, nivel_nome: 'Prajied Verde', ordem_hierarquica: 6, atual: 1, data_graduacao: '2026-05-01' }
        ],
        levelsForModality: niveis
    });
    assert.equal(planStepDown.allowed, true);
    assert.equal(planStepDown.mode, 'step_down_level');
    assert.equal(planStepDown.updateGradId, 22);
    assert.equal(planStepDown.targetLevelId, 2);
    assert.equal(planStepDown.toLevel.nome, 'Prajied Amarelo');

    // 4. Bloqueado quando já está na graduação inicial sem histórico anterior
    const planBlocked = examEligibilityService.resolveGraduationRollbackPlan({
        historyForModality: [
            { id: 30, graduacao_nivel_id: 1, nivel_nome: 'Prajied Branco', ordem_hierarquica: 1, atual: 1, data_graduacao: '2026-01-01' }
        ],
        levelsForModality: niveis
    });
    assert.equal(planBlocked.allowed, false);
    assert.ok(planBlocked.error);
});

test.after(async () => {
    try {
        await pool.end();
    } catch {
        // ignore
    }
});

