import { describe, expect, it } from "vitest";
import {
  CHANGE_PASSWORD_CARD_TITLE,
  classifyResetFailure,
  CONFIRM_EMAIL_HELP,
  CONFIRM_EMAIL_LABEL,
  isEmailShapeValid,
  RESET_RATE_LIMITED_MESSAGE,
  RESET_REFUSED_MESSAGE,
  RESET_REFUSED_NEW_LINK,
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


describe("confirmação do e-mail na redefinição (ST-67)", () => {
  it("as frases são as aprovadas pelo Ogilvy", () => {
    expect(CONFIRM_EMAIL_LABEL).toBe("Confirme o e-mail desta conta");
    expect(CONFIRM_EMAIL_HELP).toBe("Digite o e-mail completo da conta, como você o usa para entrar.");
    expect(RESET_REFUSED_MESSAGE).toBe("Não foi possível redefinir a senha. Confira o e-mail e o link e tente de novo.");
    expect(RESET_REFUSED_NEW_LINK).toBe("Pedir um novo link");
    expect(RESET_RATE_LIMITED_MESSAGE).toBe("Muitas tentativas. Aguarde alguns minutos e tente de novo.");
  });

  it("a frase única não diz qual dos dois falhou", () => {
    expect(RESET_REFUSED_MESSAGE).not.toMatch(/incorret|errad|não bate|não confere|inválid|vencid|usado/i);
  });

  it("forma do e-mail (só libera o botão; quem decide é o servidor)", () => {
    expect(isEmailShapeValid("maria@gmail.com")).toBe(true);
    expect(isEmailShapeValid("  maria@gmail.com  ")).toBe(true);
    expect(isEmailShapeValid("maria@gmail")).toBe(false);
    expect(isEmailShapeValid("maria@")).toBe(false);
    expect(isEmailShapeValid("@gmail.com")).toBe(false);
    expect(isEmailShapeValid("ma ria@gmail.com")).toBe(false);
    expect(isEmailShapeValid("")).toBe(false);
  });

  it("classifica a recusa: tamanho da senha, 429, erro de servidor/rede e, para todo o resto, a recusa única", () => {
    expect(classifyResetFailure(null, null)).toBeNull();
    expect(classifyResetFailure(400, "newPassword: String must contain at least 10 character(s)")).toBe("rule");
    expect(classifyResetFailure(429, "Too Many Requests")).toBe("rate");
    expect(classifyResetFailure(500, "erro")).toBe("server");
    expect(classifyResetFailure(503, "Não foi possível conectar ao servidor.")).toBe("server");
    expect(classifyResetFailure(400, "Link inválido ou vencido.")).toBe("refused");
    expect(classifyResetFailure(400, "E-mail não confere")).toBe("refused");
    expect(classifyResetFailure(404, "não encontrado")).toBe("refused");
    expect(classifyResetFailure(401, "x")).toBe("refused");
  });
});
