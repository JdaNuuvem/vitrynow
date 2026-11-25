// SSOT D9 — TELEFONE DO BRASIL: a regra única de "telefone válido" e a máscara de digitação. Sem zod: o web importa direto
// (`@meucardapio/shared-types/phone`) e a API usa a mesma regra dentro do `phoneSchema`.
//
// Válido = DDD + número, 10 dígitos (fixo) ou 11 (celular, 3º dígito 9). Aceita o DDI 55 na frente (12/13 dígitos) e a
// pontuação comum: "(11) 98765-4321", "+55 11 98765-4321", "11987654321".

export const PHONE_MAX_INPUT = 20; // caracteres no campo (com máscara e DDI cabe: "+55 (11) 98765-4321" = 19)
export const PHONE_INVALID_MESSAGE = "Telefone inválido: informe DDD e número (10 ou 11 dígitos).";

/** Só os dígitos, sem o DDI 55. Não valida. */
export function nationalPhoneDigits(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return (digits.length === 12 || digits.length === 13) && digits.startsWith("55") ? digits.slice(2) : digits;
}

/** Dígitos nacionais (10 ou 11) se o telefone é válido no Brasil; senão null. */
export function brPhoneDigits(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!/^\+?[0-9()\s.-]+$/.test(text)) return null; // só dígitos e pontuação de telefone; "+" só no começo
  const digits = nationalPhoneDigits(text);
  if (digits.length !== 10 && digits.length !== 11) return null;
  if (!/^[1-9][1-9]/.test(digits)) return null; // DDD não começa nem termina em 0
  if (digits.length === 11 && digits[2] !== "9") return null; // celular: 9 na frente
  return digits;
}

export const isValidBrPhone = (value: string | null | undefined) => brPhoneDigits(value) !== null;

/**
 * Máscara de digitação: "(11) 98765-4321" / "(11) 3456-7890". Descarta tudo que não é dígito e corta em 11 dígitos
 * (o DDI 55 colado de um link é removido). Valor parcial fica parcialmente formatado.
 */
export function maskPhoneInput(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  const split = digits.length === 11 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}
