// API-02b — mensagem ao cliente derivada de (motivo, ator); sem texto livre (contrato B3 §12, CA-MC-04/05/06/11/14).
import { describe, expect, it } from "vitest";
import type { PaymentStatus } from "@meucardapio/db";
import { HUMAN_REASON_CODES, SYSTEM_REASON_CODES } from "../../src/lib/orderStateMachine";
import { ALL_CUSTOMER_MESSAGES, customerMessageFor, formatBRL, messageActorFor, moneyLineFor } from "../../src/lib/cancelMessages";

const allPhrases = () => [
  ...Object.values(ALL_CUSTOMER_MESSAGES.STORE_MESSAGES),
  ...Object.values(ALL_CUSTOMER_MESSAGES.SYSTEM_MESSAGES),
  ...Object.values(ALL_CUSTOMER_MESSAGES.CUSTOMER_MESSAGES),
];

describe("mensagem de cancelamento ao cliente", () => {
  it("CA-MC-11: todo motivo humano e de sistema tem frase própria (nunca cai no genérico)", () => {
    for (const code of HUMAN_REASON_CODES) {
      expect(ALL_CUSTOMER_MESSAGES.STORE_MESSAGES[code], `loja/${code}`).toBeTruthy();
    }
    for (const code of SYSTEM_REASON_CODES) {
      expect(ALL_CUSTOMER_MESSAGES.SYSTEM_MESSAGES[code], `sistema/${code}`).toBeTruthy();
    }
    expect(ALL_CUSTOMER_MESSAGES.CUSTOMER_MESSAGES.CLIENTE_DESISTIU).toBeTruthy();
  });

  it("toda frase: ≤ 80 caracteres, uma linha, sem link (teto da v1)", () => {
    for (const phrase of allPhrases()) {
      expect(phrase.length, phrase).toBeLessThanOrEqual(80);
      expect(phrase, phrase).not.toMatch(/[\r\n]/);
      expect(phrase, phrase).not.toMatch(/https?:|www\.|\.com\b/i);
    }
  });

  it("CA-MC-14: nenhuma frase expõe erro operacional da loja nem culpa o cliente; voz sem desculpa/agradecimento", () => {
    for (const phrase of allPhrases()) {
      expect(phrase.toLowerCase(), phrase).not.toMatch(/duplicidade|erro de lançamento|não atendeu|não localizado|infelizmente|desculpe|obrigad/);
    }
  });

  it("a frase depende do ator: o cliente que cancelou lê 'Você cancelou…'; a loja que usa o mesmo motivo, outra frase", () => {
    expect(customerMessageFor("CLIENTE_DESISTIU", "CUSTOMER")).toBe("Você cancelou este pedido.");
    expect(customerMessageFor("CLIENTE_DESISTIU", "STORE")).toBe("Cancelamento solicitado por você.");
    expect(customerMessageFor("ITEM_EM_FALTA", "STORE")).toBe("Item indisponível no momento.");
    expect(customerMessageFor("PAGAMENTO_NAO_APROVADO", "SYSTEM")).toBe("O pagamento não foi aprovado e o pedido foi cancelado.");
  });

  it("DUPLICADO_OU_ERRO e OUTRO não vazam o motivo real", () => {
    expect(customerMessageFor("DUPLICADO_OU_ERRO", "STORE")).toBe("Pedido cancelado pela loja.");
    expect(customerMessageFor("OUTRO", "STORE")).toBe("Pedido cancelado pela loja.");
  });

  it("código desconhecido ou ausente cai numa frase neutra (nunca devolve o código nem texto livre)", () => {
    for (const code of ["INVENTADO", "", null, undefined, "<script>alert(1)</script>"]) {
      expect(customerMessageFor(code, "STORE")).toBe("O pedido foi cancelado.");
    }
  });

  it("origem do histórico → ator da mensagem", () => {
    expect(messageActorFor("CUSTOMER")).toBe("CUSTOMER");
    expect(messageActorFor("PANEL")).toBe("STORE");
    expect(messageActorFor("SYSTEM")).toBe("SYSTEM");
    expect(messageActorFor("WEBHOOK")).toBe("SYSTEM");
  });
});

