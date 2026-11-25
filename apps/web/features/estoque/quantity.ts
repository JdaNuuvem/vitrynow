import { BIG_UNIT, type StockUnit } from "@/core/domain/stock";

// A tela aceita kg/L ou g/ml (e un). A API só recebe UNIDADE BASE inteira: converte aqui, num lugar só.
export type InputUnit = "base" | "big";

/** "1,5" kg -> 1500 g. Vazio, negativo ou inválido -> null. */
export function toBaseQty(raw: string, unit: StockUnit, inputUnit: InputUnit): number | null {
  // "1.234,5" (milhar com ponto) ou "1,5" / "1.5" (decimal): ponto só é milhar quando também há vírgula.
  const text = raw.trim();
  const value = Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text);
  if (!raw.trim() || !Number.isFinite(value) || value < 0) return null;
  const factor = inputUnit === "big" ? BIG_UNIT[unit]?.factor ?? 1 : 1;
  return Math.round(value * factor);
}

/** Rótulos dos seletores de unidade de entrada para o insumo. */
export function inputUnitOptions(unit: StockUnit): { id: InputUnit; label: string }[] {
  const big = BIG_UNIT[unit];
  const base = unit === "G" ? "g" : unit === "ML" ? "ml" : "un";
  return big ? [{ id: "big", label: big.label }, { id: "base", label: base }] : [{ id: "base", label: base }];
}
