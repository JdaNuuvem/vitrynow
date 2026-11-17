# Plano de virada do `UsePrintJobs` (modo fila) — print-client × API-12

Hoje o cliente roda no modo **legado** (`/api/device/orders/pending` + `printed`) e o modo **fila** (`claim`/`ack`, ADR-0004) está pronto e conferido contra a API-12 real, mas **desligado** (`UsePrintJobs=false`).
Este plano diz o que precisa estar certo na API e na loja **antes** de ligar, como ligar e como voltar. Só DEV até a decisão do Claudio de abrir o piloto.

## 1. Duas lacunas de dados na virada (achado ao ler a API-12 na main `9c3c0d1`)

A API-12 cria um job `ORDER_KITCHEN` para **todo** pedido novo, mesmo enquanto a loja usa o modo legado. Isso cria dois buracos:

| # | Situação | Efeito ao ligar o modo fila | Origem |
|---|---|---|---|
| **R1** | Pedido que já existia e **ainda não imprimiu** quando o modo liga, sem job (criado antes da API-12) | **Nunca imprime** (não está na fila) | Ressalva R1 do Deming |
| **R1b** | Pedido **já impresso pelo modo legado**: `POST /api/device/orders/:id/printed` só grava `Order.printedAt` e **não fecha o `PrintJob`**, que fica `PENDING` | Ao ligar, a fila oferece **todos** esses jobs e o cliente **reimprime tudo** (duplicidade em massa na cozinha) | Achado novo (Ritchie, 17/11) |

O R1b é o mais perigoso (papel sobrando na cozinha de uma vez, no primeiro minuto do modo novo). O cliente não tem como saber: o job é válido e pendente para ele.

### O que pedir à API (Turing) — não é código do cliente
1. **Fechar o job no ack legado:** `POST /api/device/orders/:id/printed` deve, na mesma transação do `printedAt`, passar o `PrintJob ORDER_KITCHEN` pendente desse pedido para `PRINTED` (marca de origem legado, a critério do Turing). Assim o R1b deixa de ser criado daqui para a frente.
2. **Comando de reconciliação único para a virada de cada loja** (script versionado e testado, não SQL à mão em produção), idempotente, que faça duas coisas:
   - (R1b) fechar como `PRINTED` os jobs `PENDING` cujo pedido já tem `printedAt`;
   - (R1) criar o job `ORDER_KITCHEN` (mesmo `dedupeKey` do fluxo normal: `<orderId>:ORDER_KITCHEN`) dos pedidos imprimíveis sem job: `printedAt` nulo, não cancelado, não aguardando pagamento.
3. Teste de contrato dos dois itens (pedido impresso no legado não vira job pendente; pedido sem job ganha um e imprime uma vez).

### Consultas de conferência (só leitura; ambas devem dar **0** antes de ligar)
```sql
-- R1b: jobs que reimprimiriam pedido já impresso
select count(*) from "PrintJob" j join "Order" o on o.id = j."orderId"
 where j.kind = 'ORDER_KITCHEN' and j.status = 'PENDING' and o."printedAt" is not null;

-- R1: pedido imprimível sem job
select count(*) from "Order" o
 where o."printedAt" is null and o.status <> 'CANCELADO' and o."awaitingPayment" = false
   and not exists (select 1 from "PrintJob" j where j."orderId" = o.id and j.kind = 'ORDER_KITCHEN');
```

## 2. Quem liga e como (decisão pendente do Atlas)
Hoje `UsePrintJobs` é um campo do `settings.json` no PC da loja. Desvantagens: o lojista não deve editar JSON, a virada de uma loja com 2 impressoras não é atômica e o recuo exige ir ao PC.
**Recomendação:** o modo vir do **servidor, por loja** (por exemplo, um campo na resposta de uma chamada autenticada que o cliente já faz), com o `settings.json` só como trava de segurança (`UsePrintJobs=false` força legado). Assim todas as impressoras da loja trocam no mesmo ciclo, o recuo é do lado do servidor e não precisa mexer no PC. É um contrato novo (Atlas decide; eu implemento no cliente em pequena tarefa).

## 3. Passo a passo da virada de uma loja (fora do expediente)
Regra de ouro: **todas as impressoras da loja trocam juntas.** Um PC no legado e outro na fila disputam o mesmo pedido (legado lista `printedAt` nulo; fila imprime job): risco de duplicidade.

1. Pré-requisitos: pilha PC-13…PC-03c e API-12 na produção; itens 1–3 da §1 entregues; app atualizado em todos os PCs da loja; impressora e papel conferidos; Claudio autorizou a loja.
2. Esperar a lista do legado esvaziar (nenhum pedido pendente na faixa "sem imprimir").
3. Rodar a reconciliação (§1.2) e conferir as duas consultas (= 0).
4. Ligar o modo fila (§2). Reiniciar o app se for por `settings.json`.
5. Pedir o **job de teste** pelo painel (rota do dono, `POST /api/print-jobs/test`) → deve sair "TESTE DE IMPRESSÃO" (tíquete próprio, sem valor). O app **não tem** item "imprimir teste" no menu hoje; se o Claudio quiser testar a impressora sem depender do painel, é uma pequena tarefa nova (PC).
6. Fazer **1 pedido de teste** da loja → sai 1 vez; no painel o pedido aparece impresso; no banco o job fica `PRINTED`.
7. Observar 30 min com movimento real: nenhum "pedido sem imprimir" preso, nenhum tíquete repetido, `attempts` ≤ 1 nos jobs.

### Sinais para voltar (qualquer um)
Tíquete repetido; pedido sem sair por mais de 2 min com impressora ok; job `FAILED` definitivo sem causa de hardware; erro de chave inesperado.

## 4. Como voltar (recuo)
1. Desligar o modo fila (mesmo mecanismo do §2) em **todas** as impressoras da loja.
2. Antes de religar o legado, conferir que nenhum pedido impresso no modo fila ficou com `printedAt` nulo (o ack atualiza `printedAt` num 2º comando — ressalva R2 do Deming; se falhar, o legado **reimprimiria**):
```sql
select count(*) from "Order" o join "PrintJob" j on j."orderId" = o.id
 where j.kind = 'ORDER_KITCHEN' and j.status = 'PRINTED' and o."printedAt" is null;   -- deve ser 0
```
3. Se não for 0, corrigir `printedAt` desses pedidos pelo mesmo comando de reconciliação (a API deve oferecer o sentido inverso) e só então reabrir o legado.

## 5. O que este plano não cobre
Impressora e driver reais, tela WinForms, instalador em máquina limpa (aceite G3 com o Claudio: `roteiro-instalador-maquina-limpa.md`), chave de release real (adiada, CL-10), lease vencida com impressão lenta contra a API real, revogação de chave com job em curso e o limite global de recuo (observação O1 do Deming: um tíquete que quebra segura os outros por ~1 min).
