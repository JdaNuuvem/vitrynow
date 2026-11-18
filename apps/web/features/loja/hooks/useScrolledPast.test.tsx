import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrolledPast } from "./useScrolledPast";

type Entry = { isIntersecting: boolean; boundingClientRect: { top: number } };
let callback: (entries: Entry[]) => void;
const disconnect = vi.fn();
const observe = vi.fn();

beforeEach(() => {
  disconnect.mockClear();
  observe.mockClear();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: Entry[]) => void) {
        callback = cb;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

const marker = () => document.createElement("div");

describe("useScrolledPast (identidade saiu de vista, sem ouvir scroll)", () => {
  it("começa em 'não passou' e observa o marcador", () => {
    const element = marker();
    const { result } = renderHook(() => useScrolledPast(element));
    expect(result.current).toBe(false);
    expect(observe).toHaveBeenCalledWith(element);
  });

  it("marcador fora da tela e ACIMA: passou", () => {
    const { result } = renderHook(() => useScrolledPast(marker()));
    act(() => callback([{ isIntersecting: false, boundingClientRect: { top: -120 } }]));
    expect(result.current).toBe(true);
  });

  it("marcador fora da tela mas ABAIXO (página aberta no meio de outra tela): não conta como passou", () => {
    const { result } = renderHook(() => useScrolledPast(marker()));
    act(() => callback([{ isIntersecting: false, boundingClientRect: { top: 900 } }]));
    expect(result.current).toBe(false);
  });

  it("voltou à vista: some", () => {
    const { result } = renderHook(() => useScrolledPast(marker()));
    act(() => callback([{ isIntersecting: false, boundingClientRect: { top: -50 } }]));
    act(() => callback([{ isIntersecting: true, boundingClientRect: { top: 10 } }]));
    expect(result.current).toBe(false);
  });

  it("o marcador some (detalhe por cima): a barra fixa zera e não volta sozinha", () => {
    const { result, rerender } = renderHook(({ element }: { element: Element | null }) => useScrolledPast(element), { initialProps: { element: marker() as Element | null } });
    act(() => callback([{ isIntersecting: false, boundingClientRect: { top: -80 } }]));
    expect(result.current).toBe(true);
    rerender({ element: null });
    expect(result.current).toBe(false);
  });

  it("sem marcador (outra aba) não observa nada; ao receber o elemento, passa a observar", () => {
    const { rerender } = renderHook(({ element }: { element: Element | null }) => useScrolledPast(element), { initialProps: { element: null as Element | null } });
    expect(observe).not.toHaveBeenCalled();
    rerender({ element: marker() });
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it("desconecta ao desmontar e não usa o evento scroll", () => {
    const add = vi.spyOn(window, "addEventListener");
    const { unmount } = renderHook(() => useScrolledPast(marker()));
    unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(add.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(0);
    add.mockRestore();
  });

  it("sem IntersectionObserver (ambiente antigo) não quebra", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    expect(renderHook(() => useScrolledPast(marker())).result.current).toBe(false);
  });
});
