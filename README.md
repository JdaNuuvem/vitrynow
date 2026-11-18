# VitryNow (nome provisório: MeuCardapio)

Plataforma de pedidos para restaurantes e lojas: cardápio online para o cliente, painel de gestão (pedidos, catálogo, caixa, cupons, equipe), impressão de tíquetes no balcão e pagamento por PIX.

> Estado: **em desenvolvimento, só ambiente de DEV**. Nada em produção. Nome, domínio e marca ainda não definidos.

## Stack

| Camada | Tecnologia |
|---|---|
| Monorepo | pnpm workspaces (`apps/*`, `packages/*`, `infra`) |
| API | Node 24, Fastify, Zod, WebSocket, jobs no processo |
| Banco | PostgreSQL 16, Prisma 5.22 (migrações em `packages/db/prisma/migrations`) |
| Painel e cardápio | Next.js 14 (React), SSR/ISR no cardápio público |
| Impressão | C# / .NET Framework (WinForms), `apps/print-client` |
| Testes | Vitest (API e web), Testing Library (web), selftest próprio no print-client |
| Infra | Docker Compose, Caddy (HTTPS e limite de requisições), backup do Postgres |
| Integrações | Mercado Pago (PIX, hoje só mock/sandbox), Resend (e-mail, mock), WhatsApp/Meta (planejado) |

**Pré-requisitos:** Node **24** (`.nvmrc`; as imagens Docker e o CI usam a mesma versão), pnpm 12.8.1 (fixado em `packageManager`; `corepack enable` instala a versão certa), Docker. O Postgres de teste sobe por `scripts/test-db.ps1`.

## Páginas atuais (`apps/web/app`)

Estado visual: **v2** = redesenhada; **antigo** = ainda no desenho original (só correções de segurança/comportamento).

### Públicas (cliente)

| Rota | O que é | Estado visual |
|---|---|---|
| `/loja/[slug]` | Cardápio público: capa, logo, categorias fixas, itens, carrinho, checkout, resultado do PIX, acompanhar/cancelar pedido | **v2 (Fatia 1: estrutura)**. Movimento (Fatia 2) e detalhe/carrinho/checkout novos (Fatia 3) pendentes |

### Acesso

| Rota | O que é | Estado visual |
|---|---|---|
| `/` | Entrada / cadastro de loja | antigo |
| `/login` | Entrar no painel | antigo |
| `/esqueci-senha` | Pedir link de redefinição | antigo (backend endurecido) |
| `/reset-senha` | Definir nova senha (exige e-mail da conta) | antigo (backend endurecido) |

### Painel (`/dashboard`, requer login)

| Rota | O que é | Estado visual |
|---|---|---|
| `/dashboard` | Início: resumo, checklist de primeiros passos | antigo |
| `/dashboard/pedidos` | Kanban de pedidos: aceitar, recusar, cancelar com motivo, estorno, desfazer | **v2** |
| `/dashboard/pedidos/historico` | Histórico com busca e filtro "Em aberto" | **v2** |
| `/dashboard/catalogo` | Categorias e produtos (excluir pede confirmação; "Ocultar" é o padrão) | antigo |
| `/dashboard/caixa` | Abrir/fechar caixa, movimentos, resumo | antigo |
| `/dashboard/cupons` | Cupons de desconto (teto de funcionário: 50% ou R$ 50) | antigo |
| `/dashboard/entregadores` | Cadastro de entregadores | antigo |
| `/dashboard/equipe` | Usuários da loja (dono e funcionário) | antigo |
| `/dashboard/impressoras` | Chaves de impressora (token só com hash, exibido uma vez) | antigo |
| `/dashboard/conta` | Conta e personalização da loja | antigo |
| `/dashboard/planos` | Plano, assinatura e trial | antigo |
| `/dashboard/relatorios` | Relatório de vendas (resumo) | antigo |
| `/dashboard/auditoria` | Log de ações sensíveis | antigo |

### Páginas planejadas (ainda sem tela)

Pedido manual, acompanhamento do pedido pelo cliente, conexão do Mercado Pago por loja, mesas e QR, estados de consulta/suspensão da assinatura, onboarding guiado, back-office da plataforma. Planos PRO: agendamento, WhatsApp, comanda e pagamento dividido, relatórios avançados.

