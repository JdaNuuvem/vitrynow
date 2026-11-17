import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CHANGE_PASSWORD_CARD_TITLE, PASSWORD_HELP, PASSWORD_HELP_STAFF, PASSWORD_TOO_SHORT_MESSAGE } from "@/shared/auth/passwordPolicy";
import { ChangePasswordCard } from "./ChangePasswordCard";

function setup(result: string | null = null) {
  const onChangePassword = vi.fn().mockResolvedValue(result);
  render(<ChangePasswordCard onChangePassword={onChangePassword} />);
  return { onChangePassword };
}
const fill = async (current: string, next: string) => {
  await userEvent.type(screen.getByPlaceholderText("Senha atual"), current);
  await userEvent.type(screen.getByLabelText("Nova senha"), next);
};

describe("ChangePasswordCard: senha mínima de 10 (SEC-29)", () => {
  it("o título do card é a MESMA constante que a ajuda do convite cita (a frase 'em Minha senha' nunca diverge do card)", () => {
    setup();
    expect(screen.getByRole("heading", { name: CHANGE_PASSWORD_CARD_TITLE })).toBeInTheDocument();
    expect(PASSWORD_HELP_STAFF).toContain(`em ${CHANGE_PASSWORD_CARD_TITLE}.`);
  });

  it("a ajuda é fixa e fica ligada ao campo da nova senha", () => {
    setup();
    const input = screen.getByLabelText("Nova senha");
    expect(screen.getByText(PASSWORD_HELP)).toBeInTheDocument();
    expect(input.getAttribute("aria-describedby")).toContain(screen.getByText(PASSWORD_HELP).id);
  });

  it("'Senha atual' NÃO tem regra de tamanho (conta antiga pode ter senha curta)", () => {
    setup();
    expect(screen.getByPlaceholderText("Senha atual")).not.toHaveAttribute("minlength");
  });

  it("UI-PW-04: nova senha com 9 caracteres: erro junto do campo, ajuda visível, e a API NÃO é chamada", async () => {
    const { onChangePassword } = setup();
    await fill("atual", "123456789");
    await userEvent.click(screen.getByRole("button", { name: "Trocar senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSWORD_TOO_SHORT_MESSAGE);
    expect(screen.getByLabelText("Nova senha")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(PASSWORD_HELP)).toBeInTheDocument();
    expect(onChangePassword).not.toHaveBeenCalled();
  });

  it("com 10 caracteres envia e confirma", async () => {
    const { onChangePassword } = setup();
    await fill("atual", "1234567890");
    await userEvent.click(screen.getByRole("button", { name: "Trocar senha" }));
    expect(onChangePassword).toHaveBeenCalledWith("atual", "1234567890");
    expect(await screen.findByText("Senha alterada.")).toBeInTheDocument();
  });

  it("o servidor recusa por tamanho: a MESMA frase no campo, sem texto técnico", async () => {
    setup("newPassword: String must contain at least 10 character(s)");
    await fill("atual", "1234567890");
    await userEvent.click(screen.getByRole("button", { name: "Trocar senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSWORD_TOO_SHORT_MESSAGE);
    expect(document.body.textContent).not.toMatch(/String must contain|newPassword/);
  });

  it("'Senha atual incorreta' continua como veio, no cartão, e não vira a frase do tamanho", async () => {
    setup("Senha atual incorreta");
    await fill("errada", "1234567890");
    await userEvent.click(screen.getByRole("button", { name: "Trocar senha" }));
    expect(await screen.findByText("Senha atual incorreta")).toBeInTheDocument();
    expect(screen.queryByText(PASSWORD_TOO_SHORT_MESSAGE)).not.toBeInTheDocument();
  });

  it("UI-PW-06: 'Mostrar senha' alterna só o campo da nova senha e mantém o valor", async () => {
    setup();
    const input = screen.getByLabelText("Nova senha") as HTMLInputElement;
    await userEvent.type(input, "uma-frase-longa");
    await userEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(input.type).toBe("text");
    expect(input.value).toBe("uma-frase-longa");
    expect((screen.getByPlaceholderText("Senha atual") as HTMLInputElement).type).toBe("password");
  });
});
