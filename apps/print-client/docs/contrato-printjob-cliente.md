# Contrato do PrintJob que o print-client consome (PC-03)

**CONFIRMADO pelo Atlas no ADR-0004 §8** (2026-11-16), em resposta às perguntas do Ritchie. Este arquivo descreve o que o **cliente** implementa e testa; a fonte do contrato é o ADR-0004 §2, §5, §6, §7 e §8.
Diferenças em relação à minha proposta inicial: lease padrão **120 s** (relativo, relógio do banco); a API **só emite `200 {"job":null}`** para fila vazia (o cliente tolera `204`); `TEST` **leva `ticket`**
(o cliente também imprime um tíquete de teste próprio se faltar); `FAILED` devolve o job a `PENDING` com `availableAt` (recuo 15 s, 60 s, 5 min) e o `claim` **só devolve jobs com `availableAt <= agora`**; o
mesmo token com lease válida recebe **o mesmo job sem incrementar `attempt`**; `attempts` máximo **3**. O modo novo só liga com `UsePrintJobs: true` no `settings.json` (padrão: `/api/device/orders/pending`).
A tabela de casos do contrato está executável em `SelfTestJobs.ContractTable` sobre o `FakeApi` (Turing: reaproveitar na API-12).

## Autenticação
`Authorization: Bearer mcd_<id>_<segredo>` (um token por impressora, D4-2), igual ao modo atual. 401/403 seguem a regra do PC-05 (3 recusas em 2 min pausam; 4401 no WS pausa na hora).

## `POST /api/device/print-jobs/claim`  (corpo `{}`)
Entrega o PRÓXIMO job pendente da loja **com lease** (o servidor decide; o cliente obedece). Um job por chamada.

| Situação | Resposta que o cliente aceita |
|---|---|
| há job | `200` `{"job": { "id": "<cuid>", "kind": "ORDER_KITCHEN" \| "ORDER_REPRINT" \| "ORDER_CANCEL_NOTICE" \| "TEST", "attempt": 1, "leaseSeconds": 60, "ticket": { ...payload do §6... } }}` |
| fila vazia | `200` `{"job": null}` **ou** `204` sem corpo |
| sem permissão | `401`/`403` |

- `ticket` é o payload do tíquete do ADR-0004 §6 (os mesmos campos de hoje + `paymentStatus`, `tableLabel`, `changeForCents`, `subtotalCents`, `discountCents`, `couponCode`,
  `reprintCount`, `printedAtOriginal`, `cancelNotice`, `ticketSchemaVersion`). **Sem** token, QR, e-mail ou id do provedor de pagamento. Em `kind: "TEST"` o `ticket` pode faltar. **No `TEST` o cliente imprime o PRÓPRIO tíquete de teste ("TESTE DE IMPRESSÃO") e ignora todo campo de pedido do servidor** (valor, pagamento, itens, nome, telefone, endereço, observação); só o nome da loja é aproveitado (ADR-0004 §8 itens 10-11). A regra fail-safe "COBRAR NO CAIXA sem prova de pagamento" vale só para pedidos reais.
- `leaseSeconds` é **relativo** (o cliente não confia no relógio do PC): o cliente começa a contar quando recebe a resposta. Ausente = 60.
- Kind desconhecido (ex.: `TAB_BILL`, que é do PC-08) ⇒ o cliente responde `FAILED` com "tipo não suportado" e não imprime.

## `POST /api/device/print-jobs/:id/ack`
Corpo: `{"status":"PRINTED"}` ou `{"status":"FAILED","code":"<CÓDIGO>","error":"<frase fixa nossa>"}`.

**O que sai do computador da loja no `FAILED` é só um CÓDIGO de lista fechada e uma frase fixa em português** (ADR-0004 §8 item 8, parecer da Nightingale): `PRINTER_OFFLINE` ("impressora offline"),
`NO_PAPER` ("impressora sem papel"), `DRIVER_ERROR` ("erro do driver da impressora"), `PRINTER_NOT_FOUND` ("impressora não encontrada"), `OTHER` ("falha na impressão"). A mensagem da exceção (do .NET,
do driver, do spooler) pode trazer o nome da impressora ou do compartilhamento (por exemplo, um caminho de rede como `\\SERVIDOR\HP-Joao`), caminho ou usuário do Windows e **nunca** é enviada: fica só no log local. Código fora da lista vira
`OTHER`; o tipo de job desconhecido recebido do servidor **não** é ecoado de volta. O servidor (API-12) deve tratar `error` como **não confiável** (sanitizar C0/C1/bidi, nunca interpolar em log/HTML/WhatsApp) e
mostrar ao dono a frase traduzida do `code`.

