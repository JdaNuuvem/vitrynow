# VitryNow | design system

O CRM usa superfícies creme, texto verde-escuro, terracota para a ação principal e verde para estados positivos. O resumo da operação, os indicadores com período e as filas aplicam a hierarquia observada na referência CloudPOS. O cardápio segue a referência Ramenku, com a fotografia da loja, busca, categorias e informação do produto em sequência. A identidade editada no CRM é aplicada individualmente a cada loja.

## Fundações

| Decisão | Implementação |
| --- | --- |
| Fonte de verdade | `apps/web/shared/design/tokens.css` contém os tokens globais. `shared/styles/panel-tokens.css` liga os aliases de telas existentes a esses tokens. |
| Tipografia | Urbanist nos títulos e Open Sans no texto de trabalho. Carregamento local e licenças em `apps/web/public/fonts`. Números da operação usam espaçamento tabular. |
| Cores e superfícies | Use `--panel-canvas`, `--surface`, `--ink`, `--ink-soft`, `--line` e tokens semânticos. Reserve as cores de estado para status ou mensagens com texto. |
| Temas | Claro, escuro e sistema em `themePreference.ts` e `ThemeControls.tsx`. O tema inicial é claro e a seleção se aplica à navegação e às demais abas do mesmo navegador. |
| Cor de cada loja | `features/loja/theme.ts` valida a cor e calcula variantes de contraste para os fundos claro e escuro. O checkout e o componente de campanha usam os mesmos tokens locais. |
| Sobreposições | `shared/ui/Modal.tsx` concentra foco, Escape e devolução do foco. Para confirmações, preserve o motivo e a reautenticação que a operação exige. |

## Componentes

Abra `/dev/design-system` para visualizar os componentes nos temas disponíveis e experimentar os estados interativos.

| Componente | Aplicação |
| --- | --- |
| `PageHeading` e `Panel` | Título, contexto, ações e grupos de informação. |
| `Button` e `Field` | Ações principais, secundárias, discretas e destrutivas. Campo com rótulo e estados de erro, ajuda, carregamento e indisponibilidade. |
| `StateMessage` e `StatusBadge` | Carregamento, confirmação, erro, informação, bloqueio e status operacional. Exponha ação de recuperação quando existir. |
| `DataTable` e `Pagination` | Listas densas com rolagem horizontal interna quando necessário. Mantenha foco e ação de linha acessíveis pelo teclado. |
| `Tabs` | Alternância entre vistas com navegação por setas, Home e End. |
| `StoreHeader`, `MenuBanner` e seletor de opções | Usados no cardápio e nas prévias apropriadas. O banner fotográfico da loja e a campanha promocional têm controles próprios. |

## Critérios para novas telas

- Use o contexto do lado do usuário. Mostre período, unidade e estado da informação junto do valor. Ofereça ação apenas para os perfis e dados que a API permite.
- Preserve a hierarquia no celular. Controles críticos precisam de foco visível, área de toque adequada e comportamento verificável com teclado. Mantenha o conteúdo principal sem rolagem lateral da página.
- Confira claro e escuro, texto comprido, ausência de fotos, erro e listas vazias. Ao usar dinheiro, preços de pedidos e disponibilidade, valide a resposta oficial da API.
- Consulte os componentes existentes na aplicação antes de criar uma variante. Amplie a demonstração junto com a primitiva quando introduzir um novo estado compartilhado.
