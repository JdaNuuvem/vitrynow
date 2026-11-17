import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReducedMotion } from "./useReducedMotion";

afterEach(() => vi.unstubAllGlobals());

function stubMedia(matches: boolean) {
  let listener: (() => void) | null = null;
  const media = {
    matches,
    addEventListener: vi.fn((_: string, fn: () => void) => (listener = fn)),
    removeEventListener: vi.fn(() => (listener = null)),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  return {
    media,
    change(next: boolean) {
      media.matches = next;
      listener?.();
    },
  };
}

describe("useReducedMotion", () => {
  it("reflete a preferência do sistema", () => {
    stubMedia(true);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true);
  });

  it("acompanha a mudança da preferência sem recarregar", () => {
    const stub = stubMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => stub.change(true));
    expect(result.current).toBe(true);
  });

  it("solta o ouvinte ao desmontar", () => {
    const stub = stubMedia(false);
    renderHook(() => useReducedMotion()).unmount();
    expect(stub.media.removeEventListener).toHaveBeenCalled();
  });

  it("sem matchMedia (ambiente antigo) assume que não pediu e não quebra", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false);
  });

  it("no servidor assume que não pediu (sem window não há como saber)", () => {
    function Probe() {
      return <span>{String(useReducedMotion())}</span>;
    }
    expect(renderToString(<Probe />)).toContain("false");
  });
});
