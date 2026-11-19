import { z } from "zod";

// IMP-1 (e1..e3, fase 1 sem conta de IA): FONTE ÚNICA do modelo de planilha/JSON e da validação da importação.
// O modelo baixado e a validação saem DESTA lista de colunas: nunca duas definições.
export const IMPORT_COLUMNS = [
  { key: "categoria", required: true, example: "Pizzas", help: "Nome da categoria. Se já existir (sem diferenciar acento ou maiúscula), é reaproveitada." },
  { key: "nome", required: true, example: "Pizza Margherita", help: "Até 80 caracteres." },
  { key: "descricao", required: false, example: "Molho, muçarela e manjericão", help: "Opcional. Até 300 caracteres." },
  { key: "preco", required: true, example: "42,50", help: "Em reais. Aceita 12,50, 12.50 ou R$ 12,50. Maior que zero." },
] as const;
export type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]["key"];
export const IMPORT_COLUMN_KEYS: readonly string[] = IMPORT_COLUMNS.map((c) => c.key);

export const IMPORT_MAX_ROWS = 500; // RN-IMP2-02
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024; // RN-IMP2-02 (2 MB)
export const IMPORT_MAX_PER_HOUR = 3; // RN-IMP2-20 (por loja)
export const IMPORT_FORMATS = ["csv", "json"] as const; // xlsx fica para depois (sem dependência nova nesta fase)
export const IMPORT_GUIDE_VERSION = 1;

export const importTemplateQuerySchema = z.object({ format: z.enum(IMPORT_FORMATS).default("csv") });
export const importPreviewInputSchema = z.object({ format: z.enum(IMPORT_FORMATS), content: z.string().min(1) }).strict();
export const importConfirmSchema = z
  .object({
    contentHash: z.string().length(64).optional(), // se vier e o lote tiver mudado: 409
    duplicates: z.enum(["skip", "create"]).default("skip"), // RN-IMP2-06: nunca sobrescreve
    skipInvalid: z.boolean().default(false), // publicar só as linhas válidas e ignorar as em revisão
  })
  .strict();
export type ImportConfirmInput = z.infer<typeof importConfirmSchema>;

export const IMPORT_ROW_STATUS = ["OK", "REVIEW", "IGNORED"] as const;
export const IMPORT_ISSUE_CODES = [
  "CATEGORY_MISSING",
  "NAME_MISSING",
  "NAME_TOO_LONG",
  "DESCRIPTION_TOO_LONG",
  "PRICE_MISSING", // IMPORT_PRICE_MISSING na tela
  "PRICE_INVALID",
  "DUPLICATE_IN_FILE",
  "ALREADY_EXISTS",
] as const;
export const IMPORT_WARNING_CODES = ["UNKNOWN_FIELD", "FORMULA_AS_TEXT", "HTML_AS_TEXT", "ROW_IGNORED_NO_NAME"] as const;

export const importDraftRowSchema = z.object({
  line: z.number().int().positive(),
  status: z.enum(IMPORT_ROW_STATUS),
  category: z.string(),
  name: z.string(),
  description: z.string(),
  priceCents: z.number().int().nullable(),
  issues: z.array(z.enum(IMPORT_ISSUE_CODES)),
  existingCategory: z.boolean(),
});
export type ImportDraftRow = z.infer<typeof importDraftRowSchema>;

export const importWarningSchema = z.object({ code: z.enum(IMPORT_WARNING_CODES), line: z.number().int().nullable(), field: z.string().optional() });
export const importPreviewSchema = z.object({
  batchId: z.string(),
  contentHash: z.string(),
  status: z.enum(["PREVIEW", "CONFIRMED", "DISCARDED"]),
  rows: z.array(importDraftRowSchema),
  warnings: z.array(importWarningSchema),
  totals: z.object({ rows: z.number().int(), ok: z.number().int(), review: z.number().int(), ignored: z.number().int(), newCategories: z.number().int() }),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;

export const IMPORT_ERROR_CODES = {
  FILE_TOO_LARGE: { status: 413, message: "O arquivo passou do tamanho permitido." },
  TOO_MANY_ROWS: { status: 400, message: "A planilha tem mais de 500 linhas. Divida em duas." },
  IMPORT_FORMAT_INVALID: { status: 400, message: "Não reconhecemos este arquivo. Use CSV ou JSON." },
  IMPORT_RATE_LIMITED: { status: 429, message: "Limite de 3 importações por hora. Tente de novo mais tarde." },
  IMPORT_NOT_FOUND: { status: 404, message: "Importação não encontrada." },
  IMPORT_BATCH_CHANGED: { status: 409, message: "A importação mudou. Veja a prévia de novo." },
  IMPORT_NOT_PENDING: { status: 409, message: "Esta importação já foi finalizada." },
  IMPORT_HAS_PENDING_ROWS: { status: 409, message: "Há linhas para revisar. Corrija a planilha ou publique só as válidas." },
} as const;

// "Guia para a sua IA" (RN-IMP2-15b): texto fixo e versionado; o dono cola no ChatGPT/Claude DELE, fora da plataforma. Texto final: Ogilvy valida.
export function importGuideText(): string {
  const cols = IMPORT_COLUMNS.map((c) => `- ${c.key}${c.required ? " (obrigatório)" : " (opcional)"}: ${c.help}`).join("\n");
  const example = JSON.stringify([Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, c.example]))], null, 2);
  return [
    "Leia a foto do cardápio que vou enviar e devolva SOMENTE uma lista JSON, sem nenhum outro texto, neste formato:",
    example,
    "Colunas:",
    cols,
    "Regras: um item do cardápio por linha; não invente itens nem preços; se um item tiver mais de um preço (ex.: P e G), crie uma linha para cada tamanho com o tamanho no nome; não inclua nada além do JSON.",
  ].join("\n\n");
}
