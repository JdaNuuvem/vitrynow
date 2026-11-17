# Plano de virada do modo fila (`QUEUE`) — print-client × API

O cliente tem dois modos de impressão: **legado** (`/api/device/orders/pending` + `printed`) e **fila** (`claim`/`ack`, ADR-0004). Por decisão do Atlas (ADR-0004 §8 itens 12-13) **quem decide é o servidor, por loja** (`Store.printMode`, `LEGACY` | `QUEUE`, padrão `LEGACY`; só o OWNER altera, auditado). O cliente segue o servidor a cada ciclo (PC-18) e `UsePrintJobs` no `settings.json` é só o ponto de partida de desenvolvimento.
Este plano diz o que precisa estar pronto antes de virar uma loja, como virar e como voltar. Só DEV até o Claudio abrir o piloto.

## 1. Por que a virada precisa de reconciliação (achado do Ritchie, 17/11)

A API-12 cria um job `ORDER_KITCHEN` para **todo** pedido novo, mesmo enquanto a loja usa o modo legado. Sem cuidado, isso abre dois buracos:

| # | Situação | Efeito ao ligar a fila |
|---|---|---|
| **R1** | Pedido que já existia e **ainda não imprimiu**, sem job (criado antes da API-12) | **Nunca imprime** |
| **R1b** | Pedido **já impresso pelo legado**: o ack legado `POST /api/device/orders/:id/printed` só gravava `Order.printedAt` e **não fechava o `PrintJob`**, que ficava `PENDING` | A fila oferece todos esses jobs e o cliente **reimprime tudo** na cozinha |

### O que a API faz (API-12b, Turing; ADR-0004 §8 itens 12-13)
1. `Store.printMode` (padrão `LEGACY`); `claim` e a configuração do dispositivo devolvem `mode`.
2. Em `LEGACY`: `claim` → `{"job":null,"mode":"LEGACY"}` (nunca entrega job) e o endpoint legado funciona. Em `QUEUE`: o endpoint legado responde `409 MODE_QUEUE` e a lista legada vem vazia. **O servidor impede a impressão em dobro.**
3. O ack legado `.../printed` fecha o `PrintJob` do pedido (`PRINTED`) na **mesma transação** do `printedAt`.
4. Reconciliação **idempotente por loja** na troca `LEGACY → QUEUE` (fecha como `PRINTED` os jobs `PENDING` de pedido com `printedAt`; cria o job `<orderId>:ORDER_KITCHEN` de pedido imprimível sem job) e no recuo `QUEUE → LEGACY` (`printedAt` para pedido com job `PRINTED` e `printedAt` nulo, senão o legado o reimprime).
5. Teste de contrato com as 3 consultas de conferência abaixo (= 0).

### Consultas de conferência (só leitura; todas devem dar **0**)
```sql
-- R1b: jobs que reimprimiriam pedido já impresso
select count(*) from "PrintJob" j join "Order" o on o.id = j."orderId"
 where j.kind = 'ORDER_KITCHEN' and j.status = 'PENDING' and o."printedAt" is not null;

-- R1: pedido imprimível sem job
select count(*) from "Order" o
 where o."printedAt" is null and o.status <> 'CANCELADO' and o."awaitingPayment" = false
   and not exists (select 1 from "PrintJob" j where j."orderId" = o.id and j.kind = 'ORDER_KITCHEN');

-- recuo (QUEUE -> LEGACY): impresso pela fila e sem printedAt reimprimiria no legado
select count(*) from "Order" o join "PrintJob" j on j."orderId" = o.id
 where j.kind = 'ORDER_KITCHEN' and j.status = 'PRINTED' and o."printedAt" is null;
```

## 2. O que o cliente faz (PC-18, `docs\contrato-printjob-cliente.md`)
- Segue o modo do servidor a cada ciclo: `claim` com `mode:"LEGACY"` ⇒ volta ao legado; legado com `409 MODE_QUEUE` ⇒ passa para a fila; `mode` ausente ou desconhecido ⇒ não muda nada.
- **Nunca mistura os dois modos com impressão em andamento:** não pede job enquanto há pedido legado em impressão ou com aviso pendente; não roda o legado enquanto há job em impressão ou com `PRINTED` pendente; aviso legado respondido com `409 MODE_QUEUE` encerra sem repetir.
- **Cinto de segurança:** job `ORDER_KITCHEN` de pedido que este PC já imprimiu no legado só envia `PRINTED`, não reimprime (2ª via e aviso de cancelamento sempre imprimem).
- Todas as impressoras da loja trocam **no mesmo ciclo** (o servidor decide por loja): não há mais "um PC no legado e outro na fila" disputando o mesmo pedido.

## 3. Passo a passo da virada de uma loja (fora do expediente)
1. Pré-requisitos: API-12b e a pilha do cliente (PC-13…PC-18) na produção; app atualizado em **todos** os PCs da loja (um app antigo ignora o modo); impressora e papel conferidos; o Claudio autorizou a loja.
2. Esperar a lista do legado esvaziar (nenhum pedido na faixa "sem imprimir").
3. O dono muda a loja para `QUEUE` no painel (auditado). A API roda a reconciliação (§1.4) na mesma ação.
4. Conferir as 3 consultas da §1 (= 0).
5. Pedir o **job de teste** pelo painel (`POST /api/print-jobs/test`, só OWNER) → deve sair "TESTE DE IMPRESSÃO" (o cliente imprime o tíquete próprio; sem valor nem pagamento). O app **não tem** item "imprimir teste" no menu hoje; se o Claudio quiser testar sem o painel, é uma pequena tarefa nova.
6. Fazer **1 pedido de teste** da loja: sai 1 vez; no painel aparece impresso; o job fica `PRINTED`.
7. Observar 30 min com movimento real: nenhum "pedido sem imprimir" preso, nenhum tíquete repetido, `attempts` ≤ 1.

### Sinais para voltar (qualquer um)
Tíquete repetido; pedido sem sair por mais de 2 min com a impressora ok; job `FAILED` definitivo sem causa de hardware; erro de chave inesperado.

## 4. Como voltar (recuo)
1. O dono muda a loja para `LEGACY` no painel (sem ir ao PC). A API roda a reconciliação do recuo (§1.4) e as impressoras voltam ao legado no ciclo seguinte.
2. Conferir a 3ª consulta da §1 (= 0). Se não for, **não reabra o legado** (ele reimprimiria) até corrigir `printedAt` desses pedidos.

## 5. O que este plano não cobre
- Impressora e driver reais, tela WinForms, instalador em máquina limpa (CL-15, decisão do Claudio; só antes do piloto, `roteiro-instalador-maquina-limpa.md`), chave de release real (adiada, CL-10).
- Lease vencida com impressão lenta e revogação de chave com job em curso, **contra a API real**.
- Observação O1 do Deming: o recuo local de falha é global, então um tíquete que quebra segura os outros por ~1 min.
- Limite do cinto de segurança: ele só protege pedidos que este **mesmo PC** imprimiu pelo legado; a proteção entre PCs diferentes é a reconciliação do servidor.
