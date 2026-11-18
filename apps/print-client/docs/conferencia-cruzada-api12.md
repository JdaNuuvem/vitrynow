# Conferência cruzada: cliente PC-03 × API-12 real (só DEV)

Roda o `DeviceClient` **de verdade** (modo `UsePrintJobs`) contra a API local da API-12, com a impressora virtual. Não toca produção nem impressora real.
Feita em 2026-11-17 contra `feat/API-12-printjob` @`1fd2622` (Postgres de teste próprio, porta 55459) com o cliente PC-03/03b/03c.

## Como repetir
1. Worktree da API-12, `pnpm install --frozen-lockfile`; Postgres: `scripts\test-db.ps1 -Agent <você> -Port <sua porta>` (aplica as migrações).
2. API: em `apps\api`, com `DATABASE_URL`, `JWT_SECRET`, `MFA_HMAC_KEY` (diferentes), `COOKIE_SECURE=false` e `PORT`: `pnpm exec tsx --conditions=development src\server.ts`.
   (`--conditions=development` porque o pacote `@meucardapio/db` exporta o fonte nessa condição; sem isso falta o `dist`.)
3. Pelo painel/API: `POST /auth/register`, categoria, produto, `POST /api/device-tokens` (o segredo `mcd_…` só aparece uma vez), pedido em `POST /stores/:slug/orders`.
4. Cliente: `tools\live-check.ps1 -Token mcd_… -OutDir <pasta> -Ledger <printed.json> -Seconds 20 [-Fault offline]`. Use o **mesmo** `-Ledger` entre rodadas para simular o mesmo PC reiniciado.
5. Confira no banco: tabela `"PrintJob"` (status, attempts, ackStatus, lastErrorCode).

## Resultado
| Cenário | Esperado | Observado |
|---|---|---|
| 2 pedidos, impressora boa | 1 tíquete cada; jobs `PRINTED`, `attempts=1` | ✓ |
| Impressora offline, depois volta | `FAILED` com só `code=PRINTER_OFFLINE` e a frase fixa; job volta a `PENDING` com recuo; ao voltar sai 1 vez, `attempts=2` | ✓ (banco guardou `PRINTER_OFFLINE` / "impressora offline") |
| 2ª via (`POST /api/orders/:id/reprint`) | "2ª VIA (1)" e "1ª impressão: …" | ✓ |
| Job de teste (`POST /api/print-jobs/test`) | sai e fecha | ✓ (ver achado 2) |
| Cancelar pedido já impresso | aviso "CANCELADO / NÃO PREPARAR" | **✗ antes do PC-03c** (achado 1); ✓ depois |
| 2 impressoras (2 tokens) na mesma fila, 6 pedidos | cada pedido 1 vez, nenhum perdido | ✓ (#0004 a #0009, cada um em uma só impressora; 9 jobs `PRINTED`) |

## Achados
1. **`ORDER_CANCEL_NOTICE` (corrigido no PC-03c).** A API-12 emite o aviso de cancelamento como job de tipo próprio; o cliente só conhecia `ORDER_KITCHEN`/`ORDER_REPRINT`/`TEST`, recusava com `FAILED/OTHER` e a cozinha nunca saberia do cancelamento. O ADR-0004 lista só 4 tipos (`ORDER_KITCHEN`, `ORDER_REPRINT`, `TAB_BILL`, `TEST`): o ADR deve ganhar `ORDER_CANCEL_NOTICE`.
2. **(Resolvido no PC-03c, decisão do Atlas) Tíquete de teste do servidor dizia "COBRAR NO CAIXA R$ 10,00".** O `buildTestTicket` manda `paymentStatus: "A_COBRAR"`, e a regra fail-safe do cliente imprime a linha de cobrança. Decisão (ADR-0004 §8 item 11): o cliente imprime o próprio tíquete de teste e ignora os campos de pedido do `TEST`; o servidor manda só o mínimo.
3. **Aviso de cancelamento sem alerta sonoro** (por decisão do contrato: só `ORDER_KITCHEN` novo toca). Se o Claudio quiser um som diferente para "cancelado", é decisão de produto.

## Não coberto
Lease vencida com impressão lenta e ack perdido contra a API real (coberto só no `FakeApi`), revogação de chave com job em curso, WebSocket com a audiência da API-47 (ainda fora da main), impressora e driver reais.
