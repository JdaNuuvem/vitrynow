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

## 2. O que o cliente faz (PC-18 + PC-22, `docs\contrato-printjob-cliente.md`)
- **Segue o modo do servidor a cada ciclo.** Na fila, o `claim` traz o `mode`. No legado, descobre a fila de três jeitos (nesta ordem de confiança): o **`mode` do corpo** do `GET /api/device/orders/pending` (`{orders, mode}`; troca no próprio ciclo), o `GET /api/device/config` (`{mode}`) lido a cada ciclo, e o `409 MODE_QUEUE` dos endpoints do pedido. **Achado da conferência cruzada (PC-22):** em `QUEUE` a lista legada vem **vazia com 200**, sem erro; um cliente que só esperasse o 409 ficaria olhando uma lista vazia e a **cozinha sem tíquete**.
- A fonte do modo é sempre o **corpo** da resposta; o cabeçalho `X-Print-Mode` é só dica e o cliente **não o lê**. `mode` ausente ou desconhecido ⇒ nada muda.
- **Config com problema:** `404` (API antiga, deploy, proxy) suprime a pergunta por 10 min e volta; **5 falhas seguidas** (rede, 5xx, lixo) mostram na tela "Não consigo confirmar o modo de impressão da loja" **sem trocar o modo**, e limpam ao voltar. Esse aviso e os de `nothingToCharge` entram no alerta de operação e no runbook INF-11 (Hopper).
- **Nunca mistura os dois modos com impressão em andamento:** não pede job enquanto há pedido legado em impressão; aviso pendente nunca bloqueia nada (cinto nos dois sentidos: o legado pula o pedido que um job deste PC imprimiu; o job de pedido que este PC imprimiu no legado só envia `PRINTED`); aviso legado respondido com `409 MODE_QUEUE` encerra sem repetir.
- Todas as impressoras da loja trocam **no mesmo ciclo** (o servidor decide por loja): não há mais "um PC no legado e outro na fila" disputando o mesmo pedido.

## 3. Passo a passo da virada de uma loja (fora do pico)
**Regra de ouro (Atlas): nenhuma loja vira para `QUEUE` com um cliente anterior à PC-22 em qualquer PC dela** (esse cliente ficaria sem ver a fila). A PC-22 já está na main; o runbook INF-11 (Hopper) confere a versão do app em todos os PCs da loja antes (o painel mostra a versão pelo `User-Agent`/`lastSeen`).
**Condição de G3 (Atlas): nenhuma loja vira para `QUEUE` sem a PC-24 mesclada**, isto é, a rota `POST /api/device/alerts` e o detector do servidor **`QUEUE_WITHOUT_PRINTER`** (loja em QUEUE com pedido/job `PENDING` mais antigo que 5 min e nenhum `claim` do token nesse intervalo) em produção **e o painel do dono mostrando o alerta**. É esse detector que cobre "cozinha sem tíquete" mesmo quando a API ou a configuração estão fora do alcance do cliente (o cliente não consegue avisar o que não consegue alcançar).
1. Pré-requisitos: API-12b, API-66, PC-24 (rota + detector + alerta no painel) e o cliente PC-13…PC-24 na produção; **app atualizado em TODOS os PCs da loja**; impressora e papel conferidos; o Claudio autorizou a loja.
2. Trocar **fora do horário de pico**. Esperar a lista do legado esvaziar (nenhum pedido na faixa "sem imprimir").
3. O dono muda a loja para `QUEUE` no painel (só OWNER, auditado; no máximo 10 trocas por minuto). A API roda a reconciliação (§1) na mesma ação e devolve as 3 consultas.
4. Conferir as 3 consultas da §1 (= 0).
5. Pedir o **job de teste** pelo painel (`POST /api/print-jobs/test`, só OWNER) → deve sair "TESTE DE IMPRESSÃO" (o cliente imprime o tíquete próprio, sem valor nem pagamento).
6. Fazer **1 pedido de teste** da loja: sai 1 vez; no painel aparece impresso; o job fica `PRINTED`. Se a loja usa cupom de 100%, fazer 1 pedido com ele: deve sair "SEM COBRANÇA: NADA A COBRAR".
7. **Provocar a falta de impressora (teste do alerta, obrigatório):** com a loja em `QUEUE`, criar 1 pedido e **fechar o app de impressão no PC** (ou desligar a impressora) com o pedido `PENDING`; o painel do dono deve mostrar o alerta **`QUEUE_WITHOUT_PRINTER` em até 5 min** ("precisa de atenção"). Depois reabrir o app: o pedido sai 1 vez e o alerta some. Se o alerta **não** aparecer, **não ligar a loja** e voltar ao legado (§4).
8. Observar 30 min com movimento real: nenhum "pedido sem imprimir" preso, nenhum tíquete repetido, `attempts` ≤ 1, nenhum aviso "Não consigo confirmar o modo" na tela.

### Sinais para voltar (qualquer um)
Tíquete repetido; pedido sem sair por mais de 2 min com a impressora ok; job `FAILED` definitivo sem causa de hardware; erro de chave inesperado; aviso "Não consigo confirmar o modo de impressão da loja" que não some.

## 4. Como voltar (recuo)
1. O dono muda a loja para `LEGACY` no painel (sem ir ao PC). A API roda a reconciliação do recuo (§1) e as impressoras voltam ao legado no ciclo seguinte.
2. **Se a API responder `409 PRINT_IN_PROGRESS`** ("Há impressão em andamento. Tente em instantes."): há um job reclamado com lease vigente; **esperar até ~2 min** (a lease é de 120 s) e tentar de novo. Isso é o recuo de emergência: avisar no runbook que ele pode demorar até 2 min se um cliente cair com job reclamado.
3. Conferir a 3ª consulta da §1 (= 0). Se não for, **não reabra o legado** (ele reimprimiria) até corrigir `printedAt` desses pedidos.
4. Um `/printed` legado **tardio** de pedido cujo job ninguém reclamou é aceito em `QUEUE` (200, fecha o job e grava `printedAt` na mesma transação), para a fila não reimprimir; com job reclamado por outra impressora continua `409 MODE_QUEUE`.

## 5. O que este plano não cobre
- Impressora e driver reais, tela WinForms, instalador em máquina limpa (CL-15, decisão do Claudio; só antes do piloto, `roteiro-instalador-maquina-limpa.md`), chave de release real (adiada, CL-10).
- Lease vencida com impressão lenta e revogação de chave com job em curso, **contra a API real**.
- O limite de 10 trocas/min, as corridas claim×recuo e a auditoria da reconciliação sem troca: provados pelos testes da API (Turing/Deming), não por mim ao vivo.
- Observação O1 do Deming: o recuo local de falha é global, então um tíquete que quebra segura os outros por ~1 min.
- Limite do cinto de segurança: ele só protege pedidos que este **mesmo PC** imprimiu pelo legado; a proteção entre PCs diferentes é a reconciliação do servidor.
