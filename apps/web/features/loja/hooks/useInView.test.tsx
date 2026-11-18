import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInView } from "./useInView";

let callback: (entries: Array<{ isIntersecting: boolean }>) => void;
const disconnect = vi.fn();

beforeEach(() => {
  disconnect.mockClear();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: typeof callback) {
        callback = cb;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("useInView", () => {
  it("começa fora da janela e acompanha a visibilidade", () => {
    const { result } = renderHook(() => useInView(document.createElement("div")));
    expect(result.current).toBe(false);
    act(() => callback([{ isIntersecting: true }]));
    expect(result.current).toBe(true);
    act(() => callback([{ isIntersecting: false }]));
    expect(result.current).toBe(false);
  });

  it("sem elemento fica falso e, ao perder o elemento, volta a falso", () => {
    const element = document.createElement("div");
    const { result, rerender } = renderHook(({ el }: { el: Element | null }) => useInView(el), { initialProps: { el: element as Element | null } });
    act(() => callback([{ isIntersecting: true }]));
    expect(result.current).toBe(true);
    rerender({ el: null });
    expect(result.current).toBe(false);
  });

  it("desconecta ao desmontar e não quebra sem IntersectionObserver", () => {
    const { unmount } = renderHook(() => useInView(document.createElement("div")));
    unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.stubGlobal("IntersectionObserver", undefined);
    expect(renderHook(() => useInView(document.createElement("div"))).result.current).toBe(false);
  });
});
