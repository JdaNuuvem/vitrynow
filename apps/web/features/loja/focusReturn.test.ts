import { afterEach, describe, expect, it, vi } from "vitest";
import { PRODUCT_ID_ATTR, findProductElement, restoreReturnPoint } from "./focusReturn";

afterEach(() => {
  document.body.innerHTML = "";
});

function page(html: string) {
  document.body.innerHTML = html;
  return document;
}

describe("restoreReturnPoint (WEB-22, F2)", () => {
  it("devolve a rolagem e o foco ao produto que abriu o detalhe", () => {
    page(`<main><div id="cardapio-conteudo" tabindex="-1"><div ${PRODUCT_ID_ATTR}="p1" tabindex="0">A</div><div ${PRODUCT_ID_ATTR}="p2" tabindex="0">B</div></div></main>`);
    const scrollTo = vi.fn();
    const target = restoreReturnPoint(document, { productId: "p2", scrollY: 640 }, scrollTo);
    expect(scrollTo).toHaveBeenCalledWith(640);
    expect(target?.textContent).toBe("B");
    expect(document.activeElement).toBe(target);
  });

  it("produto que sumiu da tela: o foco vai ao conteúdo, não ao body", () => {
    page(`<main><div id="cardapio-conteudo" tabindex="-1"></div></main>`);
    const target = restoreReturnPoint(document, { productId: "p9", scrollY: 0 }, vi.fn());
    expect(target?.id).toBe("cardapio-conteudo");
    expect(document.activeElement).toBe(target);
  });

  it("na busca (sem conteúdo do cardápio) o foco vai ao campo de busca", () => {
    page(`<main><input type="search" aria-label="Buscar" /></main>`);
    const target = restoreReturnPoint(document, { productId: "p1", scrollY: 0 }, vi.fn());
    expect(target?.tagName).toBe("INPUT");
    expect(document.activeElement).toBe(target);
  });

  it("tela sem nenhum destino não quebra", () => {
    page(`<main></main>`);
    expect(restoreReturnPoint(document, { productId: "p1", scrollY: 10 }, vi.fn())).toBeNull();
  });

  it("acha o produto pelo id exato, sem escapar seletor", () => {
    page(`<div ${PRODUCT_ID_ATTR}='a"b'>x</div>`);
    expect(findProductElement(document, 'a"b')?.textContent).toBe("x");
    expect(findProductElement(document, "a")).toBeNull();
  });
});
