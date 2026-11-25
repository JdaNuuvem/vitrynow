import { describe, expect, it } from "vitest";
import { scheduleDays, scheduleLabel, scheduleTimes, zonedToUtc } from "./scheduleSlots";

const SP = "America/Sao_Paulo";

describe("pedido agendado — horários no fuso da LOJA", () => {
  it("hora local da loja vira o instante UTC certo (São Paulo -3; Lisboa com horário de verão)", () => {
    expect(zonedToUtc(2026, 11, 25, 19, 30, SP).toISOString()).toBe("2026-11-25T22:30:00.000Z");
    expect(zonedToUtc(2026, 7, 1, 12, 0, "Europe/Lisbon").toISOString()).toBe("2026-07-01T11:00:00.000Z"); // verão: UTC+1
    expect(zonedToUtc(2026, 1, 1, 12, 0, "Europe/Lisbon").toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it("dias: hoje, amanhã e mais 6, no calendário da loja (não do aparelho)", () => {
    const now = new Date("2026-11-25T02:30:00Z"); // 23:30 de 24/11 em São Paulo
    const days = scheduleDays(now, SP);
    expect(days).toHaveLength(8);
    expect(days[0]).toEqual({ value: "2026-11-24", label: "Hoje" });
    expect(days[1]).toEqual({ value: "2026-11-25", label: "Amanhã" });
    expect(days[2].label).toBe("qui, 26/11");
  });

  it("horários: de 15 em 15 min, a partir de agora + 30 min (arredondado para cima) e até 7 dias", () => {
    const now = new Date("2026-11-25T15:05:00Z"); // 12:05 em São Paulo
    const today = scheduleTimes("2026-11-25", now, SP);
    expect(today[0].label).toBe("12:45"); // 12:35 é o mínimo; o próximo degrau de 15 min é 12:45
    expect(today.at(-1)!.label).toBe("23:45");
    expect(today[0].value).toBe("2026-11-25T15:45:00.000Z");
    const last = scheduleTimes("2026-12-02", now, SP);
    expect(last.at(-1)!.label).toBe("12:00"); // 7 dias exatos à frente
    expect(scheduleTimes("2026-12-03", now, SP)).toEqual([]);
    expect(scheduleTimes("lixo", now, SP)).toEqual([]);
  });

  it("rótulo legível no fuso da loja", () => {
    expect(scheduleLabel("2026-11-26T22:30:00.000Z", SP)).toBe("qui, 26/11 às 19:30");
  });
});
