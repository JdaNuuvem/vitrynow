import { z } from "zod";

// API-49 (RN-TXT-01..03, ADR-0004 D4-6): texto livre limpo NA ENTRADA, para todo campo digitado pelo cliente ou pela loja.
// Remove: controles C0 (exceto \n; \t vira espaço, \r some), DEL, C1, U+2028/2029, U+FEFF e controles bidirecionais invisíveis
// (que fariam o texto aparecer ao contrário no tíquete/tela). Normaliza para NFC e corta as pontas.
// O limite é RECUSADO (400), NUNCA cortado em silêncio; conta caracteres visíveis (emoji = 1), depois da limpeza.
const BIDI_AND_INVISIBLE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u2028\u2029\uFEFF]/g;
// eslint-disable-next-line no-control-regex
const C0_EXCEPT_NEWLINE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const C1 = /[\u0080-\u009F]/g;

export const TEXT_TOO_LONG_CODE = "TEXT_TOO_LONG";
export const TEXT_TOO_LONG_PREFIX = "Passou de ";
export const textTooLongMessage = (max: number) => `${TEXT_TOO_LONG_PREFIX}${max} caracteres.`;
export const MAX_TEXT_LINES = 5; // RN-TXT-03

export type SanitizeOptions = { multiline?: boolean };

export function sanitizeText(value: string, options: SanitizeOptions = {}): string {
  let text = value.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, " ");
  text = text.replace(C0_EXCEPT_NEWLINE, "").replace(C1, "").replace(BIDI_AND_INVISIBLE, "");
  if (!options.multiline) text = text.replace(/\n+/g, " ").replace(/ {2,}/g, " "); // quebra de linha é proibida em nome/código/rótulo
  else text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

export const charLength = (value: string) => Array.from(value).length;

export type TextFieldOptions = { max: number; min?: number; multiline?: boolean };

// Campo de texto livre: limpa e depois confere o tamanho. Use `.optional()`, `.nullable()` e `.partial()` normalmente.
export function textField({ max, min = 0, multiline = false }: TextFieldOptions) {
  return z
    .string()
    .transform((value) => sanitizeText(value, { multiline }))
    .pipe(
      z
        .string()
        .refine((v) => charLength(v) >= min, { message: min <= 1 ? "Preencha este campo." : `Use pelo menos ${min} caracteres.` })
        .refine((v) => charLength(v) <= max, { message: textTooLongMessage(max) })
        .refine((v) => !multiline || v.split("\n").length <= MAX_TEXT_LINES, { message: `Use no máximo ${MAX_TEXT_LINES} linhas.` }),
    );
}
