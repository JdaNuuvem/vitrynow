# VitryNow (nome provisório: MeuCardapio)

Plataforma de pedidos para restaurantes e lojas: **cardápio online** para o cliente, **painel (CRM)** para o dono e a equipe (pedidos, catálogo, caixa, cupons, entrega, relatórios), **impressão de tíquetes** na loja e **back-office** da plataforma. Tudo em um monorepo. **Hoje o projeto roda só em desenvolvimento (DEV): nada está em produção, o PIX é mock e não há e-mail real.**

> **Sócio (frontend)?** Comece por [`docs/SINCRONIZAR-SOCIO.md`](docs/SINCRONIZAR-SOCIO.md): passo a passo para atualizar o seu repositório local, o que mudou desde a sua base, o contrato entre front e API e o que não fazer.

## Estado em 19/11/2026

| | O que é |
|---|---|
| **Na `main`** | Cardápio público e checkout · painel completo (pedidos/kanban, histórico, catálogo, **produto detalhado** com promoção de/por, venda por peso, adicionais e prato único, caixa, cupons, entregadores, mesas e QR, equipe, impressoras, relatórios, auditoria, conta e aparência, **campanha do cardápio**) · back-office da plataforma (lojas, plano, suspensão, avisos, créditos) · **front do sócio inteiro** (squash #130) · grupos de opções e variações · **FKs compostas por loja** (o banco recusa referência entre lojas) · upload de fotos em **disco local** servido pelo Caddy · LGPD técnico (anonimização, exportação, não contatar) **atrás de `PRIVACY_ACTIONS_ENABLED`** · MFA, alertas de segurança, captcha plugável (Fake) · fila de impressão com lease/ack · jobs (PIX, estorno, assinatura, revalidação do cardápio) |
| **Em andamento (fila da fonte única, `docs/SSOT.md`)** | horário com uma só fonte (`Store.schedule`) · fuso por `Store.timezone` · frete/total só no servidor · status/papéis/pagamento em `shared-types` · criação de pedido unificada (`OrderService.create`) |
| **Só desenho (aprovado, sem código)** | importação assistida de produtos por IA (fases em `docs/adr/0020`) · Reels de até 30 s (`docs/adr/0021`) · robô de atendimento por WhatsApp (Camada A, sem IA) |
| **Travado** | pratos 3D e restaurante 3D · visão computacional · IA de texto livre do robô · provedor de IA pago · Mercado Pago real · produção |

Detalhes e riscos conhecidos: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) e [`docs/SSOT.md`](docs/SSOT.md).

## Stack

| Camada | Tecnologia |
|---|---|
| Monorepo | pnpm 12 (`apps/*`, `packages/*`, `infra`), TypeScript 5.6, **Node 24** |
| API | Fastify 4 (cookie, cors, helmet, jwt, rate-limit, websocket), Zod, jobs no processo |
| Banco | PostgreSQL 16, Prisma 5.22 (**60 migrações** em `packages/db/prisma/migrations`) |
| Painel e cardápio | Next.js 14.2, React 18, Tailwind 3 (SSR/ISR no cardápio público) |
| Impressão | C# / .NET Framework 4.7.2 (WinForms), `apps/print-client` |
| Testes | Vitest 2 (API e web), Testing Library (web), selftest próprio no print-client |
| Infra | Docker Compose, Caddy (HTTPS, limites, `/media`), backup do Postgres e das fotos, CI no GitHub Actions |

## Mapa do repositório

| Pasta | O que há |
|---|---|
| `apps/api` | API Fastify: `routes/` (HTTP + `routePolicy`), `modules/*` (serviço + repositório por tema), `lib/` (regras puras: preço do item, máquinas de estado, DTO público), `jobs/`, `realtime/` |
| `apps/web` | Painel (`/dashboard`), cardápio (`/loja/[slug]`), cadastro, back-office (`/plataforma`), `/dev/*` (só em desenvolvimento) |
| `apps/print-client` | App Windows de impressão térmica |
| `packages/db` | Schema Prisma, migrações, seeds |
| `packages/shared-types` | **Contrato compartilhado** (Zod, eventos de tempo real, tíquete): a fonte única de validação |
| `infra` | Compose (dev, local, produção), Caddy, scripts de saúde, backup |
| `scripts` | CI, verificador de migrações, smoke da stack, QA |
| `docs` | Arquitetura, SSOT, ADRs, design system do front (`docs/frontend`) |

