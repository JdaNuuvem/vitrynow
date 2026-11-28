# Para o frontend (apps/web) — leia ao receber esta atualização

**Para:** o agente/dev que cuida do `apps/web` (telas do sócio). **De:** o lado backend/infra. **Atualizado:** 25/11/2026.

**Regra combinada:** o backend não altera o que já existe no `apps/web`, EXCETO quando o dono do produto autoriza. Em 25/11 ele autorizou: sanitização dos campos (§3b), 3 telas corrigidas (§3b) e as cores do §1 — **tudo isso JÁ ESTÁ APLICADO no main**; revise e ajuste o visual se quiser.

## O QUE FICOU PARA VOCÊ (resumo)
1. ~~Tela nova: importação de produtos por planilha~~ — **FEITO** (§3c, PR #178).
2. **Ligar o catálogo de erros** (§2) — **textos revisados em 27/11/2026**: 240 aprovados (`ok`), 55 ficam com a frase da API (`api`, mais específica), 0 rascunhos (`docs/textos-de-erro-para-revisar.md`). **LIGADO em 27/11/2026 (autorizado):** `shared/errors/catalogMessage.ts` (+ teste) e `extractErrorMessage` em `core/http/FetchHttpClient.ts` consulta o catálogo pelo `code` antes de usar o texto da API. Ficou em `extractErrorMessage` (e não só em `toResult`) para valer também nos 5 lugares que a chamam direto (campanha, sangria, lucro, operação, relatórios). O 5xx genérico do Fastify continua com a frase padrão. Teste ajustado em `FetchHttpClient.test.ts` (STORE_UNAVAILABLE agora tem texto aprovado). Conferido no navegador: cadastro com e-mail já usado mostra "Este e-mail já tem cadastro. Entre com ele ou use outro." no lugar de "este e-mail já está cadastrado".
3. **z-index e breakpoints** (§3) — **APLICADO em 27/11/2026 (autorizado)**: revisar.
4. **Revisar o que foi aplicado nas suas telas**: §1 (cores), §3b (máscaras/limites e 3 telas).
5. ~~Conferir se as telas criadas pelo backend seguem o seu padrão~~ — **CONFERIDO em 27/11/2026**: estoque/lucro, relatórios, salão, prato 3D, Reels, importação, equipe e caixa já usam `PageHeading`, `StateMessage` e `ds-button`. A exceção era `operacao/` (Mesas, Horários, QR da mesa), com um estilo de botão próprio (`.operacao button`, `operacao__primary`, `operacao__button`): **trocado** por `ds-button` / `--primary` / `--quiet` em `MesasPage.tsx`, `HorariosPage.tsx` e `TableQr.tsx`; `operacao.css` agora só estiliza botão SEM `ds-button`. `MesaCardapioPage` (tela do cliente, estilo da loja) não mudou. Espaçamento em px é o mesmo padrão das suas telas (catálogo, início), então ficou.

---

## 1. Cores (SSOT D8) — APLICADO em 25/11/2026
Tudo da §1.1 à §1.4 abaixo foi aplicado como descrito: tokens fantasmas trocados (`--success/--warning/--accent` → `--ok/--warn/--color-primary`), 27 reservas mortas removidas, tokens novos `--warn-line`/`--danger-line` (claro = cor de antes; escuro = proposta), hex das regras trocados por token, SVG do onboarding via `style`. Hex no web: 149 → 96 (só paletas). Guarda: `shared/design/no-loose-colors.test.ts` (teto de hex por arquivo, todo `var(--x)` existe, todo token de cor claro tem versão escura). Mudança visual no tema claro só onde a tabela diz "cor muda". Texto original mantido abaixo como referência.

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

## 3. z-index e breakpoints (SSOT D8, APLICADO em 27/11/2026, autorizado)
Antes: um `z-index: 100000000` (causa do #35), camadas soltas (25–80) e **23 larguras diferentes** de `@media`.
- **Camadas:** tokens em `shared/design/tokens.css`, com os MESMOS valores de antes (ordem visual inalterada): `--z-sticky` 25, `--z-bar` 30, `--z-nav` 40, `--z-cart` 45, `--z-skip-link` 50, `--z-overlay` 60, `--z-fullscreen` 80, `--z-modal` 100 (o `ui-modal`, antes 100000000; continua acima de tudo). Trocados em `loja.css`, `purchase.css`, `reels*.css`, `pedidos-acoes.css`, `pratos3d.css`, `salao.css`, `ui.css`. Número solto só até 20 (empilhar dentro de um componente).
- **Larguras:** só **340** (celular muito estreito), **480/481** (celular), **800/801** (troca celular/desktop, a mesma do menu) e **1099/1100** (tela larga). Na dúvida, arredondei para o lado que mantém o layout estreito (ex.: Equipe e Campanha empilham até 1099; os painéis de Prato 3D e Reels só abrem 2 colunas a partir de 1100). Exceção registrada: os 3 ajustes de encaixe das abas do topo em `shell/shell.css` (950/1080/1120), que dependem do texto das abas.
- **Detalhe do produto no cardápio (481–800):** largura `min(36rem, 100%)` para não estourar em celular grande.
- **Guarda:** `shared/design/layers.test.ts` reprova z-index > 20 fora dos tokens, `var(--z-*)` inexistente e largura fora da lista. `features/loja/motion.test.ts` agora resolve os tokens ao comparar camadas.
- **Conferido no navegador:** todas as telas do painel no desktop e no celular, e larguras 520/860/1024 (Equipe, Catálogo, Novo pedido, Prato 3D, Reels, cardápio e detalhe): sem estouro horizontal e sem erro.

---

## 3b. APLICADO no web (25/11/2026, com autorização): máscaras e limites dos campos
Exceção à regra acima, pedida pelo dono do produto depois de um telefone de 20 dígitos passar no Novo pedido. **Já está no código**; revise se quiser outro visual.

- **Telefone (regra única, SSOT D9):** `@meucardapio/shared-types/phone` → `isValidBrPhone`, `maskPhoneInput`, `PHONE_INVALID_MESSAGE` (reexportados em `shared/format/phone.ts` com `PHONE_INPUT_PROPS`). Válido = DDD + 10/11 dígitos (celular com 9), DDI 55 opcional. A API usa a MESMA regra no `phoneSchema`.
  - Máscara `(11) 98765-4321` em: Novo pedido (`ManualOrderPage.tsx`), checkout da loja (`CheckoutDrawer.tsx`), entregador (`NewDelivererForm.tsx`).
  - WhatsApp da loja (`StoreSettingsCard.tsx`): só dígitos, até 15 (o servidor exige DDI, sem máscara).
- **Checkout da loja:** `checkoutForm.ts` → `CHECKOUT_LIMITS` (nome 80, endereço 280, cupom 50 = `createOrderSchema`). Antes o cliente aceitava nome até 150 e o servidor recusava acima de 80. Mensagens novas `NAME_TOO_LONG_MESSAGE` / `ADDRESS_TOO_LONG_MESSAGE`.
- **maxLength igual ao servidor:** produto (nome 80, descrição 300, link 500), adicional 60, categoria 50, dados da loja (nome 150, endereço 300, horário 200), e-mails 200, senhas 200 (`PasswordField`, `SingleFieldForm`, login), código na Privacidade 20 (era 21).
- `Field.tsx` (conta) ganhou as props `maxLength` e `inputMode`.
- `MoneyInput`: para de aceitar dígitos acima de 10 (R$ 99.999.999,99).
- Testes atualizados: `checkoutForm.test.ts` (regra nova do telefone e do nome) e `CheckoutDrawer.test.tsx` (máscara e maxLength).

**API (mesmo pacote):** textos do pedido do painel, da mesa, de grupos/opções, bairro, chave de impressora e insumo agora passam pelo `textField` (limpa controles invisíveis); cupom do pedido sem espaços nas pontas; `maxUses` ≤ 1.000.000; ids do item ≤ 100; motivo de cancelamento "OUTRO" limpo e com teto de 500 (antes sem limite).

**Achados da rodada de testes por tela — CORRIGIDOS (25/11/2026, autorizado):**
1. Planos mostrava códigos crus (`table_qr · tab_service …`). `planPresentation.ts`: `FEATURE_LABELS` com os 6 recursos; código sem nome vira "Outros recursos do plano" (nunca o código); `CurrentPlanCard`/`PlanOfferCard` sem itens repetidos. Teste: `planPresentation.test.ts`.
2. Pagamentos vista por FUNCIONÁRIO mostrava erro + "Consultar novamente". `StorePaymentsPage.tsx`: 403 vira o aviso "Acesso do dono da loja · Peça ao dono…", como Auditoria/Equipe.
3. Equipe mostrava "A senha precisa ter pelo menos 10 caracteres" depois de um cadastro com sucesso. `usePasswordRule` ganhou `reset()`; `InviteStaffCard` chama depois de limpar. Teste em `InviteStaffCard.test.tsx`.

**Desperdício (aplicado com autorização):**
1. Cancelar pedido aceito JÁ PREPARADO: `CancelOrderDialog` ganhou a caixa "O pedido já foi preparado" (só em cancelamento, não em recusa). `CancelDraft.stockWasted` → `buildCancelBody` manda `stockWasted: true`. API: a venda é estornada, mas os insumos saem como desperdício com motivo `PEDIDO_CANCELADO` (não voltam ao estoque). Sem a marca, nada muda.
2. Perda de PRATO PRONTO: componente NOVO `estoque/components/ProductLossForm.tsx`, aberto pelo botão "Perda de prato" no topo de Estoque (equipe e dono). Rota `POST /api/stock/products/:id/loss` `{ quantity 1–100, reason (WASTE_REASONS), weightGrams? }`; baixa pela ficha técnica; prato sem ficha = 409 `PRODUCT_NO_RECIPE`. `StockGateway.productLoss`.
3. `SYSTEM_WASTE_REASONS` (domain/stock.ts) entrou nos rótulos de motivo de Estoque e Lucro.
4. Desfazer perda: Estoque › Movimentações ganhou o filtro "Só perdas", as colunas "Quem" e o botão "Desfazer" (`POST /api/stock/movements/:id/undo`; a API devolve `canUndo` por linha: dono qualquer perda manual, equipe só a própria até 30 min; perda de prato desfaz o prato todo). Linha desfeita mostra "Desfeito".
5. Observação: campo em `MovementForm` e `ProductLossForm` (até 200), obrigatório no motivo "Outro" (a API recusa sem).
6. Perda alta: `LucroPage` mostra aviso quando `lossAlert.exceeded` (perdas > 5% do faturamento) e o painel "Perdas por quem lançou" (`lossesByUser`).
7. Validade: `MovementForm` (compra) tem "Validade do lote"; a lista de insumos traz `expiry` (EXPIRED/SOON/OK) e `nextExpiresOn` estimados por PEPS; Estoque mostra o selo "Vencido"/"Vence dd/mm" e o aviso de validade.

---

## 3c. Importação de produtos por planilha — tela FEITA (26/11/2026)
- **Novo:** `/dashboard/catalogo/importar` (`features/importacao/`): modelo CSV/JSON, texto para IA ler a foto do cardápio, enviar ou colar, prévia (OK / revisar / ignoradas, avisos por linha), opções de duplicados e "publicar só as prontas", resultado.
- **Tocado no existente:** `features/catalogo/CatalogoPage.tsx` (botão "Importar planilha" no cabeçalho, só para o dono).

### (referência) API
Só OWNER; escrita bloqueada em loja só-leitura/suspensa. Sem tela no web ainda. Rotas:
- `GET /api/catalog/import/template?format=csv|json` (modelo) e `GET /api/catalog/import/guide` (instruções)
- `POST /api/catalog/import/preview` (até 2 MB, até 500 linhas) → lote com linhas OK / REVISAR e avisos por linha
- `GET /api/catalog/import/:batchId`, `POST /:batchId/confirm` (publica as válidas), `POST /:batchId/discard`
- Códigos e frases no catálogo único (`@meucardapio/shared-types/errors`): `IMPORT_*`, `TOO_MANY_ROWS`, e os avisos `UNKNOWN_FIELD`, `FORMULA_AS_TEXT`, `HTML_AS_TEXT`, `ROW_IGNORED_NO_NAME`.
Sugestão: botão "Importar planilha" no Catálogo → enviar arquivo → prévia (linhas OK/revisar) → publicar.

---

## 3d. Prato 3D (26/11/2026, autorizado): tela NOVA + 2 toques no existente
- **Novo:** `/dashboard/pratos-3d` (`features/pratos3d/`), `shared/dish3d/Dish3dViewer.tsx` (usa `@google/model-viewer@4.0.0`, carregado só no navegador), `core/gateways/http/dish3d.ts`, `core/domain/dish3d.ts`.
- **Tocado no existente:** `core/navigation/panelNavigation.ts` (item "Pratos 3D") e `app/media/stores/[storeId]/[file]/route.ts` (proxy de DEV aceita também `3d-<uuid>.glb`).
- **Cardápio público (APLICADO 27/11, autorizado):** `features/loja/components/ProductDetailScreen.tsx` tocado: com `model3dUrl`, botão "Ver em 3D" sobre a foto troca a foto pelo `Dish3dViewer` (girar + "Ver na mesa"); estilos em `components/hero3d.css`; tipo `Product.model3dUrl` em `core/domain/storefront.ts`. Publicar/tirar/remover 3D e Reels agora revalidam o cardápio (`plugins/menuRevalidation.ts`).
- Fluxo: dono envia 1–4 fotos → gera em 2–5 min (créditos de IA da loja; devolve se falhar) → rascunho → "Publicar no cardápio".

## 3e. Salão 3D (26/11/2026, autorizado): tela NOVA + 3 toques no existente
- **Novo:** `/dashboard/salao` (`features/salao/`): mapa 3D das mesas (three + @react-three/fiber 8 + drei 9, só nesta tela, sem SSR), status por cor vindo da API (`status` em `GET /api/tables`), etiqueta sobre cada mesa, painel da mesa (pedidos, total parcial, "Atendido" para os avisos, "Fechar conta"), resumo por status e filtro por setor; modo "Organizar salão" (dono): arrastar mesas/elementos, girar, formato, lugares, setor, adicionar parede/balcão/planta/porta, salvar (`PUT /api/floor`).
- **Tocado no existente:** `core/navigation/panelNavigation.ts` (item "Salão 3D"); `features/operacao/MesasPage.tsx` (+5 linhas: abre já com a mesa de `?mesa=<id>`, usado pelo "Fechar conta" do salão); `shared/design/no-loose-colors.test.ts` (teto 8 para `features/salao/scene/palette.ts`, paleta dos materiais 3D).
- **API nova para você usar na tela de Mesas, se quiser:** `GET /api/tables` agora traz `status` (INACTIVE/ASK_BILL/CALL_WAITER/WAITING/OCCUPIED/FREE, rótulos em `TABLE_STATUS_LABEL` do shared-types), `openedAt`, `layout`, `callWaiterAt`, `askBillAt`; "chamou garçom"/"pediu a conta" ficam guardados até `POST /api/tables/:id/alerts/clear` ou o recebimento; evento de tempo real novo `table.updated`.

### 3e.1 Salão 3D — opcionais (26/11/2026)
- No painel da mesa: garçom responsável (dono escolhe; garçom assume/larga a própria), pessoas na mesa (mesa com pessoas e sem pedido = Ocupada; zera ao receber), próxima reserva e **Adicionar pedido** (lança na conta da mesa pela MESMA rota do pedido do painel: `POST /api/orders` com `type: "MESA"` e `tableId`; sem pagamento, que fica para o fechamento).
- Gaveta **Reservas** (`/api/reservations`): nova reserva, Chegou (põe as pessoas na mesa), Não veio, Cancelar; a mesa aparece **Reservada** (amarelo) de 30 min antes a 15 min depois do horário; horário sobreposto na mesma mesa = 409.
- Para a sua tela de Pedidos: `createManualOrderSchema.type` agora aceita `MESA` (com `tableId`). Nada mudou para DELIVERY/BALCAO.

## 3f. Reels — cardápio estilo Reels (26/11/2026, autorizado)
- **Novo no painel:** `/dashboard/reels` (`features/reels/`): um vídeo vertical ≤ 30 s por produto; enviar → preparando → conferir → **Publicar no cardápio** / Tirar / Remover. Limites: 10 vídeos e 300 MB por loja, upload ≤ 50 MB. Item "Reels" no menu (`panelNavigation.ts`).
- **Novo no cardápio:** `features/loja/reels/` — faixa "Veja em vídeo" (capas estilo stories) e o feed vertical em tela cheia (um vídeo toca por vez, mudo até tocar no som, botão **Pedir** abre o produto no MESMO cardápio: o carrinho não se perde). `?reels=1` no link da loja abre direto nos vídeos.
- **Tocado no existente:** `features/loja/LojaPage.tsx` (+13 linhas: hook `useReels`, a faixa abaixo do `MenuBanner` e o visualizador por cima); proxy de DEV `app/media/stores/[storeId]/reels/[file]` (repassa Range).
- **API:** `GET /stores/:slug/reels` (público, lista vazia se a loja não tem o recurso); `POST /api/reels/:id/publish|unpublish|remove` (só o dono). Liga com `REELS_ENABLED=true` + recurso `reels` (PRO).

## 3g. Melhorias (27/11/2026, autorizado)
- **Salão — Adicionar pedido:** agora aceita produto COM opções (usa `ProductOptionFields` e `productOptions.ts` da vitrine, sem regra nova); fonte = cardápio público da loja. Venda por peso continua pela tela de Pedidos.
- **Equipe:** coluna "Nome" com edição na linha (`features/equipe/components/MemberRow.tsx` e `EquipePage.tsx`, tocados); API `POST /api/users/:id/name` (dono). O salão mostra esse nome no garçom (`memberName` no shared-types).
- **Lucro:** campo "Avisar quando as perdas passarem de X%" (`LucroPage.tsx` tocado + `components/LossAlertSetting.tsx`); API `PUT /api/stock/settings`.
- **Estoque — Perda de prato:** pede o peso (g) quando o prato é vendido por peso (`ProductLossForm.tsx` tocado).
- **Importação:** aceita Excel .xlsx (lido no navegador com `read-excel-file@5.8.6` e enviado como CSV).
- **Prato 3D:** qualidade do Rodin configurável no servidor (`DISH3D_QUALITY`, padrão high; `DISH3D_HIGHPACK`).

## 3h. Cardápio modelo Reels (27/11/2026, autorizado)
- **Novo:** `features/loja/reels/ReelsMenu.tsx` (+ `reels-menu.css`): com `store.menuLayout === "REELS"` a aba Cardápio vira feed vertical em tela cheia (um prato por tela; vídeo quando há Reel, foto com movimento suave quando não; abas de categoria; Detalhes/Adicionar usam o MESMO carrinho/detalhe; "Ver em lista" volta ao clássico na visita).
- **Tocado no existente:** `LojaPage.tsx` (troca a lista pelo `ReelsMenu` só na aba Cardápio quando o modelo é Reels; guarda o prato onde o cliente estava); `conta/aparencia/AppearancePage.tsx` (+ `MenuLayoutSetting.tsx`: escolha Clássico/Reels); `reels/ReelsFeed.tsx` (barra de progresso, próximo vídeo pré-carregado, "Toque para ouvir", dica de deslizar).
- **API:** `Store.menuLayout` (CLASSIC|REELS) em `POST /api/store/settings` e no cardápio público (`store.menuLayout`). Migração `20261127200000_cardapio_reels`.
- **Prévia da Aparência no modelo Reels (feito, autorizado):** `AppearancePage.tsx` guarda o modelo escolhido (mesmo antes de salvar) e passa `layout` para `AppearanceEditor.tsx` → `components/StoreIdentityPreview.tsx`, que no modelo Reels mostra o próprio `ReelsMenu` com os pratos ativos (fotos; vídeos só no cardápio). `MenuLayoutSetting.tsx` ganhou `onChange`; `appearance.css` ganhou `.appearance-preview__reels` (prende o feed, que é `position: fixed`, dentro da moldura). Teste: `StoreIdentityPreview.test.tsx`.

## 3i. Texturas do prato 3D bloqueadas pela CSP (28/11/2026, corrigido)
- **Defeito achado no teste com um modelo real:** o `.glb` traz as texturas embutidas e o model-viewer/three as lê com `fetch()` de um `blob:` da própria página. A CSP só liberava `blob:` em `img-src`, então o `connect-src` bloqueava e **o prato aparecia branco** (valeria também para os modelos da fal.ai).
- **Tocado:** `lib/securityHeaders.mjs` (`connect-src` ganha `blob:`) e `lib/securityHeaders.test.ts`. `blob:` só aponta para dados criados na mesma página: não abre conexão para fora.
- **Conferido no navegador (celular emulado):** textura carrega, girar com o dedo funciona, "Ver na mesa" (AR) ligado, nenhum erro de CSP no console.

## 4. Mudanças do backend desde a última sincronização (para saber o que a API já oferece)
- **Tíquete v4** (`printableOrderSchema`): `round`, `requestedBy`, `customerRemoved` — impressos pelo print-client; nada a fazer no web.
- **Catálogo de erros** (§2) e `docs/textos-de-erro-para-revisar.md`.
- **Nome do produto: "Vitry"**; logo ainda não chegou.
- Telas criadas antes desta regra (estoque/lucro, mesas, pedidos agendados, relatórios avançados, ações extras do pedido etc.) estão listadas no histórico do projeto; se algo nelas não seguir o padrão do sócio, ajuste à vontade.

## Como conferir
- `cd apps/web && pnpm exec tsc --noEmit -p tsconfig.json && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run`
- Conhecido: `ResetPasswordPage › aceita a query legada` falha na máquina do backend (Node 26 vs. 24 do projeto); causa não confirmada.
