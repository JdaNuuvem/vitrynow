// API-16 (B9): regras puras da taxa por bairro (sem banco), para testar sem servidor.

// Nome do bairro sem acento, caixa e espaços repetidos: "  São  JOSÉ " e "sao jose" são o mesmo bairro (RN-B9-09).
export function zoneNameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// "6", "6,00", "6.5", "R$ 6,00" => centavos; inválido => null.
export function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.replace(/^R\$\s*/i, "").trim();
  if (!/^\d{1,7}([.,]\d{1,2})?$/.test(cleaned)) return null;
  const [reais, decimals = ""] = cleaned.split(/[.,]/);
  return Number(reais) * 100 + Number(decimals.padEnd(2, "0"));
}

export type ParsedZoneLine = { line: number; name: string; feeCents: number };
export type ZoneLineError = { line: number; text: string; reason: string };

// Colagem "nome; taxa" (uma por linha). Linhas em branco são ignoradas; cada erro volta com o motivo (CA-B9-08).
// Duplicados dentro da colagem e contra `existingKeys` viram erro, nunca sobrescrevem.
export function parseZonePaste(text: string, existingKeys: Set<string>): { valid: ParsedZoneLine[]; errors: ZoneLineError[] } {
  const valid: ParsedZoneLine[] = [];
  const errors: ZoneLineError[] = [];
  const seen = new Set(existingKeys);
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    const parts = raw.split(";");
    if (parts.length !== 2) return void errors.push({ line, text: raw, reason: "Use o formato: nome; taxa" });
    const name = parts[0].trim().replace(/\s+/g, " ");
    if (!name) return void errors.push({ line, text: raw, reason: "Nome do bairro vazio" });
    if (name.length > 100) return void errors.push({ line, text: raw, reason: "Nome do bairro muito longo (máximo 100)" });
    const feeCents = parseMoneyToCents(parts[1]);
    if (feeCents === null) return void errors.push({ line, text: raw, reason: "Taxa inválida (ex.: 6,00)" });
    const key = zoneNameKey(name);
    if (seen.has(key)) return void errors.push({ line, text: raw, reason: "Bairro repetido" });
    seen.add(key);
    valid.push({ line, name, feeCents });
  });
  return { valid, errors };
}

// Frete grátis: compara com o subtotal LÍQUIDO (itens menos desconto), nunca com o bruto (RN-B9-05, CA-B9-05).
// A regra do bairro vale antes da regra geral da loja.
export function applyFreeShipping(feeCents: number, netSubtotalCents: number, zoneFreeFrom: number | null | undefined, storeFreeFrom: number | null | undefined): number {
  const threshold = zoneFreeFrom ?? storeFreeFrom ?? null;
  return threshold !== null && netSubtotalCents >= threshold ? 0 : feeCents;
}
