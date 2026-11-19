# Plano de evolução do frontend do VitryNow

> Atualização de escopo em 18/11/2026: o [plano de rebrand para restaurantes](rebrand/PLANO-REBRAND-RESTAURANTES.md) amplia este roteiro com as quatro referências visuais, a base `Dashboard - Front`, ícones, animações mobile e gráficos administrativos. Ele orienta as próximas entregas; a primeira etapa registrada em `EXECUCAO-FRONTEND.md` permanece como histórico de implementação.

Priorizar o cardápio público com fotografia de comida, banners úteis e uma interface elegante para restaurantes e bares. A direção proposta combina superfícies claras, tipografia precisa, cores da loja e controles translúcidos discretos. A primeira entrega deve melhorar a apresentação e a navegação sem alterar o pedido ou seus valores.

O trabalho fica em `apps/web`. API, banco, migrações, pagamentos e cliente de impressão permanecem fora do escopo. Esta análise corresponde à leitura do código; a aparência atual ainda precisa ser conferida no navegador. Não houve instalação de dependências nem execução de testes nesta etapa de planejamento.

## O que já existe

| Área | Base atual | Como aproveitar |
| --- | --- | --- |
| Cardápio público | `features/loja/LojaPage.tsx` integra capa, identidade, categorias, busca, produtos, detalhe, carrinho, checkout e resultado do pedido. | Evoluir os componentes existentes por etapas, preservando estado, navegação e serviços. |
| Identidade da loja | `StoreHeader.tsx` usa capa, logo, nome, endereço, WhatsApp, condições e disponibilidade. Imagens quebradas têm alternativa visual. | Refinar hierarquia e enquadramento da capa; preservar as informações operacionais. |
| Navegação | `CategoryNav.tsx`, `BottomNav.tsx` e hooks usam marcadores de visibilidade e destaque de categoria. | Aplicar material translúcido às barras sobrepostas e conferir novamente offsets de rolagem após mudar alturas. |
| Tema público | `theme.ts` calcula contraste da cor da loja; `loja.css` define superfícies, cores e movimento. | Reutilizar o cálculo de contraste e ampliar os tokens sem fixar uma cor para todos os restaurantes. |
| Movimento | `motion.css`, `useReducedMotion` e testes dão suporte à preferência por menos movimento. | Usar transições curtas para orientação e resposta ao toque. |
| Componentes compartilhados | `shared/ui` oferece modal, confirmação, switch, dinheiro, senha e carregamento. | Preservar comportamento acessível e acrescentar variantes visuais quando necessário. |
| Painel | `DashboardShell.tsx` organiza navegação, loja, plano e serviços; as telas ficam em `features`. | Manter a arquitetura e harmonizar o visual depois do cardápio. |
| Personalização | `core/domain/store.ts` e `StoreSettingsCard.tsx` já permitem logo, capa e cor principal. | Melhorar a edição e mostrar uma prévia usando os campos existentes. |

O README está desatualizado em pontos relevantes: apresenta movimento, detalhe, carrinho e checkout novos como pendentes, embora os componentes e sua integração já existam. `CONTRIBUTING.md` também lista o CI como pendente, mas `.github/workflows/ci.yml` já contém um job web. A próxima etapa deve considerar o código e atualizar essas descrições no momento adequado.

## Direção visual proposta

