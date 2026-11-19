import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRevealOnEnter } from "./useRevealOnEnter";

type Entry = { isIntersecting: boolean; target: Element };
let callback: (entries: Entry[]) => void;
let observed: Element[];
let observerOptions: IntersectionObserverInit | undefined;
const disconnect = vi.fn();
const unobserve = vi.fn();

function mountCards(tops: number[]) {
  document.body.innerHTML = "";
  return tops.map((top, index) => {
    const card = document.createElement("article");
    card.className = "loja__item";
    const name = document.createElement("button");
    name.setAttribute("data-product-id", "p" + index);
    card.appendChild(name);
    card.getBoundingClientRect = () => ({ top, bottom: top + 130, left: 0, right: 0, width: 0, height: 130, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(card);
    return card;
  });
}

const reducedMotion = (matches: boolean) =>
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }));

beforeEach(() => {
  observed = [];
  disconnect.mockClear();
  unobserve.mockClear();
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  reducedMotion(false);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: typeof callback, options?: IntersectionObserverInit) {
        callback = cb;
        observerOptions = options;
      }
      observe(element: Element) {
        observed.push(element);
      }
      unobserve = unobserve;
      disconnect = disconnect;
    },
  );
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("useRevealOnEnter (M-01: cartão sobe e aparece na 1ª vez que entra na tela)", () => {
  it("só marca os cartões ABAIXO da dobra; o que já está à vista (HTML do servidor) nunca é escondido", () => {
    const [visible, below1, below2] = mountCards([100, 900, 1200]);
    renderHook(() => useRevealOnEnter(true));
    expect(visible).not.toHaveAttribute("data-reveal");
    expect(below1).toHaveAttribute("data-reveal", "pre");
    expect(below2).toHaveAttribute("data-reveal", "pre");
    expect(observed).toEqual([below1, below2]);
  });

  it("ao entrar na tela o cartão passa a 'in' com atraso crescente (cascata) e deixa de ser observado", () => {
    const [a, b, c] = mountCards([900, 1000, 1100]);
    renderHook(() => useRevealOnEnter(true));
    act(() =>
      callback([
        { isIntersecting: true, target: a },
        { isIntersecting: true, target: b },
        { isIntersecting: false, target: c },
      ]),
    );
    expect(a).toHaveAttribute("data-reveal", "in");
    expect(a.style.getPropertyValue("--reveal-i")).toBe("0");
    expect(b).toHaveAttribute("data-reveal", "in");
    expect(b.style.getPropertyValue("--reveal-i")).toBe("1");
    expect(c).toHaveAttribute("data-reveal", "pre"); // ainda fora da tela
    expect(unobserve).toHaveBeenCalledTimes(2);
  });

  it("a cascata para no 8º: do 9º em diante entram juntos (--reveal-i máximo 7)", () => {
    const cards = mountCards(Array.from({ length: 12 }, (_, i) => 900 + i * 140));
    renderHook(() => useRevealOnEnter(true));
    act(() => callback(cards.map((target) => ({ isIntersecting: true, target }))));
    const delays = cards.map((card) => Number(card.style.getPropertyValue("--reveal-i")));
    expect(delays).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7]);
  });

  it("menos movimento: não marca nem observa nada (o cartão nunca fica escondido)", () => {
    reducedMotion(true);
    const cards = mountCards([900, 1000]);
    renderHook(() => useRevealOnEnter(true));
    cards.forEach((card) => expect(card).not.toHaveAttribute("data-reveal"));
    expect(observed).toEqual([]);
  });

  it("desligado (outra tela por cima) não faz nada", () => {
    const [card] = mountCards([900]);
    renderHook(() => useRevealOnEnter(false));
    expect(card).not.toHaveAttribute("data-reveal");
  });

  it("não usa o evento scroll", () => {
    mountCards([900]);
    const add = vi.spyOn(window, "addEventListener");
    renderHook(() => useRevealOnEnter(true));
    expect(add.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(0);
    add.mockRestore();
  });

  it("desmontar com cartões ainda escondidos não deixa nenhum preso em 'pre'", () => {
    const [a, b] = mountCards([900, 1000]);
    const { unmount } = renderHook(() => useRevealOnEnter(true));
    act(() => callback([{ isIntersecting: true, target: a }]));
    unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(b).not.toHaveAttribute("data-reveal");
  });

  it("volta do detalhe: cartão que já tinha aparecido não anima de novo", () => {
    const [a, b] = mountCards([900, 1000]);
    const { rerender } = renderHook(({ on }) => useRevealOnEnter(on), { initialProps: { on: true } });
    act(() => callback([{ isIntersecting: true, target: a }]));
    rerender({ on: false });
    // a tela remonta: elementos novos com os mesmos produtos
    const again = mountCards([900, 1000]);
    rerender({ on: true });
    expect(again[0]).not.toHaveAttribute("data-reveal"); // já visto
    expect(again[1]).toHaveAttribute("data-reveal", "pre"); // ainda não visto
    expect(b).toBeDefined();
  });

  it("usa uma margem inferior para revelar um pouco ANTES de o cartão estar inteiro à vista", () => {
    mountCards([900]);
    renderHook(() => useRevealOnEnter(true));
    expect(observerOptions?.rootMargin).toBe("0px 0px -8% 0px");
  });
});

