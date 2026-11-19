# Implementação CloudPOS e Ramenku

O [inicializador para Windows](../../../Abrir-VitryNow.cmd) abre a aplicação Next.js com a API Fastify e o PostgreSQL locais. A loja inicial Ramenku tem três categorias, cinco produtos, fotos, adicionais e uma campanha vinculada ao catálogo. Para comparar as telas com os dados gravados na operação, faça um pedido no cardápio e consulte a fila no painel. [Acesso e configuração](../../../README.md#rodando-localmente) · [Arquitetura da aplicação](../../ARQUITETURA-VITRYNOW.md)

Em 18/11/2026, o painel e a loja pública receberam os pilotos dos dois kits. As telas usam os componentes e serviços do VitryNow. A [matriz dos designs](REFERENCIAS-FIGMA.md) identifica os frames, as dimensões e as artes de origem.

| Onde conferir | Comportamento implementado |
| --- | --- |
| `/dashboard` | Navegação horizontal no desktop, quatro indicadores e filas de pedidos em aberto e aguardando pagamento. A lateral reúne situação da loja e ações operacionais. Cada fonte indica falha e permite nova tentativa. |
| `/dashboard/relatorios` | Gráfico diário com alternância de valor e quantidade, valores por data em tabela e distribuição por modalidade. Valores ocultos e preferência por movimento reduzido também se aplicam ao gráfico. |
| `/loja/[slug]` | Identidade, capa, busca, categorias, destaques editoriais quando cadastrados e lista completa. A campanha por loja usa foto, chamada e botão separados. O detalhe, o carrinho e o checkout usam os produtos e preços do catálogo. |
| Confirmação e PIX | O pedido devolve total e desconto em centavos. Comprovante, retomada e histórico usam os valores do servidor, inclusive quando o cupom cobre o pedido inteiro. |
| `/dashboard/catalogo` e `/dashboard/conta` | Busca por produto ou categoria e distinção entre carregamento, erro e vazio. A prévia de identidade reage ao nome, à cor, ao logo e à capa antes de salvar. |
| Entrada e acesso | Assinatura VitryNow, ícone do navegador, telas de login e recuperação alinhadas à marca. O cardápio público continua usando a marca do restaurante. |

## Fotografias e campanha

O arquivo de arte incluído é o recorte de tigela do Ramenku. A campanha de demonstração usa dados locais. Uma loja real exibe banner quando seu slug tem uma campanha configurada. O botão é resolvido contra o catálogo atual. [Como configurar uma campanha](../BANNERS.md)

## Verificação

- O empacotamento de verificação resolveu as importações locais dos 20 arquivos de página/layout e gerou os respectivos estilos. Os módulos de Next e React foram tratados como dependências externas nesse teste.
- O shell passou por testes em navegador a 360, 390, 801 e 1194 px, incluindo busca, avisos, navegação, Escape e retorno de foco. O cardápio foi exercitado de 320 a 1440 px com fotos reais e serviços de demonstração.
- O fluxo de compra foi exercitado a 360, 390 e 960 px, com adicionais, quantidade, cupom inválido, desconto confirmado, pedido zerado e recuperação de PIX. O gateway de teste permitiu verificar a interface sem criar uma cobrança.
- Catálogo, prévia da loja e login foram exercitados em navegador a 390 e 1440 px. As verificações incluem falha de consulta seguida de recuperação, nome e cor antes de salvar e validação do formulário de acesso.
- A dashboard também passou no Chrome em 390, 768 e 1440 px. Os cenários cobriram painel vazio, painel preenchido, falha em uma fila com a outra disponível, nova tentativa e ocultação de valores. Na loja a 390 px, o navegador mediu a capa com 200 px de altura, a campanha com 350 × 188 px e os cards de destaque com 168 px de largura.

O ambiente tinha React e esbuild isolados para as verificações, mas as dependências completas do monorepo estavam ausentes e o registro de pacotes estava inacessível. A suíte oficial de Vitest, o typecheck, o lint, o build de produção com Next 14/React 18 e a integração com PostgreSQL continuam pendentes. O plano mantém a aferição de desempenho em ambiente integrado e a validação com o catálogo e as campanhas da primeira loja.
