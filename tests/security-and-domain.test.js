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
        assert.equal(itemAsaas.origem_label, 'Gateway Asaas');
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

        // 1. Professor registra avaliação com os 4 quesitos de 0 a 10
        const postRes = await fetch(`${baseUrl}/api/alunos/1/avaliacoes-desempenho`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${profToken}`
            },
            body: JSON.stringify({
                data_avaliacao: '2026-11-12',
                nota_clinch: 9.5,
                nota_socos: 8.5,
                nota_chutes: 9.0,
                nota_postura: 8.0,
                observacoes: 'Excelente base e evolução nos chutes e clinch'
            })
        });

        assert.equal(postRes.status, 201);
        const postData = await postRes.json();
        assert.equal(postData.success, true);
        assert.ok(postData.data.id, 'Deve retornar o ID da avaliação criada');
        avaliacaoId = postData.data.id;

        assert.equal(postData.data.nota_clinch, 9.5);
        assert.equal(postData.data.nota_socos, 8.5);
        assert.equal(postData.data.nota_chutes, 9.0);
        assert.equal(postData.data.nota_postura, 8.0);

        // 2. Consulta Meu Painel e valida que as 4 notas técnicas aparecem consolidadas
        const painelRes = await fetch(`${baseUrl}/api/aluno/meu-painel?aluno_id=1`);
        assert.equal(painelRes.status, 200);
        const painelData = await painelRes.json();

        assert.equal(painelData.success, true);
        assert.ok(painelData.notas_tecnicas, 'Deve retornar objeto notas_tecnicas');
        assert.equal(painelData.notas_tecnicas.clinch, 9.5);
        assert.equal(painelData.notas_tecnicas.socos, 8.5);
        assert.equal(painelData.notas_tecnicas.chutes, 9.0);
        assert.equal(painelData.notas_tecnicas.postura, 8.0);
        assert.equal(painelData.aluno.notas_tecnicas.clinch, 9.5);

    } finally {
        if (avaliacaoId) {
            await pool.query('DELETE FROM aluno_avaliacoes_desempenho WHERE id = ?', [avaliacaoId]).catch(() => {});
        }
        server.close();
    }
});

// ============================================================================
// 13. GESTÃO DE ALUNOS: REDEFINIÇÃO DE SENHA E EXCLUSÃO PERMANENTE
// ============================================================================
test('Gestão de Alunos: Redefinição Administrativa de Senha e Exclusão Permanente com Limpeza Relacional', async () => {
    const server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    let alunoCriadoId = null;

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

        // 3. Testa Exclusão Permanente (DELETE /api/alunos/:id)
        const deleteRes = await fetch(`${baseUrl}/api/alunos/${alunoCriadoId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${adminToken}`
            }
        });

        assert.equal(deleteRes.status, 200);
        const deleteBody = await deleteRes.json();
        assert.equal(deleteBody.success, true);

        // 4. Valida que o aluno NÃO existe mais no banco de dados (Hard Delete real)
        const [checkAluno] = await pool.query('SELECT id FROM alunos WHERE id = ?', [alunoCriadoId]);
        assert.equal(checkAluno.length, 0, 'Registro do aluno deve ter sido completamente removido da tabela alunos');

        // Valida que registros dependentes foram excluídos em cascata
        const [checkMat] = await pool.query('SELECT id FROM matriculas WHERE aluno_id = ?', [alunoCriadoId]);
        assert.equal(checkMat.length, 0, 'Matrícula vinculada deve ter sido removida');

        const [checkFat] = await pool.query('SELECT id FROM faturas WHERE aluno_id = ?', [alunoCriadoId]);
        assert.equal(checkFat.length, 0, 'Fatura vinculada deve ter sido removida');

        const [checkUser] = await pool.query('SELECT id FROM usuarios_alunos WHERE aluno_id = ?', [alunoCriadoId]);
        assert.equal(checkUser.length, 0, 'Usuário de acesso deve ter sido removido');

        // 5. Tentativa de deletar novamente deve retornar 404
        const deleteAgainRes = await fetch(`${baseUrl}/api/alunos/${alunoCriadoId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.equal(deleteAgainRes.status, 404);

        alunoCriadoId = null; // Já excluído

    } finally {
        if (alunoCriadoId) {
            await pool.query('DELETE FROM faturas WHERE aluno_id = ?', [alunoCriadoId]).catch(() => {});
            await pool.query('DELETE FROM matriculas WHERE aluno_id = ?', [alunoCriadoId]).catch(() => {});
            await pool.query('DELETE FROM usuarios_alunos WHERE aluno_id = ?', [alunoCriadoId]).catch(() => {});
            await pool.query('DELETE FROM alunos WHERE id = ?', [alunoCriadoId]).catch(() => {});
        }
        server.close();
    }
});

test.after(async () => {
    try {
        await pool.end();
    } catch {
        // ignore
    }
});