## Divisão de trabalho

- **Frontend** (`apps/web`, telas, design): responsável o sócio.
- **Backend** (`apps/api`, `packages/db`, `infra`, `apps/print-client`): responsável Claudio.
- Contrato entre os dois: tipos em `packages/shared-types` e rotas listadas em `docs/` (ver `CONTRIBUTING.md`).

## Fluxo de código

`main` protegida, trabalho em branches, mudança entra só por Pull Request com CI verde e revisão. Detalhes em [CONTRIBUTING.md](CONTRIBUTING.md).

---

# Documentação técnica (original)
# MeuCardapio (placeholder) — plataforma própria

Plataforma própria de pedidos (painel + cardápio online + impressão local), construída a partir dos
aprendizados de arquitetura do projeto de engenharia reversa em `../DOCS/` — **sem** reaproveitar marca,
assets ou backend do cardapio.ai. Ver `../DOCS/mapa-faltas.md` (histórico) e o plano aprovado para o
contexto completo.

Monorepo: `apps/api` (Fastify), `apps/web` (Next.js), `apps/print-client` (C#/.NET, Fase 1), `packages/db`
(Prisma), `packages/shared-types` (Zod).

## Rodando localmente (Fase 0/1)

1. **Instalar dependências** (na raiz `platform/`):
   ```powershell
   pnpm install
   ```

2. **Banco de dados** (Postgres local via Docker):
   ```powershell
   docker compose -f infra/docker-compose.dev.yml up -d
   ```

3. **Variáveis de ambiente**:
   ```powershell
   Copy-Item apps/api/.env.example apps/api/.env
   Copy-Item apps/web/.env.example apps/web/.env
   ```

4. **Migrar e popular o banco**:
   ```powershell
   pnpm db:generate
   pnpm --filter @meucardapio/db migrate --name init
   pnpm db:seed
   ```
   O seed cria a loja `loja-teste` (login `dono@lojateste.com` / senha `senha123`) com 2 categorias e 3
   produtos.

5. **Subir API e painel** (dois terminais):
   ```powershell
   pnpm dev:api   # http://localhost:3001
   pnpm dev:web   # http://localhost:3000
   ```

6. **Testar o loop de pedido**:
   - Cardápio público: `http://localhost:3000/loja/loja-teste` — monte um pedido e finalize.
   - Painel: `http://localhost:3000/login` com as credenciais do seed → kanban em
     `http://localhost:3000/dashboard` deve mostrar o pedido na coluna "PENDENTE" em tempo real (via WS).
   - Gerar uma chave de impressora (device token): `POST http://localhost:3001/api/device-tokens`
     autenticado com o cookie de sessão do painel — usado pelo `apps/print-client` para buscar pedidos
     pendentes (`GET /api/device/orders/pending`), o tíquete pronto (`GET
     /api/device/orders/:id/printable`) e marcar como impresso (`POST /api/device/orders/:id/printed`).

7. **Print-client (C#/.NET, Windows)**: ver `apps/print-client/README.md` para build (`.\build.ps1`,
   sem precisar de Visual Studio/dotnet SDK) e self-test (`.\run-selftest.ps1`). Na primeira execução
   o app pede a URL da API e a chave de impressora gerada no passo anterior.

## Testes automatizados (`apps/api`)

Integração via `fastify.inject()` contra um banco Postgres dedicado (nunca o de dev):

```powershell
docker exec infra-postgres-1 psql -U meucardapio -d postgres -c "CREATE DATABASE meucardapio_test;"  # só na 1a vez
$env:DATABASE_URL = "postgresql://meucardapio:meucardapio@localhost:55432/meucardapio_test?schema=public"
pnpm --filter @meucardapio/db exec prisma migrate deploy
pnpm --filter @meucardapio/api test
```

Cobre: login/registro, troca/recuperação de senha, permissão OWNER vs STAFF, isolamento multi-tenant,
pedido com cupom (aplicação/esgotamento/rollback de PIX), validação de assinatura do webhook do
Mercado Pago, concorrência na abertura de caixa, cancelamento de pedido pelo cliente, e que excluir um
produto não quebra pedidos antigos. `vitest.config.ts` já aponta pro banco de teste e não toca no `.env`
de dev.

## Segurança — variáveis obrigatórias em produção

- `JWT_SECRET`: obrigatório quando `NODE_ENV=production` — o servidor recusa subir sem ele (sem
  fallback silencioso).
- `MP_WEBHOOK_SECRET`: sem isso, `/api/payments/webhook` rejeita toda notificação do Mercado Pago
  (a assinatura `x-signature` é sempre verificada, nunca só o `data.id`).
- Rate limiting global (300 req/min/IP) + limites mais estritos em login (8/min), cadastro (5/min),
  pedido público (20/min) e webhook (60/min) — ver `config.rateLimit` nas rotas.
- Ações de conta (configurações da loja, chaves de impressora, equipe) exigem `role: OWNER`; `STAFF`
  continua liberado para catálogo/caixa/cupons/pedidos do dia a dia.
- `RESEND_API_KEY`: sem ela, "esqueci minha senha" cai no modo dev (link só no log do servidor, não
  chega pro usuário) — configure em produção. `EMAIL_FROM` precisa ser de um domínio verificado no
  Resend (https://resend.com/domains); `onboarding@resend.dev` só funciona pra enviar ao próprio
  e-mail da conta Resend, não a usuários reais.

## Caixa, loja disponível, planos, avisos e MFA

- **Caixa:** o pedido guarda forma de pagamento (`DINHEIRO`, `PIX`, `CREDITO`, `DEBITO`, `VR`, `VA`),
  "troco para", taxa de entrega (fixa por loja, `deliveryFeeCents`) e gorjeta — ambas já somadas em
  `totalCents`. O saldo esperado do caixa é abertura + vendas em dinheiro + suprimentos - sangrias
  (`lib/cashier.ts`); o fechamento grava esperado e diferença. Resumo por caixa em
  `GET /api/cashier/sessions/:id/summary`.
- **Loja disponível:** `POST /api/store/availability`; com `acceptingOrders=false` o cardápio público
  responde 409 `STORE_CLOSED` a novos pedidos.
- **Planos:** toda loja nasce com uma assinatura em teste (`TRIAL_DAYS`, padrão 14). Planos ficam na tabela
  `Plan` (BASICO e PRO criados pela migration — preços e recursos editáveis direto na tabela).
  `POST /api/store/subscription/checkout` gera um PIX da conta Mercado Pago da plataforma; o webhook
  existente ativa 30 dias. Recurso fora do plano responde 402 `FEATURE_LOCKED` (hoje: `multi_user`, que
  libera criar usuários da equipe).
- **Avisos:** `GET /api/notices` e `POST /api/notices/:id/read` para o painel; a equipe da plataforma
  publica em `POST /api/admin/notices` com o header `x-admin-token` (`ADMIN_TOKEN`).
- **MFA por e-mail:** `POST /api/mfa/challenge` e `POST /api/mfa/verify` geram um comprovante de uso único
  (10 min). Com `MFA_ENFORCED=true`, estorno, troca de senha e remoção de usuário exigem o header
  `x-mfa-challenge`; sem o comprovante a API responde 403 `MFA_REQUIRED`.

## Outras lacunas de produção resolvidas nesta rodada

- `GET /health` agora confere a conexão com o banco (`SELECT 1`), não só responde "ok" sempre.
- Graceful shutdown: `SIGTERM`/`SIGINT` fecham HTTP/WS/Prisma antes de encerrar o processo (importa
  em deploy com restart — evita cortar requisição em voo). Validado por leitura de código: sinais
  Unix reais só existem no Linux do VPS, não no Windows de desenvolvimento.
- Abertura de caixa é atômica (índice único parcial no banco) — dois cliques/abas simultâneos não
  abrem dois caixas na mesma loja.
- Chave de impressora tem heartbeat (`lastSeenAt`/`online` em `GET /api/device-tokens`) — o painel
  já pode mostrar se a impressora está online, falta só a tela.
- `GET /api/orders` aceita paginação por cursor (`?cursor=&limit=`) em vez do `take: 200` fixo.
- Todo campo de texto livre tem limite de tamanho (`.max()` no Zod) — o storefront público não aceita
  mais payloads gigantes sem autenticação.
- Cliente pode cancelar o próprio pedido enquanto ainda está PENDENTE (`POST
  /stores/:slug/orders/:orderId/cancel`); depois que a loja confirma, só a loja cancela.
- Estorno de PIX aprovado: `POST /api/orders/:id/refund` (OWNER), chama o reembolso real no
  Mercado Pago.
- Relatório (`/api/reports/summary`) agora inclui entregas por entregador e resumo de caixa
  (sessões, suprimentos, sangrias) do período.
- Caixa aberto há mais de 20h mostra aviso no painel (`stale: true` em `GET /api/cashier/current`) —
  não fecha automático, só avisa.
- Excluir produto não quebra mais pedidos antigos: `OrderItem.productName` guarda o nome no momento
  do pedido (antes dependia de um JOIN vivo com `Product`, que falhava ou ficava em branco se o
  produto fosse renomeado/excluído).
- Log de auditoria (`AuditLog` + `GET /api/audit-log`, OWNER) registra quem revogou chave, excluiu
  produto/categoria/cupom/entregador/usuário, fechou caixa, mudou configurações da loja ou estornou
  pagamento.

## Produção (VPS própria)

`infra/docker-compose.yml` sobe Postgres + API + Web + Caddy (reverse proxy/TLS automático) a partir dos
`Dockerfile`s de `apps/api` e `apps/web`, mais um serviço de backup diário do Postgres
(`infra/backups/`, 14 dumps mais recentes).

```powershell
cd infra
Copy-Item .env.example .env   # preencha POSTGRES_PASSWORD, JWT_SECRET, DOMAIN, etc.
docker compose up -d --build
```

Variáveis obrigatórias (o compose recusa subir sem elas): `POSTGRES_PASSWORD`, `JWT_SECRET`. As demais
(`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `ACME_EMAIL`) têm default vazio/
genérico — preencha antes de ativar PIX/e-mail de verdade.

### Bugs de produção corrigidos (só apareciam rodando de verdade, não no `pnpm dev`)

- `NODE_ENV` não era setado em lugar nenhum do Docker — isso desligava silenciosamente o hardening de
  segurança da API (fallback de `JWT_SECRET`, cookie sem `secure`). Agora o compose e os `Dockerfile`s
  setam `NODE_ENV=production` nas duas camadas.
- `.env` reais (com segredos) iam pra dentro da imagem Docker — não existia `.dockerignore`. Adicionado
  em `platform/.dockerignore`.
- `apps/web/Dockerfile` não iniciava: copiava só `apps/web` sem o `node_modules` real do monorepo
  (pnpm usa symlinks). Resolvido com `output: "standalone"` do Next.js — só ativo dentro do Docker
  (`NEXT_OUTPUT_STANDALONE=1`), porque a etapa de "trace" do standalone cria symlinks que quebram
  `next build` local no Windows sem Modo de Desenvolvedor.
- `node dist/server.js` quebrava com `SyntaxError: Unexpected identifier 'global'` — `packages/db` e
  `packages/shared-types` tinham `main` apontando pro `.ts` fonte (funciona em dev via `tsx`, que
  habilita a condição `development` do `package.json`, mas não em produção sem ele). Agora os dois
  pacotes compilam pra `dist/` (`pnpm -r build` já builda na ordem certa) e usam `exports` condicional.
- Motor do Prisma não carregava no Alpine (`Error loading shared library libssl.so.1.1`) — faltava
  `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` em `schema.prisma` **e** o pacote `openssl`
  instalado na imagem (sem ele, o Prisma não detecta a versão certa do OpenSSL em runtime mesmo com o
  engine certo gerado).
- Healthcheck em todos os serviços do compose (`postgres`, `api`, `web`) — sem isso, `depends_on` só
  checava se o container tinha subido, não se a aplicação dentro dele respondia.
- Postgres não fica mais exposto em `0.0.0.0:5432` (só `127.0.0.1`).

