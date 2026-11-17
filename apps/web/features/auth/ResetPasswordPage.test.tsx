import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthGateway } from "@/core/gateways/AuthGateway";
import { AuthServicesProvider } from "@/core/services/AuthServices";
import { ResetPasswordPage } from "./ResetPasswordPage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function setup(url: string, { strict = false } = {}) {
  window.history.replaceState(null, "", url);
  const resetPassword = vi.fn().mockResolvedValue({ ok: true, data: {} });
  const auth = { resetPassword } as unknown as AuthGateway;
  const tree = (
    <AuthServicesProvider auth={auth}>
      <ResetPasswordPage />
    </AuthServicesProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { resetPassword };
}

describe("ResetPasswordPage: token no fragmento (ST-56 / NG-17)", () => {
  let before = 0;
  beforeEach(() => {
    before = window.history.length;
  });
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("lê o token do fragmento, mostra o formulário e APAGA a barra de endereço na hora", () => {
    setup("/reset-senha#token=segredo-do-fragmento");
    expect(screen.getByPlaceholderText("Nova senha")).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("segredo-do-fragmento");
    expect(window.location.pathname + window.location.search).toBe("/reset-senha");
  });

  it("aceita a query legada (e-mails já enviados) e a apaga da barra", () => {
    setup("/reset-senha?token=segredo-da-query");
    expect(screen.getByPlaceholderText("Nova senha")).toBeInTheDocument();
    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain("segredo-da-query");
  });

  it("com fragmento e query, vale o fragmento e os dois somem da barra", async () => {
    const { resetPassword } = setup("/reset-senha?token=velho#token=novo");
    expect(window.location.href).not.toMatch(/velho|novo/);
    await userEvent.type(screen.getByPlaceholderText("Nova senha"), "minhaSenha1");
    await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(resetPassword).toHaveBeenCalledWith("novo", "minhaSenha1");
  });

  it("sem token: 'Link inválido', sem formulário e sem chamar a API", () => {
    const { resetPassword } = setup("/reset-senha");
    expect(screen.getByText(/Link inválido/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Nova senha")).not.toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("token vazio no fragmento também é 'Link inválido'", () => {
    setup("/reset-senha#token=");
    expect(screen.getByText(/Link inválido/)).toBeInTheDocument();
  });

  it("o token vai no CORPO da chamada (gateway), com a senha nova, e nunca na URL", async () => {
    const { resetPassword } = setup("/reset-senha#token=corpo-e-so-corpo");
    await userEvent.type(screen.getByPlaceholderText("Nova senha"), "outraSenha9");
    await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(resetPassword).toHaveBeenCalledWith("corpo-e-so-corpo", "outraSenha9");
    expect(window.location.href).not.toContain("corpo-e-so-corpo");
    expect(await screen.findByText("Senha alterada com sucesso.")).toBeInTheDocument();
  });

  it("DOM-XSS: #token=<script>… vira 'Link inválido', não injeta nada na página e não chama a API", () => {
    const { resetPassword } = setup("/reset-senha#token=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
    expect(screen.getByText(/Link inválido/)).toBeInTheDocument();
    expect(document.querySelector("img, script, svg")).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/onerror|<script/i);
    expect(window.location.href).not.toContain("onerror");
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("link novo colado numa aba JÁ aberta em /reset-senha (só muda o fragmento): lê o token e limpa a barra de novo", async () => {
    const { resetPassword } = setup("/reset-senha");
    expect(screen.getByText(/Link inválido/)).toBeInTheDocument();
    await act(async () => {
      window.location.hash = "#token=link-novo-colado";
      await new Promise((resolve) => setTimeout(resolve, 20)); // jsdom dispara hashchange de forma assíncrona
    });
    expect(screen.getByPlaceholderText("Nova senha")).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("link-novo-colado");
    await userEvent.type(screen.getByPlaceholderText("Nova senha"), "SenhaColada9");
    await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(resetPassword).toHaveBeenCalledWith("link-novo-colado", "SenhaColada9");
  });

  it("o link novo (mesmo inválido) substitui o anterior: um fragmento com cara de HTML nunca fica na barra", async () => {
    setup("/reset-senha#token=primeiro-valido");
    expect(screen.getByPlaceholderText("Nova senha")).toBeInTheDocument();
    await act(async () => {
      window.location.hash = "#token=%3Cscript%3Ealert(1)%3C%2Fscript%3E";
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByText(/Link inválido/)).toBeInTheDocument();
    expect(window.location.href).not.toMatch(/script|%3C/i);
    expect(document.body.innerHTML).not.toMatch(/<script/i);
  });

  it("ao desmontar o ouvinte de hashchange é removido (não vaza para outra página)", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    window.history.replaceState(null, "", "/reset-senha#token=remove-listener");
    const auth = { resetPassword: vi.fn() } as unknown as AuthGateway;
    const { unmount } = render(
      <AuthServicesProvider auth={auth}>
        <ResetPasswordPage />
      </AuthServicesProvider>,
    );
    unmount();
    expect(remove.mock.calls.some(([type]) => type === "hashchange")).toBe(true);
    remove.mockRestore();
  });

  it("não escreve o token no texto da página", () => {
    setup("/reset-senha#token=nao-aparece-na-tela");
    expect(document.body.textContent).not.toContain("nao-aparece-na-tela");
  });

  it("não cria entrada no histórico (replaceState, não pushState)", () => {
    setup("/reset-senha#token=sem-historico");
    expect(window.history.length).toBe(before);
  });

  it("StrictMode (efeito roda duas vezes): o token lido na 1ª vez NÃO é apagado pela 2ª", () => {
    setup("/reset-senha#token=resiste-ao-strictmode", { strict: true });
    expect(screen.getByPlaceholderText("Nova senha")).toBeInTheDocument();
    expect(screen.queryByText(/Link inválido/)).not.toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });
});
