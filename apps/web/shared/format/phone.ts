// SSOT D9 — TELEFONE: um lugar só para os dígitos, o DDI do Brasil e os links de contato (ligar e WhatsApp).
// Os links só são montados por ação da pessoa; aqui nada é enviado.

export const phoneDigits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

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
