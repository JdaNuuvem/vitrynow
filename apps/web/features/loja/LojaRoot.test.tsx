import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Menu } from "@/core/domain/storefront";
import { LojaRoot } from "./LojaRoot";

const menu = {
  store: {
    name: "Pizzaria Boa Massa", slug: "boa-massa", logoUrl: null, coverImageUrl: null, primaryColor: null, address: "Rua A, 1",
    whatsapp: null, openingHours: null, minOrderCents: null, deliveryEnabled: true, pickupEnabled: true, acceptingOrders: true, deliveryFeeCents: 0,
  },
  categories: [
    {
      id: "c1", name: "Pizzas Tradicionais", icon: null,
      products: [{ id: "p1", name: "Calabresa Especial", description: "Molho e calabresa", imageUrl: null, priceCents: 4000, active: true, featured: false, additionals: [] }],
    },
  ],
} as unknown as Menu;

afterEach(() => vi.unstubAllGlobals());

// Defeito pego no navegador (WEB-16): o LojaRoot não repassava o menu do servidor ao LojaPage,
// então o HTML saía "Carregando..." e o cliente buscava tudo de novo. Estes testes cobrem a ligação.
describe("LojaRoot com o menu vindo do servidor (ADR-0013)", () => {
  it("o HTML renderizado no servidor já traz nome, categoria e produto (sem JS)", () => {
    const html = renderToString(<LojaRoot slug="boa-massa" initialMenu={menu} />);
    expect(html).toContain("Pizzaria Boa Massa");
    expect(html).toContain("Pizzas Tradicionais");
    expect(html).toContain("Calabresa Especial");
    expect(html).not.toContain("Carregando");
  });

  it("no navegador mostra o menu na hora e não chama a API", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<LojaRoot slug="boa-massa" initialMenu={menu} />);
    expect(screen.getAllByText("Pizzaria Boa Massa").length).toBeGreaterThan(0);
    expect(screen.getByText("Calabresa Especial")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tem o link 'Ir para o cardápio' como primeiro foco, apontando para o conteúdo", () => {
    const { container } = render(<LojaRoot slug="boa-massa" initialMenu={menu} />);
    const skip = screen.getByRole("link", { name: "Ir para o cardápio" });
    expect(skip).toHaveAttribute("href", "#cardapio-conteudo");
    expect(container.querySelector("#cardapio-conteudo")).toBeInTheDocument();
    expect(container.querySelector("a, button")).toBe(skip);
  });

  it("cardápio sem nenhum produto mostra a mensagem neutra e o contato, e esconde a categoria vazia", () => {
    const empty = {
      ...menu,
      store: { ...menu.store, whatsapp: "5521999999999" },
      categories: [{ id: "c1", name: "Vazia", icon: null, products: [] }],
    } as unknown as Menu;
    render(<LojaRoot slug="boa-massa" initialMenu={empty} />);
    expect(screen.getByText("Este cardápio ainda não tem produtos.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Falar com a loja" })).toHaveAttribute("href", "https://wa.me/5521999999999");
    expect(screen.queryByText("Vazia")).not.toBeInTheDocument();
  });

  it("categoria vazia some, mas as categorias com produto continuam", () => {
    const base = menu as unknown as { categories: unknown[] };
    const mixed = { ...menu, categories: [{ id: "c0", name: "Sem produtos", icon: null, products: [] }, ...base.categories] } as unknown as Menu;
    render(<LojaRoot slug="boa-massa" initialMenu={mixed} />);
    expect(screen.queryByText("Sem produtos")).not.toBeInTheDocument();
    expect(screen.getByText("Calabresa Especial")).toBeInTheDocument();
    expect(screen.queryByText("Este cardápio ainda não tem produtos.")).not.toBeInTheDocument();
  });

  it("sem menu inicial (API fora do ar no SSR) mostra 'Carregando' e busca no navegador", () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<LojaRoot slug="boa-massa" />);
    expect(screen.getByText("Carregando...")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// WEB-22 (F2 do Deming): a troca de tela desmonta a lista. Ao fechar o detalhe, a rolagem e o foco voltam ao produto.
describe("detalhe do produto: devolve rolagem e foco ao fechar", () => {
  function setupDetail() {
    // Devolve um valor de propósito: se o efeito repassasse o retorno do scrollTo, o React o chamaria como
    // função de limpeza e a página quebraria ao fechar o detalhe (visto no navegador).
    const scrollTo = vi.fn(() => "não é função");
    vi.stubGlobal("scrollTo", scrollTo);
    Object.defineProperty(window, "scrollY", { value: 480, configurable: true });
    render(<LojaRoot slug="boa-massa" initialMenu={menu} />);
    return scrollTo;
  }

  it("Voltar devolve o foco ao produto que abriu e a rolagem de onde estava", async () => {
    const scrollTo = setupDetail();
    await userEvent.click(screen.getByRole("button", { name: "Calabresa Especial" }));
    expect(screen.getByRole("heading", { level: 1, name: "Calabresa Especial" })).toHaveFocus();
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

    await userEvent.click(screen.getByRole("button", { name: "Voltar ao cardápio" }));
    expect(screen.getByRole("button", { name: "Calabresa Especial" })).toHaveFocus();
    expect(scrollTo).toHaveBeenLastCalledWith(0, 480);
  });

  it("Esc também devolve o foco ao produto", async () => {
    setupDetail();
    await userEvent.click(screen.getByRole("button", { name: "Calabresa Especial" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Calabresa Especial" })).toHaveFocus();
  });

  it("Adicionar devolve o foco ao produto", async () => {
    setupDetail();
    await userEvent.click(screen.getByRole("button", { name: "Calabresa Especial" }));
    await userEvent.click(screen.getByRole("button", { name: /^Adicionar/ }));
    expect(screen.getByRole("button", { name: "Calabresa Especial" })).toHaveFocus();
  });
});

// Cardápio v2 (UX-26, Fatia 1): estrutura, regra do "+" e linha compacta no fluxo completo.
describe("cardápio v2: estrutura e regras no fluxo completo (spec 12)", () => {
  const photo = "https://x/foto.png";
  const item = (id: string, name: string, imageUrl: string | null, additionals: unknown[] = []) => ({ id, name, description: null, imageUrl, priceCents: 2000, active: true, featured: false, additionals });
  const rich = {
    store: { ...menu.store, primaryColor: null, minOrderCents: 2000, deliveryFeeCents: 600 },
    categories: [
      { id: "ca", name: "Lanches", icon: "🍔", products: [item("a1", "X-Burger", photo), item("a2", "X-Salada", photo), item("a3", "X-Bacon", null, [{ id: "ad1", name: "Ovo", priceCents: 300 }])] },
      { id: "cb", name: "Bebidas", icon: "🥤", products: [item("b1", "Suco", null), item("b2", "Refri", null)] },
    ],
  } as unknown as Menu;

  function open() {
    vi.stubGlobal("fetch", vi.fn());
    return render(<LojaRoot slug="boa-massa" initialMenu={rich} />);
  }

  it("usa o VERDE padrão (D-01) quando a loja não escolheu cor", () => {
    const { container } = open();
    expect((container.querySelector(".loja") as HTMLElement).style.getPropertyValue("--loja-accent")).toBe("#1f7a54");
  });

  it("usa a cor da loja quando ela escolheu", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { container } = render(<LojaRoot slug="boa-massa" initialMenu={{ ...rich, store: { ...rich.store, primaryColor: "#b5472a" } } as unknown as Menu} />);
    expect((container.querySelector(".loja") as HTMLElement).style.getPropertyValue("--loja-accent")).toBe("#b5472a");
  });

  it("a barra de categorias é filha da página inteira (não da folha da identidade) e há um chip por categoria", () => {
    const { container } = open();
    const nav = container.querySelector("nav.loja__chipsbox") as HTMLElement;
    expect(nav.parentElement).toBe(container.querySelector("main.loja__page"));
    expect(nav.closest(".loja__card")).toBeNull();
    expect(screen.getByRole("button", { name: "Lanches" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bebidas" })).toBeInTheDocument();
  });

  it("categoria com poucas fotos (Bebidas) usa linha compacta; a com maioria de fotos (Lanches) usa o cartão com bloco", () => {
    const { container } = open();
    const lists = container.querySelectorAll(".loja__list");
    expect(lists[0]).not.toHaveClass("loja__list--compact");
    expect(lists[0].querySelectorAll(".loja__item--compact")).toHaveLength(0);
    expect(lists[1]).toHaveClass("loja__list--compact");
    expect(lists[1].querySelectorAll(".loja__item--compact")).toHaveLength(2);
  });

  it("'Mínimo · Entrega' e o status aparecem no cabeçalho", () => {
    open();
    expect(screen.getByText(/Mínimo R\$\s?20,00 · Entrega R\$\s?6,00 · Retirada/)).toBeInTheDocument();
    expect(screen.getByText("Recebendo pedidos")).toBeInTheDocument();
  });

  it("'+' de produto sem adicionais adiciona 1, vira stepper e o '−' tira; o carrinho flutuante acompanha", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: "Adicionar X-Burger" }));
    expect(screen.getByRole("group", { name: "Quantidade de X-Burger" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ver carrinho: 1 item, R\$\s?20,00/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mais um X-Burger" }));
    expect(screen.getByRole("button", { name: /Ver carrinho: 2 itens, R\$\s?40,00/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tirar um X-Burger" }));
    await userEvent.click(screen.getByRole("button", { name: "Tirar um X-Burger" }));
    expect(screen.queryByRole("button", { name: /Ver carrinho/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar X-Burger" })).toBeInTheDocument();
  });

  it("'+' de produto com adicionais opcionais adiciona 1 unidade simples (sem abrir o detalhe) e mostra 'Tem opções'", async () => {
    open();
    expect(screen.getByText("Tem opções")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Adicionar X-Bacon" }));
    expect(screen.queryByRole("heading", { level: 1, name: "X-Bacon" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar X-Bacon (1 no carrinho)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tirar um X-Bacon/ })).not.toBeInTheDocument();
  });

  it("loja que não aceita pedidos: sem '+' em nenhum cartão, 'Fechado agora' no cabeçalho", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<LojaRoot slug="boa-massa" initialMenu={{ ...rich, store: { ...rich.store, acceptingOrders: false } } as unknown as Menu} />);
    expect(screen.queryByRole("button", { name: /^Adicionar / })).not.toBeInTheDocument();
    expect(screen.getByText("Fechado agora")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "X-Burger" })).toBeInTheDocument();
  });

  it("depois de abrir e fechar um detalhe, o destaque de categoria observa as seções NOVAS (não as antigas, já removidas)", async () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe(element: Element) {
          observed.push(element);
        }
        disconnect() {}
      },
    );
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal("fetch", vi.fn());
    render(<LojaRoot slug="boa-massa" initialMenu={rich} />);
    const before = observed.filter((element) => element.id.startsWith("categoria-"));
    expect(before.length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "X-Burger" }));
    await userEvent.click(screen.getByRole("button", { name: "Voltar ao cardápio" }));
    const after = observed.filter((element) => element.id.startsWith("categoria-")).slice(before.length);
    expect(after.length).toBe(before.length);
    after.forEach((element) => expect(element.isConnected).toBe(true));
    before.forEach((element) => expect(element.isConnected).toBe(false));
  });

  it("no fim da página, o chip tocado fica destacado mesmo que a categoria curta não alcance a linha de leitura; sai do fim, o pino cai", async () => {
    const instances: { cb: (entries: { isIntersecting: boolean; target: Element; boundingClientRect: { top: number } }[]) => void; observed: Element[] }[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        instance: (typeof instances)[number];
        constructor(cb: (typeof instances)[number]["cb"]) {
          this.instance = { cb, observed: [] };
          instances.push(this.instance);
        }
        observe(element: Element) {
          this.instance.observed.push(element);
        }
        disconnect() {}
      },
    );
    vi.stubGlobal("scrollTo", vi.fn());
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("fetch", vi.fn());
    const three = { ...rich, categories: [...(rich as unknown as { categories: unknown[] }).categories, { id: "cc", name: "Pizzas", icon: "🍕", products: [item("c1", "Calabresa", photo)] }] } as unknown as Menu;
    const { container } = render(<LojaRoot slug="boa-massa" initialMenu={three} />);
    const atEnd = (isIntersecting: boolean) => {
      const observer = instances.filter((i) => i.observed.some((element) => element.classList.contains("loja__end"))).at(-1)!;
      act(() => observer.cb([{ isIntersecting, target: observer.observed[0], boundingClientRect: { top: 0 } }]));
    };
    const current = () => container.querySelector('.loja__chip[aria-current="true"]')?.textContent;
    expect(current()).toContain("Lanches");

    // a rolagem leva a linha de leitura até Pizzas (o último chip alcançável)
    const spy = instances.filter((i) => i.observed.some((element) => element.id === "categoria-cc")).at(-1)!;
    const place = (id: string, top: number, bottom: number) => {
      (document.getElementById(id) as HTMLElement).getBoundingClientRect = () => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    };
    place("categoria-ca", -700, -300);
    place("categoria-cb", -300, 50);
    place("categoria-cc", 50, 500); // a linha de leitura (120 px no celular) cruza Pizzas
    act(() => spy.cb([]));
    expect(current()).toContain("Pizzas");

    atEnd(true);
    await userEvent.click(screen.getByRole("button", { name: "Bebidas" }));
    expect(current()).toContain("Bebidas"); // a página parou no fim: o chip tocado vence a leitura

    atEnd(false); // a pessoa saiu do fim: a rolagem volta a mandar no destaque
    expect(current()).toContain("Pizzas");
  });

  it("B1: tocar a última categoria no fim e SUBIR de volta ao topo destaca a PRIMEIRA, nunca a tocada", async () => {
    const instances: { cb: () => void; observed: Element[] }[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        instance: (typeof instances)[number];
        constructor(cb: () => void) {
          this.instance = { cb, observed: [] };
          instances.push(this.instance);
        }
        observe(element: Element) {
          this.instance.observed.push(element);
        }
        disconnect() {}
      },
    );
    vi.stubGlobal("scrollTo", vi.fn());
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("fetch", vi.fn());
    const { container } = render(<LojaRoot slug="boa-massa" initialMenu={rich} />);
    const current = () => container.querySelector('.loja__chip[aria-current="true"]')?.textContent;
    const fireAtEnd = (isIntersecting: boolean) => {
      const observer = instances.filter((i) => i.observed.some((element) => element.classList.contains("loja__end"))).at(-1)!;
      // o observador do fim usa a entrada; o da leitura ignora os argumentos
      (observer.cb as unknown as (entries: { isIntersecting: boolean }[]) => void)([{ isIntersecting }]);
    };

    act(() => fireAtEnd(true));
    await userEvent.click(screen.getByRole("button", { name: "Bebidas" }));
    expect(current()).toContain("Bebidas");
    act(() => fireAtEnd(false)); // subiu: saiu do fim, o pino cai
    // nenhuma seção sob a linha (topo): a leitura é null
    expect(current()).toContain("Lanches");
  });

  // M-07 (Fatia 2): a pílula do carrinho pulsa quando entra item ou o total muda, com ela já na tela; o total "rola".
  describe("pílula do carrinho (M-07)", () => {
    const animate = vi.fn();
    const motion = (reduced: boolean) => vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    function openCart() {
      animate.mockClear();
      Element.prototype.animate = animate;
      vi.stubGlobal("fetch", vi.fn());
      vi.stubGlobal("scrollTo", vi.fn());
      return render(<LojaRoot slug="boa-massa" initialMenu={rich} />);
    }

    it("a 1ª aparição não pulsa (tem animação própria); o 2º item pulsa (1 → 1,06 → 1, só transform)", async () => {
      motion(false);
      openCart();
      await userEvent.click(screen.getByRole("button", { name: "Adicionar X-Burger" }));
      expect(animate).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Mais um X-Burger" }));
      expect(animate).toHaveBeenCalledTimes(1);
      const [keyframes, options] = animate.mock.calls[0];
      expect(keyframes.map((frame: { transform: string }) => frame.transform)).toEqual(["translateX(-50%) scale(1)", "translateX(-50%) scale(1.06)", "translateX(-50%) scale(1)"]);
      expect(options).toMatchObject({ duration: 300 });
      expect(Object.keys(keyframes[0])).toEqual(["transform"]); // só transform (compositor)
    });

    it("menos movimento: sem pulso", async () => {
      motion(true);
      openCart();
      await userEvent.click(screen.getByRole("button", { name: "Adicionar X-Burger" }));
      await userEvent.click(screen.getByRole("button", { name: "Mais um X-Burger" }));
      expect(animate).not.toHaveBeenCalled();
    });

    it("o trecho do total é refeito quando o valor muda (é isso que faz o total 'rolar') e o botão não perde o foco", async () => {
      motion(false);
      const { container } = openCart();
      await userEvent.click(screen.getByRole("button", { name: "Adicionar X-Burger" }));
      const bar = screen.getByRole("button", { name: /Ver carrinho/ });
      const before = container.querySelector(".loja__roll");
      bar.focus();
      await userEvent.click(screen.getByRole("button", { name: "Mais um X-Burger" }));
      const after = container.querySelector(".loja__roll");
      expect(after).not.toBe(before);
      expect(after).toHaveTextContent(/R\$\s?40,00/);
      expect(screen.getByRole("button", { name: /Ver carrinho/ })).toBe(bar); // o mesmo botão: não foi remontado
    });
  });

  it("o HTML do servidor já traz o cabeçalho, a barra de categorias e os cartões (SSR/ISR intacto)", () => {
    const html = renderToString(<LojaRoot slug="boa-massa" initialMenu={rich} />);
    for (const text of ["Pizzaria Boa Massa", "Lanches", "Bebidas", "X-Burger", "Recebendo pedidos", "Adicionar X-Burger"]) expect(html).toContain(text);
  });
});
