import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpResult } from "@/core/http/HttpClient";
import { PanelServicesProvider, type PanelServices } from "@/core/services/PanelServices";
import { useImpressoras } from "@/features/impressoras/hooks/useImpressoras";
import { useSubscription } from "@/features/planos/hooks/useSubscription";
import { SecurityConfirmProvider } from "./SecurityConfirmProvider";

// SEC-13: com MFA_ENFORCED=true a API devolve 403 MFA_REQUIRED nestas ações do dono. Com o provedor REAL (diálogo, código, repetição),
// prova que a tela abre a confirmação, manda o código e repete a MESMA chamada com o cabeçalho x-mfa-challenge.
const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const ok = <T,>(data: T): HttpResult<T> => ({ ok: true, data });
const needMfa = (): HttpResult<never> => ({ ok: false, status: 403, error: "Confirme com o código enviado por e-mail.", code: "MFA_REQUIRED" });
const HEADERS = { headers: { "x-mfa-challenge": "ch-1" } };

const mfa = {
  requestChallenge: vi.fn(),
  verify: vi.fn(),
};

function setup<T>(services: Partial<PanelServices>, hook: () => T) {
  const all = { mfa, ...services } as unknown as PanelServices;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PanelServicesProvider services={all}>
      <SecurityConfirmProvider>{children}</SecurityConfirmProvider>
    </PanelServicesProvider>
  );
  return renderHook(hook, { wrapper });
}

async function confirmWithCode(code = "123456") {
  await userEvent.type(await screen.findByLabelText("Código de 6 dígitos"), code);
  await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
}

beforeEach(() => {
  mfa.requestChallenge.mockReset().mockResolvedValue(ok({ challengeId: "ch-1", expiresAt: "2026-11-18T20:00:00Z", maskedEmail: "d***@x.com" }));
  mfa.verify.mockReset().mockResolvedValue(ok({}));
});

describe("ações do dono com MFA (SEC-13): impressoras", () => {
  const tokens = () => {
    const create = vi.fn().mockResolvedValueOnce(needMfa()).mockResolvedValue(ok({ token: { id: "t1", label: "Balcão", token: "dt_abc" } }));
    const revoke = vi.fn().mockResolvedValueOnce(needMfa()).mockResolvedValue(ok({}));
    const list = vi.fn().mockResolvedValue(ok({ tokens: [] }));
    return { create, revoke, list };
  };

  it("criar chave: 403 abre o diálogo da finalidade certa, e com o código repete a criação com o cabeçalho", async () => {
    const deviceTokens = tokens();
    const { result } = setup({ deviceTokens } as never, () => useImpressoras());
    await waitFor(() => expect(deviceTokens.list).toHaveBeenCalled());
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.create("Balcão");
    });
    await waitFor(() => expect(mfa.requestChallenge).toHaveBeenCalledWith("device_token_create"));
    await confirmWithCode();
    const outcome = await pending;
    expect(mfa.verify).toHaveBeenCalledWith("ch-1", "123456");
    expect(deviceTokens.create).toHaveBeenCalledTimes(2);
    expect(deviceTokens.create).toHaveBeenLastCalledWith("Balcão", HEADERS);
    expect(outcome).toEqual({ status: "created", token: "dt_abc" });
  });

  it("revogar chave: mesma coisa, com a finalidade device_token_revoke", async () => {
    const deviceTokens = tokens();
    const { result } = setup({ deviceTokens } as never, () => useImpressoras());
    await waitFor(() => expect(deviceTokens.list).toHaveBeenCalled());
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.revoke("t1");
    });
    await waitFor(() => expect(mfa.requestChallenge).toHaveBeenCalledWith("device_token_revoke"));
    await confirmWithCode();
    const outcome = await pending;
    expect(deviceTokens.revoke).toHaveBeenLastCalledWith("t1", HEADERS);
    expect(outcome).toEqual({ status: "done" });
  });

  it("cancelar o diálogo NÃO cria a chave (uma chamada só) e devolve erro, não 'sucesso'", async () => {
    const deviceTokens = tokens();
    const { result } = setup({ deviceTokens } as never, () => useImpressoras());
    await waitFor(() => expect(deviceTokens.list).toHaveBeenCalled());
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.create("Balcão");
    });
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    const outcome = (await pending) as { status: string };
    expect(deviceTokens.create).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("error");
  });
});

describe("ações do dono com MFA (SEC-13): assinatura", () => {
  it("cancelar assinatura: 403 abre o diálogo cancel_subscription e repete com o cabeçalho", async () => {
    const subscription = {
      listPlans: vi.fn().mockResolvedValue(ok({ plans: [] })),
      getSubscription: vi.fn().mockResolvedValue(ok({ subscription: { status: "ACTIVE" } })),
      cancel: vi.fn().mockResolvedValueOnce(needMfa()).mockResolvedValue(ok({ subscription: { status: "CANCELED" } })),
    };
    const { result } = setup({ subscription } as never, () => useSubscription());
    await waitFor(() => expect(subscription.getSubscription).toHaveBeenCalled());
    let pending!: Promise<string | null>;
    act(() => {
      pending = result.current.cancel();
    });
    await waitFor(() => expect(mfa.requestChallenge).toHaveBeenCalledWith("cancel_subscription"));
    await confirmWithCode();
    const message = await pending;
    expect(subscription.cancel).toHaveBeenCalledTimes(2);
    expect(subscription.cancel).toHaveBeenLastCalledWith(HEADERS);
    expect(message).toBeNull();
  });
});