| Resposta | O que o cliente faz |
|---|---|
| `200` | confirmado; fim (ack repetido do mesmo dono também é `200`, sem efeito) |
| `409` | lease vencida ou o job não é mais deste token: **não repete**; se já imprimiu, avisa que o pedido pode sair de novo em outra impressora |
| `404` | o job não existe mais: não repete |
| `401`/`403` | regra de chave recusada do PC-05 |
| outro / rede | `PRINTED` fica **pendente em disco** (`printed.json`) e é repetido a cada ciclo; `FAILED` é de melhor esforço (se não chegar, a lease vence e o servidor recoloca na fila) |

## Regras do cliente (testadas em `SelfTestJobs.cs`)
- **Um job por vez:** só pede o próximo depois de resolver o atual (imprimiu, falhou ou venceu a lease); no máximo 20 jobs por ciclo. Evita lease vencendo na fila local.
- **Não reclama (`claim`) enquanto há job em impressão nem enquanto há job em recuo de falha.** Reclamar um job que o cliente não vai imprimir já o seguraria pela lease inteira e
  bloquearia as outras impressoras (e, se a impressão passa da lease, reclamaria o mesmo job de novo). Durante o recuo o job fica `PENDING` no servidor para outra impressora pegar.
  Limite conhecido: um job que falha sempre pausa o `claim` desta impressora só durante o recuo local (15 s … 5 min), e o `availableAt` do servidor impede que ele trave as outras impressoras ou a fila; com `attempts` máximo 3 ele vira `FAILED` definitivo.
- **Dedupe local por `job:<id>`** (não por pedido: original e 2ª via do mesmo pedido são jobs diferentes e saem os dois). Job já impresso localmente que o servidor oferece de novo
  (ack perdido, lease vencida) **não reimprime**: só reenvia `PRINTED`.
- **Falha de impressão:** `FAILED` com o motivo + indicador "sem imprimir" + recuo local (15 s … 5 min). O servidor conta `attempts` e, ao estourar, alerta o painel.
- **Falha local esquecida:** se o servidor deixar de oferecer o job por 30 min, o indicador "sem imprimir" daquele job some (o aviso passa a ser o do painel).
- **Reimpressão (`ORDER_REPRINT`):** imprime com "2ª VIA (n)" (`reprintCount`) e "1ª impressão: …" (`printedAtOriginal`). **Cancelamento:** o job `ORDER_CANCEL_NOTICE` (emitido pela API-12 quando o pedido já tinha sido impresso) imprime só o aviso "CANCELADO / NÃO PREPARAR"; o **tipo do job** manda (o cliente liga `cancelNotice` mesmo que o servidor esqueça), e `cancelNotice: true` num job de outro tipo também imprime só o aviso. Não toca o alarme de "novo pedido". *Achado da conferência cruzada com a API-12 real (PC-03c): antes o cliente recusava esse tipo e a cozinha nunca saberia do cancelamento.*
- **Alerta sonoro** só para `ORDER_KITCHEN` novo.

## Modo da loja: LEGACY × QUEUE (PC-18, ADR-0004 §8 itens 12-13)
Quem decide como imprimir é o **servidor, por loja** (`Store.printMode`, padrão `LEGACY`; só o OWNER altera). O cliente não decide nada: segue o servidor a cada ciclo.

| Situação | Resposta do servidor | O que o cliente faz |
|---|---|---|
| Loja em `LEGACY` | `claim` → `{"job":null,"mode":"LEGACY"}` (nunca entrega job); endpoint legado funciona | usa `/api/device/orders/pending` e `/printed` |
| Loja em `QUEUE` | `claim` normal, com `"mode":"QUEUE"`; endpoint legado → `409` com `code: "MODE_QUEUE"` | usa `claim`/`ack`; o `409` do legado não conta como chave recusada nem como erro |
| `mode` ausente (API antiga) ou valor desconhecido | — | ignora: nada muda |

