import { describe, expect, it } from "vitest";
import { CANCEL_REASONS, CUSTOMER_PHRASE_MAX, buildCancelBody, customerPhraseFor, validateCancel } from "./cancelReasons";

describe("CANCEL_REASONS (spec 02 §5.1, contrato §2.2)", () => {
  it("lista e ordem da spec, com Outro por último", () => {
    expect(CANCEL_REASONS.map((r) => r.code)).toEqual([
      "ITEM_EM_FALTA",
      "FORA_DA_AREA",
      "LOJA_SEM_CAPACIDADE",
      "CLIENTE_DESISTIU",
      "NAO_ATENDEU_ENDERECO",
      "DUPLICADO_OU_ERRO",
      "OUTRO",
    ]);
  });

  it("PAGAMENTO_NAO_APROVADO não aparece: é só do sistema", () => {
    expect(CANCEL_REASONS.some((r) => (r.code as string) === "PAGAMENTO_NAO_APROVADO")).toBe(false);
  });
});

// GRW-15 (contrato B3 §12): frase FIXA por motivo, testável.
describe("frases fixas ao cliente (GRW-15)", () => {
  it("todo motivo tem uma frase, de 1 linha, até 80 caracteres e sem link", () => {
    for (const reason of CANCEL_REASONS) {
      expect(reason.customerPhrase.length, reason.code).toBeGreaterThan(0);
      expect(reason.customerPhrase.length, reason.code).toBeLessThanOrEqual(CUSTOMER_PHRASE_MAX);
      expect(reason.customerPhrase, reason.code).not.toMatch(/[\r\n]/);
      expect(reason.customerPhrase, reason.code).not.toMatch(/https?:|www\.|\.com/i);
    }
  });

  it("voz do catálogo: sem pedido de desculpa, sem agradecimento, sem culpar o cliente", () => {
    for (const reason of CANCEL_REASONS) expect(reason.customerPhrase, reason.code).not.toMatch(/infelizmente|desculp|obrigad|sua culpa/i);
  });

  it("o motivo interno nunca vira a frase: DUPLICADO_OU_ERRO e OUTRO não expõem o erro da loja", () => {
    expect(customerPhraseFor("DUPLICADO_OU_ERRO")).toBe("Pedido cancelado pela loja.");
    expect(customerPhraseFor("OUTRO")).toBe("Pedido cancelado pela loja.");
  });

  it("a frase oficial de item em falta é a da spec da Da Vinci", () => {
    expect(customerPhraseFor("ITEM_EM_FALTA")).toBe("Item indisponível no momento.");
  });

  it("sem motivo escolhido não há frase para mostrar", () => {
    expect(customerPhraseFor(null)).toBeNull();
  });
});

describe("validateCancel: o botão só habilita com motivo (e nota, se Outro)", () => {
  it("sem motivo: dica escrita embaixo do botão", () => {
    expect(validateCancel({ code: null, text: "" })).toEqual({ ok: false, hint: "Escolha um motivo para continuar" });
  });

  it("Outro sem nota (ou só espaços) não passa", () => {
    expect(validateCancel({ code: "OUTRO", text: "" }).ok).toBe(false);
    expect(validateCancel({ code: "OUTRO", text: "   " })).toEqual({ ok: false, hint: "Escreva o motivo para continuar" });
  });

  it("motivo da lista passa sem nota; Outro com nota passa", () => {
    expect(validateCancel({ code: "ITEM_EM_FALTA", text: "" }).ok).toBe(true);
    expect(validateCancel({ code: "OUTRO", text: "Fechamos mais cedo" }).ok).toBe(true);
  });
});

describe("buildCancelBody (POST /api/orders/:id/cancel)", () => {
  it("manda o código e a frase FIXA (interino, até o servidor derivar); sem nota fora do Outro", () => {
    expect(buildCancelBody({ code: "ITEM_EM_FALTA", text: "anotação que não deve ir" })).toEqual({
      reason: { code: "ITEM_EM_FALTA", customerMessage: "Item indisponível no momento." },
      acknowledgeClosedCash: false,
    });
  });

  it("Outro leva a nota interna aparada; a frase ao cliente continua a fixa", () => {
    expect(buildCancelBody({ code: "OUTRO", text: " Fechamos " }, true)).toEqual({
      reason: { code: "OUTRO", text: "Fechamos", customerMessage: "Pedido cancelado pela loja." },
      acknowledgeClosedCash: true,
    });
  });

  it("a nota interna NUNCA entra na mensagem ao cliente", () => {
    const body = buildCancelBody({ code: "OUTRO", text: "cliente mal educado, telefone 21 99999-0000" });
    expect(body.reason.customerMessage).not.toContain("mal educado");
    expect(body.reason.customerMessage).not.toContain("99999");
  });

  it("sem motivo não monta corpo", () => {
    expect(() => buildCancelBody({ code: null, text: "" })).toThrow();
  });
});
