import { describe, expect, it } from "vitest";
import { isStoreOpenNow } from "./openingHours";

// 2026-11-16 é segunda-feira. Datas locais (o código usa getDay/getHours).
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);
const MON = 16;
const SAT = 21;
const SUN = 22;

describe("isStoreOpenNow", () => {
  it("sem texto ou texto que não dá para interpretar: null (a tela só mostra o texto)", () => {
    expect(isStoreOpenNow(null)).toBeNull();
    expect(isStoreOpenNow("")).toBeNull();
    expect(isStoreOpenNow("Abrimos quando der")).toBeNull();
  });

  it("intervalo de dias e horas", () => {
    const text = "Seg a sáb, 09:00 às 18:00";
    expect(isStoreOpenNow(text, at(MON, 10))).toBe(true);
    expect(isStoreOpenNow(text, at(MON, 8, 59))).toBe(false);
    expect(isStoreOpenNow(text, at(MON, 18, 0))).toBe(false); // fim exclusivo
    expect(isStoreOpenNow(text, at(MON, 17, 59))).toBe(true);
    expect(isStoreOpenNow(text, at(SAT, 12))).toBe(true);
    expect(isStoreOpenNow(text, at(SUN, 12))).toBe(false);
  });

  it("aceita 'h' e acentos", () => {
    expect(isStoreOpenNow("Seg a sex, 18h às 23h", at(MON, 19))).toBe(true);
    expect(isStoreOpenNow("Seg a sex, 18h às 23h", at(MON, 12))).toBe(false);
  });

  it("sem dias, vale todo dia", () => {
    expect(isStoreOpenNow("11:00 às 15:00", at(SUN, 12))).toBe(true);
  });

  it("horário que atravessa a meia-noite", () => {
    const text = "Todos os dias, 18:00 às 02:00";
    expect(isStoreOpenNow(text, at(MON, 23))).toBe(true);
    expect(isStoreOpenNow(text, at(MON, 1))).toBe(true);
    expect(isStoreOpenNow(text, at(MON, 10))).toBe(false);
  });

  it("intervalo de dias que dá a volta na semana (sex a seg)", () => {
    const text = "Sex a seg, 10:00 às 22:00";
    expect(isStoreOpenNow(text, at(SUN, 12))).toBe(true);
    expect(isStoreOpenNow(text, at(MON, 12))).toBe(true);
    expect(isStoreOpenNow(text, at(MON + 1, 12))).toBe(false); // terça
  });
});
