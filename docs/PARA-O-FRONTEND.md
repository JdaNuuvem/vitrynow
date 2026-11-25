# Para o frontend (apps/web) — leia ao receber esta atualização

**Para:** o agente/dev que cuida do `apps/web` (telas do sócio). **De:** o lado backend/infra. **Data:** 24/11/2026.

**Regra combinada:** o backend **não altera** telas, CSS, componentes nem o cliente HTTP que já existem no `apps/web`; só cria telas que ainda não existiam. Tudo abaixo é **proposta**: nada daqui foi aplicado no web (o que chegou a ser aplicado foi desfeito; o web está como estava, 149 hex, testes iguais). Decida e aplique o que fizer sentido.

Ordem sugerida: §1.1 (bug real, 15 min) → §2 (quando os textos forem aprovados) → §1.2–1.4 → §3.

---

## 1. Cores (SSOT D8)

### 1.1 BUG: 3 tokens que NÃO existem (cor fixa, sem tema escuro) — recomendado corrigir
`--success`, `--warning` e `--accent` não estão em `shared/design/tokens.css` (nem em `panel-tokens.css`). Todo `var(--success, #067647)` cai **sempre** na reserva: a cor não segue o tema e, no **modo escuro**, fica o verde/laranja/vermelho do tema claro.

| Arquivo:linha | Hoje | Sugestão |
|---|---|---|
| `features/estoque/estoque.css:5`, `:40` | `var(--success, #067647)` | `var(--ok)` |
| `features/estoque/estoque.css:41` | `var(--warning, #b54708)` | `var(--warn)` |
| `features/operacao/operacao.css:66` | `var(--warning, #b54708)` | `var(--warn)` |
| `features/pedidos/pedidos-detalhe.css:341` | `var(--success, #067647)` | `var(--ok)` |
| `features/relatorios/relatorios.css:109` | `var(--success, #067647)` | `var(--ok)` |
| `features/relatorios/relatorios.css:117` | `var(--accent, #c2410c)` | `var(--color-primary)` |

Muda um pouco a cor no tema claro (`#067647`→`#1f704e`, `#b54708`→`#864607`, `#c2410c`→`#a13d27`), e passa a funcionar no escuro.

### 1.2 Reservas mortas `var(--token, #hex)` (sem efeito visual)
`tokens.css` é importado no `app/layout.tsx`, então `--ink`, `--line`, `--color-primary`, `--danger`, `--panel-canvas` etc. **sempre** existem e o `#hex` da reserva nunca é usado (só confunde e mantém cores antigas no código). 27 casos em: `estoque.css` (4, 42), `month-chart.css` (2), `inicio.css` (2–6, 14), `operacao.css` (5, 11, 18, 28, 32, 35, 42), `historico.css` (70), `manual-order.css` (2–6), `pedidos-detalhe.css` (342), `platform.css` (4), `relatorios.css` (110), `shell.css` (3). Trocar `var(--x, #hex)` por `var(--x)`.

### 1.3 Hex direto nas regras (não muda no modo escuro)
Proposta: 2 tokens semânticos novos em `tokens.css` (claro = a cor de hoje, sem mudança visual; escuro = proposta):

```css
:root                    { --warn-line: #b45309; --danger-line: #fca5a5; }
:root[data-theme="dark"] { --warn-line: #a8743a; --danger-line: #a3737c; }  /* #a3737c = o mesmo da --loja-danger-line escura */
```

| Arquivo:linha | Hoje | Sugestão |
|---|---|---|
| `features/auth/auth.css:141`, `features/pedidos/pedidos-acoes.css:24`, `:295` | `#b45309` | `var(--warn-line)` |
| `features/pedidos/pedidos-detalhe.css:182` | `#f59e0b` | `var(--warn-line)` (cor muda) |
| `features/pedidos/pedidos-acoes.css:194`, `pedidos.css:91`, `shared/ui/ui.css:299` | `#fca5a5` | `var(--danger-line)` |
| `features/pedidos/historico/historico.css:171`, `shared/ui/password-field.css:44` | `#94a3b8` (cinza-azulado) | `var(--line-strong)` (cinza do painel; cor muda) |
| `features/auth/auth.css:124` | `#cbd5e1` | `var(--line)` (cor muda) |
| `shared/ui/password-field.css:35` (foco) | `#1d4ed8` | `var(--info-ink)` (azul do painel; cor muda) |
| `features/shell/components/OnboardingWidget.tsx:16`, `:22` (SVG) | `stroke="#dddddd"`, `"#25a65b"` | `style={{ stroke: "var(--line)" }}`, `"var(--ok)"` (atributo SVG não lê `var()`; use `style`) |
| `features/loja/loja.css:385` | `#fecaca` | `var(--loja-danger-line)` (mesma cor) |
| `features/loja/loja.css:411` (`.loja__dot`) | `#157a3b` | `var(--loja-ok)` |
| `features/loja/cardapio.css:307`, `:340`, `:344` (banner) | `#fff` | `var(--loja-accent-on)` (é exatamente "texto sobre a cor da loja") |
| `features/loja/purchase.css:28` | `#fff` | `var(--loja-glass-solid)` |

