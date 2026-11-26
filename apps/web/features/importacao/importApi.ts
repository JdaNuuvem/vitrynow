import type { ImportConfirmInput, ImportPreview } from "@meucardapio/shared-types";
import { FetchHttpClient } from "@/core/http/FetchHttpClient";
import { apiFetch } from "@/lib/api";

// IMPORTAÇÃO DE PRODUTOS (tela nova): chamadas da API IMP-1 (só o dono). A regra (validar, sanitizar, publicar pelo
// serviço de catálogo) fica toda na API; aqui só transporte.
const http = new FetchHttpClient();
const enc = encodeURIComponent;

export type ImportFormat = "csv" | "json";
export type ImportGuide = { version: number; text: string; notice: string };
export type ImportResult = { batchId: string; status: "CONFIRMED"; createdProducts: number; createdCategories: number; skippedExisting: number; ignoredRows: number };

export const importApi = {
  guide: () => http.get<ImportGuide>("/api/catalog/import/guide"),
  preview: (format: ImportFormat, content: string) => http.post<ImportPreview>("/api/catalog/import/preview", { format, content }),
  confirm: (batchId: string, input: Partial<ImportConfirmInput>) => http.post<ImportResult>(`/api/catalog/import/${enc(batchId)}/confirm`, input),
  discard: (batchId: string) => http.post<{ status: "DISCARDED" }>(`/api/catalog/import/${enc(batchId)}/discard`, {}),
  /** Baixa o modelo (o navegador salva o arquivo). */
  async downloadTemplate(format: ImportFormat): Promise<string | null> {
    const res = await apiFetch(`/api/catalog/import/template?format=${format}`);
    if (!res.ok) return "Não foi possível baixar o modelo.";
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `modelo-produtos.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    return null;
  },
};

/** Formato pelo nome do arquivo ou pelo conteúdo (começa com [ ou { = JSON). */
export function detectFormat(fileName: string | null, content: string): ImportFormat {
  if (fileName?.toLowerCase().endsWith(".json")) return "json";
  if (fileName?.toLowerCase().endsWith(".csv")) return "csv";
  const head = content.trimStart().slice(0, 1);
  return head === "[" || head === "{" ? "json" : "csv";
}

// Problemas por linha (códigos da API → texto curto da prévia).
export const ISSUE_LABEL: Record<string, string> = {
  CATEGORY_MISSING: "Sem categoria",
  NAME_MISSING: "Sem nome",
  NAME_TOO_LONG: "Nome com mais de 80 caracteres",
  DESCRIPTION_TOO_LONG: "Descrição com mais de 300 caracteres",
  PRICE_MISSING: "Sem preço",
  PRICE_INVALID: "Preço inválido (use 12.50)",
  DUPLICATE_IN_FILE: "Repetido na planilha",
  ALREADY_EXISTS: "Já existe no cardápio",
};
