import type { Category, Product, ProductInput } from "@/core/domain/catalog";

// Exclusão no catálogo (UX-19, P0 de perda de dados). Antes, "excluir" apagava no 1º toque, sem aviso.
// A ação padrão agora é OCULTAR (reversível); apagar de vez é a segunda opção, com o efeito escrito.
// A API também precisa barrar (só dono, produto em pedido aberto): é a API-56; a tela não é a única barreira.

// Mesmos campos que o formulário de edição manda, com `active` trocado. Não perde foto, adicionais nem preço.
export function productToInput(product: Product, categoryId: string, patch: Partial<ProductInput> = {}): ProductInput {
  return {
    categoryId,
    name: product.name,
    description: product.description ?? undefined,
    imageUrl: product.imageUrl ?? "",
    priceCents: product.priceCents,
    featured: product.featured,
    active: product.active,
    additionals: product.additionals,
    ...patch,
  };
}

export type DeleteCopy = {
  title: string;
  message: string;
  // Ação principal. Em produto ativo é "Ocultar" (reversível); nos demais casos é a própria exclusão.
  confirmLabel: string;
  confirmTone: "primary" | "danger";
  // Segunda ação (só em produto ativo): excluir de vez.
  alternativeLabel: string | null;
  // Categoria que ainda tem produtos não pode ser excluída (a API recusa com 409): só informa.
  informOnly: boolean;
};

export function productDeleteCopy(product: Product): DeleteCopy {
  if (product.active) {
    return {
      title: `Ocultar ou excluir ${product.name}?`,
      message:
        "Ocultar tira o produto do cardápio, mas guarda tudo para você ativar de novo quando quiser. Excluir apaga o produto de vez e não dá para desfazer. Pedidos antigos continuam mostrando o nome e o preço.",
      confirmLabel: "Ocultar do cardápio",
      confirmTone: "primary",
      alternativeLabel: "Excluir de vez",
      informOnly: false,
    };
  }
  return {
    title: `Excluir ${product.name}?`,
    message: "Este produto já está oculto. Excluir apaga o produto de vez e não dá para desfazer. Pedidos antigos continuam mostrando o nome e o preço.",
    confirmLabel: "Excluir de vez",
    confirmTone: "danger",
    alternativeLabel: null,
    informOnly: false,
  };
}

export function categoryDeleteCopy(category: Category): DeleteCopy {
  const count = category.products.length;
  if (count > 0) {
    return {
      title: `Não dá para excluir ${category.name}`,
      // O servidor conta TODOS os produtos, inclusive os ocultos. Saídas: "Mover produtos" (na própria categoria, leva todos
      // para outra no fim da lista) ou excluir os produtos.
      message: `Esta categoria ainda tem ${count} ${count === 1 ? "produto" : "produtos"}, mesmo os ocultos. Use "Mover produtos" para levá-${count === 1 ? "lo" : "los"} a outra categoria, ou exclua ${count === 1 ? "o produto" : "os produtos"} antes de excluir a categoria.`,
      confirmLabel: "Entendi",
      confirmTone: "primary",
      alternativeLabel: null,
      informOnly: true,
    };
  }
  return {
    title: `Excluir a categoria ${category.name}?`,
    message: "A categoria será apagada de vez e não dá para desfazer.",
    confirmLabel: "Excluir categoria",
    confirmTone: "danger",
    alternativeLabel: null,
    informOnly: false,
  };
}
