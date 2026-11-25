const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatCents(cents: number): string {
  return BRL.format(cents / 100).replace(/ /g, " ");
}

export function digitsToCents(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

export function maskMoneyInput(raw: string): string {
  if (!/\d/.test(raw)) return "";
  return (digitsToCents(raw) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// SSOT D11 — VALOR OCULTO: um texto só para "Ocultar valores" (antes: "Oculto", "R$ ••••" e "••••" em telas diferentes).
export const HIDDEN_MONEY = "R$ ••••";

/** Valor em reais, ou o texto de oculto quando a preferência "Ocultar valores" está ligada. */
export function moneyOrHidden(cents: number, hidden = false): string {
  return hidden ? HIDDEN_MONEY : formatCents(cents);
}
