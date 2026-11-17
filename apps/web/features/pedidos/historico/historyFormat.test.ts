import { describe, expect, it } from "vitest";
import { customerText, formatWhen, rowBadges, safePhone, statusChip, typeLabel } from "./historyFormat";

describe("statusChip: ícone + texto + tom, nunca o código cru", () => {
  it("aberto mostra o estado de verdade do quadro (Pendente, Em preparo...)", () => {
    expect(statusChip({ display: "ABERTO", status: "EM_PREPARO" })).toMatchObject({ text: "Em preparo", tone: "info" });
    expect(statusChip({ display: "ABERTO", status: "PENDENTE" }).text).toBe("Pendente");
  });

  it("cada situação tem texto em português e um ícone", () => {
    expect(statusChip({ display: "CONCLUIDO", status: "CONCLUIDO" })).toEqual({ text: "Concluído", icon: "✓", tone: "ok" });
    expect(statusChip({ display: "CANCELADO", status: "CANCELADO" })).toMatchObject({ text: "Cancelado", tone: "danger" });
    expect(statusChip({ display: "AGUARDANDO_PAGAMENTO", status: "PENDENTE" }).text).toBe("Aguardando pagamento");
    expect(statusChip({ display: "PAGAMENTO_EXPIRADO", status: "CANCELADO" }).text).toBe("Pagamento expirado");
    for (const display of ["ABERTO", "CONCLUIDO", "CANCELADO", "AGUARDANDO_PAGAMENTO", "PAGAMENTO_EXPIRADO"]) {
      expect(statusChip({ display, status: "PENDENTE" }).icon).not.toBe("");
    }
  });

  it("situação que a tela não conhece vira texto neutro, nunca o código", () => {
    const chip = statusChip({ display: "ESTADO_DO_FUTURO", status: "X" });
    expect(chip.text).toBe("Outro status");
    expect(chip.tone).toBe("neutral");
    expect(JSON.stringify(chip)).not.toContain("ESTADO_DO_FUTURO");
  });
});

describe("rowBadges: no máximo 2 visíveis e o resto em +N", () => {
  it("sem selos, com um e com dois", () => {
    expect(rowBadges({ refundPending: false, notPrinted: false })).toEqual({ shown: [], more: 0 });
    expect(rowBadges({ refundPending: true, notPrinted: false })).toEqual({ shown: [{ text: "Estorno pendente", tone: "danger" }], more: 0 });
    expect(rowBadges({ refundPending: true, notPrinted: true }).shown.map((badge) => badge.text)).toEqual(["Estorno pendente", "Não impresso"]);
  });
});

describe("formatWhen: data e hora no fuso da LOJA", () => {
  it("o mesmo instante muda de dia conforme o fuso da loja", () => {
    const iso = "2026-11-17T02:30:00Z";
    expect(formatWhen(iso, "America/Sao_Paulo")).toBe("16/11 · 23:30");
    expect(formatWhen(iso, "UTC")).toBe("17/11 · 02:30");
  });

  it("fuso inválido ou ausente não quebra; data inválida vira traço", () => {
    expect(formatWhen("2026-11-17T12:00:00Z", "Nao/Existe")).toMatch(/^\d{2}\/\d{2} · \d{2}:\d{2}$/);
    expect(formatWhen("2026-11-17T12:00:00Z", undefined)).toMatch(/^\d{2}\/\d{2} · \d{2}:\d{2}$/);
    expect(formatWhen("lixo", "UTC")).toBe("—");
  });
});

describe("telefone na lista: sempre mascarado", () => {
  it("só aceita telefone COM máscara; o completo nunca é exibido", () => {
    expect(safePhone("(11) ••••-5678")).toBe("(11) ••••-5678");
    expect(safePhone("(11) ****-5678")).toBe("(11) ****-5678");
    expect(safePhone("11987655678")).toBeNull();
    expect(safePhone("(11) 98765-5678")).toBeNull();
    expect(safePhone("")).toBeNull();
    expect(safePhone(null)).toBeNull();
  });

  it("cliente: nome, senão o telefone mascarado, senão traço; telefone cru nunca vai para a tela", () => {
    expect(customerText({ customerName: "Maria S.", customerPhone: "(11) ••••-5678" })).toBe("Maria S.");
    expect(customerText({ customerName: null, customerPhone: "(11) ••••-5678" })).toBe("(11) ••••-5678");
    expect(customerText({ customerName: "  ", customerPhone: null })).toBe("—");
    expect(customerText({ customerName: null, customerPhone: "11987655678" })).toBe("—");
  });
});

describe("typeLabel", () => {
  it("rótulos em português e traço para tipo desconhecido", () => {
    expect(typeLabel("DELIVERY")).toBe("Delivery");
    expect(typeLabel("BALCAO")).toBe("Retirada");
    expect(typeLabel("MESA")).toBe("Mesa");
    expect(typeLabel("OUTRO")).toBe("—");
  });
});
