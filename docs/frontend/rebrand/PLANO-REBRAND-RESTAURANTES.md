# Rebrand do VitryNow para restaurantes

Atualização de 18/11/2026. Os pilotos CloudPOS e Ramenku estão implementados em `apps/web`. Este documento conserva as decisões e os critérios do plano. O registro de execução distingue o que foi verificado localmente do que depende do ambiente integrado. [Execução dos pilotos](EXECUCAO-DOS-PILOTOS.md)

As referências finais foram conferidas nos arquivos editáveis. O piloto administrativo parte da [dashboard preenchida do CloudPOS](https://www.figma.com/design/qXP8K5VUx9Ue95KQ7ySYjv/CloudPos---Point-of-Sale-UI-KIT?node-id=19013-3328). O piloto público parte do [cardápio](https://www.figma.com/design/PCa69ifTSUxaqn64frvQZ0/Ramenku?node-id=16024-11488) e do [banner do Ramenku](https://www.figma.com/design/PCa69ifTSUxaqn64frvQZ0/Ramenku?node-id=16262-16266). A matriz documenta os frames, as camadas de arte, os destinos no código e o aceite de cada fluxo. [Referências e matriz de implementação](REFERENCIAS-FIGMA.md)

## 1. Resultado desejado

Criar uma identidade reconhecível para a plataforma e uma experiência com personalidade para cada restaurante. O cliente deve reconhecer a comida, encontrar o que quer e comprar com facilidade. O operador deve enxergar pedidos, disponibilidade e caixa antes de procurar relatórios ou configurações.

A direção combina fotografia gastronômica, ícones consistentes, composição clara, superfícies quentes e movimento curto. O painel adotará os padrões visuais selecionados no CloudPOS; o cardápio e seus banners adotarão os do Ramenku. A implementação aproveita componentes existentes do VitryNow e, quando adequados, da pasta `Dashboard - Front`, preservando os serviços atuais.

Entregáveis do rebrand: sistema visual documentado; cardápio e checkout harmonizados; shell e páginas administrativas harmonizados; gráficos com dados reais e animação controlada; padrões de conteúdo, fotografia e campanhas; verificações funcionais, visuais e de desempenho.

Nome VitryNow mantido como nome de trabalho. Novo nome, desenho final de logotipo e posicionamento comercial definitivo não são decisões concluídas por este plano.

## 2. Leitura das referências fornecidas

O nó CloudPOS enviado (`21258:35520`) pertence ao fluxo de criação de pedido. A dashboard correta tem três estados claros de 1194 × 834: preenchida (`19013:3328`), vazia (`21099:32043`) e com notificações expandidas (`22966:86723`). O Ramenku fornece os frames de cardápio (`16024:11488`), campanha (`16262:16266`) e detalhe (`16091:14080`) em 390 × 844. As pranchas de apresentação dos dois arquivos confirmam a composição. A comparação com o aplicativo renderizado fica para os pilotos.

As quatro imagens do estudo inicial abaixo servem como histórico. Quando houver diferença de composição ou medida, aplicar a referência final correspondente.

| Referência | O que foi observado | Aplicação no VitryNow |
| --- | --- | --- |
| `original-8488f7773eaaffe6311f9e82e479edb0.png` | Banner fotográfico curto, categorias em círculos, cartões compactos e detalhe com foto dominante. | Dar protagonismo à comida, separar categorias de ações e organizar preço, quantidade e CTA. |
| `original-c6f98aa00e00ca2ba47f0c569ec9a7b7.png` | Carrinho em linhas, resumo de valores com total destacado e ação final previsível. | Compor carrinho e checkout com hierarquia estável e uma ação principal por etapa. |
| `original-83c080ea5c6067a8275d19acab584dd8.png` | Listas com ícones, divisórias discretas e menu lateral com identidade bem definida. | Organizar menus e avisos por prioridade, com SVGs consistentes e alvos confortáveis. |
| `original-dc1c1e821488973352f998acea599a4d.png` | Relação entre capa, categoria, produto e detalhe; laranja pontual e grandes áreas brancas. | Repetir linguagem entre descoberta e compra; adaptar a densidade ao celular real. |

O fundo pêssego, as sombras grandes e a moldura de telefone compõem a apresentação das imagens; não devem se tornar o fundo de todas as telas. As referências também mostram elementos que exigem produto e contrato próprios: favoritos, fidelidade, notificações pessoais, desconto automático e agendamento. Eles só entram quando houver suporte funcional.

## 3. Identidade e harmonia

### Marca da plataforma e marca do restaurante

Direção de cor escolhida pelo usuário: terracota e creme, com verde para estados positivos. O plano detalha essa escolha com branco e tinta escura para leitura. Os valores exatos dos tokens e sua aplicação ainda passam por revisão visual e de contraste.

O cardápio preserva `primaryColor`, logo, capa e nome de cada loja. O verde atual `#1f7a54` continua sendo o fallback do restaurante. A paleta da plataforma não sobrescreve os restaurantes. No painel, a identidade da plataforma organiza a interface e a marca da loja aparece no contexto da operação; o uso atual da cor da loja em ações deve ser migrado conscientemente, com contraste e consistência.

| Papel | Proposta | Uso |
| --- | --- | --- |
| Marca da plataforma | `#b7472a` | Ação principal, seleção e assinatura visual. |
| Fundo | `#f6f5f1` | Plano neutro do painel e áreas de respiro. |
| Superfície | `#ffffff` | Produtos, formulários, tabelas e valores. |
| Tinta | `#212920` | Títulos e conteúdo. |
| Texto secundário | `#636b62` | Apoio e metadados, sujeito a teste contra o fundo real. |
| Sucesso | `#1f7a54` | Confirmação e disponibilidade efetiva. |
| Atenção / erro | Tokens semânticos independentes | Acompanhados de texto e ícone; nunca dependentes da cor do restaurante. |

Tokens propostos em [design-tokens.proposed.json](design-tokens.proposed.json). Validar todos os pares de cor no código; uma tabela de cores não equivale a aprovação de contraste.

O helper atual `accentInk` calcula contraste somente contra branco. Na primeira migração, preços e links que o usam permanecem em superfície branca. Qualquer aplicação sobre creme ou outra superfície exige cálculo contra esse fundo real, com teste específico; reutilizar o helper intacto nesse caso não atende R1.

### Tipografia, espaçamento e forma

- No painel, o CloudPOS usa Open Sans, incluindo títulos semibold de 18 px e textos de 14 px. No cardápio e na campanha Ramenku, Urbanist aparece em títulos, descrições e botões. Usar essas famílias como alvo visual dos pilotos. Se a entrega usar Jakarta local como fallback, comparar quebra de linha, altura de controles e preço com a fonte de origem.
- Escala de espaço: 4, 8, 12, 16, 24, 32 e 48 px. Controles com pelo menos 44×44 px; ações principais com altura de 48 px.
- Usar as medidas do frame correspondente para o acabamento de cada componente. O KPI CloudPOS tem raio de 12 px. Os raios gerais do estudo anterior ficam como proposta para peças sem equivalente nos kits.
- Bordas leves para separar conteúdo; sombra em superfícies elevadas. Blur restrito a navegação sobreposta, com reserva opaca. Conteúdo e gráficos permanecem estáveis.
- Desktop com mais informação por linha, mantendo alinhamento e leitura. Mobile elimina redundância antes de reduzir a fonte.

### Voz e conteúdo

Português direto e operacional: “Recebendo pedidos”, “Pedidos aguardando ação”, “Ver carrinho”, “Salvar alterações”. Diferenciar total, subtotal, taxa, desconto e gorjeta. Explicar falhas com uma próxima ação possível. Evitar superlativos, urgência fabricada, avaliações, popularidade ou promoções sem fonte.

### Kit de identidade e pontos de contato

Planejar wordmark legível para VitryNow e um símbolo compacto, com duas propostas visuais antes da escolha final. Explorar a ideia de vitrine/cardápio e hospitalidade, evitando depender de um desenho gastronômico que represente apenas um tipo de restaurante. O símbolo da plataforma não ocupa o lugar do logo do estabelecimento.

Entregar versões principal, reduzida, monocromática e inversa; área de proteção, tamanho mínimo e usos inadequados; SVGs de origem documentada, PNGs e favicons. Definir uma assinatura discreta para o cardápio público. Aplicar o mesmo vocabulário a entrada/cadastro, login, recuperação de senha e onboarding, além dos estados de ajuda e busca do painel. E-mails e material de impressão recebem especificação de marca para uma integração futura, sem alterar API ou cliente de impressão nesta entrega de frontend.

## 4. Sistema de ícones

Adotar uma família profissional consistente para ações e navegação. Lucide React é a proposta do estudo anterior, sujeita à conferência dos ícones reais dos frames finais. Preservar os SVGs fornecidos pelo design quando forem os assets definidos para implementação; usar substitutos somente após decisão explícita de adaptação. Se Lucide for adotada, usar imports explícitos e wrapper tipado; a biblioteca oferece SVGs configuráveis e imports individuais. [Documentação oficial](https://lucide.dev/guide/react).

Evoluir `shared/icons/Icon.tsx` como adaptador para preservar os nomes semânticos das rotas. Migrar `features/loja/icons.tsx` para a mesma família por etapas. Grade de 24×24, traço de aproximadamente 1,75–2 px, tamanhos de 18/20/24 px e alinhamento óptico revisado. Não carregar um sprite com a coleção completa.

| Função | Direção do ícone |
| --- | --- |
| Início / pedidos / catálogo | Casa, recibo e utensílios. |
| Caixa / relatórios / entregadores | Carteira, gráfico e bicicleta/moto disponível na família. |
| Categorias gastronômicas | Pizza, sanduíche, salada, bebida, sobremesa ou utensílios como fallback. |
| Ações | Buscar, filtrar, adicionar, editar, excluir, voltar e compartilhar. |
| Estados | Relógio, confirmação, atenção, indisponibilidade e segurança. |

Categorias podem receber pictogramas próprios com duas cores e fundo suave, mantendo o nome visível. A foto representa o produto; o ícone ajuda a localizar o grupo. O contrato atual guarda `category.icon` como texto: planejar um adaptador local e overrides por ID, sem converter silenciosamente esse campo em slug de biblioteca. Se for necessário um seletor persistido de pictogramas, criar contrato próprio em uma entrega separada. Mapeamento por nome deve ter fallback neutro, sem adivinhar categorias ambíguas.

Ícones decorativos ficam ocultos de tecnologias assistivas; botões sem texto recebem nome acessível. Logos de marcas e pagamentos mantêm o arquivo e as condições de uso próprios. Preservar os avisos de licença dos recursos adotados. [Licença Lucide](https://lucide.dev/license).

## 5. Cardápio: disposição e composição

### Ordem na tela inicial

1. Identidade compacta: capa, logo, nome, disponibilidade e acesso às condições.
2. Busca com alvo confortável e rótulo claro.
3. Um banner principal opcional, curto e contextual.
4. Categorias com pictograma e nome; seleção visível.
5. Produtos organizados por categoria, com preço e ação consistentes.
6. Carrinho persistente quando houver itens, acima da navegação e da área segura.

Na Home Menu do Ramenku, a capa mede 390 × 200, a busca 350 × 46, a faixa de categorias 350 × 42 e o carrinho fixo 350 × 58. Usar esse frame como referência para a loja sem campanha. Para a variante com campanha, trazer a peça da Home Banner e medir a distância até o primeiro prato. A meta de aproximadamente 620 px em 390 × 844 é uma adaptação da Vitry para nomes curtos, a validar no piloto.

A ordem acima acomoda a campanha opcional do contrato atual. A Home Menu e a Home Banner são frames distintos. A experiência desktop é uma adaptação da composição mobile e requer comparação própria.

### Cabeçalho e banners

No piloto de 390 px, partir da capa de 390 × 200. Ela identifica o restaurante com sua imagem real. A campanha usa outra arte e um destino específico. Quando a loja não tiver campanha ativa, as categorias seguem a busca.

O banner de origem tem 350 × 188 e padding de 24 px. Ele combina fotografia recortada de 227 × 190 com título, descrição e botão independentes. Usar 350:188 como proporção inicial da peça mobile. Preservar a área da foto durante o carregamento, permitir que a altura cresça para textos longos e ampliar a área de toque do botão de 96 × 34 para pelo menos 44 px de altura.

Usar uma campanha por loja, com um único destino de categoria ou produto já suportado. Se o destino sair do catálogo, omitir o botão. A campanha “Birthday Treat” orienta o desenho da peça. A oferta, sua validade e qualquer desconto dependem dos dados do restaurante.

A configuração estática opcional já implementada em `banners.ts` continua como primeira fonte. A edição visual pode evoluir depois, com campos para título, texto, imagem, ponto focal, destino, ordem e período de exibição; isso exige contrato e persistência adicionais. Não apresentar essa gestão como pronta.

### Categorias, produtos e detalhe

- Categorias: o frame usa controles em uma faixa de 350 × 42. Adaptar a área de toque para pelo menos 44 px de altura. Preservar rótulos, rolagem horizontal, foco e sincronização entre categoria selecionada e lista.
- Produtos: a Home Menu tem duas peças de 168 × 248, separadas por 14 px, em “Popular Now”, e linhas de 350 × 108 em “All Items”. A lista por categoria é a base do piloto. A grade exige uma seleção editorial real ou um ranking público identificado. Adaptar a 360 px e ampliar as colunas no desktop conforme a leitura de título e preço.
- Fotografia: preservar o enquadramento da listagem e usar o recorte quadrado do detalhe (390 × 390). O preço, o nome e a ação continuam disponíveis para produtos sem foto.
- Texto: título legível, descrição curta com acesso ao detalhe, preço em posição previsível. Botão adicionar com contraste, contador evidente e espaço próprio; preço não muda de posição ao adicionar.
- Detalhe: foto, título/preço, descrição, adicionais, observações e ação final. Quantidade e total ficam próximos da ação. A rolagem deve permitir revisar todos os adicionais antes do rodapé fixo.
- Preservar centavos, adicionais obrigatórios, retorno de foco, estado fechado e validações do servidor.

### Carrinho, checkout e resultado

Usar os estados Ramenku de carrinho vazio (`16185:27345`), carrinho preenchido (`16185:31533`), checkout (`16185:31804`) e confirmação (`16257:13719`). Reutilizar os componentes atuais para entrega ou retirada, contato, endereço, pagamento e resumo, com foco no total e na ação seguinte. Desktop pode distribuir o resumo em coluna lateral.

Erros próximos do campo e resumo de erros com foco apropriado. Envio não permite duplicação. Total final só muda pelas regras existentes. PIX diferencia aguardando, confirmado, expirado e falha; animação nunca representa confirmação de pagamento. O pedido pode ser explorado na prévia, mas dados de demonstração permanecem explicitamente identificados.

## 6. Painel administrativo baseado no CloudPOS

O piloto usa a dashboard clara preenchida do CloudPOS. As pranchas do kit confirmam o cabeçalho horizontal, os quatro KPIs, as duas filas e a coluna auxiliar. A pasta `Dashboard - Front` fornece componentes de apoio técnico listados abaixo. O domínio, o acesso e as ações continuam ligados ao VitryNow. [Adaptação da dashboard](ADAPTACAO-DASHBOARD.md)

| Parte da base | Resultado para restaurantes |
| --- | --- |
| Layout + Sidebar + Header | Shell mais limpo, loja identificada e acesso rápido à operação. |
| Card + Overview | KPIs concisos, título claro, período e fonte consistente. |
| ProductView + gráficos | Evolução dos pedidos, tipos e ranking real do cardápio. |
| Coluna complementar | Pedidos aguardando ação, situação da loja e caixa. |
| Componentes de tabela e filtros | Pedidos, catálogo, entregadores, equipe e relatórios. |

A pasta usa Next 15.2, React 19, Tailwind 4 e ESLint 9; `apps/web` usa Next 14, React 18, Tailwind 3 e ESLint 8. A adaptação deve traduzir composição e componentes para a stack atual. Upgrade de framework, se desejado, tem entrega própria. Não transportar `package.json`, globais ou providers do template como substituição integral.

### Navegação e hierarquia

Manter URLs e reorganizar apresentação em grupos: **Operação** (Início, Pedidos, Caixa), **Cardápio e vendas** (Produtos, Cupons, Relatórios), **Gestão** (Entregadores, Equipe, Impressoras), **Loja** (Minha loja, Plano, Auditoria conforme acesso). Busca e ajuda continuam acessíveis. Novos rótulos precisam apontar para recursos existentes.

No frame de 1194 × 834, o cabeçalho horizontal mede 1194 × 92. As colunas de conteúdo medem 864 e 282 px, com intervalo de 16 px. Adotar essa hierarquia na largura de referência. Aproveitar os destinos existentes do shell e usar navegação inferior no celular, com acesso por teclado ao menu completo.

As barras do sistema do tablet pertencem à apresentação do kit. No navegador, considerar apenas a área útil. Em 1440 px, distribuir o espaço adicional entre os blocos; em 768 e 360 px, recolher a navegação e empilhar as filas antes que nomes e ações fiquem truncados.

### Dashboard de restaurante

Perguntas que a primeira tela deve responder: a loja recebe pedidos? Há pedidos esperando ação? Como está o caixa? Qual o volume do período? Quais produtos e tipos de pedido mais contribuíram?

“Recebendo pedidos” vem de `store.acceptingOrders`, a mesma fonte usada no pedido público; horário em texto livre permanece informativo e não substitui pausa manual. Revisar `StoreHoursCard.tsx`, que hoje deduz “Aberto agora” pelo horário e fuso do aparelho. Entrega e retirada respeitam `deliveryEnabled` e `pickupEnabled`. Se a dashboard disser “Aguardando aceite”, a contagem corresponde a `PENDENTE`, não a todos os pedidos não finais de `selectCurrentOrders`; situações de pagamento/bloqueio aparecem separadas e ações seguem a API.

No tamanho de origem, manter os quatro cards de 204 × 128, duas filas operacionais de 424 × 472 e a coluna de atalhos. Usar indicadores que possam ser conferidos no período e estados de pagamento identificáveis. O gráfico temporal, o ranking e os tipos de pedido são extensões VitryNow e entram após a operação. Os avisos do plano e as comunicações comerciais mantêm seus próprios destinos.

Mobile: disponibilidade e pendências primeiro; pedidos com ação em seguida; KPIs em duas colunas se os valores couberem; caixa; gráfico e ranking depois. A tela atual esconde `CurrentOrdersCard` no celular: esse comportamento deve ser revisto na adaptação.

A preferência de ocultar valores deve valer também para tooltips, resumos, tabelas acessíveis e exports da própria interface que exibam a mesma informação. Ocultar visualmente não cria uma permissão: OWNER/STAFF continuam governados pelo backend. Não prometer indicadores exclusivos por plano ou papel sem o respectivo contrato.

### Demais telas administrativas

Pedidos: quadros e listas com status, idade, contato e ação principal; preservar transições permitidas, cancelamento, estorno, MFA e impressão. Mobile deve permitir operar sem arrastar cartões.

Catálogo: foto, nome, categoria, preço, disponibilidade e editar; filtro/busca, estados de carga/erro/vazio e foco após salvar. “Ocultar” e “Excluir” continuam distintos. Formulários organizados em grupos, com prévia de produto.

Caixa e relatórios: valores alinhados, período/sessão evidente, legenda de unidades e ações separadas de consulta. Equipe, entregadores, cupons e impressoras usam a mesma base de tabela, formulário e confirmação. Conta/personalização conecta identidade da loja a uma prévia mobile/desktop com os campos já existentes.

Tema claro é o primeiro alvo para validar legibilidade e a relação com as fotos. Tema escuro entra depois da equivalência dos componentes, com tokens próprios e verificação de gráficos, formulários e status. A existência de dark mode no template não comprova sua qualidade no produto.

## 7. Gráficos: valor real, movimento curto

Detalhes e contrato em [DADOS-E-GRAFICOS.md](DADOS-E-GRAFICOS.md). O app já tem `MonthChart.tsx` em SVG e relatório com série diária, tipos, ranking, ticket médio e valores em centavos.

| Bloco inicial | Representação | Fonte / cuidado |
| --- | --- | --- |
| Valor dos pedidos | Barras diárias; alternar para quantidade | `byDay`; não chamar receita líquida ou saldo recebido. |
| Pedidos / ticket médio | KPIs com período | Mesma seleção do relatório e definição visível. |
| Tipos de pedido | Barras horizontais ou distribuição com legenda | Delivery, mesa e balcão/retirada; zero total tem estado próprio. |
| Produtos mais vendidos | Ranking de até 10 itens | Quantidade e valor dos itens; pode diferir do total após desconto/taxa/gorjeta. |
| Operação | Lista e contadores | Campos de pedidos/caixa; fonte operacional separada de BI. |

Evoluir os SVGs existentes para os gráficos simples. Usar a base como referência de acabamento; introduzir Recharts no painel somente se os recursos exigirem e o experimento de compatibilidade/bundle justificar. A versão 2.15.1 presente no template declara compatibilidade com React 18, mas isso não define a versão a instalar no projeto. [Manifesto oficial dessa versão](https://raw.githubusercontent.com/recharts/recharts/v2.15.1/package.json).

Sem dados, mostrar vazio e explicação. Falha de API não vira zero. Dados antigos permanecem identificados com hora de atualização e opção de tentar novamente. Comparações exigem períodos equivalentes, fuso e intervalo final alinhados; denominador zero exibe “sem base de comparação”. Dias futuros não são desenhados como vendas zeradas.

Cada gráfico terá título, unidade, período, resumo textual e acesso aos valores em tabela/lista. Tooltip funciona com toque e teclado; cor não é o único identificador. Se Recharts for escolhido, configurar acessibilidade explicitamente conforme a versão. [Orientação oficial](https://github.com/recharts/recharts/wiki/Recharts-and-accessibility).

R5 deve substituir a redução atual da série a `{day, revenueCents}` por um adaptador que preserve a data completa, `orderCount`, `revenueCents` e lacunas. Isso permite alternar a unidade e atravessar meses sem perder identidade dos pontos. O ranking atual não devolve ID/foto de produto: começa textual, sem associar automaticamente ao catálogo por nome. Fotos ou links de edição dependem de identidade explícita no contrato.

## 8. Animações otimizadas

O objetivo do movimento é confirmar ação e preservar orientação. A informação final fica disponível sem esperar animação. Reutilizar `lib/motion.ts`, reduced motion e os tokens existentes; CSS é suficiente para a primeira versão das interações simples. Se uma composição exigir Motion, usar apenas `motion/react`, carregar o necessário e evitar duplicação com `framer-motion`, `react-animate-height` e outras bibliotecas do template. [Carregamento modular](https://motion.dev/docs/react-reduce-bundle-size).

| Interação | Proposta mobile | Desktop | Preferência por menos movimento |
| --- | --- | --- | --- |
| Pressionar botão / adicionar item | Escala discreta, 80–120 ms | Igual | Sem escala; estado final imediato. |
| Categoria e navegação ativa | Opacidade/cor, 120–160 ms | Até 180 ms | Atualização imediata ou fade de até 150 ms. |
| Abrir detalhe, carrinho ou menu | Transform/opacity, 180–240 ms | Até 280 ms | Sem deslocamento; fade breve opcional. |
| Surgimento de produtos | Uma vez; até 4 itens e 24 ms entre eles | Até 6 itens | Sem cascata. |
| Atualização de KPI | Valor final imediato, fade de até 120 ms | Igual | Imediato. |
| Barras do gráfico | `scaleY`, 240–320 ms, uma entrada | Até 450 ms | Geometria final estática. |
| Linha / distribuição | Fade de 160–200 ms | Até 240 ms | Estático. |
| Skeleton | Brilho leve apenas se necessário | Igual | Blocos estáticos; status fora da região ocupada. |

Proibir loops decorativos, parallax, autoplay de banner e repetição de entrada a cada refresh. Não animar largura, altura, margem, blur ou sombra de listas. Eixos, rótulos e totais dos gráficos ficam estáveis; desabilitar interpolação padrão de geometria no mobile. Com animação própria, o motor da biblioteca não anima o mesmo elemento simultaneamente.

Preferir `transform` e `opacity` para evitar trabalho de layout/paint; aplicar `will-change` só após medição e removê-lo quando desnecessário. [Guia de desempenho](https://web.dev/articles/animations-guide). Respeitar a preferência do sistema, inclusive quando houver um controle de prévia. Não deduzir capacidade real do aparelho apenas por quantidade de núcleos. Elementos fora de tela e abas em segundo plano não mantêm animação ou polling decorativo.

## 9. Desempenho, conteúdo e acessibilidade

Metas propostas, ainda não medidas no app: LCP ≤2,5 s, INP ≤200 ms e CLS ≤0,1 no percentil 75, segmentado mobile/desktop quando houver medição de campo. Testes de laboratório são evidência complementar. [Definições e limites](https://web.dev/articles/vitals).

Orçamentos iniciais para implementação: banner mobile de até 200 KB; miniaturas preferencialmente abaixo de 60 KB; só imagem principal priorizada; imagens inferiores sob demanda; nenhuma biblioteca de gráficos no chunk público. Medir os incrementos reais de ícones/animação e registrar regressões por rota. Para gráficos administrativos, testar primeiro SVG existente; dependência nova exige comparação de tamanho e interação.

Preparar fotografias próprias/autorizadas, com recortes mobile/desktop e ponto focal. Reservar proporções mesmo com erro. Não usar screenshots das referências como conteúdo nem manter o texto “Imagem de teste” em uma entrega de produção.

Contraste de texto normal ≥4,5:1 e de componentes/ícones informativos ≥3:1 contra o fundo real. Validar cores claras/escuras e store color arbitrária com o cálculo do tema. Foco visível, zoom permitido, rótulos reais, navegação por teclado e ordem de leitura coerente. Modais preservam Escape, foco inicial/retorno, scroll lock e conteúdo de fundo inerte.

Estados obrigatórios por superfície: carregando, vazio, erro recuperável, parcial/desatualizado, sucesso e sem permissão quando aplicável. Exemplos: cardápio sem foto ou fechado, loja inexistente, relatório sem vendas, caixa fechado, equipe sem acesso, trial expirado e falha de salvamento. Documentar o que não se aplica, sem marcar como testado o que não pôde ser executado.

## 10. Execução em entregas revisáveis

| ID | Entrega / arquivos principais | Aceite verificável |
| --- | --- | --- |
| R0 | Inventário estrutural dos dois arquivos concluído para os pilotos. Preparar capturas dos frames selecionados e baseline das rotas. | IDs, camadas e pranchas identificados na matriz. Capturas individuais e baseline de execução são pendências para a comparação com o aplicativo. |
| R1 | Extrair/adaptar tokens, componentes, ícones e assinatura: `shared/styles`, `shared/icons`, `loja/theme.ts`, `loja.css`, assets da plataforma. | Cada decisão tem estado extraído/adaptado/a validar e origem; matriz frame→componente→dado→asset→teste; cor escolhida/tenant preservados; assets locais, sem URLs temporárias. |
| R2 | Piloto Ramenku: `StoreHeader`, `MenuBanner`, `CategoryNav`, `ProductListItem`, `LojaPage`. | Composição conferida contra frames selecionados e catálogo real; CTA válido/ausente; nada encoberto; textos longos, imagens ausentes e adaptação mobile verificados. |
| R3 | Fluxo de compra: `ProductDetailScreen`, `CartDrawer`, `CheckoutDrawer`, resultado. | Quantidade/adicionais/cupom/taxa/total preservados; foco e teclado; envio e estados PIX sem regressão. |
| R4 | Piloto CloudPOS em `DashboardShell`, navegação, `panel-tokens.css` e `InicioPage`. Usar os frames preenchido e vazio de 1194 × 834. | Hierarquia do cabeçalho, quatro indicadores, duas filas e coluna auxiliar conferidas com a origem. Dados, permissões e atalhos para ações reais verificados também no celular. |
| R5 | Dados e gráficos: `inicio/services`, `MonthChart`, gateways/types de relatório/pedidos, `RelatoriosPage`. | Valores conferidos com a API; zero/erro/stale distintos; dias futuros tratados; gráfico utilizável sem animação e com tabela. Comparações só após contrato temporal. |
| R6 | Operação e gestão: pedidos, catálogo, caixa, cupons, entregadores, equipe, impressoras, conta, planos e auditoria. | Componentes consistentes em todas as rotas; ações reais preservadas; loading/error/empty e limites de papel/plano validados. |
| R7 | Identidade completa, acesso/onboarding, conteúdo e personalização: `features/auth`, páginas de entrada, campos de logo/capa/cor, guia de fotos e campanhas. | Kit de marca e telas de acesso consistentes; validações atuais preservadas; prévia reage aos campos reais; erro de imagem orienta. Gestão de campanhas persistida é expansão separada. |
| R8 | QA visual/funcional, acessibilidade, performance e entrega. | Checks oficiais verdes; evidência em aparelhos/viewport-alvo; fluxos críticos e contraste revisados; risco/rollback documentados. |

Dependências: R0 → R1; R2 e R4 podem avançar em paralelo após R1. R3 segue o piloto público; R5 segue o shell e o alinhamento de dados. R6 e R7 usam os componentes estabilizados. R8 verifica cada entrega e fecha a composição conjunta.

Trabalhar em mudanças pequenas por superfície. Revisar conjuntamente um cardápio e uma dashboard representativos antes de expandir para todas as páginas. Isso permite ajustar a linguagem comum sem reescrever cada tela duas vezes.

## 11. Verificação e critérios de conclusão

Alvos: 360×800, 390×844, 768×1024, 1194×834 e 1440×900; conferir também zoom de 200%, orientação e safe areas. Catálogos: com/sem foto, nome longo, categoria longa sem espaços, muitos produtos, loja fechada, cor clara e escura. Admin: dados vazios, um dia, períodos longos, falha parcial, valor oculto, caixa fechado e telas com acesso limitado.

Verificar pausa manual com horário informado divergente, aparelho em outro fuso, modalidade de entrega/retirada desativada e contadores separados para pedidos pendentes, em preparo e aguardando pagamento. A disponibilidade deve ter significado consistente no cardápio e no painel.

Testes de comportamento para novas regras de destino/ícones, foco, preços e estados de dados. Integração para pedido, recuperação de falhas, papéis e filtros. Revisão visual para composição; testes que apenas repetem valores CSS não substituem essa revisão. Medir rolagem e interações em celular intermediário, com rede móvel simulada, sem presumir otimização pela escolha da biblioteca.

```powershell
pnpm --filter @meucardapio/web run typecheck
pnpm --filter @meucardapio/web run lint
pnpm --filter @meucardapio/web test
pnpm --filter @meucardapio/web run build
```

Preparar os pacotes compartilhados conforme o CI. Produzir capturas comparáveis, relatório de performance e registro de acessibilidade. Não publicar dados fictícios como métricas da loja. Caso o ambiente continue sem as dependências/rede do projeto, registrar as verificações pendentes; a prévia isolada não prova o app completo.

O rebrand estará concluído quando o cardápio e as rotas administrativas previstas estiverem harmonizados, ligados aos serviços reais e verificados; banner, checkout e gráficos cumprirem os critérios acima; e as pendências de conteúdo, dados e acessibilidade tiverem destino explícito. Este planejamento não declara esses resultados já alcançados.

## 12. Decisões e dependências abertas

| Item | Encaminhamento |
| --- | --- |
| Direção de cor da plataforma | Terracota/creme e verde positivo confirmados pelo usuário; validar os valores exatos e a aplicação nas telas. |
| Logotipo/naming definitivos | Manter nome de trabalho e reservar uma etapa específica de identidade, se desejada. |
| Fotografias e campanhas de cada restaurante | Selecionar conteúdo real/autorizado antes de publicar. |
| Origem e licença de assets da base | Inventariar antes de redistribuir fontes, ícones e imagens; a composição pode ser estudada desde já. |
| Período/fuso de relatórios | Alinhar com backend em contrato separado; não corrigir silenciosamente o significado no frontend. |
| Métricas novas | Hora a hora, tempo médio de preparo/entrega, recorrência, margem e conciliação exigem dados próprios. |
| Painel escuro e biblioteca avançada de charts | Evolução posterior ao piloto claro e ao experimento de bundle/necessidade. |

Material para revisão: [conceito visual interativo](CONCEITO-REBRAND.html), [tokens propostos](design-tokens.proposed.json), [adaptação do painel](ADAPTACAO-DASHBOARD.md) e [dados/gráficos](DADOS-E-GRAFICOS.md). O conceito usa exemplos e não é implementação das novas telas. Para servi-lo localmente com Node instalado, executar `node docs/frontend/rebrand/preview.cjs` e abrir `http://127.0.0.1:4174/`.

O conceito interativo permanece como **estudo anterior aos designs finais**, até ser refeito a partir de evidências do CloudPOS/Ramenku. Ele não representa reprodução ou aprovação desses arquivos.
