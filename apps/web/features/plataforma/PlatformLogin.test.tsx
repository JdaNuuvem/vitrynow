import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlatformLogin } from "./PlatformLogin";

const mocks = vi.hoisted(() => ({ login: vi.fn(), verifyLogin: vi.fn(), replace: vi.fn() }));
vi.mock("./platformApi", () => ({ platformApi: mocks }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));

describe("entrada da plataforma", () => {
  it("só abre a área depois de verificar o código e apaga a senha do formulário", async () => {
    mocks.login.mockResolvedValue({ ok: true, data: { challengeId: "qa-challenge", maskedEmail: "qa***@example.test" } });
    mocks.verifyLogin.mockResolvedValueOnce({ ok: false, error: "Pode conferir o código?", status: 400, code: "MFA_INVALID" });
    mocks.verifyLogin.mockResolvedValueOnce({ ok: true, data: { role: "SUPPORT" } });
    const user = userEvent.setup();
    render(<PlatformLogin />);
    await user.type(screen.getByLabelText("E-mail"), "qa@example.test");
    await user.type(screen.getByLabelText("Senha"), "senha-descartavel");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    expect(await screen.findByText("Digite o código enviado para qa***@example.test.")).toBeInTheDocument();
    expect(mocks.login).toHaveBeenCalledWith("qa@example.test", "senha-descartavel");
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Senha")).not.toBeInTheDocument();
    const input = screen.getByLabelText("Código de segurança");
    await user.type(input, "000000");
    await user.click(screen.getByRole("button", { name: "Confirmar entrada" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pode conferir o código?");
    expect(mocks.replace).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, "012345");
    await user.click(screen.getByRole("button", { name: "Confirmar entrada" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/plataforma"));
    expect(mocks.verifyLogin).toHaveBeenLastCalledWith("qa-challenge", "012345");
  });
});
