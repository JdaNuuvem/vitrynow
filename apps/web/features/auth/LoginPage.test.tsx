import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AuthGateway } from "@/core/gateways/AuthGateway";
import { AuthServicesProvider } from "@/core/services/AuthServices";
import { LoginPage } from "./LoginPage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

// UI-PW-05: o login NÃO muda. Contas existentes com senha curta continuam entrando: nenhum minLength, nenhum aviso, nenhuma ajuda.
describe("LoginPage: sem regra de tamanho (SEC-29)", () => {
  it("o campo de senha do login não tem minlength nem ajuda de senha nova", () => {
    render(
      <AuthServicesProvider auth={{ login: vi.fn() } as unknown as AuthGateway}>
        <LoginPage />
      </AuthServicesProvider>,
    );
    const password = document.querySelector("input[type=password]") as HTMLInputElement;
    expect(password).not.toBeNull();
    expect(password).not.toHaveAttribute("minlength");
    expect(screen.queryByText(/Pelo menos 10 caracteres/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mostrar senha/ })).not.toBeInTheDocument();
  });
});
