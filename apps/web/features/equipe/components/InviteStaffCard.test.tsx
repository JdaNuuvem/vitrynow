import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PASSWORD_HELP_STAFF, PASSWORD_TOO_SHORT_MESSAGE } from "@/shared/auth/passwordPolicy";
import { InviteStaffCard } from "./InviteStaffCard";

function setup(error: string | null = null) {
  const onInvite = vi.fn().mockResolvedValue(true);
  render(<InviteStaffCard error={error} onInvite={onInvite} />);
  return { onInvite };
}
const fill = async (email: string, password: string) => {
  await userEvent.type(screen.getByPlaceholderText("E-mail"), email);
  await userEvent.type(screen.getByLabelText("Senha do funcionário"), password);
};

describe("InviteStaffCard: senha mínima de 10 (SEC-29)", () => {
  it("a ajuda é a PRÓPRIA do convite (quem digita não é quem usa) e não a do usuário comum", () => {
    setup();
    expect(screen.getByText(PASSWORD_HELP_STAFF)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/três palavras|não usa em outro lugar/);
  });

  it("UI-PW-04: 9 caracteres: erro junto do campo, ajuda visível, e NÃO convida", async () => {
    const { onInvite } = setup();
    await fill("ana@loja.com", "123456789");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSWORD_TOO_SHORT_MESSAGE);
    expect(screen.getByText(PASSWORD_HELP_STAFF)).toBeInTheDocument();
    expect(onInvite).not.toHaveBeenCalled();
  });

  it("10 caracteres convida e limpa o formulário", async () => {
    const { onInvite } = setup();
    await fill("ana@loja.com", "1234567890");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(onInvite).toHaveBeenCalledWith("ana@loja.com", "1234567890");
    expect((screen.getByLabelText("Senha do funcionário") as HTMLInputElement).value).toBe("");
  });

  it("recusa do servidor por tamanho: a mesma frase no campo, sem texto técnico, sem duplicar no cartão", () => {
    setup("password: String must contain at least 10 character(s)");
    expect(screen.getByRole("alert")).toHaveTextContent(PASSWORD_TOO_SHORT_MESSAGE);
    expect(document.body.textContent).not.toMatch(/String must contain/);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("outro erro do servidor (e-mail já cadastrado) continua como veio", () => {
    setup("E-mail já cadastrado.");
    expect(screen.getByText("E-mail já cadastrado.")).toBeInTheDocument();
    expect(screen.queryByText(PASSWORD_TOO_SHORT_MESSAGE)).not.toBeInTheDocument();
  });
});
