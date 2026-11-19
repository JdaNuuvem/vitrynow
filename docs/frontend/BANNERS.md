# Campanha opcional do cardápio

O inicializador local habilita a campanha **Ramen da casa** na loja Ramenku. O botão aponta para a categoria criada no PostgreSQL pela carga inicial. A variável `NEXT_PUBLIC_LOCAL_RAMENKU=1` está definida no Compose local.

O registro `bannersByStore`, em `apps/web/features/loja/banners.ts`, começa vazio. Sem entrada para o slug, nenhum espaço de banner é criado. A capa continua vindo de `store.coverImageUrl`.

O piloto usa a composição do frame *Home Banner* do Ramenku, com texto e botão à esquerda e fotografia à direita. Para uma campanha de ramen compatível com a oferta da loja, está disponível a [tigela recortada](../../apps/web/public/campanhas/ramenku-tigela.webp), com 512 × 512 px e transparência. O arquivo deriva da camada `Product Image` (`16262:17733`) da cópia fornecida. Use `imageUrl: "/campanhas/ramenku-tigela.webp"` e `imageLayout: "cutout"` para reproduzir a tigela avançando sobre o canto inferior direito. Fotografias convencionais ocupam a coluna direita por padrão.

Para ativar uma campanha, adicione uma entrada usando o slug exato da loja e conteúdo autorizado. O exemplo abaixo é apenas um modelo: substitua imagem, textos e IDs pelos dados reais antes de publicar código.

```ts
const bannersByStore: Readonly<Record<string, MenuBannerConfig>> = {
  "slug-real-da-loja": {
    id: "pratos-da-casa",
    title: "Pratos da casa",
    description: "Escolha seu prato e confira os ingredientes.",
    imageUrl: "/campanhas/foto-autorizada.webp",
    imagePosition: "60% 50%",
    action: {
      label: "Ver pratos",
      target: { kind: "category", id: "id-real-da-categoria" },
    },
  },
};
```

`kind: "product"` abre o detalhe de um produto existente pelo `id`. Não adiciona um item automaticamente. `kind: "category"` navega até uma categoria com produtos e transfere o foco para a seção. Se o destino foi removido, ou a categoria ficou vazia, a ação desaparece; o texto permanece. Uma campanha também pode omitir `action` e `description`.

O título e a descrição são HTML textual, separados da fotografia. O ponto focal aceita `object-position`; confira o recorte no celular e no desktop. Prepare WebP ou AVIF e considere o orçamento inicial de até 200 KB para o celular. A fotografia é decorativa: todo conteúdo necessário para decidir deve constar no texto. Falhas de imagem preservam o espaço, o título e a ação válida.

Não inclua desconto, prazo de entrega, frete grátis ou popularidade sem informação real. O banner não muda preços, cupons, disponibilidade ou pagamentos. O estado de loja fechada continua visível.

Esse registro exige nova entrega de código para mudar conteúdo. Não há upload, editor de campanhas, agendamento nem persistência de múltiplos banners nesta entrega.
