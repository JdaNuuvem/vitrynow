import { describe, expect, it } from "vitest";
import { explainOrderError } from "./orderErrors";

describe("explainOrderError (contrato B3 §5)", () => {
  it.each([
    ["ORDER_STATE_CHANGED", "Este pedido já mudou. A tela foi atualizada.", true],
    ["INVALID_TRANSITION", "Este pedido já mudou. A tela foi atualizada.", true],
    ["ORDER_ALREADY_ACCEPTED", "A loja já aceitou este pedido. A tela foi atualizada.", true],
    ["REFUND_PENDING", "O estorno deste pedido está em andamento.", true],
    ["FORBIDDEN_ROLE", "Seu perfil não permite esta ação.", false],
    ["REASON_REQUIRED", "Escolha um motivo para continuar.", false],
    ["READ_ONLY", "Esta ação precisa da assinatura ativa.", false],
  ])("%s -> texto em português e recarrega=%s", (code, message, reload) => {
    expect(explainOrderError({ status: 409, error: "texto cru do servidor", code })).toEqual({ message, reload });
  });

  it("os textos conhecidos têm prioridade sobre o texto do servidor e nunca expõem o código", () => {
    const { message } = explainOrderError({ status: 409, error: "state", code: "ORDER_STATE_CHANGED" });
    expect(message).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
  });

  it("código desconhecido: usa o texto em português do servidor", () => {
    expect(explainOrderError({ status: 400, error: "valor inválido para o pedido", code: "NOVO_CODIGO" })).toEqual({ message: "valor inválido para o pedido", reload: false });
  });

  it("sem código e sem texto: frase segura", () => {
    expect(explainOrderError({ status: 500, error: "" }).message).toBe("Não foi possível concluir esta ação. Tente de novo.");
  });

  it("se o 'texto' do servidor é um código cru, não mostra: frase segura", () => {
    expect(explainOrderError({ status: 500, error: "INTERNAL_SERVER_ERROR" }).message).toBe("Não foi possível concluir esta ação. Tente de novo.");
  });

  it.each([500, 502, 504])("erro do servidor (%i): SEMPRE a frase fixa, nunca o texto que veio (parecer R3)", (status) => {
    expect(explainOrderError({ status, error: "PrismaClientKnownRequestError: relation Order at db-internal:5432" }).message).toBe("Não foi possível concluir esta ação. Tente de novo.");
    expect(explainOrderError({ status, error: "frase em português do servidor" }).message).toBe("Não foi possível concluir esta ação. Tente de novo.");
  });

  it("falha de rede (503 sintético) mantém o texto de conexão", () => {
    expect(explainOrderError({ status: 503, error: "Não foi possível conectar ao servidor. Verifique sua internet e tente de novo." }).message).toContain("conectar");
  });
});
