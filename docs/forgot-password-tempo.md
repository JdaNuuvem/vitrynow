# Esqueci a senha: o piso de tempo e a suposição "banco na mesma rede" (SEC-28b, ST-64)

`POST /auth/forgot-password` responde sempre `200 {ok:true}` e sempre depois de **no mínimo `FORGOT_MIN_DURATION_MS` (350 ms)**, para que a resposta não revele por tempo se o e-mail tem conta (ST-57).

## O que iguala os caminhos

Conta existente, inexistente, no intervalo de 60 s e com a cota esgotada executam **a mesma sequência de idas ao banco**: consulta do usuário, e na transação `lock → leitura da última hora → invalidação → inserção`. Quando não pode emitir, a invalidação não casa linha e a inserção grava zero (`WHERE false`). O teste `forgot-password-sec28b.test.ts` compara a sequência dos quatro caminhos.

O envio do e-mail **não** é esperado (o provedor leva centenas de ms e variaria por conta).

## Suposição que o piso faz (precisa continuar verdadeira)

> O banco está **na mesma rede** da API (latência de ida e volta de poucos ms, p99 do caminho mais lento abaixo de ~150 ms).

O piso só esconde a diferença entre caminhos enquanto o caminho mais lento cabe nele. Se a API e o banco passarem a ficar em hosts ou regiões diferentes, ou o banco ficar sob carga:

1. Medir o p99 do caminho "conta existente que emite" (a resposta sem piso) com `padToMinimum` desligado, num ambiente com a mesma topologia.
2. Subir `FORGOT_MIN_DURATION_MS` para pelo menos **2× esse p99**, nunca abaixo do p99 + 100 ms.
3. Acompanhar: se a resposta passar do piso (resposta > 350 ms) com frequência, o piso está curto e o tempo volta a revelar a conta. Alerta sugerido: p95 de `POST /auth/forgot-password` acima do piso.

O mesmo vale para `RESET_FAIL_MIN_DURATION_MS` (300 ms) na redefinição.

## Limites aceitos

- Os limites por conta (3 enviados/h, 60 s, teto de 8 tentativas/h) estão no banco e valem entre instâncias; o limite por IP (5/min) é em memória por instância.
- Pedido cujo envio falhou fica marcado (`sendFailedAt`) e não gasta a cota de 3/h nem o intervalo de 60 s; o teto de 8 tentativas/h impede que isso vire metralhadora contra o provedor.
- Ao emitir um token novo, os anteriores morrem. Se o envio do novo falhar, o link anterior (já entregue) não volta a valer: a pessoa pede de novo.
