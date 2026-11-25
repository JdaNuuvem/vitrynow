// SSOT D9 — TELEFONE: um lugar só para os dígitos, o DDI do Brasil e os links de contato (ligar e WhatsApp).
// Os links só são montados por ação da pessoa; aqui nada é enviado.

export const phoneDigits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

// Validação e máscara de DIGITAÇÃO vêm da regra única do pacote compartilhado (a API usa a mesma no `phoneSchema`).
export { PHONE_INVALID_MESSAGE, isValidBrPhone, maskPhoneInput } from "@meucardapio/shared-types/phone";
/** Atributos do campo de telefone com máscara: "(11) 98765-4321" (15) ou "(11) 3456-7890" (14). */
export const PHONE_INPUT_PROPS = {
  type: "tel",
  inputMode: "tel",
  maxLength: 15,
  pattern: String.raw`\(\d{2}\) \d{4,5}-\d{4}`,
  title: "Informe DDD e número, ex.: (11) 98765-4321",
  placeholder: "(11) 98765-4321",
} as const;

/** Telefone do Brasil sem DDI (10 ou 11 dígitos) ganha 55; com DDI fica como está. */
export function withBrazilCountryCode(digits: string): string {
  return digits.length > 0 && digits.length <= 11 ? `55${digits}` : digits;
}

export function telHref(phone: string): string {
  return `tel:+${withBrazilCountryCode(phoneDigits(phone))}`;
}

/** Conversa no WhatsApp com um texto pronto. Sem número: null (a tela mostra só o texto). */
export function whatsappHref(phone: string | null | undefined, text: string): string | null {
  const digits = phoneDigits(phone);
  return digits ? `https://wa.me/${withBrazilCountryCode(digits)}?text=${encodeURIComponent(text)}` : null;
}
