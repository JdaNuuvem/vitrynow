import { afterEach, describe, expect, it } from "vitest";
import { toReportRange } from "@/features/relatorios/dateRange";
import { activeStoreTimezone, DEFAULT_STORE_TIMEZONE, formatInStoreTimezone, safeTimeZone, setActiveStoreTimezone, storeDateInput, storeMidnight } from "./storeTime";

const MANAUS = "America/Manaus"; // UTC-4, uma hora atrás de São Paulo
const instant = new Date("2026-11-25T03:30:00Z"); // 00:30 de 25/11 em SP; 23:30 de 24/11 em Manaus

afterEach(() => setActiveStoreTimezone(null));

describe("SSOT D1 — fuso da LOJA, nunca o do aparelho", () => {
  it("fuso ausente, vazio ou inválido cai no padrão sem quebrar", () => {
    expect([safeTimeZone(undefined), safeTimeZone(""), safeTimeZone("Marte/Olympus"), safeTimeZone(MANAUS)]).toEqual([DEFAULT_STORE_TIMEZONE, DEFAULT_STORE_TIMEZONE, DEFAULT_STORE_TIMEZONE, MANAUS]);
  });

  it("o mesmo instante cai em DIAS diferentes conforme a loja", () => {
    expect(storeDateInput(instant, DEFAULT_STORE_TIMEZONE)).toBe("2026-11-25");
    expect(storeDateInput(instant, MANAUS)).toBe("2026-11-24");
    expect(formatInStoreTimezone(instant, MANAUS, { hour: "2-digit", minute: "2-digit" })).toBe("23:30");
    expect(formatInStoreTimezone("lixo", MANAUS)).toBe("");
  });

  it("período do relatório começa à meia-noite DA LOJA (antes: -03:00 fixo)", () => {
    expect(storeMidnight("2026-11-24", MANAUS).toISOString()).toBe("2026-11-24T04:00:00.000Z");
    expect(toReportRange({ from: "2026-11-01", to: "2026-11-24" }, MANAUS).from.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(toReportRange({ from: "2026-11-01", to: "2026-11-24" }).from.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });

  it("fuso da loja ativa (formatadores fora de componente) começa no padrão e segue a loja carregada", () => {
    expect(activeStoreTimezone()).toBe(DEFAULT_STORE_TIMEZONE);
    setActiveStoreTimezone(MANAUS);
    expect(activeStoreTimezone()).toBe(MANAUS);
    setActiveStoreTimezone("inválido");
    expect(activeStoreTimezone()).toBe(DEFAULT_STORE_TIMEZONE);
  });
});
