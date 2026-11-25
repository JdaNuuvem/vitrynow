# Adaptação da dashboard CloudPOS ao VitryNow

O piloto de `/dashboard` segue a tela preenchida do CloudPOS em tema claro. Cada bloco usa os serviços do VitryNow e a paleta terracota e creme da plataforma. [Abrir a dashboard preenchida no Figma](https://www.figma.com/design/qXP8K5VUx9Ue95KQ7ySYjv/CloudPos---Point-of-Sale-UI-KIT?node-id=19013-3328).

A estrutura dos frames foi conferida no arquivo local. O nó do link inicial, `21258:35520`, é uma instância de `Pop Up Components` dentro de `Create New Order`. Ele serve ao estudo da interação de pedido manual. A seleção de frames, os ativos identificados e a cobertura de inspeção de cada kit estão no [inventário de referências](REFERENCIAS-FIGMA.md).

| Fonte | Papel atualizado | Situação |
| --- | --- | --- |
| CloudPOS | Shell e início do painel | Três frames claros de 1194 × 834 px identificados no arquivo local. Usar `19013:3328` para o estado preenchido, `21099:32043` para o vazio e `22966:86723` para o painel de notificações expandido, caso a interação tenha fonte no produto. |
| Ramenku | Cardápio público e banners do restaurante | Páginas Light (`1:3`) e Dark (`14584:33316`) confirmadas por metadados. A seleção das telas de compra está no inventário. |
| `Dashboard - Front` | Exemplos locais de componentes e implementação que podem auxiliar a adaptação. | Código auditado; sem autoridade sobre o design final. |
| Quatro PNGs e conceito HTML anteriores | Histórico de estudo e referências complementares. | Não representam reprodução dos novos Figmas. |

Os frames selecionados orientam a composição. O painel adota terracota e creme, com verde para estados positivos. O cardápio usa a identidade do restaurante. Cada ação ou indicador publicado precisa de uma fonte e de permissões correspondentes no VitryNow.

## 1. O que o suporte local já oferece

`Dashboard - Front/components/Layout`, `components/Sidebar`, `components/Header` e `components/Card` oferecem exemplos de navegação lateral, cabeçalho, cartões de indicadores, gráficos e coluna complementar. `templates/HomePage` mostra como essas peças se organizam na pasta local. O código dessa base pode ser reaproveitado onde reproduzir os frames selecionados e servir à operação do restaurante.

O conteúdo encontrado pertence à marca SaphyraPay e a um domínio de pagamentos B2B. Carteira, saques, integradores e contestações não descrevem a operação de restaurantes. A nova dashboard deverá responder primeiro: a loja recebe pedidos, o que precisa de atendimento, como estão as vendas e quais ações operacionais exigem atenção.

O diretório inclui dados demonstrativos em `mocks`, números literais em componentes, ícones SVG locais e fontes InterDisplay. Não é uma integração pronta com os serviços do VitryNow.

## 2. Compatibilidade técnica

| Camada | Base `Dashboard - Front/package.json` | VitryNow `apps/web/package.json` | Decisão da migração |
| --- | --- | --- | --- |
| Framework | Next 15.2.0 | Next 14.2.15 | Preservar Next 14 durante o rebrand; adaptar os componentes ao projeto existente. |
| React | React/React DOM 19 | React/React DOM 18.3 | Preservar React 18; conferir APIs e tipagens ao transportar uma peça. |
| Estilos | Tailwind 4 e `@tailwindcss/postcss` | Tailwind 3 e CSS por feature | Traduzir o vocabulário da base para os tokens e CSS do VitryNow. |
| Lint | ESLint 9 | ESLint 8 e configuração Next 14 | Manter a esteira do aplicativo. |
| Gráficos | Recharts declarado como `^2.15.1` | SVG local em `features/inicio/components/MonthChart.tsx` | Evoluir primeiro o SVG existente. A versão da base é informação de origem, não uma versão a fixar. |
| Movimento | `framer-motion`, `react-animate-height`, transições CSS | Tokens e utilitários de movimento existentes | Reusar a infraestrutura do app; avaliar uma dependência nova apenas quando uma interação concreta exigir. |
| Tema | `next-themes`, padrão escuro | Tokens do painel e cor da loja | Tema claro como primeira entrega; modo escuro em fase secundária, com validação própria. |

O README da base informa Next 14+/React 18, mas seu manifesto declara Next 15/React 19. Para esta análise, o manifesto é a evidência técnica utilizada.

Não copiar `Dashboard - Front/package.json`, `app/globals.css`, `app/layout.tsx` ou o provider de tema sobre seus equivalentes do VitryNow. O CSS da base depende de recursos do Tailwind 4, como `@theme` e `@custom-variant`. Misturar os dois sistemas sem tradução produziria classes sem efeito e alterações globais difíceis de controlar. Um eventual upgrade de stack deve ter escopo e validação separados do rebrand.

## 3. Matriz de reaproveitamento técnico secundário

Os destinos marcados como propostos serão criados na implementação. Os demais já existem no projeto. Esta matriz liga o código de `Dashboard - Front` ao VitryNow. O vínculo entre cada frame do CloudPOS e o componente do piloto está no [inventário de referências](REFERENCIAS-FIGMA.md).

| Origem do suporte local | Destino no VitryNow | Adaptação técnica planejada |
| --- | --- | --- |
| `components/Layout/index.tsx` | `apps/web/features/shell/DashboardShell.tsx` e `shell.css` | Reaproveitar padrões de implementação quando úteis; composição final vem do CloudPOS inspecionado, preservando a árvore de providers e serviços. |
| `components/Sidebar/index.tsx` e `Sidebar/Dropdown` | `features/shell/components/Sidebar.tsx`, `SidebarNav.tsx` | Reutilizar os grupos, rótulos e estados da navegação no cabeçalho horizontal e no menu compacto. Preservar foco, nomes acessíveis e fechamento ao navegar. |
| `components/Header/index.tsx` | `features/shell/components/Topbar.tsx` | A referência desktop tem cabeçalho horizontal de 1194 × 92 px. Distribuir contexto da loja, navegação e ações existentes verificando o espaço dos rótulos em português. |
| `constants/navigation.tsx` | `core/navigation/panelNavigation.ts` | Manter as URLs e os metadados do VitryNow. Alterar apresentação e agrupamento, não transportar as rotas de pagamentos. |
| `components/Card/index.tsx` | `features/inicio/components/*Card.tsx` e primitivo visual compartilhado proposto | Padronizar superfície, borda, título, ação e espaçamento; evitar camadas de cartões dentro de cartões. |
| `templates/HomePage/index.tsx` | `features/inicio/InicioPage.tsx`, `inicio.css` | Reaproveitar organização de código quando compatível, aplicando o grid e a hierarquia dos frames CloudPOS selecionados e a prioridade operacional do restaurante. |
| `HomePage/Overview/index.tsx` | `features/inicio/components/RevenueCard.tsx`, `StatCard.tsx` | Recriar KPIs com métricas reais e nomes inequívocos; remover valores e percentuais literais do template. |
| `HomePage/Overview/Balance` e `HomePage/ProductView` | `features/inicio/components/MonthChart.tsx` | O frame preenchido concentra a operação em KPIs e listas. A série diária é uma extensão analítica própria do VitryNow, detalhada em [Dados e gráficos](DADOS-E-GRAFICOS.md). |
| `components/CardChartPie/index.tsx` | `features/inicio/components/OrderTypesCard.tsx`, visualização proposta quando justificada | Usar distribuição real por tipo de pedido; tratar total zero, labels, teclado e alternativa textual. Não copiar o cálculo sem proteção. |
| `components/PopularProducts` | `features/inicio/components/TopProductsCard.tsx` | Ranking textual com nome, quantidade e valor real. O contrato não devolve ID/foto; imagem e link de edição exigem identidade explícita, sem associação pelo nome. |
| `components/RefundRequests` | `features/inicio/components/CurrentOrdersCard.tsx`, `features/pedidos` | Aproveitar o acabamento de lista e indicadores; ações e status seguem os fluxos de pedido e estorno já existentes. |
| `HomePage/OverviewSlider`, `GetMoreCustomers` | `features/inicio/components/PromoCard.tsx`, `promoCards.ts` | O card aceita texto, selo e ação de link ou upgrade. Para usar uma arte CloudPOS, prever imagem opcional com espaço reservado e preservar o CTA em HTML. Exibir as promoções depois das pendências operacionais. O aviso de assinatura usa `features/planos/PlanStatusBanner.tsx`. |
| `components/Icon/index.tsx` | `apps/web/shared/icons/Icon.tsx` | Unificar os ícones sob wrapper tipado e a família definida no rebrand. Não transportar o mapa inteiro de paths sem origem verificada. |
| `components/Field`, `Button`, `Select`, `Modal` | `apps/web/shared/ui` e componentes das features | Reproduzir acabamento preservando labels, validação, foco, Escape, scroll lock, `inert` e contratos dos controles existentes. |
| `components/ThemeButton`, `app/providers.tsx` | Tokens e controle de tema propostos para o painel | Modo escuro posterior à estabilização do claro; não adicionar provider de tema nem `suppressHydrationWarning` indiscriminadamente. |
| `templates/Products/*` | `features/catalogo` | Aproveitar composição de tabelas, filtros e formulários; manter produtos, categorias, adicionais e exclusão/ocultação do domínio atual. |
| `templates/Income/*` | `features/relatorios` e `features/caixa` | Usar visualizações e filtros como referência; valores, definições e ações seguem os contratos de relatórios e caixa. |

## 4. Composição por largura

Usar 1194 × 834 px para cotejar o render do piloto com as três variantes claras identificadas. A adaptação para telas menores preserva o acesso aos pedidos, o foco e a legibilidade.

### Desktop

- O frame preenchido usa cabeçalho horizontal de 1194 × 92 px. Adaptar a navegação atual ao cabeçalho por grupos e garantir acesso às rotas com rótulos longos.
- Quatro cartões de indicadores medem 204 × 128 px cada no tamanho de origem. O corpo tem duas listas de pedidos e uma coluna lateral de 282 px. Comparar os alinhamentos com o frame e testar valores em BRL e rótulos em português.
- Usar disponibilidade e pendências reais nos blocos operacionais. A série temporal do VitryNow pode aparecer como extensão abaixo da operação ou na rota Relatórios.
- A coluna de apoio não recebe um mural de promoções que desloque pedidos importantes para baixo. Alertas de operação, indisponibilidade ou acesso têm precedência.

### Tablet

- Navegação compacta com possibilidade de expandir por uma ação explícita. O grid passa a uma composição de oito colunas ou duas colunas de conteúdo, conforme espaço real.
- Indicadores mantêm rótulo e valor completos. Cards de apoio descem quando comprimir o gráfico prejudicar eixos, labels ou controles.
- Não transportar cegamente os breakpoints `max-4xl`, `max-3xl` e larguras fixas da base; defini-los pelos conteúdos e pela infraestrutura responsiva do VitryNow.

### Mobile

- Estado da loja e acesso aos pedidos aparecem primeiro. Preservar a navegação mobile de `features/shell/components/Bottombar.tsx` e seus estados de foco/menu.
- KPIs em 2×2 apenas quando rótulos e valores couberem sem truncar informação importante; em telas menores ou com nomes extensos, passar a uma coluna.
- Gráficos abaixo do resumo operacional, com altura reservada e controles compactos. Evitar uma altura excessiva para métricas de apoio e rolagem horizontal da página.
- Banners, dicas e ações comerciais ficam depois dos blocos operacionais. As ações de fechar loja, aceitar pedido, acessar caixa e buscar produto não devem competir com publicidade.
- Conferir o resultado em 360, 390 e 430 px, além de tablet e desktop. Fonte ampliada, nomes longos e teclado virtual fazem parte da verificação.

## 5. Domínio e contratos preservados

O ponto de integração continua sendo `features/shell/DashboardShell.tsx`. Manter `PanelServicesProvider`, `StoreProvider`, `PlanStatusProvider`, `FeatureUpgradeProvider`, `SearchProvider`, `HelpProvider` e `SecurityConfirmProvider`, respeitando sua ordem e seus contratos.

Unificar o significado de disponibilidade: “Recebendo pedidos” usa `store.acceptingOrders`; texto de horário não autoriza pedido nem substitui pausa manual. O atual `StoreHoursCard.tsx` infere “Aberto agora” a partir de texto livre no fuso do aparelho e precisa ser harmonizado. Mostrar modalidades de entrega/retirada conforme seus flags. “Aguardando aceite” conta `PENDENTE`, enquanto a seleção de todos os estados não finais deve ser rotulada “Em andamento”. Preservar bloqueios de pagamento e transições vindos da API.

Manter também os controles de papel e acesso já existentes: esconder uma ação visualmente não substitui validação de permissão. OWNER e STAFF continuam seguindo o backend e os componentes atuais. Não ligar ações do template diretamente a novos endpoints nem duplicar gateways.

As rotas existentes em `core/navigation/panelNavigation.ts` continuam sendo a referência de navegação: Início, Pedidos, Produtos, Relatórios, Caixa, Cupons, Entregadores, Impressoras, Equipe, Auditoria, Plano e Minha loja. A busca usa o mecanismo atual. Os bloqueios de plano e as confirmações de segurança permanecem funcionais durante a migração.

O shell atual já torna o conteúdo atrás do menu mobile inerte. Preservar esse comportamento, o controle/retorno de foco, o fechamento ao navegar, a tecla Escape e o bloqueio de rolagem nos modais e gavetas. Não copiar o `maximumScale: 1` encontrado em `Dashboard - Front/app/layout.tsx`; a revisão deve preservar o zoom do usuário.

## 6. Gráficos e indicadores

A proposta parte do gráfico SVG `MonthChart` em `features/inicio/components/MonthChart.tsx`. Ele recebe a série de valor dos pedidos em centavos e usa `formatCents`. Avaliar a extensão analítica com os dados do período, a alternativa tabular e os estados de zero, erro e carga.

`features/inicio/hooks/useInicioData.ts` consulta os gateways de relatórios e pedidos; `features/relatorios/RelatoriosPage.tsx` já consome resumo por tipo, produtos mais vendidos, entregadores e caixa. O desenho dos gráficos deve partir desses dados e de suas limitações. Não converter uma série ou indicador do template em uma promessa de dado disponível.

Diretrizes da adaptação:

- Valor dos pedidos, quantidade de pedidos e ticket médio devem manter nome, unidade, período e definição visíveis. Evitar abreviações que escondam valores no resumo principal.
- Usar centavos nas operações e formatação de BRL/pt-BR. O uso de `thousandSeparator=","` na base não deve ser transportado como padrão monetário.
- Prever carregamento, zero real, ausência de dados, erro, dados parciais e atualização em andamento. Falha não vira zero e dados antigos não aparecem como recém-atualizados.
- Oferecer alternativa textual/tabela e valores acessíveis por teclado/toque. Tooltip exclusivamente por hover não é suficiente.
- Comparação percentual exige período comparável e denominador válido. Caso contrário, omitir a variação e explicar o motivo de forma discreta.
- Em distribuição, tratar total zero antes de dividir. O `CardChartPie` da base calcula `value / total` sem proteção e precisa ser refeito se aproveitado.
- A animação não mascara atualização nem altera o número real. Atualizações frequentes não reiniciam toda a entrada da dashboard.
- A evolução visual pode animar opacidade e transformação das barras SVG por 240–320 ms no mobile e até 450 ms no desktop, uma vez na entrada ou na mudança explícita de período. Redução de movimento mostra o estado final diretamente. Os tokens finais seguem o plano mestre e não uma escala separada do painel.
- Gráficos fora da área visível não precisam iniciar animação. Não executar intervalos ou animações contínuas para decoração.

Se surgir uma necessidade concreta de gráficos complexos que o SVG local não resolva com clareza, avaliar Recharts em uma entrega técnica separada: compatibilidade com React 18, tamanho do bundle, acessibilidade, responsividade, SSR e manutenção. `^2.15.1` é a versão declarada no template de origem, não uma decisão de dependência para o VitryNow.

## 7. Conteúdo, assets e proveniência

Para cada arte selecionada no inventário, vincular o nó ou a imagem embutida ao componente, registrar recorte e ponto focal e testar o arquivo exportado no tamanho efetivo. A arte de comunicação administrativa pertence ao `PromoCard`. O cardápio público usa o `MenuBanner` do restaurante e recebe conteúdo por loja.

Retirar da adaptação as marcas SaphyraPay, `SAPHYRA_1.png`, `ISO_COLORIDO.png`, avatars de clientes fictícios, integradores, saques e todo texto demonstrativo sem equivalente na operação. Revisar também metadados, títulos, texto alternativo, mensagens e nomes internos para não deixar resíduos visíveis da outra marca.

`mocks/dashboard.tsx`, `mocks/charts.tsx` e os demais mocks podem ajudar a entender o formato visual durante o protótipo. Não serão fonte de dados do painel real. Protótipos com mocks precisam ser identificados como demonstração, e o fluxo publicado deve usar os gateways existentes.

Não foram encontrados `LICENSE`, `NOTICE`, licença das fontes ou atribuição verificável na pasta analisada. Confirmar a origem e a autorização dos assets antes de redistribuí-los. Se essa informação não estiver disponível, preservar a referência de composição e substituir arquivos por fontes, ícones e fotografias de origem documentada. O nome `core-2` do manifesto e a marca do README são pistas de origem, não comprovação de licença.

Dark mode é fase secundária. Antes de implementá-lo, consolidar tokens semânticos e validar o tema claro. Depois, conferir superfícies, texto, bordas, ícones, campos, estados operacionais e paleta de gráficos. Não usar o laranja da base como cor automática de sucesso, e não deixar a cor configurável da loja substituir indiscriminadamente as cores de erro e atenção.

## 8. Entregas de adaptação

Estas entregas A–F detalham e se subordinam às fases R0–R8 do plano mestre; não constituem uma sequência concorrente. Antes de B/C, concluir os seguintes itens de preparação de R0/R1:

1. **Inventário de fontes e estados (R0).** Comparar os estados preenchido e vazio selecionados com a consulta real. Anotar quais elementos da variante expandida têm dados e ações correspondentes. Usar a seleção pública do Ramenku registrada no inventário.
2. **Tokens e assets (R1):** extrair apenas valores e referências efetivamente observados; classificar cada decisão como extraída, adaptada à marca confirmada ou ainda a validar. Rever os baselines de Lucide, fontes locais, proporções e medidas; nenhum deles é atribuído aos kits antes da inspeção.
3. **Rastreabilidade (R0/R1):** para cada tela ou banner, preencher `arquivo/página/frame/nó → componente VitryNow → variante/estado → dado/gateway → asset → adaptação responsive → teste/evidência`. Campos desconhecidos permanecem pendentes, sem valores inferidos do nome do kit.

O aceite de R1 exige distinguir o que veio do arquivo final do que foi adaptado por acessibilidade, marca, comportamento ou desempenho. R2 e R4 implementam os pilotos público e administrativo a partir dessa matriz; R8 compara a interface real aos frames escolhidos nos viewports-alvo.

| Entrega | Trabalho planejado | Critério de aceite |
| --- | --- | --- |
| A — Inventário e tokens (R0/R1) | Inspeção CloudPOS/Ramenku, mapa de frames/estados, tokens e assets; vínculo com componentes do produto e apoio local. | Valores extraídos e adaptações diferenciados; origem visual e destino funcional registrados; pendências de acesso/conteúdo/proveniência explícitas. |
| B — Shell administrativo (R4) | Cabeçalho horizontal e distribuição dos blocos do CloudPOS, com navegação compacta e acesso às rotas atuais no celular. | Correspondência com os frames registrada, busca e permissões verificadas, foco e fundo inerte preservados no menu. |
| C — Visão geral | Reorganização de `InicioPage`, pedidos em andamento, indicadores e gráfico SVG. | Operação precede promoções; cards mostram dados reais e estados distintos; gráfico legível no mobile e acessível. |
| D — Telas de operação | Aplicar componentes e tokens a pedidos, catálogo, caixa, cupons e relatórios. | Ações e serviços permanecem íntegros; formulários, tabelas e feedbacks têm a mesma linguagem visual. |
| E — Motion e robustez | Tokens compartilhados, movimento reduzido, carregamento seletivo, testes de navegação e estados. | Sem animação contínua, perda de foco, salto de layout ou bloqueio do toque; limites de desempenho medidos no app. |
| F — Tema escuro e acabamento | Modo escuro opcional, revisão de consistência e imagens finais autorizadas. | Todos os estados e gráficos funcionam no tema; sem regressão no tema claro e sem assets de demonstração publicados. |

Cada entrega deve registrar revisão em larguras mobile, tablet e desktop, testes funcionais pertinentes e execução das verificações oficiais do web. Inspeção estática ou uma fixture adaptada não substitui a aprovação do app real com sua versão de React, seus dados e seus fluxos.

## 9. Recursos que não devem ser inventados pelo rebrand

Visualização nova não cria contrato de dados. Essa regra vale igualmente para controles que venham a aparecer no CloudPOS ou no Ramenku. Não apresentar como funcional uma carteira financeira, saque PIX, contestação, integração via API, agenda de campanhas, programa de fidelidade, favoritos sincronizados, estoque, custo/margem, mapa de entregas, avaliação de clientes, mesas/comandas ou acompanhamento detalhado da cozinha sem existência comprovada do respectivo fluxo e contrato.

Se algum desses recursos for desejado futuramente, documentá-lo como expansão de produto com contrato e critérios próprios. Na migração administrativa, ações apontam apenas a destinos reais e indicadores mostram apenas dados disponíveis. O rebrand entrega uma dashboard de restaurante com a composição solicitada e a operação confiável do VitryNow.