## Telas (`apps/web/app`)

`/loja/[slug]` (cardápio) · `/loja/[slug]/m/[token]` (pedido de mesa por QR) · `/cadastro` · `/login`, `/esqueci-senha`, `/reset-senha`, `/verificar-email` · `/dashboard` (início e primeiros passos), `pedidos` (kanban, histórico, novo, PIX), `catalogo` (+ opções), `caixa`, `cupons`, `entregadores`, `equipe`, `impressoras` (+ fila), `mesas`, `pagamentos`, `planos`, `relatorios`, `auditoria`, `privacidade`, `conta` (aparência, campanha, entrega, horários) · `/plataforma` (login, lojas, avisos) · `/dev/design-system` e `/dev/campanha` (só em desenvolvimento).

## Contrato front ↔ API: regras que não mudam

- **Dinheiro em centavos inteiros.** O preço é calculado **só no servidor** (`apps/api/src/lib/orderItems.ts`: `buildOrderLines`). O web pode simular para prévia e envia `expectedUnitPriceCents`; se divergir, a API responde **409 `ITEM_PRICE_CHANGED`** e **não grava nada**.
- **Preço do item (RN-B8-03):** `unitPriceCents` = preço base (ou promocional) **+ opções que somam**; **adicional legado soma por cima** (linha = (unitário + adicionais) × quantidade). Venda por peso: `quantity = 1` e `unitPriceCents` = valor da linha.
- **Opções:** o cliente envia `options` (ou `optionSelections`, alias); opção de outra loja/inativa/inexistente = a **mesma** resposta (sem pista). Tetos: 30 por item, 200 por pedido.
- **Códigos de erro estáveis** (`{ error, code, details }`): o texto pode mudar, o `code` não.
- **DTO público por lista de permissão** (`publicDto`): campo novo exige teste de chaves exatas.
- **Eventos em tempo real por audiência** (`WS_AUDIENCE`: painel, dispositivo ou ambos).
- **Toda rota de escrita** precisa de classe em `routePolicy` (teste de contrato falha sem ela).

## Rodando localmente

Pré-requisitos: **Node 24**, pnpm 12, Docker.

**A. Windows, um clique:** extraia o repositório, inicie o Docker Desktop (containers Linux) e execute `Abrir-VitryNow.cmd`. Ele sobe Postgres, armazenamento de fotos, API e web, aplica as migrações e carrega a loja de demonstração **Ramenku** (`http://127.0.0.1:3000/loja/ramenku`; painel em `/login`; `dono@ramenku.local`). A senha de demonstração do seed está em `packages/db/prisma/seed-local.ts`: **vale só em desenvolvimento** (o seed recusa `NODE_ENV=production`). Portas padrão 3000 e 3001; para uma segunda instalação lado a lado use `VITRY_LOCAL_PROJECT`, `VITRY_LOCAL_WEB_PORT` e `VITRY_LOCAL_API_PORT`.

**B. Manual:**
```powershell
pnpm install --frozen-lockfile
docker compose -f infra/docker-compose.dev.yml up -d        # Postgres em 55432
Copy-Item apps/api/.env.example apps/api/.env               # preencha JWT_SECRET e MFA_HMAC_KEY:
pnpm --filter @meucardapio/api gen:secrets                  #   gera os valores (copie para o .env local)
Copy-Item apps/web/.env.example apps/web/.env
pnpm db:generate; pnpm db:migrate:deploy; pnpm db:seed
pnpm dev:api   # http://localhost:3001      pnpm dev:web   # http://localhost:3000
```
Em http local sem https, ponha `COOKIE_SECURE="false"` no `apps/api/.env`. O seed cria a loja `loja-teste`. **Nunca versione `.env`, chaves ou dumps.**

**Testes da API** apagam tabelas: use um banco `*_test` em 127.0.0.1 na porta **55440–55459** e `TEST_DATABASE_URL` (o teste recusa qualquer outro banco). Aplique as migrações antes. Web: `pnpm --filter @meucardapio/web typecheck`, `lint`, `test`, `build`. CI do GitHub: backend (Postgres 16) e web.

