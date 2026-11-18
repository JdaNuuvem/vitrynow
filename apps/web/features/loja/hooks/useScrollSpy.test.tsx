import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollSpy } from "./useScrollSpy";

let callback: () => void;
let observed: string[];
let options: IntersectionObserverInit | undefined;
const disconnect = vi.fn();

const ids = ["categoria-a", "categoria-b", "categoria-c"];
const OFFSET = 120;

// Posição de cada seção na janela (top/bottom), como o navegador a daria. O observador só avisa; quem lê é o hook.
function place(positions: Record<string, [number, number]>) {
  for (const [id, [top, bottom]] of Object.entries(positions)) {
    const element = document.getElementById(id);
    if (!element) continue;
    element.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  }
}

// a linha em OFFSET (120) cruza a seção `which`
const lineIn = (which: "a" | "b" | "c" | "above" | "gap") => {
  const layouts = {
    a: { "categoria-a": [-50, 300], "categoria-b": [300, 700], "categoria-c": [700, 1100] },
    b: { "categoria-a": [-600, -100], "categoria-b": [-100, 400], "categoria-c": [400, 800] },
    c: { "categoria-a": [-900, -500], "categoria-b": [-500, -100], "categoria-c": [-100, 300] },
    above: { "categoria-a": [400, 800], "categoria-b": [800, 1200], "categoria-c": [1200, 1600] },
    gap: { "categoria-a": [-400, 60], "categoria-b": [260, 600], "categoria-c": [600, 900] },
  } as const;
  place(layouts[which] as unknown as Record<string, [number, number]>);
};

beforeEach(() => {
  observed = [];
  disconnect.mockClear();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: () => void, opts?: IntersectionObserverInit) {
        callback = cb;
        options = opts;
      }
      observe(element: Element) {
        observed.push(element.id);
      }
      disconnect = disconnect;
    },
  );
  for (const id of ids) {
    const section = document.createElement("section");
    section.id = id;
    document.body.appendChild(section);
  }
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const fire = () => act(() => callback());

describe("useScrollSpy (chips sticky, sem listener de scroll)", () => {
  it("observa cada seção que existe na página", () => {
    renderHook(() => useScrollSpy(ids, { topOffsetPx: OFFSET }));
    expect(observed).toEqual(ids);
  });

  it("começa sem categoria ativa e passa a ativa a seção que contém a linha de leitura", () => {
    const { result } = renderHook(() => useScrollSpy(ids, { topOffsetPx: OFFSET }));
    expect(result.current).toBeNull();
    lineIn("b");
    fire();
    expect(result.current).toBe("categoria-b");
    lineIn("c");
    fire();
    expect(result.current).toBe("categoria-c");
  });

  it("um salto que PULA seções (do fim ao topo) acerta mesmo sem aviso de cada uma", () => {
    const { result } = renderHook(() => useScrollSpy(ids, { topOffsetPx: OFFSET }));
    lineIn("c");
    fire();
    expect(result.current).toBe("categoria-c");
    // volta ao topo de uma vez: a, b e c mudam de uma vez; o hook lê a posição real, não depende de cada aviso
    lineIn("a");
    fire();
    expect(result.current).toBe("categoria-a");
  });

  it("página acima de todas as seções (rolou de volta ao topo): o destaque volta ao começo, não fica na última", () => {
    const { result } = renderHook(() => useScrollSpy(ids, { topOffsetPx: OFFSET }));
    lineIn("c");
    fire();
    lineIn("above");
    fire();
    expect(result.current).toBeNull();
  });

  it("entre duas seções (linha num espaço) mantém a anterior em vez de apagar o destaque", () => {
    const { result } = renderHook(() => useScrollSpy(ids, { topOffsetPx: OFFSET }));
    lineIn("a");
    fire();
    lineIn("gap");
    fire();
    expect(result.current).toBe("categoria-a");
  });

  it("a faixa de leitura é uma linha de 1 px logo abaixo das barras fixas", () => {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    renderHook(() => useScrollSpy(ids, { topOffsetPx: 96 }));
    expect(options?.rootMargin).toBe("-96px 0px -703px 0px");
  });

  it("a linha é recalculada quando a altura da janela muda (sem ouvir scroll)", () => {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    renderHook(() => useScrollSpy(ids, { topOffsetPx: 96 }));
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(options?.rootMargin).toBe("-96px 0px -503px 0px");
    expect(disconnect).toHaveBeenCalled();
  });

  it("janela mais baixa que as barras não gera margem negativa inválida", () => {
    Object.defineProperty(window, "innerHeight", { value: 50, configurable: true });
    renderHook(() => useScrollSpy(ids, { topOffsetPx: 96 }));
    expect(options?.rootMargin).toBe("-96px 0px -0px 0px");
  });

  it("não escuta o evento scroll", () => {
    const add = vi.spyOn(window, "addEventListener");
    renderHook(() => useScrollSpy(ids));
    expect(add.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(0);
    add.mockRestore();
  });

  it("desconecta ao desmontar e ao mudar a lista de seções", () => {
    const { rerender, unmount } = renderHook(({ list }) => useScrollSpy(list), { initialProps: { list: ids } });
    rerender({ list: ["categoria-a"] });
    expect(disconnect).toHaveBeenCalledTimes(1);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it("desligado (outra tela por cima) não observa; ao religar observa os elementos ATUAIS, não os antigos", () => {
    const { rerender } = renderHook(({ on }) => useScrollSpy(ids, { enabled: on }), { initialProps: { on: false } });
    expect(observed).toEqual([]);
    rerender({ on: true });
    expect(observed).toEqual(ids);
    rerender({ on: false });
    expect(disconnect).toHaveBeenCalledTimes(1);
    // a tela sai e volta com elementos NOVOS (mesmos ids): precisa observar os novos
    document.body.innerHTML = "";
    for (const id of ids) {
      const section = document.createElement("section");
      section.id = id;
      document.body.appendChild(section);
    }
    observed = [];
    rerender({ on: true });
    expect(observed).toEqual(ids);
  });

  it("A2: ao (re)ligar, lê a posição NA HORA, sem esperar a próxima rolagem (volta do detalhe com a rolagem já restaurada)", () => {
    lineIn("b");
    const { result, rerender } = renderHook(({ on }) => useScrollSpy(ids, { topOffsetPx: OFFSET, enabled: on }), { initialProps: { on: false } });
    expect(result.current).toBeNull();
    rerender({ on: true });
    expect(result.current).toBe("categoria-b"); // nenhum aviso do observador foi disparado
  });

  it("sem IntersectionObserver (ambiente antigo) não quebra", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    expect(renderHook(() => useScrollSpy(ids)).result.current).toBeNull();
  });

  it("sem seções não observa nada", () => {
    renderHook(() => useScrollSpy([]));
    expect(observed).toEqual([]);
  });
});
