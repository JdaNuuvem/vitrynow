# ADR-0020 — IA de inserção automática de produtos: sem login de assinatura; BYO chave em fases

- Status: **ACEITO pelo Claudio em 19/11/2026** (fases 1, 2 e 3 como propostas; sem provedor pago nosso; sem OAuth de assinatura do Claude). Proposto por Atlas + Nightingale. Insumo: documento interno do time (Nightingale). Atualiza o gate do ADR-0019 (IA de produtos destravada **no desenho**).

## Contexto
O Claudio pediu que a IA de produtos use **o login OAuth do administrador numa assinatura de IA dele** (ChatGPT ou Claude Code), sem chave nossa e sem custo para a plataforma. Os termos oficiais precisam permitir isso; **a validação foi feita por leitura de documentos públicos e deve ser reconfirmada antes de codar**.

## O que os termos dizem (leitura de 19/11/2026; reconfirmar)
- **Anthropic (Claude Free/Pro/Max):** a política do Claude Code proíbe usar tokens OAuth de planos de consumidor **em qualquer outro produto, ferramenta ou serviço**; um app de terceiro não pode oferecer login Claude.ai nem rotear pedidos por credenciais de plano nem guardar/intermediar esses tokens. ⇒ **NÃO é permitido** no nosso servidor. (Fonte oficial: página de conformidade do Claude Code; a cobertura de imprensa é secundária e há relatos conflitantes sobre datas.)
- **OpenAI (ChatGPT):** existe o OAuth oficial "Sign in with ChatGPT" com uso do plano, mas os termos vedam pooling/revenda do uso do plano ou de tokens e exigem token sob controle do usuário; app pago/hospedado precisa de aprovação da OpenAI. ⇒ **Não cabe hoje** num servidor multi-loja nosso. Acompanhar a lista de interesse (sem custo).
- **Suportado pelos dois:** o administrador cola a **própria chave de API** (BYO key); o custo é dele.

## Decisão
1. **Nenhum login de assinatura de consumidor** (Claude ou ChatGPT) entra no produto. Nenhuma conta real é conectada sem autorização do Claudio.
2. **Fase 1 (sem conta de IA, custo zero, sem risco de termos):** importação assistida: modelo de planilha/JSON + um *prompt-guia* para o dono usar na ferramenta que ele já assina; a plataforma só **valida o arquivo** e mostra a tela de **revisão e confirmação**; publicação pelo MESMO serviço de catálogo (`buildOrderLines`/catálogo), nunca por caminho próprio.
3. **Fase 2 (depois de aprovação):** BYO chave atrás de uma interface `AiProvider` com `FakeProvider` para teste; chave **cifrada AES-GCM com AAD** (padrão NG-11), só **OWNER com MFA recente**, escopo mínimo, **revogação apaga**, chave inválida para sem laço, tudo auditado sem expor a chave; **saída da IA = rascunho validado por esquema** que o dono revisa; sem PII ao provedor; teto de custo é do dono (chave dele), mas a plataforma limita requisições por loja.
4. **Fase 3 (opcional):** "Sign in with ChatGPT" se a OpenAI aprovar nosso caso; reavaliar os termos.

## Consequências
Custo zero e sem violar termos. Contrapartida: a experiência "conectar e pronto" só chega na fase 2 e exige que o dono tenha uma chave de API. **Decisão do Claudio:** aceitar a fase 1 como entrega inicial e a BYO chave como fase 2, ou pedir provedor barato nosso (gasto, fora do desenho atual).