### Flags de desenvolvimento
| Variável | Efeito | Regra |
|---|---|---|
| `PRIVACY_ACTIONS_ENABLED` | liga as ações de privacidade (LGPD técnico) | desligada por padrão; produção só com OK jurídico |
| `MFA_ENFORCED` | exige confirmação (MFA) nas ações sensíveis | ligar em produção só com o front pronto |
| `NEXT_PUBLIC_MENU_CAMPAIGN_ENABLED` | mostra o editor de campanha | **só em DEV**; nunca no build de produção |
| `STORAGE_DRIVER` (`local` ou `s3`) | onde ficam as fotos | produção: `local` (disco, `STORAGE_LOCAL_DIR`) |
| `COOKIE_SECURE` | cookie só por https | `false` apenas em http local |

## Regras do repositório

Backend (`apps/api`, `packages/db`, `infra`, `apps/print-client`): Claudio · Frontend (`apps/web`): `victorsampontes`. **Todo trabalho entra por branch → Pull Request → CI verde → revisão → merge; ninguém faz push direto na `main` nem force-push.** Branches com prefixo `feat/`, `fix/`, `docs/`, `chore/`, `test/`. Uma migração por PR, aditiva sempre que possível, com carimbo maior que o da `main`. Contrato (API) primeiro, tela depois. Veja [CONTRIBUTING.md](CONTRIBUTING.md). **Sem segredo no repositório** (o repositório é público).

## Decisões vigentes

PIX só mock (`PixGateway`/`FakePixGateway`); **Mercado Pago real fora** por enquanto · fotos em **disco local** (ADR-0017) · WhatsApp por API genérica tipo Evolution, robô só Camada A no começo · IA de produtos: **sem login de assinatura**; importação assistida primeiro, depois chave de API própria do dono (ADR-0020) · Reels ≤ 30 s em disco local (ADR-0021) · teto de custo de IA/mídia R$ 50–100 por loja por mês · imprimir ao chegar (PIX só depois de pago) · uma fonte única de verdade por dado (ADR-0018).

## Documentação

[`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) (contexto, contêineres, módulos, modelo de dados, jobs, segurança, onde entram as funções novas) · [`docs/SSOT.md`](docs/SSOT.md) (onde cada dado nasce, valida, serve e exibe; duplicações conhecidas e ordem de correção) · [`docs/adr/`](docs/adr) (decisões) · [`docs/RUNBOOK-infra.md`](docs/RUNBOOK-infra.md) · [`docs/frontend/`](docs/frontend) (design system e evidências do front) · [`ENTREGA-PARA-O-DEV.md`](ENTREGA-PARA-O-DEV.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md).

---
# Documentação técnica (original)
# MeuCardapio (placeholder) — plataforma própria

Plataforma própria de pedidos (painel + cardápio online + impressão local), **sem** reaproveitar marca,
assets, código ou backend de serviço de terceiro.

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
  publica em `POST /api/platform/notices` (sessão do back-office). O `x-admin-token`/`ADMIN_TOKEN` foi aposentado (API-25).
- **Back-office da plataforma (API-25):** contas da equipe separadas dos usuários de loja (`PlatformAdmin`, papéis
  `ADMIN` e `SUPPORT`; criar por `apps/api/scripts/create-platform-admin.ts`). Entrada em dois passos, sempre com
  código por e-mail: `POST /api/platform/auth/login` → `POST /api/platform/auth/verify` (cookie `mc_platform_session`).
  Rotas: `GET /api/platform/stores` (busca `q`, paginação), `GET /api/platform/stores/:id`, `POST …/suspend`,
  `…/reactivate`, `…/extend-trial` (todas com motivo), avisos e créditos. Loja suspensa fica somente leitura no painel
  (403 `STORE_SUSPENDED`) e o cardápio recusa pedidos (409). Toda ação **e toda leitura de loja** grava
  `PlatformAuditLog` (imutável).
- **Créditos de IA (livro-razão, ADR-0015 §3D):** `POST /api/platform/stores/:id/credits` (só `ADMIN`; senha de novo +
  comprovante `x-mfa-challenge` de `/api/platform/mfa/*`; `PURCHASE` exige `externalRef`; só `ADJUST` pode ser
  negativo; `idempotencyKey`; limite `CREDIT_GRANT_MAX`). `GET …/credits` lista o livro-razão e o saldo (soma dos
  lançamentos). `AiCreditLedger` e `PlatformAuditLog` recusam UPDATE/DELETE no próprio banco. Sem preço padrão e sem
  cortesia no PRO; o consumo (reserva/débito) é a tarefa AI-04.
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



