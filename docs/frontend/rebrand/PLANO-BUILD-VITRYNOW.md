# VitryNow · Plano de build do CRM e do cardápio

18 de novembro de 2026

Este documento registra a sequência de implementação do rebrand. Para instalar a versão entregue, consultar o resultado dos testes e integrar a campanha, consulte o [guia de entrega](../../../ENTREGA-PARA-O-DEV.md).

## Direção de produto

O CRM precisa funcionar no ritmo do balcão. A home abre com indicadores verificáveis, filas de pedidos e ações de operação. O cardápio público precisa mostrar quem é a loja, o que está disponível e quanto custa, com caminho curto até o pedido.

- **CRM.** A prancha clara de dashboard do CloudPOS traz navegação horizontal compacta, quatro indicadores e filas lado a lado. Os slides de produto do pitch VitryNow servem de referência de identidade. Usamos creme no fundo, superfícies claras, texto verde-escuro, terracota nas ações e verde nos estados positivos. Em celular, o conteúdo vira uma coluna com navegação inferior.
- **Cardápio.** As pranchas de navegação, compra e rastreio do Ramenku orientam composição e hierarquia. Capa fotográfica, identidade da loja, busca e categorias antecedem o catálogo. Fotos, preços e disponibilidade vêm do catálogo real. A cor escolhida pela loja alimenta controles, vínculos e destaques com contraste calculado.
- **Dados e estados.** Componentes operacionais têm rótulos, valores e períodos explícitos. Zero, erro, carregamento e falta de permissão têm apresentações distintas. A leitura se sustenta com texto e ícones quando houver cor semântica.

As fontes visuais são `design referencia/crm`, `design referencia/cardapio` e o `VitryNow-Pitch.html` fornecido. O mapeamento de frames e medidas de origem está em [Referências de Figma](REFERENCIAS-FIGMA.md).

## Entregas da primeira fase

| Área | Entrada no produto | Fluxo |
| --- | --- | --- |
| Operação | `/dashboard` | Navegação compacta, visão geral, pedidos em andamento, Pix pendente, estoque e atalhos. |
| Aparência | Minha loja → Aparência do cardápio | Editar cor de destaque, logotipo e banner principal. Conferir a prévia, salvar e abrir o cardápio público. Upload e URL são opções explícitas. |
| Cardápio | `/loja/[slug]` | Produtos, capa e categorias com a identidade da loja. Horários, disponibilidade e tempo de preparo usam o contrato atualizado do menu. |
| Fotos do catálogo | Produtos → Editar produto | Escolher arquivo compatível ou informar URL HTTPS. A foto publicada aparece no catálogo e no cardápio. |
| Atendimento | Minha loja → Horários e preparo | Grade semanal, exceções, pausa ou fechamento e estimativas por modalidade conforme o backend. |
| Salão | Mesas e QR | Criar e gerenciar mesas, abrir o cardápio por QR e acompanhar a conta da mesa segundo as permissões da loja. |
| Cadastro | Login → Criar minha loja | Cadastro, primeiros passos, reenvio e rota de confirmação por link. O provedor de e-mail do ZIP opera em teste no ambiente local. |
| Relatórios | Relatórios | Filtro de período e exportações CSV disponíveis conforme a tabela e o perfil. |

## Sequência para o restante do build

| Ordem | Trabalho | Aceite |
| --- | --- | --- |
| 1 | Revisar Pedidos, Histórico, Novo pedido e Caixa com as pranchas de operação do CRM. Aplicar a mesma escala de textos e densidade nas ações críticas. | Criar e localizar o mesmo pedido, avançar seu estado e conferir total, itens e pagamento. Recusa, cancelamento e estorno exigem o motivo ou confirmação previstos pela API. |
| 2 | Concluir grupos de opções do catálogo em gestão, detalhe do produto, carrinho, pedido manual e mesa. Usar o contrato de `/api/catalog/option-groups` para vínculos, regras e preços. | Grupo obrigatório bloqueia até atingir o mínimo. Complementos e preço-base calculam o mesmo total na tela e na API. Reabrir carrinho e alterar produto preserva seleção e validação. |
| 3 | Aprovar a criação de campanhas do cardápio. Definir texto, imagem, ação vinculada a produto ou categoria e regra de publicação da campanha. | A imagem de capa editável tem função independente. A campanha aparece somente quando cadastrada e libera o espaço quando desativada. Se o destino sair do catálogo, a chamada fica indisponível. |
| 4 | Aplicar as pranchas escuras como variante completa do tema, com revisão de relatórios, detalhes do pedido, modais, formulários e checkout. | Cada estado preserva contraste e foco em 360, 390, 768 e 1194 px. A cor da loja precisa ser legível em fundos claros e escuros. |
| 5 | Projetar o back-office da plataforma e os fluxos de privacidade com seus respectivos perfis, trilhas de auditoria e revisão operacional. Usar os contratos de `/api/platform/*` e `/api/privacy/*`. | A operação de uma loja permanece isolada. Cada ação administrativa usa a autenticação, as permissões e a confirmação que o backend exige. Validar exportação e prévia de anonimização com dados de teste. |

## Verificação e entrega local

1. Executar testes e build da web e da API com a versão de pnpm fixada no projeto. Rodar o deploy das migrações em uma base local descartável e exercitar o cliente de impressão pelo fluxo existente do projeto.
2. Conferir no navegador em 390 × 844, 768 px e 1194 × 834. Repetir no desktop largo e em 360 px. Verificar foco, zoom, textos longos, preços, banner sem foto e recorte de imagem. Em estados de erro, validar ação de retorno e tentativa novamente.
3. Salvar a aparência e reabrir o CRM e o cardápio em uma sessão nova. Conferir resets, URL inválida, upload, permissões de funcionário e alteração do status de atendimento. Seguir um pedido de teste até o acompanhamento e o painel.
4. Sequenciar a implantação com banco migrado, API saudável e web apontada para a API correspondente. O arquivo `Abrir-VitryNow.cmd` é a entrada do ambiente local Windows. Validar Pix e e-mail com os provedores de teste antes de decidir sobre integrações reais.
