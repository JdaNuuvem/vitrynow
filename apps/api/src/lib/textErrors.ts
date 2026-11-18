import { TEXT_TOO_LONG_CODE, TEXT_TOO_LONG_PREFIX } from "@meucardapio/shared-types";

// API-49 (RN-TXT-06): corpo 400 de validação (zod `flatten`) com texto acima do limite ganha `code: TEXT_TOO_LONG` e
// `details: { field, max }`, sem mexer em cada rota. Qualquer outro corpo passa intacto.
export function withTextTooLongCode(payload: string): string {
  if (!payload.includes(TEXT_TOO_LONG_PREFIX)) return payload;
  try {
    const body = JSON.parse(payload) as { code?: string; error?: { fieldErrors?: Record<string, unknown> } };
    if (body.code || !body.error?.fieldErrors || typeof body.error !== "object") return payload;
    for (const [field, messages] of Object.entries(body.error.fieldErrors)) {
      for (const message of Array.isArray(messages) ? messages : []) {
        const match = typeof message === "string" && message.startsWith(TEXT_TOO_LONG_PREFIX) ? /^Passou de (\d+) caracteres\.$/.exec(message) : null;
        if (match) return JSON.stringify({ ...body, code: TEXT_TOO_LONG_CODE, details: { field, max: Number(match[1]) } });
      }
    }
  } catch {
    // corpo que não é JSON: nada a enriquecer
  }
  return payload;
}