// Rede de segurança (condição de merge do Atlas, R1 da Da Vinci): o observador pode demorar (aba de fundo, aparelho
// lento, salto grande). Cartão que já está na tela e continua escondido depois de 600 ms aparece SEM animação.
describe("useRevealOnEnter: rede de segurança contra faixa em branco (R1)", () => {
  const goOnScreen = (card: HTMLElement) => {
    card.getBoundingClientRect = () => ({ top: 300, bottom: 430, left: 0, right: 0, width: 0, height: 130, x: 0, y: 300, toJSON: () => ({}) }) as DOMRect;
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("o observador NUNCA avisa, mas o cartão que está na tela aparece sem animação depois de 600 ms", () => {
    const [card] = mountCards([900]);
    renderHook(() => useRevealOnEnter(true));
    expect(card).toHaveAttribute("data-reveal", "pre");
    goOnScreen(card); // a pessoa rolou até ele; nenhum aviso do observador chega
    act(() => {
      vi.advanceTimersByTime(250); // 1ª vez que o relógio o vê na tela
    });
    act(() => {
      vi.advanceTimersByTime(500); // 500 ms depois: ainda dentro do prazo
    });
    expect(card).toHaveAttribute("data-reveal", "pre");
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(card).toHaveAttribute("data-reveal", "shown"); // sem animação (CSS: transition none)
  });

  it("cartão fora da tela continua escondido por mais tempo que passe (não gasta nem revela à toa)", () => {
    const [card] = mountCards([900]);
    renderHook(() => useRevealOnEnter(true));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(card).toHaveAttribute("data-reveal", "pre");
  });

  it("se o observador chegou primeiro, o cartão fica 'in' (com animação) e o relógio não mexe mais nele", () => {
    const [card] = mountCards([900]);
    renderHook(() => useRevealOnEnter(true));
    act(() => callback([{ isIntersecting: true, target: card }]));
    goOnScreen(card);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(card).toHaveAttribute("data-reveal", "in");
  });

  it("o prazo recomeça se o cartão sai da tela antes de completar 600 ms", () => {
    const [card] = mountCards([900]);
    const offScreen = card.getBoundingClientRect;
    renderHook(() => useRevealOnEnter(true));
    goOnScreen(card);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    card.getBoundingClientRect = offScreen; // saiu da tela
    act(() => {
      vi.advanceTimersByTime(250);
    });
    goOnScreen(card); // voltou: contagem nova
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(card).toHaveAttribute("data-reveal", "pre");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(card).toHaveAttribute("data-reveal", "shown");
  });

  it("o relógio para sozinho quando não resta cartão escondido, e ao desmontar", () => {
    const [a] = mountCards([900]);
    const { unmount } = renderHook(() => useRevealOnEnter(true));
    expect(vi.getTimerCount()).toBe(1);
    act(() => callback([{ isIntersecting: true, target: a }]));
    expect(vi.getTimerCount()).toBe(0);
    unmount();

    const [b] = mountCards([900]);
    const second = renderHook(() => useRevealOnEnter(true));
    expect(b).toHaveAttribute("data-reveal", "pre");
    expect(vi.getTimerCount()).toBe(1);
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("menos movimento: nem relógio nem marcação", () => {
    reducedMotion(true);
    mountCards([900]);
    renderHook(() => useRevealOnEnter(true));
    expect(vi.getTimerCount()).toBe(0);
  });
});

