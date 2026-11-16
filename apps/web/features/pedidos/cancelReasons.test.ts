import { describe, expect, it } from "vitest";
import { CANCEL_REASONS, buildCancelBody, draftForReason, validateCancel } from "./cancelReasons";

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

  it("não inventa texto para o cliente: só o motivo com texto oficial tem sugestão", () => {
    const withText = CANCEL_REASONS.filter((r) => r.customerMessage !== null).map((r) => r.code);
    expect(withText).toEqual(["ITEM_EM_FALTA"]);
  });
});

describe("validateCancel: o botão só habilita com motivo (e texto, se Outro)", () => {
  it("sem motivo: dica escrita embaixo do botão", () => {
    expect(validateCancel({ code: null, text: "", customerMessage: "" })).toEqual({ ok: false, hint: "Escolha um motivo para continuar" });
  });

  it("Outro sem texto (ou só espaços) não passa", () => {
    expect(validateCancel({ code: "OUTRO", text: "", customerMessage: "" }).ok).toBe(false);
    expect(validateCancel({ code: "OUTRO", text: "   ", customerMessage: "" })).toEqual({ ok: false, hint: "Escreva o motivo para continuar" });
  });

  it("motivo da lista passa sem texto; Outro com texto passa", () => {
    expect(validateCancel({ code: "ITEM_EM_FALTA", text: "", customerMessage: "" }).ok).toBe(true);
    expect(validateCancel({ code: "OUTRO", text: "Fechamos mais cedo", customerMessage: "" }).ok).toBe(true);
  });
});

describe("buildCancelBody (POST /api/orders/:id/cancel)", () => {
  it("só envia texto e mensagem ao cliente quando existem, aparados", () => {
    expect(buildCancelBody({ code: "ITEM_EM_FALTA", text: "  ", customerMessage: "  Item indisponível no momento.  " })).toEqual({
      reason: { code: "ITEM_EM_FALTA", customerMessage: "Item indisponível no momento." },
      acknowledgeClosedCash: false,
    });
  });

  it("Outro leva o texto; caixa fechado só vai marcado quando o dono confirmou", () => {
    expect(buildCancelBody({ code: "OUTRO", text: " Fechamos ", customerMessage: "" }, true)).toEqual({
      reason: { code: "OUTRO", text: "Fechamos" },
      acknowledgeClosedCash: true,
    });
  });

  it("sem motivo não monta corpo", () => {
    expect(() => buildCancelBody({ code: null, text: "", customerMessage: "" })).toThrow();
  });
});

describe("draftForReason", () => {
  it("trocar de motivo traz a sugestão do novo e mantém o texto interno digitado", () => {
    const first = draftForReason("ITEM_EM_FALTA");
    expect(first.customerMessage).toBe("Item indisponível no momento.");
    const second = draftForReason("FORA_DA_AREA", { ...first, text: "anotação" });
    expect(second).toEqual({ code: "FORA_DA_AREA", text: "anotação", customerMessage: "" });
  });
});
