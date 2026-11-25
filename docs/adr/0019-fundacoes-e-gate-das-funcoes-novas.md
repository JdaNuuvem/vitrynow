# ADR-0019 — Fundações sem custo e GATE das funções novas (robô, IA, Reels, 3D, visão)

- Status: **Proposto** (Atlas, 19/11/2026), a aprovar pelo Claudio. Relacionados: ADR-0006 v2, 0011, 0015, 0016, 0017; partes do Hopper e da Nightingale em `documento interno do time

## Contexto
Robô de WhatsApp, IA de produtos, Reels, pratos/restaurante 3D e visão computacional têm custo variável (teto R$ 50–100 por loja por mês), risco de privacidade e infra própria. Hoje só existem fundações parciais: jobs no processo (ADR-0011), `AiCreditLedger`, `DoNotContact`, `message.outbox`, entitlements por plano, upload em disco (ADR-0017).

## ATUALIZAÇÃO 19/11 (decisão do Claudio)
- **Destravados:** organização/fundações sem custo; **Reels** (ADR-0021: vídeo ≤30 s em disco local); **IA de inserção automática de produtos** no DESENHO (ADR-0020: **sem** login de assinatura de consumidor; fase 1 importação assistida, fase 2 BYO chave).
- **Continuam travados:** pratos 3D, restaurante 3D, visão computacional, provedor pago nosso, IA de texto livre do robô (2ª etapa, nova aprovação, teto por loja), menu em 6 grupos e P-01..P-12 (proposta ao sócio).
- **Robô:** lança só com a Camada A (menu numerado e pedido guiado, sem IA); retenção do histórico 90 dias com limpeza automática, jurídico valida antes de ir ao ar.

## Decisão
1. **GATE:** nenhum código de função nova (robô, IA, Reels, 3D, visão) antes de o Claudio aprovar o desenho. Antes disso, só **fundações sem custo**, uma por PR, com provedor **Fake**.
2. **Uma fila:** tarefas assíncronas (`MediaJob`, `AiJob`, envio do robô) usam UM contrato de fila em Postgres (`SKIP LOCKED` + lease + recuo, como a fila de impressão), consumido por um contêiner `worker` separado da API. Sem broker novo. Os jobs periódicos atuais ficam onde estão.
3. **Um orçamento:** `AiBudget` reserva o gasto antes de chamar o provedor, acerta depois e **recusa ao atingir o teto da loja e da plataforma** (fail-closed), sobre o `AiCreditLedger` existente (não criar outro livro-razão).
4. **O robô não duplica regra:** chama os mesmos serviços de pedido (`buildOrderLines`, `orders.service`); intents fechadas; handoff humano sempre; opt-in e `DoNotContact`; texto transacional identificado como automático.
5. **Saída de IA é rascunho** aprovado pelo dono; nenhuma PII vai ao provedor; mídia é transcodificada em processo isolado e quarentena; visão só na borda e só metadados (ADR-0016) após parecer jurídico.
6. **Flag desligada por padrão**, por plano (entitlements) e por loja; nada aparece em tela ou material comercial antes de existir (regra do Ogilvy: "só prometer quando existir").
7. **Ordem:** fila + worker + alertas → AiBudget com Fake → robô com Fake → mídia → IA de produtos → Reels → 3D; visão por último.

## Consequências
Custo e risco ficam controlados por construção (teto e Fake). Contrapartida: o primeiro valor visível ao cliente (robô) só chega depois de três PRs de fundação. Preço do add-on só depois de custo **medido**. Medições pendentes: RAM/CPU da Evolution com 1/10/50 instâncias (só Fake), preço vigente dos provedores.
