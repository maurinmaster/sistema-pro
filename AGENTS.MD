## Protocolo de Memória Persistente (MCP project-memory)
Você possui acesso ao servidor MCP `project-memory` (Grafo de Conhecimento). Siga estritamente este fluxo em TODAS as conversas:

1. **Ao iniciar qualquer tarefa:** Antes de propor código ou arquitetura, chame `search_nodes` ou `read_graph` para verificar a arquitetura atual, dependências e se já houve falhas anteriores registradas no módulo em questão.
2. **Durante e ao final da implementação:** Sempre que criarmos um novo endpoint, alterarmos o schema do banco, configurarmos deploy/Docker ou descobrirmos a causa raiz de um bug difícil, use `create_entities`, `add_observations` e `create_relations` para registrar o aprendizado no grafo.
3. **Quando uma regra mudar:** Se refatorarmos algo que invalide uma observação antiga no grafo, use `delete_observations` para remover o dado obsoleto antes de gravar o novo.

## Stack
Este projeto usa Node.js com Express, MySQL via mysql2 (queries SQL puras, sem ORM) e Vanilla JS no frontend.

## Protocolo Obrigatório de Segurança e Testes
**Toda e qualquer alteração de código ou implementação de novas funcionalidades DEVE ser rigorosamente testada e desenvolvida com foco estrito em segurança (Security by Design):**

1. **Autenticação e Controle de Acesso (RBAC):**
   - Todo novo endpoint da API deve exigir `authenticateToken` e, quando aplicável, `authorizeRoles(...)` de `middlewares/auth.js`.
   - Nunca exponha segredos, chaves JWT hardcoded ou senhas de fallback no código-fonte.
2. **Prevenção contra Injeções (SQLi e XSS):**
   - **Backend (SQL):** Utilize exclusivamente *Prepared Statements* (`?`) do `mysql2`. Jamais concatene variáveis do usuário diretamente em strings SQL.
   - **Frontend (DOM/XSS):** Todo dado dinâmico inserido via `innerHTML` deve obrigatoriamente passar por sanitização (`UI.escapeHtml`, `UI.sanitizeUrl` ou `UI.sanitizeColor`).
3. **Validação de Entrada, Uploads e Tratamento de Erros:**
   - Valide tipos, formatos e limites de tamanho de todos os payloads recebidos (incluindo verificação de assinatura binária/*magic bytes* em uploads de arquivos).
   - Nunca retorne mensagens cruas de erro interno ou do banco de dados (`err.message` / stack traces) em respostas HTTP `500` para o cliente.
4. **Verificação e Testes Obrigatórios antes de Concluir:**
   - Toda modificação ou nova funcionalidade deve ser validada com testes de sintaxe (`node -c`), testes de fluxo funcional e verificação de regressão de segurança antes de ser considerada pronta.
