# Execução do frontend — primeira entrega

Escopo: etapa 1 de [PLANO-FRONTEND.md](PLANO-FRONTEND.md), solicitada em 18/11/2026. Porte ECC: grande, por envolver uma direção visual e vários componentes, sem novo contrato externo. A instrução para executar o planejamento autoriza implementar a entrega já definida no plano.

## Tarefas e critérios

- Refinar tokens e cabeçalho: preservar nome, logo, capa, condições, horários e disponibilidade reais. Usar Jakarta local, superfície branca para os textos com `accentInk` e cor configurada da loja.
- Criar banner opcional por slug: foto com proporção reservada, texto em HTML e uma ação que abre uma categoria com produtos ou um produto atual. Destino inválido não gera ação; ausência de configuração não gera banner.
- Integrar sem alterar as alturas das barras, os offsets de categorias, os cálculos do carrinho ou os serviços. Conectar o skeleton existente e distinguir erro temporário de loja inexistente, com tentativa novamente.
- Executar revisão independente, verificações web e inspeção renderizada; registrar os resultados e limitações nesta pasta.

## Contrato visual

A superfície é o cardápio público. A pessoa precisa identificar o restaurante, conferir se recebe pedidos, encontrar uma categoria e abrir/adicionar um produto. A hierarquia é fotografia da loja, identidade e disponibilidade, busca, campanha opcional e catálogo. As referências locais são o cabeçalho, o tratamento de imagens e o tema já existentes, além das decisões registradas no plano.

Alvos: 360x800 e 1440x900. Nome longo, categorias extensas e textos devem quebrar sem alargar a página. Barras sobrepostas recebem material translúcido discreto com reserva sólida; fotos, preços e ingredientes permanecem em superfícies estáveis. Movimento respeita `prefers-reduced-motion`. A campanha não troca automaticamente.

| Estado | Gatilho e resposta esperada |
| --- | --- |
| Carregamento | Sem menu inicial: skeleton anunciado uma vez como carregamento. |
| Vazio | Sem produtos: mensagem neutra e contato quando cadastrado. |
| Erro | Falha temporária: mensagem e tentar novamente; 404: loja não encontrada. |
| Parcial | Capa, logo ou foto do banner falhou: alternativa visual, texto e navegação utilizáveis. |
| Sucesso | Menu carregado, destino do banner abre o fluxo existente; carrinho usa os mesmos valores. |
| Permissão | Cardápio público não exige login. Loja fechada mantém aviso real e bloqueios existentes de pedido. |

## Conteúdo das campanhas

Não existe campanha real identificada nem acervo autorizado neste checkout. O registro de campanhas começa vazio. A capa cadastrada da loja continua sendo usada; o frontend não inventa fotografias, promoções, popularidade ou prazos de entrega. A ativação de uma campanha estática exige configuração com conteúdo e IDs reais e uma nova entrega de código.

## Validação

Implementação da etapa 1 concluída; aprovação visual e verificações oficiais pendentes. A revisão independente encontrou e levou à correção de retorno de foco do detalhe aberto pela campanha, foco ao navegar para categoria e salto de layout no erro da capa. A mídia do banner também mantém o espaço após erro.

A revisão adicional com `gpt-6.2-astra`, esforço `ultra`, levou a quatro ajustes: títulos de categoria permitem quebra de palavras longas; o anúncio de carregamento fica fora da região ocupada; a cor sólida da capa tem reserva sem `color-mix`; um fechamento confirmado pelo servidor mantém a loja fechada mesmo quando a releitura do cardápio falha. Esse último estado só é reconciliado por uma leitura bem-sucedida, e não desaparece quando o erro do pedido é limpo.

A verificação local alternativa passou em 14 verificações: análise sintática de 353 arquivos TS/TSX, resolução de destinos, isolamento de campanhas, contraste em 4.096 cores e renderização de servidor dos componentes reais com menu, ausência de banner, loja fechada, catálogo vazio e skeleton. Ela identificou uma cor (`#0077dd`) para a qual branco e `#111111` falhavam em 4,5:1; o tema agora usa preto nesse intervalo, com teste de regressão.

Essa verificação usou Node e pacotes já disponíveis no cache local, com React 19 isolado e adaptação de `next/font`. O projeto usa React 18 e Next 14: o resultado não substitui typecheck semântico, lint, Vitest ou build oficiais. As dependências do projeto não estavam instaladas; a instalação com lockfile/offline falhou por pacote ausente e a rede bloqueou os downloads. Manifests e lockfile não foram alterados.

A revisão renderizada em 360x800 e 1440x900 não pôde ser realizada: o browser host estava indisponível, e o controle da janela Chrome foi encerrado pelo CUA por não conseguir determinar sua URL com confiança. Não há capturas nem aprovação visual. Interações de carrinho, checkout e PIX permanecem sem nova execução nesta entrega.

Evidências: [verificações locais](evidence/validation.json) e [gate visual pendente](evidence/design-evidence.json). Os testes de comportamento foram escritos antes das alterações correspondentes; não há evidência RED/GREEN da suíte oficial, porque seu runner não estava disponível. Não foram criados commits ou PR: este diretório não possui `.git`.

Para completar a validação num ambiente com dependências, executar os comandos do plano e o lint do CI:

```powershell
pnpm --filter @meucardapio/web run typecheck
pnpm --filter @meucardapio/web run lint
pnpm --filter @meucardapio/web test
pnpm --filter @meucardapio/web run build
```

Conferir também os estados e os fluxos interativos previstos no plano em ambos os tamanhos. As etapas 2 a 5 continuam pendentes da revisão desta primeira entrega, conforme previsto no plano. A configuração de campanhas permanece vazia; veja [BANNERS.md](BANNERS.md) para ativar conteúdo autorizado.