- **Ponto de partida:** `UsePrintJobs` do `settings.json` é só um interruptor de desenvolvimento (padrão `false` = começa no legado). Depois do primeiro ciclo quem manda é o servidor: o legado descobre a fila pelo `409 MODE_QUEUE`; a fila descobre o legado pelo `mode:"LEGACY"` do `claim`.
- **Configuração do dispositivo (PC-22, achado da conferência cruzada com a API-12b real):** em `QUEUE` a lista legada `/api/device/orders/pending` vem **vazia com 200** (não `409`); só `printable` e `/printed` dão `409 MODE_QUEUE`. Um cliente que começa no legado (o padrão) nunca descobriria a fila olhando a lista vazia. Por isso, no modo legado, o cliente lê **`GET /api/device/config` → `{"mode":"LEGACY"|"QUEUE"}` a cada ciclo** (a fila já recebe o `mode` no `claim`). `404` (API antiga, deploy, proxy ou rollback) **suprime a pergunta por 10 min** e depois volta a perguntar (não desliga para sempre: senão uma loja virada para a fila ficaria sem tíquete e sem sinal); **falhas SEGUIDAS** (rede, 5xx, lixo, corpo vazio; 5 ciclos) mostram "Não consigo confirmar o modo de impressão da loja" **uma vez, sem trocar o modo**, e limpam ao voltar a responder ("confirmado novamente"); `mode` desconhecido é ignorado; `401/403` seguem a regra de chave recusada. O `409 MODE_QUEUE` dos endpoints do pedido continua valendo como cinto. A API-12b também devolve o modo no **corpo** do `/api/device/orders/pending` (`{orders, mode}`; formato `{orders}` antigo continua aceito): o cliente troca para a fila **no próprio ciclo**, sem requisição extra. **Fonte do modo = o `mode` do CORPO** (claim, `/pending`, `/config`); o cabeçalho `X-Print-Mode` é só dica e o cliente **não o lê** (numa troca no mesmo instante os dois podem divergir por milissegundos).
- **Nunca mistura os dois modos** (a virada acontece com impressão em andamento):
  - não pede job enquanto há pedido legado **em impressão** (a impressão em andamento não pode ser reclamada como job);
  - **aviso pendente nunca bloqueia o outro modo** (um aviso recusado para sempre congelaria a loja): a proteção é o registro de "impresso" dos dois lados, abaixo;
  - ack legado respondido com `409 MODE_QUEUE` **encerra** (não repete) e muda para a fila; o registro de "impresso" fica;
  - o `409` só vale com **`code == "MODE_QUEUE"` no JSON** (leitura de no máximo 4 KB): a palavra no texto, outro `code` ou corpo que não é objeto **não** trocam o modo.
- **Cinto de segurança nos dois sentidos (R1b):** (1) job `ORDER_KITCHEN` de um pedido que **este PC já imprimiu no legado** não reimprime: o cliente só envia `PRINTED`; (2) o legado **pula o pedido que um job deste PC imprimiu ou está imprimindo** (o ledger guarda o `orderId` do job), mesmo com o aviso do job pendente. Vale só para o tíquete original (2ª via e aviso de cancelamento sempre imprimem).
- **Aviso do job recusado de vez** (4xx exceto 408/429; 404 e 409 já encerravam): encerra, avisa na tela e não repete. Job já impresso que o servidor **reoferece** (o mesmo dono recebe o mesmo job enquanto a lease vale) reenvia o aviso **uma vez por ciclo** e para o laço (antes pedia o job de novo até 20 vezes por ciclo).
- **Se um job chegar em `LEGACY`** (servidor fora do contrato), o cliente **não imprime** (o legado cuidaria do mesmo pedido).
- Teste executável: `SelfTestJobs.ModeFollowsServer` (M1–M12) sobre o `FakeApi` com `PrintMode`; o plano de virada fica em `docs\plano-virada-printjobs.md`.