describe("linha de dinheiro (CA-MC-04/05/06/13)", () => {
  const pay = (status: PaymentStatus, amountCents = 12_345) => ({ status, amountCents });

  it("formata o valor real em reais com vírgula", () => {
    expect(formatBRL(12_345)).toBe("R$ 123,45");
    expect(formatBRL(5)).toBe("R$ 0,05");
    expect(formatBRL(100_000)).toBe("R$ 1.000,00");
  });

  it("A/F: estorno em andamento; tentativa repetida/falha técnica NÃO aparece ao cliente", () => {
    expect(moneyLineFor(pay("ESTORNO_PENDENTE"), "ITEM_EM_FALTA")).toBe("O estorno de R$ 123,45 está em andamento.");
  });

  it("B: estorno concluído, sem prazo", () => {
    expect(moneyLineFor(pay("REEMBOLSADO"), "ITEM_EM_FALTA")).toBe("O valor de R$ 123,45 foi estornado. O prazo para aparecer depende do seu banco.");
  });

  it("D: pago depois do cancelamento ⇒ 'será estornado'; concluído vira B", () => {
    expect(moneyLineFor(pay("ESTORNO_PENDENTE"), "PAGAMENTO_APOS_CANCELAMENTO")).toBe("O valor de R$ 123,45 será estornado.");
    expect(moneyLineFor(pay("REEMBOLSADO"), "PAGAMENTO_APOS_CANCELAMENTO")).toContain("foi estornado");
  });

  it("C: 'Não há cobrança em aberto' só com a cobrança confirmada como encerrada (CANCELADO/EXPIRADO); PENDENTE (cancelamento no provedor falhou) não mostra", () => {
    expect(moneyLineFor(pay("CANCELADO"), "CLIENTE_DESISTIU")).toBe("Não há cobrança em aberto.");
    expect(moneyLineFor(pay("EXPIRADO"), "PAGAMENTO_NAO_APROVADO")).toBe("Não há cobrança em aberto.");
    expect(moneyLineFor(pay("PENDENTE"), "CLIENTE_DESISTIU")).toBeNull();
    expect(moneyLineFor(pay("EM_ANALISE"), "CLIENTE_DESISTIU")).toBeNull();
  });

  it("CA-MC-06/13: o texto antigo ('Nenhuma cobrança foi feita') não reaparece em nenhum estado de pagamento nem motivo", () => {
    const statuses: PaymentStatus[] = ["PENDENTE", "EM_ANALISE", "APROVADO", "REJEITADO", "EXPIRADO", "REEMBOLSADO", "CANCELADO", "ESTORNO_PENDENTE", "CONTESTADO"];
    for (const status of statuses) {
      for (const reason of ["ITEM_EM_FALTA", "CLIENTE_DESISTIU", "PAGAMENTO_NAO_APROVADO", "PAGAMENTO_APOS_CANCELAMENTO", null]) {
        expect(moneyLineFor(pay(status), reason) ?? "", `${status}/${reason}`).not.toMatch(/nenhuma cobran/i);
      }
    }
    // uma linha só, sem link
    expect("Não há cobrança em aberto.".length).toBeLessThanOrEqual(80);
  });

  it("G: sem pagamento online (dinheiro/cartão na entrega) não há linha", () => {
    expect(moneyLineFor(null, "ITEM_EM_FALTA")).toBeNull();
    expect(moneyLineFor(undefined, "ITEM_EM_FALTA")).toBeNull();
  });

  it("CA-MC-04: nenhuma linha promete prazo ('na hora', 'em minutos', 'em até N dias')", () => {
    const statuses: PaymentStatus[] = ["PENDENTE", "EM_ANALISE", "APROVADO", "REJEITADO", "EXPIRADO", "REEMBOLSADO", "CANCELADO", "ESTORNO_PENDENTE", "CONTESTADO"];
    for (const status of statuses) {
      for (const reason of ["ITEM_EM_FALTA", "PAGAMENTO_APOS_CANCELAMENTO", null]) {
        const line = moneyLineFor(pay(status), reason);
        if (line) expect(line.toLowerCase(), line).not.toMatch(/na hora|em minutos|em até|\d+\s*(dias|horas|minutos)/);
      }
    }
  });
});
