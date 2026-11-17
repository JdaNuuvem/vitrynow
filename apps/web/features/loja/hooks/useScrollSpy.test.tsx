import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollSpy } from "./useScrollSpy";

type Callback = (entries: Array<{ target: { id: string }; isIntersecting: boolean }>) => void;

let callback: Callback;
let observed: string[];
let options: IntersectionObserverInit | undefined;
const disconnect = vi.fn();

beforeEach(() => {
  observed = [];
  disconnect.mockClear();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: Callback, opts?: IntersectionObserverInit) {
        callback = cb;
        options = opts;
      }
      observe(element: Element) {
        observed.push(element.id);
      }
      disconnect = disconnect;
    },
  );
  for (const id of ["categoria-a", "categoria-b", "categoria-c"]) {
    const section = document.createElement("section");
    section.id = id;
    document.body.appendChild(section);
  }
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const ids = ["categoria-a", "categoria-b", "categoria-c"];
const cross = (id: string, isIntersecting: boolean) => ({ target: { id }, isIntersecting });

describe("useScrollSpy (chips sticky, sem listener de scroll)", () => {
  it("observa cada seção que existe na página", () => {
    renderHook(() => useScrollSpy(ids));
    expect(observed).toEqual(ids);
  });

  it("começa sem categoria ativa e passa a ativa a que cruza a faixa", () => {
    const { result } = renderHook(() => useScrollSpy(ids));
    expect(result.current).toBeNull();
    act(() => callback([cross("categoria-b", true)]));
    expect(result.current).toBe("categoria-b");
  });

  it("com duas cruzando, vale a primeira na ordem da página", () => {
    const { result } = renderHook(() => useScrollSpy(ids));
    act(() => callback([cross("categoria-c", true), cross("categoria-b", true)]));
    expect(result.current).toBe("categoria-b");
    act(() => callback([cross("categoria-b", false)]));
    expect(result.current).toBe("categoria-c");
  });

  it("entre duas seções (nenhuma cruza) mantém a anterior em vez de apagar o destaque", () => {
    const { result } = renderHook(() => useScrollSpy(ids));
    act(() => callback([cross("categoria-a", true)]));
    act(() => callback([cross("categoria-a", false)]));
    expect(result.current).toBe("categoria-a");
  });

  it("a faixa começa abaixo do cabeçalho fixo", () => {
    renderHook(() => useScrollSpy(ids, { topOffsetPx: 96 }));
    expect(options?.rootMargin).toBe("-96px 0px -55% 0px");
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

  it("sem IntersectionObserver (ambiente antigo) não quebra", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    expect(renderHook(() => useScrollSpy(ids)).result.current).toBeNull();
  });

  it("sem seções não observa nada", () => {
    renderHook(() => useScrollSpy([]));
    expect(observed).toEqual([]);
  });
});
