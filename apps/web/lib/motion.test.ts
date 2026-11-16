import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion, scrollBehavior } from "./motion";

const mockMatchMedia = (matches: boolean) =>
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

describe("movimento reduzido", () => {
  it("quem pediu menos movimento recebe rolagem sem animação", () => {
    mockMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe("auto");
  });

  it("sem a preferência, a rolagem é suave", () => {
    mockMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("sem matchMedia (ambiente antigo) não quebra", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});