A referência de [Apple Liquid Glass no Figma](https://www.figma.com/design/lczaraRCwrPdrMhObmQPal/Apple-Liquid-Glass-iOS-26---Control-Center-UI-Kit----Community-?node-id=8003-857) contribui com controles arredondados, hierarquia simples e translucidez clara. A orientação oficial da [Apple sobre materiais](https://developer.apple.com/design/human-interface-guidelines/materials) posiciona Liquid Glass em controles e navegação. No cardápio, isso se traduz em barras e ações flutuantes; a leitura dos produtos continua sobre superfícies estáveis.

A [proposta comercial no Figma](https://www.figma.com/design/aCkvV9xS9bj9PIgQ3qGIzy/-MODELO--PROPOSTA-COMERCIAL?node-id=0-1) acrescenta tipografia grande e condensada, tons quentes de laranja e terracota na capa, além de uma composição editorial escura e cartões fotográficos arredondados no portfólio. Aproveitar a hierarquia e a paleta como referência; os anúncios de outros setores presentes no arquivo não são conteúdo para o cardápio.

A síntese para o VitryNow é uma base neutra e refinada, com personalidade vinda da comida e da marca de cada estabelecimento. Terracota pode aparecer em uma demonstração ou campanha específica; não substitui a cor configurada da loja nem o verde padrão `#1f7a54`. Reutilizar a Jakarta local já disponível para títulos. Uma variante condensada, se necessária, fica reservada a títulos curtos de campanha. Preços, ingredientes e formulários usam a tipografia de leitura do produto.

Elementos a desenvolver:

- **Cabeçalho de restaurante:** capa bem enquadrada, logo e nome com presença, disponibilidade legível e acesso direto às informações da loja.
- **Banner principal:** fotografia do prato ou ambiente, título curto e uma ação contextual, como abrir uma categoria ou um produto existente.
- **Campanhas menores:** cartões para almoço, petiscos, sobremesas ou bebidas, conforme o catálogo real do estabelecimento.
- **Categorias e busca:** controles claros, com seleção evidente e translucidez apenas onde houver sobreposição.
- **Produtos:** fotografia consistente, descrição curta, preço fácil de localizar e ação de adicionar com contraste suficiente.
- **Carrinho:** ação persistente e total legível, com espaço suficiente para a navegação inferior e a área segura do celular.

## Banners com o contrato atual

A loja possui uma capa persistida em `coverImageUrl`. O contrato atual não oferece uma coleção de campanhas com título, imagem, destino, ordem e período de exibição.

Há duas entregas possíveis somente no frontend. A primeira é melhorar a capa usando o campo já existente. A segunda é acrescentar uma configuração estática de banners no código do frontend, opcional e identificada por loja. Essa configuração pode apontar para IDs reais de categorias ou produtos. Deve ocultar a ação se o destino não existir e manter o cardápio funcional quando não houver banner.

Um banner estático exige uma nova entrega de código para mudar a campanha. Não equivale a um gerenciador de campanhas. Edição pelo lojista, upload de arquivos, agendamento e persistência de múltiplos banners ficam para uma etapa futura com contrato próprio, fora do escopo atual de API e banco.

Os textos devem corresponder ao catálogo e às regras vigentes. Desconto, frete grátis, disponibilidade, tempo de entrega e popularidade só aparecem quando houver informação real que os sustente. O banner não altera preço nem aplica promoção por conta própria.

As fotos dos pratos e do ambiente são uma entrada de conteúdo a preparar com o restaurante. `apps/web/public` ainda não contém esse acervo. Definir imagens próprias ou com uso autorizado, ponto focal e enquadramentos que aceitem recorte no celular e no desktop.

## Entregas por prioridade

| Etapa | Alteração e caminhos principais | Critério de aceitação |
| --- | --- | --- |
| 1 | Tokens do cardápio, cabeçalho e primeiro banner em `features/loja/loja.css`, `theme.ts`, `components/StoreHeader.tsx`, `LojaPage.tsx` e novos arquivos locais de banner. | Identidade da loja preservada; banner opcional; CTA abre um destino real; estado fechado continua visível; layout utilizável de 360 px ao desktop; categorias e carrinho não ficam cobertos. |
| 2 | Refinar `ProductListItem.tsx`, `CategoryNav.tsx`, `BottomNav.tsx` e busca. | Imagens mantêm proporção; preço e ação são claros; teclado e foco funcionam; categoria ativa e retorno ao produto continuam corretos. |
| 3 | Harmonizar `ProductDetailScreen.tsx`, `CartDrawer.tsx` e `CheckoutDrawer.tsx`. | Quantidade, adicionais, observações, cupom, entrega ou retirada e totais mantêm o comportamento atual; estados de envio e erro são legíveis; fluxo de PIX permanece íntegro. |
| 4 | Melhorar a edição visual em `features/conta`, usando logo, capa e cor já existentes. | Prévia responde às alterações; imagem inválida apresenta orientação; formulário salva pelo serviço atual; não sugere upload ou publicação de campanha inexistentes. |
| 5 | Harmonizar shell, catálogo e demais telas em `features/shell`, `features/catalogo` e `shared/styles/panel-tokens.css`. | Cor da loja mantém contraste; catálogo distingue carregamento, erro e ausência de produtos; controles principais têm área de toque confortável; navegação mobile continua acessível. |

A primeira PR deve ficar concentrada na etapa 1. Ela estabelece a linguagem visual e permite revisar o resultado em um cardápio real antes de expandir o trabalho para checkout e painel.

## Regras para implementação e revisão

Preservar os gateways e serviços em `core`, os cálculos em centavos, a validação de adicionais e o fluxo de pedido. O frontend não deve afirmar pagamento aprovado, loja aberta ou promoção aplicada a partir de uma escolha visual. A informação operacional continua vindo do estado real já utilizado pelo app.

Reutilizar o contraste de `features/loja/theme.ts`, que hoje calcula a cor de texto de destaque contra branco. Se a superfície passar a ser creme ou outro tom, validar contra o fundo real ou manter branco nos locais que usam esse cálculo. O painel merece uma revisão equivalente: atualmente recebe `primaryColor` diretamente e há botões com texto branco sobre essa cor. Também convém ampliar a área de interação do `Switch`, cujo desenho atual mede 36 por 20 px, sem precisar aumentar o tamanho visual do controle.

O modal compartilhado já possui Escape, controle e retorno de foco, fundo inerte e bloqueio de rolagem. Novas superfícies devem preservar esses comportamentos. Banners não devem trocar automaticamente nem exigir movimento para revelar informações. O material translúcido precisa de uma superfície sólida de reserva para continuar legível sem `backdrop-filter`.

No catálogo, `useCatalogo.ts` retorna silenciosamente em uma falha de listagem diferente de 401. A revisão da tela deve oferecer mensagem e ação de tentar novamente, separando esse caso de um catálogo vazio. No cardápio, `features/loja/hooks/useMenu.ts` trata qualquer resposta sem sucesso como loja não encontrada; distinguir 404 de indisponibilidade temporária usando o status já fornecido pelo cliente HTTP. `lib/serverMenu.ts` já distingue esses estados no carregamento do servidor.

Conectar o `MenuSkeleton` já existente em `features/loja/components/Skeleton.tsx` ao carregamento de `LojaPage.tsx`, que hoje mostra apenas “Carregando...”. No detalhe do produto, aplicar o tratamento de imagem quebrada já usado pela lista e pelo cabeçalho; atualmente `ProductDetailScreen.tsx` só oferece alternativa quando a URL está vazia.

## Imagens e desempenho

As seguintes metas são propostas para a implementação e ainda precisam ser medidas no app:

- Reservar a proporção do banner e das fotos antes do carregamento para evitar saltos de layout.
- Preparar imagens AVIF ou WebP com tamanho adequado à largura exibida; estabelecer orçamento inicial de até 200 KB para o banner mobile e revisar o limite conforme a qualidade obtida.
- Priorizar somente a imagem principal visível; carregar imagens abaixo da primeira tela sob demanda.
- Manter texto e CTA em HTML, sem incorporá-los à fotografia, para permitir adaptação de tamanho e leitura assistiva.
- Evitar blur sobre listas inteiras, animações contínuas e novas dependências visuais quando CSS e componentes existentes resolverem a necessidade.
- Conferir carregamento em rede móvel, rolagem, redução de movimento e sobreposição de barras em celulares e desktop.

## Verificação de cada entrega

Executar `pnpm --filter @meucardapio/web run typecheck`, `pnpm --filter @meucardapio/web test` e `pnpm --filter @meucardapio/web run build` depois de preparar as dependências do projeto. O CI web existente também prepara os pacotes compartilhados necessários. Acrescentar testes de comportamento para destinos dos banners, sua ausência e qualquer lógica nova; alterações exclusivamente visuais exigem revisão no navegador.

Conferir cardápio com e sem capa, imagem quebrada, nome longo, cor clara e escura, loja fechada, catálogo vazio e categorias extensas. Percorrer adicionar produto, editar carrinho, finalizar pedido e consultar seu resultado. Registrar a largura de tela e as limitações de verificação junto à PR, sem declarar aprovação visual a partir de leitura estática.

O próximo passo é implementar a primeira PR com tokens, cabeçalho e um banner opcional, mantendo os dados e serviços atuais. A arte deve valorizar o restaurante e funcionar com o conteúdo real disponível; os demais componentes seguem a mesma direção após essa primeira revisão.
