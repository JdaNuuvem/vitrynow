import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceToken } from "@/core/domain/deviceTokens";
import type { DeviceTokensGateway } from "@/core/gateways/DeviceTokensGateway";
import type { HttpResult } from "@/core/http/HttpClient";
import { PanelServicesProvider, type PanelServices } from "@/core/services/PanelServices";
import { useImpressoras } from "./useImpressoras";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }));
const { push } = router;
vi.mock("next/navigation", () => ({ useRouter: () => router }));
// runProtected real faz o passo de MFA (testado em features/seguranca); aqui basta repassar a ação.
vi.mock("@/features/seguranca/SecurityConfirmProvider", () => ({
  useSecurityConfirm: () => ({ runProtected: async (_purpose: string, action: (options?: unknown) => Promise<unknown>) => action() }),
}));

const row: DeviceToken = { id: "t1", label: "Balcão", revokedAt: null, lastSeenAt: null, online: false, tokenPreview: "mcd_t1_…ab12" };

function setup(gateway: Partial<DeviceTokensGateway>) {
  const deviceTokens = { list: vi.fn(), create: vi.fn(), revoke: vi.fn(), ...gateway } as unknown as DeviceTokensGateway;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PanelServicesProvider services={{ deviceTokens } as unknown as PanelServices}>{children}</PanelServicesProvider>
  );
  return { ...renderHook(() => useImpressoras(), { wrapper }), deviceTokens };
}

const ok = <T,>(data: T): HttpResult<T> => ({ ok: true, data });
const fail = (status: number, error = "x"): HttpResult<never> => ({ ok: false, status, error });

describe("useImpressoras (NG-06)", () => {
  beforeEach(() => push.mockClear());

  it("lista sem o campo token (só tokenPreview) funciona", async () => {
    const t = setup({ list: vi.fn().mockResolvedValue(ok({ tokens: [row] })) });
    await waitFor(() => expect(t.result.current.tokens).toEqual([row]));
    expect(t.result.current.forbidden).toBe(false);
  });

  it("403 na lista (STAFF): marca restrito e não finge lista vazia", async () => {
    const t = setup({ list: vi.fn().mockResolvedValue(fail(403)) });
    await waitFor(() => expect(t.result.current.forbidden).toBe(true));
    expect(t.result.current.tokens).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("401 na lista manda para o login", async () => {
    setup({ list: vi.fn().mockResolvedValue(fail(401)) });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });

  it("criar devolve a chave completa uma vez", async () => {
    const t = setup({
      list: vi.fn().mockResolvedValue(ok({ tokens: [] })),
      create: vi.fn().mockResolvedValue(ok({ token: { ...row, token: "mcd_t1_segredo" } })),
    });
    let outcome: unknown;
    await act(async () => {
      outcome = await t.result.current.create("Balcão");
    });
    expect(outcome).toEqual({ status: "created", token: "mcd_t1_segredo" });
  });

  it("criar sem `token` na resposta vira erro claro, não 'undefined' na tela", async () => {
    const t = setup({
      list: vi.fn().mockResolvedValue(ok({ tokens: [] })),
      create: vi.fn().mockResolvedValue(ok({ token: row })),
    });
    let outcome: { status: string; message?: string } | undefined;
    await act(async () => {
      outcome = (await t.result.current.create("Balcão")) as typeof outcome;
    });
    expect(outcome?.status).toBe("error");
    expect(outcome?.message).toContain("não a devolveu");
  });

  it("criar com 403 marca restrito", async () => {
    const t = setup({ list: vi.fn().mockResolvedValue(ok({ tokens: [] })), create: vi.fn().mockResolvedValue(fail(403)) });
    await act(async () => {
      await t.result.current.create("x");
    });
    expect(t.result.current.forbidden).toBe(true);
  });
});
