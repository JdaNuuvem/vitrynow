import type { Category, Product } from "@/core/domain/storefront";

// Produtos cujo nome ou descrição contêm o termo (sem diferenciar maiúsculas). Termo vazio = nada.
export function searchProducts(categories: Category[], term: string): Product[] {
  const query = term.trim().toLowerCase();
  if (!query) return [];
  return categories.flatMap((category) =>
    category.products.filter(
      (product) => product.name.toLowerCase().includes(query) || (product.description ?? "").toLowerCase().includes(query),
    ),
  );
}
