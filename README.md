# VitryNow (nome provisório: MeuCardapio)

Plataforma de pedidos para restaurantes e lojas: cardápio online para o cliente, painel de gestão (pedidos, catálogo, caixa, cupons, equipe), impressão de tíquetes no balcão e pagamento por PIX.

**Entrega de desenvolvimento de 18/11/2026.** Para iniciar pelo Windows, extraia o pacote inteiro e execute `Abrir-VitryNow.cmd`. Veja as rotas atuais, o design system, a integração pendente da campanha e as evidências em [Entrega para o dev](ENTREGA-PARA-O-DEV.md). Pix e e-mail usam provedores de teste na instalação local.

## Stack

| Camada | Tecnologia |
|---|---|
| Monorepo | pnpm 12 (`apps/*`, `packages/*`, `infra`), TypeScript 5.6, **Node 24** |
| API | Fastify 4 (cookie, cors, helmet, jwt, rate-limit, websocket), Zod, jobs no processo |
| Banco | PostgreSQL 16, Prisma 5.22 (54 migrações em `packages/db/prisma/migrations`) |
| Painel e cardápio | Next.js 14.2, React 18, Tailwind 3 (SSR/ISR no cardápio público) |
| Impressão | C# / .NET Framework 4.7.2 (WinForms), `apps/print-client` |
| Testes | Vitest 2 (API e web), Testing Library (web), selftest próprio no print-client |
| Infra | Docker Compose, Caddy (HTTPS e limite de requisições), backup do Postgres, CI no GitHub Actions |

## Inventário histórico da integração anterior

O inventário de rotas e telas desta seção registrava a `main` antes da entrega. Consulte o guia acima e o código em `apps/web/app` e `apps/api/src/routes` para o estado atual.

**Pedidos e pagamento:** cardápio público e criação de pedido (`/stores/:slug/orders`); máquina de estados do pedido com cancelar/recusar com motivo, desfazer, estorno de PIX (idempotente), retentar e abandonar estorno preso; **pedido manual** do painel (`POST /api/orders`); histórico e kanban com busca; **acompanhamento público** por token (`/stores/:slug/orders/:id/tracking`); webhook do Mercado Pago idempotente (mock/sandbox); **PIX por loja** com provedor de teste (`/api/store/payments*`).
**Caixa:** abrir, movimentos, fechar (fechamento duplo resolvido), resumo; vendas contadas por **dinheiro recebido** (`paidAt`, `SaleLine`); limite de sangria do funcionário.
**Catálogo e entrega:** categorias e produtos, **esgotado hoje**, **zonas/taxa por bairro** (`/api/delivery-zones`, importação), cupons (uso limitado atômico, teto do funcionário), entregadores.
**Impressão:** fila de impressão no servidor (`PrintJob`: reivindicar, confirmar, imprimir agora), modo por loja (fila x legado), alertas de impressora, chaves de impressora (token só com hash), tíquete completo ("PAGO / A COBRAR / ESTORNADO", "SEM COBRANÇA"), canal em tempo real (`/ws/panel`, `/ws/device`).
**Conta e segurança:** login com sessão revogável (sair de um aparelho), esqueci/redefinir senha endurecido, MFA por e-mail, equipe (dono e funcionário), auditoria, logs sem segredo, avisos da plataforma.
**Jobs (`apps/api/src/jobs`):** expirar PIX, reconciliar pagamento, repetir estorno, vigiar a fila de impressão, limpeza técnica, renovar token de pagamento.

### Rotas da API por módulo (108 rotas; fonte: `apps/api/src`)

| Módulo | Rotas |
|---|---|
| Auth (9) | `GET /auth/me` · `POST /auth/login`, `register`, `logout`, `logout-all`, `change-password`, `forgot-password`, `reset-password`, `reset-password/inspect` |
| Loja pública (6) | `GET /stores/:slug/menu`, `/delivery-zones`, `/orders/:id/payment-status`, `/orders/:id/tracking` · `POST /stores/:slug/orders`, `/orders/:id/cancel` |
| Pedidos (14) | `GET /api/orders`, `/orders/:id`, `/orders/history` · `POST /api/orders` (manual), `/:id/transition`, `status`, `cancel`, `undo`, `deliverer`, `internal-note`, `reprint`, `refund`, `refund/retry`, `refund/abandon` |
| Caixa (9) | `GET /api/cashier/current`, `close-preview`, `sessions`, `sessions/:id/summary` · `POST open`, `movements`, `close`, `notices/:id/dismiss` · `PUT staff-withdrawal-limit` |
| Catálogo (8) | `GET/POST /api/catalog/categories` (+`/:id`, `/:id/delete`) · `POST /api/catalog/products` (+`/:id`, `/:id/delete`, `/:id/sold-out`) |
| Zonas de entrega (6) | `GET/POST /api/delivery-zones` (+`/:id`, `/:id/delete`, `config`, `import`) |
| Cupons (4) · Entregadores (4) · Equipe (3) | `GET/POST /api/coupons`, `/api/deliverers`, `/api/users` (+ editar/excluir) |
| Loja (16) | `GET/POST /api/store/settings`, `POST availability`, `GET plan`, `GET/PUT print-mode`, `PUT manual-discount-limit`, `GET subscription` (+`cancel`, `checkout`, `payments/:id`), `GET payments`, `POST payments/mercadopago/connect`, `disconnect`, `GET .../callback`, `POST feature-interest` |
| Impressão (painel) (4+3+1) | `GET /api/print-jobs`, `/summary` · `POST /:id/print-now`, `/test` · chaves: `GET/POST /api/device-tokens`, `/:id/revoke` · `GET /api/device-alerts` |
| Impressão (dispositivo) (7) | `GET /api/device/config`, `/orders/pending`, `/orders/:id/printable` · `POST /alerts`, `/orders/:id/printed`, `/print-jobs/claim`, `/print-jobs/:id/ack` |
| Outros | `GET /api/reports/summary`, `/api/audit-log`, `/api/notices` (+`/:id/read`), `/api/plans`, `POST /api/mfa/challenge`, `/verify`, `/api/feedback`, `/api/payments/webhook`, `POST /api/admin/notices` (+delete), `GET /health`, WebSocket `/ws/panel`, `/ws/device` |