## `nothingToCharge` (API-66, ticketSchemaVersion 3)
O servidor diz se **não há nada a cobrar** (`totalCents == 0` E nenhuma cobrança possível: sem Payment, ou Payment morto REJEITADO/EXPIRADO/CANCELADO). Campo opcional; em pedido real nunca sai ausente; aviso de cancelamento e tíquete de teste saem `false`.
| Campo | Total | O cliente imprime |
|---|---|---|
| `false` | qualquer | **regra normal (cobra)**, mesmo com a aritmética local dando zero (há pagamento vivo) |
| `true` | PRESENTE e 0 | "SEM COBRANÇA: NADA A COBRAR" |
| `true` | ≠ 0 ou AUSENTE | **regra normal (cobra)** + AVISO no log (servidor incoerente) |
| PRESENTE e **não booleano** (`1`, `0`, `"true"`, `"false"`, `"lixo"`, lista, objeto) | qualquer | **regra normal (cobra)** + AVISO no log ("o campo nothingToCharge chegou com valor que nao e booleano"); dado corrompido, não é campo ausente: a aritmética NÃO decide; o valor não é coagido nem derruba a leitura do tíquete |
| ausente/`null` (API antiga) | — | aritmética do PC-19: total PRESENTE e 0, desconto = itens, sem taxa/gorjeta, subtotal batendo |


## Alerta central (PC-24, `POST /api/device/alerts`)
Os avisos que antes só existiam no log e na tela do PC da loja também vão ao servidor, para o dono e o suporte verem no painel. **Telemetria não confiável: nunca decide nada** (não troca de modo, não libera cobrança).
- **Corpo estrito:** `{ "code": "<da lista>", "orderId": "<cuid, opcional>", "clientVersion": "1.0.0" }`; nenhuma chave a mais; menos de 200 bytes. **Sem texto livre e sem PII** (nem nome, telefone, endereço, itens, loja ou valores); hora e loja vêm do servidor. `Authorization: Bearer <chave da impressora>`.
- **Lista FECHADA de 5 códigos:** `NOTHING_TO_CHARGE_CONFLICT`, `NOTHING_TO_CHARGE_INVALID`, `EMPTY_ZERO_TICKET`, `MODE_UNCONFIRMED`, `MODE_RECOVERED`. `QUEUE_WITHOUT_PRINTER` é só do detector do **servidor** e nunca sai do cliente (o servidor responde 400 se vier).
- **`orderId`** só vai se casar **localmente** com `^c[a-z0-9]{24}$` (≤ 30); senão o alerta sai sem ele (no modo fila vai o id REAL do pedido, nunca a chave `job:<id>`). O servidor responde o mesmo `204` com id da loja, de outra loja ou inexistente; o cliente **nunca lê o corpo da resposta**.
- **Quando sai:** tíquete com `nothingToCharge=true` mas total ≠ 0 ou ausente (CONFLICT); campo `nothingToCharge` não booleano (INVALID); tíquete sem itens e total zero (EMPTY_ZERO_TICKET); 5 falhas seguidas da configuração do dispositivo (MODE_UNCONFIRMED, **uma vez** até recuperar); a configuração voltou a responder (MODE_RECOVERED, só depois de um MODE_UNCONFIRMED enviado).
- **Nunca atrapalha:** envio em segundo plano, timeout de 3 s, no máximo 5 em voo (a rajada excedente é descartada), **dedupe de 10 min** por (código, pedido); falha de rede ou 5xx/429 **descartada** (sem fila em disco); `404` (API sem a rota) suprime os alertas por 10 min; `401/403` seguem a regra de chave recusada; chave pausada não envia. Aviso de cancelamento e tíquete de teste não geram alerta.
- **Alertas de modo que se perdem são reenviados (PC-24d).** `MODE_UNCONFIRMED` e `MODE_RECOVERED` descrevem um ESTADO: se o envio falhar (rede, timeout de 3 s, 5xx, 404, 401/403), o cliente desfaz a marca "já enviei" e tenta de novo na próxima falha/resposta da configuração, com intervalo mínimo de 60 s entre tentativas; depois de entregue (2xx) não repete. Os outros códigos (dinheiro, tíquete) seguem em melhor esforço, sem reenvio, com dedupe de 10 min.
- **(PC-24e) `live-check.ps1 -AlertOrderIds`** usa a chave de impressora passada em `-Token`, que fica na linha de comando e no histórico do shell: só chave de TESTE de banco descartável de DEV (prefira `PC_LIVE_TOKEN` ou o prompt). Resposta 400/422 do servidor é descarte definitivo (contrato desencontrado), não é reenviada. Suporte: o reenvio dos alertas de modo vive só na memória do app; se o app fechar com um `MODE_RECOVERED` ainda não entregue, o painel mantém o aviso "modo sem confirmar" até a janela do servidor vencer (não é defeito do PC da loja).
