// Ponto de retorno do detalhe do produto (WEB-22, F2 do Deming). A troca de tela desmonta a lista, então ao
// voltar a página iria ao topo e o foco ficaria no body. Guardamos qual produto abriu e a rolagem, e devolvemos
// os dois quando o detalhe fecha (botão Voltar, Esc ou Adicionar).
export type ReturnPoint = { productId: string; scrollY: number; bannerId?: string; featured?: boolean };

// Marca no HTML de cada produto da lista, para achá-lo de novo depois da troca de tela.
export const PRODUCT_ID_ATTR = "data-product-id";

export function findProductElement(root: ParentNode, productId: string): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>(`[${PRODUCT_ID_ATTR}]`);
  for (const element of candidates) if (element.getAttribute(PRODUCT_ID_ATTR) === productId) return element;
  return null;
}

// Devolve a rolagem e o foco. Se o produto não está mais na tela (a busca remonta vazia, o cardápio mudou),
// o foco vai ao conteúdo, e na falta dele ao primeiro campo da tela, para nunca cair no body.
export function restoreReturnPoint(root: ParentNode, point: ReturnPoint, scrollTo: (y: number) => void): HTMLElement | null {
  scrollTo(point.scrollY);
  // Compara o valor exato sem interpolar IDs editoriais em um seletor CSS.
  const bannerAction = point.bannerId === undefined ? undefined : Array.from(root.querySelectorAll<HTMLElement>("[data-banner-action]"))
    .find((element) => element.getAttribute("data-banner-action") === point.bannerId);
  const featuredAction = point.featured ? Array.from(root.querySelectorAll<HTMLElement>("[data-featured-product-id]"))
    .find((element) => element.getAttribute("data-featured-product-id") === point.productId) : undefined;
  const target = bannerAction ?? featuredAction ?? findProductElement(root, point.productId) ?? root.querySelector<HTMLElement>("#cardapio-conteudo") ?? root.querySelector<HTMLElement>("main input");
  target?.focus({ preventScroll: true });
  return target;
}