## Páginas atuais (`apps/web/app`) — 17 telas

Estado visual: **v2** = redesenhada; **antigo** = desenho original (só correções de segurança e comportamento).

| Rota | O que é | Estado |
|---|---|---|
| `/loja/[slug]` | Cardápio público: capa, categorias fixas, itens, carrinho, checkout, PIX, acompanhar/cancelar | **v2 (Fatia 1: estrutura)**; movimento e detalhe/checkout novos pendentes |
| `/`, `/login`, `/esqueci-senha`, `/reset-senha` | Entrada, login e redefinição de senha | antigo |
| `/dashboard` | Início: resumo e primeiros passos | antigo |
| `/dashboard/pedidos` e `/dashboard/pedidos/historico` | Kanban (aceitar, recusar, cancelar com motivo, estorno) e histórico com busca | **v2** |
| `/dashboard/catalogo`, `caixa`, `cupons`, `entregadores`, `equipe`, `impressoras`, `conta`, `planos`, `relatorios`, `auditoria` | Gestão da loja | antigo |

**Para o frontend (sócio):** as rotas novas da API acima ainda **não têm tela**: pedido manual, taxa por bairro (zonas), esgotado hoje, acompanhamento do pedido pelo cliente, PIX por loja (conectar/desconectar), erros de impressão e estorno preso. Cada uma tem a rota listada na tabela; o contrato (campos e códigos de erro) está nos testes de `apps/api/tests` e nos tipos de `packages/shared-types`.

## Em PR aberto (ainda NÃO está na `main`)

Veja a lista completa em [Pull requests](../../pulls). Principais: mesa/QR e receber a mesa (#66, #70, #90) · upload de imagens (#78) · back-office da plataforma e créditos (#83) · planos, limites e consulta/suspensão (#75, #76) · onboarding com verificação de e-mail (#80) · relatórios em SQL com CSV (#85) · privacidade/LGPD: exportação, "não contatar" (#63, #65, #79) · estorno: congelado, manual, caixa fechado (#60 e seguintes) · segurança: PIX órfão, DTO público, relatórios com limite, guardas sem `return` (#64, #67, #68, #71, SEC-40) · app de impressão (PCs #25–#50) · telas do painel e do cardápio v2 (movimento: **sem aceite**, não entra).
**Sem código ainda:** pedido agendado, WhatsApp (via API genérica tipo Evolution), comanda e pagamento dividido, relatórios avançados, créditos 3D (Tripo), Reels, IA de produtos, visão computacional por câmera.

## Decisões vigentes

PIX só com mock (`PixGateway`/`FakePixGateway`); **Mercado Pago real fora** por enquanto · WhatsApp por API genérica (sem Meta) · créditos de pratos 3D concedidos manualmente, sem cortesia no PRO · imprimir **ao chegar o pedido** (PIX só depois de pago) · reembolso por visão: só linha do tempo da mesa, sem imagem · Reels: R2 + vídeo curto, P2P fora do MVP · teto de custo de IA/mídia: **R$ 100 por loja por mês** · trial vencido: 7 dias em modo consulta, depois suspensão, dados nunca apagados · LGPD: nenhuma anonimização em produção antes do parecer jurídico.

## Rodando localmente

Pré-requisitos: **Node 24**, pnpm 12, Docker.

```powershell
pnpm install --frozen-lockfile
docker compose -f infra/docker-compose.dev.yml up -d        # Postgres em 55432
Copy-Item apps/api/.env.example apps/api/.env               # preencha JWT_SECRET e MFA_HMAC_KEY:
pnpm --filter @meucardapio/api gen:secrets                  #   gera os valores (copie para o .env local)
Copy-Item apps/web/.env.example apps/web/.env
pnpm db:generate; pnpm --filter @meucardapio/db migrate; pnpm db:seed
pnpm dev:api   # http://localhost:3001      pnpm dev:web   # http://localhost:3000
```

Em http local sem https, ponha `COOKIE_SECURE="false"` no `apps/api/.env`. O seed cria a loja `loja-teste` (login `dono@lojateste.com`). Nunca versione `.env`, chaves ou dumps.
Testes da API (apagam tabelas): use um banco `*_test` em 127.0.0.1 na porta **55440–55459** e `TEST_DATABASE_URL`; o teste recusa qualquer outro banco. CI do GitHub: backend (Postgres 16) e web (typecheck, lint, testes, build).

## Dívida de revisão

A `main` recebeu o lote de integração (#86) **sem parecer do Deming nem da Nightingale** e sem CI verde garantido. Pendente: revisão de segurança (login, pagamento, sessão, dados, guardas de permissão sem `return` — SEC-40), suíte completa estável (há testes que falham só sob carga) e teste do app de impressão numa máquina Windows.

## Divisão de trabalho e fluxo de código

Backend (`apps/api`, `packages/db`, `infra`, `apps/print-client`): Claudio · Frontend (`apps/web`): `victorsampontes`. Mudanças entram por **branch → Pull Request → CI → revisão → merge**; veja [CONTRIBUTING.md](CONTRIBUTING.md).

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



