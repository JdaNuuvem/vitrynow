import { describe, expect, it } from "vitest";
import {
  CHANGE_PASSWORD_CARD_TITLE,
  isPasswordLongEnough,
  isPasswordRuleError,
  PASSWORD_HELP,
  PASSWORD_HELP_STAFF,
  PASSWORD_MIN_LENGTH,
  PASSWORD_TOO_SHORT_MESSAGE,
} from "./passwordPolicy";

describe("política de senha (SEC-29)", () => {
  it("o mínimo é 10 e as frases saem dele (um número só)", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(PASSWORD_TOO_SHORT_MESSAGE).toBe("A senha precisa ter pelo menos 10 caracteres.");
    expect(PASSWORD_HELP).toBe("Pelo menos 10 caracteres. Dica: junte três palavras sem relação entre si.");
    expect(PASSWORD_HELP_STAFF).toContain("Pelo menos 10 caracteres.");
  });

  it("a ajuda do convite diz onde o funcionário troca a senha, com o NOME REAL do card (uma constante só)", () => {
    expect(CHANGE_PASSWORD_CARD_TITLE).toBe("Minha senha");
    expect(PASSWORD_HELP_STAFF).toBe("Pelo menos 10 caracteres. Combine com o funcionário como ele vai receber a senha. Ele pode trocá-la depois em Minha senha.");
    expect(PASSWORD_HELP_STAFF).toContain(CHANGE_PASSWORD_CARD_TITLE);
    expect(PASSWORD_HELP_STAFF).not.toMatch(/Alterar senha/);
  });

  it("9 não basta, 10 basta, sem exigir composição", () => {
    expect(isPasswordLongEnough("123456789")).toBe(false);
    expect(isPasswordLongEnough("1234567890")).toBe(true);
    expect(isPasswordLongEnough("aaaaaaaaaa")).toBe(true); // sem exigir letra, número ou símbolo
    expect(isPasswordLongEnough("")).toBe(false);
  });

  it("só a recusa por TAMANHO vira a frase do campo; senha atual incorreta e outros erros ficam como vieram", () => {
    expect(isPasswordRuleError("newPassword: String must contain at least 10 character(s)")).toBe(true);
    expect(isPasswordRuleError("password: Too short, min 10")).toBe(true);
    expect(isPasswordRuleError("A senha precisa ter pelo menos 10 caracteres.")).toBe(true);
    expect(isPasswordRuleError("Senha muito curta")).toBe(true);
    expect(isPasswordRuleError("Senha atual incorreta")).toBe(false);
    expect(isPasswordRuleError("Link inválido ou vencido.")).toBe(false);
    expect(isPasswordRuleError("email: já cadastrado")).toBe(false);
    expect(isPasswordRuleError(null)).toBe(false);
    expect(isPasswordRuleError("")).toBe(false);
  });
});
