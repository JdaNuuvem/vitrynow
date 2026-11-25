# Evidências do planejamento

Status em 18/11/2026: planejamento e conceito demonstrativo, sem alterações no código de `apps/web` nesta etapa.

Foram inspecionadas as quatro imagens locais fornecidas pelo usuário, a base `Dashboard - Front`, o cardápio atual, o shell, a visão geral, os componentes de gráficos, os contratos frontend e as fontes API dos indicadores. Duas auditorias independentes produziram os anexos de adaptação e dados. A direção terracota/creme com verde positivo foi confirmada pelo usuário.

Uma revisão adicional com `gpt-6.2-astra`, esforço `ultra`, levou a quatro detalhamentos: ranking sem associação de foto por nome; adaptador de gráfico preservando data completa/contagem/valor; contraste calculado contra a superfície real, respeitando o limite atual de `accentInk`; disponibilidade baseada em `acceptingOrders` e distinção entre pedidos pendentes e em andamento. Também foi alinhada a duração proposta dos gráficos entre os documentos.

Verificações executadas nos artefatos:

- JSON dos tokens válido.
- JavaScript do conceito analisado sem erro de sintaxe.
- 44 IDs HTML únicos e referências internas conferidas pelo autor do conceito.
- Links locais dos documentos existentes.
- Contraste estático de quatro pares propostos: marca/branco 5,32:1; tinta/creme 13,72:1; secundário/creme 5,05:1; positivo/branco 5,29:1. Isso não aprova todos os estados ou cores da interface.
- Servidor local respondeu HTTP 200 para o conceito; rota fora da lista de artefatos respondeu 404.

Não houve revisão renderizada do conceito em navegador nesta etapa. Não foram executados testes, typecheck, build ou medições de performance do aplicativo por se tratar de planejamento. O conceito não fornece pedido, pagamento ou métricas reais, e a animação demonstrativa não comprova desempenho em aparelho móvel.

As metas de desempenho, a biblioteca de ícones, os breakpoints, os recortes de fotografia e os valores exatos dos tokens são decisões propostas para implementação e validação. A cor escolhida pelo usuário não equivale a aprovação de todas as telas ou do plano completo.

## Atualização com os designs finais

Os arquivos locais `.fig` permitiram inspecionar a estrutura dos dois kits. Nesta revisão, o conector abriu e forneceu metadados do Ramenku. As consultas de detalhe atingiram a cota Starter. O [inventário de referências](REFERENCIAS-FIGMA.md) registra os nós, as medidas, os ativos e a origem de cada evidência.

| Fonte | Resultado da revisão | Aplicação no piloto |
| --- | --- | --- |
| CloudPOS | O link enviado seleciona a instância `21258:35520` dentro de `Create New Order`. A dashboard preenchida `19013:3328`, a vazia `21099:32043` e a variante expandida de notificações `22966:86723` medem 1194 × 834 px. | O cabeçalho de 1194 × 92 px, quatro KPIs de 204 × 128 px, duas listas de pedidos e lateral de 282 px orientam a tela administrativa. A série temporal fica como extensão do VitryNow. [Dashboard preenchida](https://www.figma.com/design/qXP8K5VUx9Ue95KQ7ySYjv/CloudPos---Point-of-Sale-UI-KIT?node-id=19013-3328). |
| Ramenku | O arquivo tem páginas Light `1:3` e Dark `14584:33316`. Home Menu `16024:11488` e Home Banner `16262:16266` fornecem referências mobile de 390 × 844 px. | O piloto público usa os frames para a lista do cardápio e a apresentação da campanha. Nome, catálogo, disponibilidade e preços vêm da loja. [Home Menu](https://www.figma.com/design/PCa69ifTSUxaqn64frvQZ0/Ramenku?node-id=16024-11488) e [Home Banner](https://www.figma.com/design/PCa69ifTSUxaqn64frvQZ0/Ramenku?node-id=16262-16266). |

A pasta `Dashboard - Front` continua como apoio técnico, e o conceito HTML documenta o estudo anterior. O aceite visual da implementação exige comparar as telas renderizadas com as referências selecionadas. A leitura de camadas e de imagens embutidas sustenta o planejamento. A comparação renderizada integral continua pendente.
