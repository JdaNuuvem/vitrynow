import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlatformCreditAdjustment } from "./PlatformCreditAdjustment";

const api = vi.hoisted(() => ({ creditChallenge: vi.fn(), verifyCreditChallenge: vi.fn(), grantCredits: vi.fn() }));
vi.mock("./platformApi", () => ({ platformApi: api }));
vi.mock("./PlatformShell", () => ({ usePlatform: () => ({ request: (action: () => unknown) => action() }) }));

describe("confirmação de créditos da plataforma", () => {
  it("reutiliza a chave e o comprovante ao confirmar após resultado incerto", async () => {
    api.creditChallenge.mockResolvedValue({ ok: true, data: { challengeId: "qa-credit", maskedEmail: "qa***@example.test" } });
    api.verifyCreditChallenge.mockResolvedValue({ ok: true });
    api.grantCredits.mockResolvedValueOnce({ ok: false, status: 503, error: "Conexão indisponível." });
    api.grantCredits.mockResolvedValueOnce({ ok: true, data: { idempotent: true } });
    const done = vi.fn();
    const user = userEvent.setup();
    render(<PlatformCreditAdjustment storeId="loja-teste" storeName="Loja de teste" onDone={done} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Quantidade"), "4");
    await user.type(screen.getByLabelText("Observação"), "Ajuste de teste");
    await user.click(screen.getByRole("button", { name: "Revisar lançamento" }));
    expect(api.grantCredits).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Enviar código de segurança" }));
    await user.type(await screen.findByLabelText(/Código enviado/), "123456");
    await user.type(screen.getByLabelText("Sua senha"), "senha-descartavel");
    await user.click(screen.getByRole("button", { name: "Confirmar lançamento" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Repita a confirmação/);
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(screen.getByLabelText("Sua senha")).toHaveValue("");
    await user.type(screen.getByLabelText("Sua senha"), "senha-descartavel");
    await user.click(screen.getByRole("button", { name: "Confirmar lançamento" }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(api.verifyCreditChallenge).toHaveBeenCalledTimes(1);
    expect(api.verifyCreditChallenge).toHaveBeenCalledWith("qa-credit", "123456");
    const [original, retry] = api.grantCredits.mock.calls;
    expect(original[1]).toMatchObject({ credits: 4, reason: "GRANT" });
    expect(original[2]).toEqual(expect.any(String));
    expect(retry).toEqual(original);
  });
});
