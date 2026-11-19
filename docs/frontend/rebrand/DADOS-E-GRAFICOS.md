# Dados e gráficos da dashboard de restaurantes

Documento de planejamento, baseado no código disponível em 18/11/2026. Nenhuma alteração de aplicação, contrato de API ou cálculo foi executada nesta auditoria. O rebrand deve apresentar os dados reais do VitryNow com leitura clara, mantendo pedidos, pagamentos, permissões e caixa sob as regras existentes.

No CloudPOS, a dashboard preenchida reúne quatro cartões de indicadores e duas listas de pedidos. O piloto usa esses espaços para valores e pedidos retornados pelos gateways do VitryNow. A variante vazia (`21099:32043`) orienta a apresentação quando uma resposta bem-sucedida retorna zero registros. Uma falha de consulta recebe estado próprio. [Dashboard preenchida no Figma](https://www.figma.com/design/qXP8K5VUx9Ue95KQ7ySYjv/CloudPos---Point-of-Sale-UI-KIT?node-id=19013-3328).

A série temporal é uma extensão analítica do VitryNow. O frame da dashboard não contém gráfico temporal. A tela de relatórios comporta o histórico sem deslocar as filas de pedidos. Os nós de referência, incluindo a origem do link para o modal de novo pedido, estão no [inventário de referências](REFERENCIAS-FIGMA.md).

## 1. Hierarquia proposta

A ordem abaixo define a prioridade operacional da adaptação para o VitryNow, incluindo a leitura em celulares.

A dashboard precisa responder primeiro se a loja está recebendo pedidos e o que requer ação. A análise de desempenho vem em seguida. No celular, essa ordem é ainda mais importante.

1. Identidade da loja, disponibilidade real e acesso ao cardápio.
2. Pedidos que exigem atenção e ações operacionais autorizadas.
3. Período de análise e indicação da última atualização bem-sucedida.
4. Até quatro indicadores principais, com rótulos e período explícitos.
5. Evolução diária de pedidos ou valor; canais e produtos mais vendidos.
6. Detalhes de caixa, entregadores e acesso aos relatórios completos.

Os cards promocionais atuais não devem ocupar a posição dos pedidos urgentes. `CurrentOrdersCard` hoje fica oculto no mobile por `features/inicio/inicio.css`; o novo desenho deve preservar sua utilidade operacional em uma composição compacta.

## 2. Fontes existentes

| Fonte | Caminhos principais | O que entrega |
| --- | --- | --- |
| Resumo por período | `apps/api/src/routes/reports.ts`, `apps/web/core/gateways/ReportsGateway.ts`, `apps/web/core/gateways/http/HttpReportsGateway.ts` | Totais, série diária, tipos de pedido, produtos, entregadores, parcelas de taxa/gorjeta, formas de pagamento e movimentos de caixa. |
| Modelo web do resumo | `apps/web/core/domain/reports.ts` | Parte do contrato da API; ainda não declara `byPaymentMethod`, `deliveryFeeCents` e `tipCents`, que já vêm na resposta. |
| Dashboard atual | `apps/web/features/inicio/InicioPage.tsx`, `hooks/useInicioData.ts`, `services/inicioMetrics.ts` | Consultas de mês, últimos sete dias e pedidos; atualização a cada 60 segundos. |
| Lista operacional de pedidos | `apps/api/src/modules/orders/orders.service.ts`, `apps/web/core/gateways/OrdersGateway.ts` | Pedidos abertos e página de encerrados do dia, com limites e metadados de operação. |
| Caixa | `apps/api/src/routes/cashier.ts`, `apps/api/src/lib/cashier.ts`, `apps/web/core/domain/cashier.ts`, `apps/web/core/gateways/CashierGateway.ts` | Sessão atual, movimentos, resumo por forma/tipo, saldo esperado e restrições por papel. |
| Relatórios atuais | `apps/web/features/relatorios/RelatoriosPage.tsx`, `hooks/useRelatorios.ts`, `dateRange.ts` | Filtro de datas e apresentação textual de totais, canais, produtos, entregadores e caixa. |

## 3. Matriz de indicadores e visualizações

Os nomes abaixo são propostas de interface. A ajuda contextual deve explicar a seleção do relatório sem expor nomes internos de campos ao lojista.

| Nome amigável proposto | Visualização inicial | Dado disponível | Semântica e restrição | Necessidade para a entrega |
| --- | --- | --- | --- | --- |
| Valor dos pedidos | Card em reais e evolução diária | `revenueCents` | Soma de `totalCents` dos pedidos elegíveis; inclui taxa e gorjeta e já reflete descontos. Não identifica recebimento ou lucro. | Reutilizar a fonte; definir tooltip e período. |
| Pedidos no período | Card e barras diárias | `orderCount`, `byDay[].orderCount` | Mesma seleção do relatório de valor; pode incluir pedidos ainda em operação. | Reutilizar dados; evitar o rótulo “pedidos concluídos”. |
| Ticket médio | Card em reais | `averageTicketCents` | Média arredondada em centavos do conjunto acima. | Manter centavos no domínio e formatar apenas na apresentação. |
| Clientes no período | Card secundário | `customerCount` | Contatos distintos por telefone ou, quando ausente, por nome. Não é cadastro de clientes nem identificação de novos compradores. | Explicar a estimativa; não chamar “novos clientes” ou “clientes totais da loja”. |
| Evolução diária | Barras para valor ou quantidade, com seletor | `byDay[].date/revenueCents/orderCount` | Data de criação dos pedidos elegíveis. O endpoint não oferece série por hora. | Alinhar período/fuso; tratar dias futuros sem inventar zero. |
| Pedidos por atendimento | Três barras ou distribuição com legenda | `byType` | Delivery, mesa e balcão/retirada. Não são canais de aquisição. | Mapear os enums para rótulos em português e manter cores estáveis. |
| Mais vendidos | Ranking horizontal, quantidade e valor dos itens | `topProducts` | Top 10 ordenado por quantidade; valor é preço unitário × quantidade. Não concilia diretamente com total após cupom, taxas e gorjeta. | Mostrar unidades; preservar o nome histórico do item. |
| Formas de pagamento | Barras ou tabela, com categoria “Sem cobrança” | `byPaymentMethod`, já devolvido pela API | Forma declarada do pedido; não é conciliação nem confirmação de recebimento de todos os meios. | Alinhar o tipo web e a apresentação. Não criar endpoint só para expor o campo já existente. |
| Taxas de entrega / Gorjetas | Linhas de composição do resumo | `deliveryFeeCents`, `tipCents`, já devolvidos pela API | Parcelas já incluídas no total dos pedidos; somá-las novamente duplicaria o valor. | Alinhar o tipo web; rotular como parcelas. |
| Entregas por entregador | Ranking e acesso ao detalhe | `byDeliverer` | Pedidos associados ao entregador e valor desses pedidos. Não mede velocidade ou custo de entrega. | Reutilizar o relatório, sem SLA ou taxa de eficiência inventados. |
| Caixa atual | Card operacional com link para Caixa | `/api/cashier/current` | Saldo esperado da sessão, composto pelas regras de caixa. Não é o mesmo indicador que vendas por datas. | Preservar fonte própria e distinguir caixa fechado, aberto e aberto há muito tempo. |
| Pedidos em andamento | Cards por estado e lista de atenção | `/api/orders`, `status`, `statusChangedAt` | Retrato operacional sujeito a tetos e paginação; não é histórico analítico completo. | Consumir metadados de completude e tempo do servidor; manter acesso ao histórico. |

### Seleção atual do resumo

`reports.ts` seleciona pedidos da loja com `awaitingPayment: false`, estado diferente de `CANCELADO` e `createdAt` no intervalo calculado pelo endpoint. A consulta não exige estado `CONCLUIDO` nem pagamento `APROVADO`.

Consequências para o desenho:

- “Valor dos pedidos” descreve melhor o campo atual que “dinheiro recebido”, “saldo disponível”, “receita líquida” ou “lucro”.
- O total pode incluir um pedido em preparo ou com pagamento presencial ainda não recebido.
- O relatório não oferece uma dedução específica de estornos pendentes ou uma conciliação por pagamento. Um pedido não cancelado pode permanecer na seleção.
- A exclusão de cancelados impede extrair taxa geral de cancelamento apenas desse resumo.
- O valor dos produtos mais vendidos tem composição diferente do total de pedidos; não deve ser apresentado como uma decomposição que necessariamente fecha com ele.

Essas observações descrevem a fonte do aplicativo. O rebrand não deve alterar regras financeiras para fazer os gráficos coincidirem.

## 4. Período e fuso: contrato a alinhar antes de comparações precisas

Há uma divergência verificável no código atual:

| Trecho | Comportamento atual | Risco para a nova apresentação |
| --- | --- | --- |
| `features/relatorios/dateRange.ts` | Usa datas ISO, `new Date("AAAA-MM-DD")` e `toISOString().slice(0, 10)`. | Datas de calendário e instantes podem não representar a meia-noite da loja. |
| `features/inicio/services/inicioMetrics.ts` | Monta início de mês e semana com o fuso local do navegador. | O mesmo restaurante pode receber intervalos diferentes conforme o dispositivo. |
| `core/gateways/http/HttpReportsGateway.ts` | Serializa os dois instantes com `toISOString()`. | A API recebe instantes, sem contrato explícito de datas civis da loja. |
| `apps/api/src/routes/reports.ts` | Adiciona 24 horas ao `to`; agrupa o dia em `America/Sao_Paulo` fixo. | Um fim que já representa “agora” ganha mais 24 horas; limites e agrupamento podem divergir do fuso/configuração da loja. |
| `orders.service.ts` | Usa o fuso configurado da loja para o dia operacional e devolve `timezone`, `serverNow` e `todayStartsAt`. | Operação e relatório podem apresentar recortes distintos para a mesma palavra “hoje”. |

Planejar uma tarefa de contrato de backend separada do rebrand para definir:

1. Se o resumo recebe datas civis no fuso da loja ou instantes com início inclusivo e fim exclusivo.
2. Quem calcula o fim do último dia, evitando acréscimo de 24 horas aplicado a um instante que já inclui esse dia.
3. Qual fuso é usado para filtro, agrupamento, resposta e legendas.
4. Como indicar período efetivamente coberto, data de atualização e eventual incompletude.
5. Como validar datas invertidas e limitar intervalos de forma consistente.

Até esse contrato ser alinhado e validado, bloquear badges de crescimento preciso, comparação “hoje versus ontem”, comparação com período anterior e promessas de equivalência exata entre relatório e caixa. A tela pode mostrar o período selecionado e a série existente, com o recorte conhecido, sem inventar precisão.

Os critérios do contrato deverão incluir virada do dia no fuso da loja, virada de mês, dispositivos em fusos diferentes, intervalo de um único dia e limites finais. Nenhuma correção de período foi feita nesta auditoria.

### Dias futuros e lacunas

O adaptador atual `buildInicioMetrics()` também reduz os pontos a `{day, revenueCents}`, descartando a data completa e a contagem de pedidos. R5 deverá introduzir pontos de apresentação com `{date, orderCount, revenueCents}` e representação explícita de lacuna, preservando o período coberto. Testar séries que atravessam dois meses e a alternância entre quantidade e valor antes de reutilizar o SVG.

`buildMonthSeries()` preenche todos os dias do mês com zero, inclusive os futuros. Na nova camada de apresentação:

- Recortar a série até o último dia coberto ou representar os dias futuros como `null`, sem barra e sem queda artificial para zero.
- Usar zero para um dia passado somente quando uma resposta bem-sucedida e completa confirmar que não houve pedidos elegíveis naquele dia.
- Usar ausência de dado quando a carga falhou, a cobertura é desconhecida ou a consulta ainda não terminou.
- Não interpolar ausência de dados nem ligar linhas através de uma lacuna sem sinalização.

## 5. Identidade dos produtos e metadados dos pedidos

### Identidade no ranking de produtos

O relatório agrega os itens por identidade no backend, mas `topProducts` só devolve `productName`, `quantity` e `revenueCents`. Nomes iguais podem representar produtos diferentes, e o card atual usa o nome como chave. O primeiro ranking deve ser textual e ter identidade local de linha dentro da resposta; não tratar o nome como chave exclusiva nem relacioná-lo automaticamente à foto ou ao produto editável do catálogo. Fotografia confiável, link de edição e associação persistente exigem ID/metadados explícitos em contrato separado.

### Metadados operacionais já enviados

Para rótulos operacionais, “Aguardando aceite” significa `status === "PENDENTE"`; o conjunto de `selectCurrentOrders` contém todos os estados não finais e corresponde a “Em andamento”. Não tratar bloqueio de pagamento como autorização de aceite. Disponibilidade usa `store.acceptingOrders`; horário cadastrado em texto livre é informativo, e as modalidades respeitam `deliveryEnabled`/`pickupEnabled`.

Os comentários em partes do frontend dizem que a API ainda não envia horários de mudança de estado ou hora do servidor. A implementação atual em `apps/api/src/modules/orders/orders.service.ts` e `orders.view.ts` já envia esses dados.

| Campo atual da resposta | Uso planejado | Cuidado |
| --- | --- | --- |
| `serverNow` | Referência do relógio para a idade dos pedidos. | Não depender exclusivamente do relógio do computador do restaurante. |
| `timezone` | Contextualizar o dia operacional. | Alinhar com o contrato de relatórios; não substituir automaticamente o fuso fixo daquele endpoint. |
| `todayStartsAt` | Identificar pedidos abertos de dias anteriores. | Preservar a regra da API em vez de recalcular pelo navegador. |
| `statusChangedAt` por pedido | Mostrar tempo no estado atual. | É o estado atual, não duração histórica média de cada etapa. |
| `openCount` | Quantidade de abertos incluídos na resposta. | No código atual corresponde à lista retornada, que pode atingir o teto. |
| `staleOpenCount` | Abertos retornados que foram criados antes de hoje. | Também está limitado ao conjunto retornado. |
| `openHidden`, `openCapped` | Avisar que há mais abertos e levar ao histórico. | Não esconder incompletude nem tomar uma contagem limitada por total absoluto. |
| `nextCursor` | Paginar os encerrados do dia. | Não usar a primeira página como amostra de todos os pedidos históricos. |

`OrdersListResponse`, em `apps/web/core/gateways/OrdersGateway.ts`, tipa apenas `orders`, `openCapped` e `openHidden`. A implementação frontend deverá alinhar os tipos aos campos já existentes e atualizar comentários desatualizados, mantendo compatibilidade quando metadados opcionais não vierem. Isso não exige inventar um novo endpoint.

## 6. Estados de informação e atualização

`useInicioData.ts` faz três consultas a cada 60 segundos. As métricas só atualizam quando mês e semana têm sucesso; os pedidos podem atualizar separadamente. `useRelatorios.ts` trata 401, mas não fornece estado visual de erro para as demais falhas. Planejar estados explícitos por bloco:

| Estado | Apresentação | Próxima ação |
| --- | --- | --- |
| Carregando pela primeira vez | Skeleton com geometria final e aviso acessível. Nenhum zero provisório. | Aguardar a resposta; os controles que não dependem dela continuam utilizáveis. |
| Sucesso com zero | Valor `R$ 0,00` ou contagem `0`, com período claro. | Ver outro período ou acessar pedidos. |
| Vazio | “Nenhum pedido neste período”, com gráfico sem marcações que simulem atividade. | Alterar período. |
| Erro sem dado anterior | Mensagem contextual e botão de tentar novamente. | Refazer apenas a consulta necessária. |
| Atualizando com dado anterior | Manter os valores, indicar atualização sem cobrir a tela. | Continuar operando. |
| Dado desatualizado | Manter o último resultado válido com horário da última resposta bem-sucedida e aviso de falha. | Atualizar novamente. |
| Parcial | Mostrar os blocos válidos e indicar separadamente os indisponíveis. | Repetir a carga que falhou; não descartar tudo por falha de um bloco. |
| Período trocado | Vincular a resposta ao filtro que a originou; ignorar respostas antigas. | Exibir o novo período quando a resposta correspondente chegar. |
| Sessão expirada ou acesso negado | Usar o tratamento real de 401/403 e o estado apropriado. | Entrar novamente ou retornar a uma área permitida. |

“Atualizado às” deve representar a última carga bem-sucedida conhecida, sem alegar atualização em tempo real ou conciliação. Falha de rede não equivale a restaurante sem vendas. Após uma atualização bem-sucedida, números podem mudar imediatamente; a animação não deve atrasar a informação.

## 7. Gráficos e animação com orçamento mobile

### Decisão inicial

Evoluir o SVG responsivo de `apps/web/features/inicio/components/MonthChart.tsx` para a série diária do VitryNow. O teste de fidelidade do CloudPOS verifica os cartões e as listas operacionais. O teste da série verifica a leitura dos dados, os filtros e a tabela acessível. A dependência `recharts: ^2.15.1` pertence ao template técnico local.

Recharts na área administrativa fica como alternativa de implementação se surgirem necessidades concretas de composição, séries ou interação que justifiquem seu custo. Antes de adotar, validar versão compatível com a stack efetiva, tamanho da rota e acessibilidade, usando documentação primária na etapa de implementação. Não copiar a versão do template nem prometer compatibilidade sem executar a verificação.

Usar uma única engine por família de gráficos. Não renderizar a mesma série com SVG próprio e Recharts, não empilhar duas animações sobre o mesmo elemento e não carregar código de gráficos no cardápio público.

### Contrato de desenho

R0/R1 devem registrar `arquivo/frame/nó CloudPOS → gráfico/componente → série e unidade → gateway/campo → estados → teste/evidência`. A adaptação visual pode alterar apresentação e densidade, preservando o significado dos dados abaixo. Se um frame pedir métrica ausente, classificar a lacuna e usar um estado apropriado ou deixar o recurso fora do piloto; nunca completar com um mock apresentado como resultado real.

- Geometria final é calculada a partir dos dados reais; o container reserva espaço antes de carregar.
- Barras começam em zero; a escala do eixo permanece fixa para o dataset/período exibido. Não alterar o máximo durante a animação de entrada.
- Ao mudar o período, calcular a nova escala uma vez e atualizar valores e legenda juntos. Não manter o eixo antigo com os números novos.
- Valores monetários permanecem em centavos até a formatação. Os valores acessíveis e os tooltips exibem o dado final, não um valor intermediário da animação.
- Canais mantêm cor e ordem constantes entre gráficos, filtros e legendas. Cor acompanha texto, unidade e estado.
- Linhas e barras não precisam de curvas decorativas que sugiram valores entre observações que a API não mediu.

### Motion proposto

| Elemento | Comportamento planejado | Reserva e redução |
| --- | --- | --- |
| Barras diárias | SVG com posição e dimensão finais; entrada via `scaleY` com origem na base, entre 240 e 320 ms. | Evitar animar `height`, `y` ou o layout da página. Em redução de movimento, apresentar o resultado final. |
| Série em linha, caso adotada | Fade de opacidade curto, entre 120 e 180 ms. | Evitar desenho contínuo custoso e morph de caminhos na entrega inicial. |
| Ranking de produtos | Entrada curta por opacidade; tamanho final da barra já reservado. | Sem cascata para dezenas de linhas nem contadores que atrasem a leitura. |
| Tooltip e seleção | Feedback de até 120 ms e seleção por toque ou teclado. | Sem depender de hover no mobile. |
| Atualização periódica | Alterar o dado e, quando útil, fazer um único fade discreto. | Não repetir animação completa a cada polling de 60 segundos. |
| Valores dos cards | Mostrar o valor final imediatamente. | Não usar contagem infinita, rolagem de dígitos ou números fictícios até chegar ao total. |

Os números de duração são propostas a validar em aparelho mobile representativo. Centralizar os tokens e reutilizar a infraestrutura existente em `lib/motion.ts` e `features/loja/motion.css`. `prefers-reduced-motion` remove transformações não essenciais; abaixo da dobra e em aba oculta não há animação contínua. O filtro e o toque devem responder sem aguardar a animação anterior.

### Acessibilidade e responsividade

- Cada gráfico terá título, período, unidade, resumo textual e tabela de dados acessível, usando a mesma fonte da representação visual.
- O conteúdo não pode depender do `<title>` de uma barra ou de hover. A seleção terá caminho por teclado e toque, foco visível e rótulo do valor selecionado.
- Tooltips não cobrem o filtro ou as ações operacionais; podem ser substituídos por um resumo fixo abaixo do gráfico no celular.
- A tabela não recebe um tab stop por célula; o usuário deve conseguir ler cabeçalhos e valores na ordem natural.
- Legendas são legíveis e não usam somente cor. Gráfico decorativo duplicado por uma descrição equivalente deve evitar anúncios repetidos.
- No mobile, mostrar menos rótulos no eixo, mantendo todos os valores na tabela. A página não ganha rolagem horizontal para acomodar o gráfico.
- Conferir 360, 390, 768 e 1440 px, zoom de texto, filtros longos e datasets zero, um único ponto e valores muito diferentes.

## 8. Dados reais versus novos contratos

| Entrega | Situação | Tratamento no plano |
| --- | --- | --- |
| Cards de pedidos, valor, ticket e clientes no período | Dados existentes. | Frontend com semântica explícita e estados confiáveis. |
| Série diária, canais, top produtos e entregadores | Dados existentes. | Evolução de layout e SVG; sem mock preenchendo o estado real. |
| Formas de pagamento, taxas e gorjetas | Já enviados; tipos web incompletos. | Alinhar contrato frontend à resposta, com testes do adaptador. |
| Idade e metadados operacionais de pedidos | Já enviados; partes não tipadas. | Reutilizar os campos atuais e sinalizar incompletude. |
| Comparações precisas entre períodos | Fonte existe, mas limites/fuso precisam de alinhamento. | Dependência de contrato separado; só habilitar após validação. |
| Movimento por hora / horários de pico | Sem agregação horária no resumo. | Novo contrato de relatório, fora da entrega visual inicial. |
| Tempo médio de preparo/entrega e SLA | Horário do estado atual não fornece a agregação histórica necessária. | Definir eventos, cobertura histórica e agregação no backend. |
| Taxa geral de cancelamento ou estorno | Resumo atual exclui cancelados; Kanban é limitado/paginado. | Novo denominador e fonte agregada; não calcular pela lista exibida. |
| Recorrência, clientes novos e coortes | `customerCount` não fornece identidade/coortes. | Novo contrato e definição de identidade; não inferir por nomes. |
| Custos, CMV, margem ou lucro | O resumo não fornece custos. | Requer dados e regras próprios; não mostrar no rebrand como recurso pronto. |
| Recebimentos conciliados ou valor líquido disponível | Forma de pagamento e total do pedido não compõem uma conciliação. | Contrato específico, separado da melhoria de design. |

## 9. Papéis, planos e privacidade visual

O endpoint de resumo usa `requirePanelAuth`, sem restrição explícita a OWNER no arquivo auditado. O botão de ocultar valores da dashboard atual é uma preferência visual; não cria uma autorização no servidor. Portanto, a interface não deve afirmar que valores financeiros estão protegidos da equipe somente por ocultar um card.

A API de caixa já restringe a visão de uma sessão fechada por papel: o dono pode receber o resumo, enquanto a equipe recebe uma visão reduzida. Reutilizar exatamente a resposta autorizada. A nova composição não deve buscar um campo sensível em outra rota para contornar essa ausência.

Subscription/trial fornece estados e recursos existentes; a regra identificada de plano é `multi_user`. Não inventar bloqueio de gráficos por plano nem badges de upgrade para métricas que já estão disponíveis. Mudanças de acesso ou plano precisam de contrato próprio.

## 10. Sequência de implementação e aceite

As fatias A–D detalham as fases R0/R1, R4/R5 e R8 do plano mestre. Usar a matriz de frames e registrar para cada bloco o campo do gateway, o período e os estados de apresentação. A auditoria técnica abaixo define a semântica desses campos.

### Fatia A — infraestrutura e leitura operacional

Preservar `DashboardShell`, os providers e as rotas. Evoluir tokens, ícones e cartões segundo a matriz CloudPOS e documentar os ajustes de marca e tradução. Alinhar campos já devolvidos pela API. Mostrar disponibilidade e pedidos antes de promoções, inclusive no celular.

Aceite: nenhum dado demonstrativo aparece como dado da loja; pedidos limitados são sinalizados; estados fechado, vazio, parcial e erro têm saída útil; permissões e ações existentes permanecem sob as regras do servidor.

### Fatia B — gráficos com fontes atuais

Evoluir o SVG para série diária e ranking; aplicar o novo desenho a canais e resumos. Acrescentar resumo/tabela acessível e motion por transformação/opacidade com resultado final imediato.

Aceite: valores e tabela conciliam com a mesma resposta, unidades são claras, dias futuros não parecem vendas zero, e a navegação por toque/teclado não depende de animação ou hover.

### Fatia C — confiabilidade de período

Executar uma tarefa separada de contrato frontend/backend para o intervalo e o fuso. Habilitar comparações e rótulos precisos somente depois de validar os limites com testes comuns aos consumidores.

Aceite: um restaurante produz o mesmo recorte em dispositivos de fusos diferentes; fim de dia e mês estão corretos; não há duplo acréscimo de dia; comparação usa duração e conjunto equivalentes, com base zero tratada explicitamente.

### Fatia D — analytics adicionais

Priorizar novos contratos somente quando o produto precisar das métricas ausentes. Não atrasar a melhoria visual existente para preencher uma dashboard com indicadores sem fonte.

### Verificação transversal

Usar fixtures identificadas para os estados de dados e comportamento. Testar os adaptadores, rótulos semânticos, concorrência de troca de filtro, completude, datas e cálculos que forem novos. Executar typecheck, lint, suíte web e build com as versões oficiais do projeto; fazer revisão renderizada nos viewports e em redução de movimento. Uma renderização isolada ou revisão estática não aprova performance, interação ou acessibilidade assistiva.

Backend, banco, regras de pagamento e novas métricas permanecem tarefas separadas. Este documento planeja a apresentação e identifica dependências; não declara que essas dependências foram resolvidas.