**Hex que DEVEM ficar:** as paletas (`tokens.css`; bloco `--loja-*` no topo de `loja.css`), `features/loja/theme.ts` (cor da loja e contraste), as opções de cor em `AppearanceEditor.tsx` (são dado: o lojista escolhe), a cor demo em `CampaignPages.tsx` e o `color-mix(..., #24251e)` do banner.

### 1.4 Guarda (para não voltar)
Teste sugerido `shared/design/no-loose-colors.test.ts`: varre `.css/.ts/.tsx` (sem comentários e sem testes), conta hex por arquivo e falha se algum arquivo passar do teto (tetos = só os arquivos de paleta acima); segundo caso: todo `var(--x)` aponta para token que existe em `tokens.css`; terceiro: todo token de cor do tema claro tem versão no escuro. (Escrito e testado do lado de cá; pode pedir o arquivo pronto.)

---

## 2. Textos de erro pelo catálogo único (SSOT D6)

**Já existe (fora do web):** `@meucardapio/shared-types/errors` (subpath novo, sem zod: pode importar no navegador) exporta `errorMessages[code] = { message, surfaces, reviewed }`. A API garante (teste) que **todo** `code` que ela devolve tem entrada. Hoje os 254 textos são rascunho (`reviewed: false`). A revisão de conteúdo está em `docs/textos-de-erro-para-revisar.md`; aprovado = trocar `e(...)` por `ok(...)` no catálogo.

**Proposta para o web** (sem efeito até haver texto aprovado; testado do lado de cá e desfeito):

```ts
// shared/errors/catalogMessage.ts
import { errorMessages } from "@meucardapio/shared-types/errors";
const catalog: Record<string, { message: string; reviewed: boolean } | undefined> = errorMessages;
export function catalogMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const entry = Object.prototype.hasOwnProperty.call(catalog, code) ? catalog[code] : undefined;
  return entry?.reviewed ? entry.message : undefined;
}
// core/http/FetchHttpClient.ts, em toResult():
//   error: catalogMessage(code) ?? extractErrorMessage(payload),
```

Casos de teste usados: revisado → texto do catálogo; rascunho → texto da API; código desconhecido/ausente → regra antiga; `"toString"` não conta como código. Telas que leem `result.code` para decidir algo (ex.: `cancelReasons.ts`, `useOrderFlow.ts`, `productOptions.ts`) não mudam: o `code` continua igual.

Depois do build: o subpath precisa do `dist` (`pnpm --filter @meucardapio/shared-types build`), como já acontece com `/constants` e `/quote`.

---

## 3. z-index e breakpoints (SSOT D8, não levantado)
O levantamento foi interrompido antes de começar (o web é do sócio). O que o SSOT já registrava: há **um** `z-index: 100000000` (causa do problema #35) e camadas sem escala; **12 larguras diferentes** de `@media` (proposta do time: 2). Sugestão: tokens de camada em `tokens.css` (ex.: `--z-base`, `--z-sticky`, `--z-drawer`, `--z-modal`, `--z-toast`) e 2 breakpoints documentados; guarda por catraca como na §1.4.

---

## 4. Mudanças do backend desde a última sincronização (para saber o que a API já oferece)
- **Tíquete v4** (`printableOrderSchema`): `round`, `requestedBy`, `customerRemoved` — impressos pelo print-client; nada a fazer no web.
- **Catálogo de erros** (§2) e `docs/textos-de-erro-para-revisar.md`.
- **Nome do produto: "Vitry"**; logo ainda não chegou.
- Telas criadas antes desta regra (estoque/lucro, mesas, pedidos agendados, relatórios avançados, ações extras do pedido etc.) estão listadas no histórico do projeto; se algo nelas não seguir o padrão do sócio, ajuste à vontade.

## Como conferir
- `cd apps/web && pnpm exec tsc --noEmit -p tsconfig.json && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run`
- Conhecido: `ResetPasswordPage › aceita a query legada` falha na máquina do backend (Node 26 vs. 24 do projeto); causa não confirmada.
