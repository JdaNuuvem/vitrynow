import { IMPORT_COLUMN_KEYS, IMPORT_MAX_ROWS, sanitizeText, charLength, type ImportDraftRow } from "@meucardapio/shared-types";
import { CodedError } from "../../shared/errors";
import { normalizeName } from "../catalog/catalog.service";

// Entrada de terceiro (planilha ou texto de uma IA): tudo aqui é DADO, nunca instrução. Nada é avaliado, executado ou interpretado como HTML/fórmula.
export type Warning = { code: "UNKNOWN_FIELD" | "FORMULA_AS_TEXT" | "HTML_AS_TEXT" | "ROW_IGNORED_NO_NAME"; line: number | null; field?: string };
type RawRow = { line: number; cells: Record<string, string> };

const MAX_NAME = 80;
const MAX_DESCRIPTION = 300;
const MAX_PRICE_CENTS = 100_000_000;

const tooMany = () => new CodedError(400, "TOO_MANY_ROWS", "A planilha tem mais de 500 linhas. Divida em duas.");
const badFormat = () => new CodedError(400, "IMPORT_FORMAT_INVALID", "Não reconhecemos este arquivo. Use CSV ou JSON.");

// CSV (aspas RFC 4180), separador `;` ou `,` detectado no cabeçalho, BOM ignorado.
export function parseCsv(content: string): string[][] {
  const text = content.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const semis = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const sep = semis > 0 && semis >= commas ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = "";
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
    if (rows.length > IMPORT_MAX_ROWS + 1) throw tooMany();
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  endRow();
  return rows;
}

const headerKey = (h: string) => normalizeName(h.replace(/^﻿/, ""));

export function toRawRows(format: "csv" | "json", content: string, warnings: Warning[]): RawRow[] {
  const unknown = new Set<string>();
  const out: RawRow[] = [];
  const addUnknown = (field: string) => {
    if (unknown.has(field)) return;
    unknown.add(field);
    warnings.push({ code: "UNKNOWN_FIELD", line: null, field: sanitizeText(field).slice(0, 40) });
  };
  if (format === "csv") {
    const table = parseCsv(content);
    if (table.length === 0) throw badFormat();
    const keys = table[0]!.map(headerKey);
    if (!keys.includes("nome") && !keys.includes("preco")) throw badFormat();
    if (table.length - 1 > IMPORT_MAX_ROWS) throw tooMany();
    keys.forEach((k, i) => {
      if (!IMPORT_COLUMN_KEYS.includes(k)) addUnknown(table[0]![i] ?? "");
    });
    table.slice(1).forEach((cells, idx) => {
      const rec: Record<string, string> = {};
      keys.forEach((k, i) => {
        if (IMPORT_COLUMN_KEYS.includes(k)) rec[k] = cells[i] ?? "";
      });
      out.push({ line: idx + 2, cells: rec });
    });
    return out;
  }
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw badFormat();
  }
  const obj = data && typeof data === "object" && !Array.isArray(data) ? (data as { itens?: unknown; items?: unknown }) : null;
  const list = Array.isArray(data) ? data : Array.isArray(obj?.itens) ? obj.itens : Array.isArray(obj?.items) ? obj.items : null;
  if (!list) throw badFormat();
  if (list.length > IMPORT_MAX_ROWS) throw tooMany();
  list.forEach((item, idx) => {
    const rec: Record<string, string> = {};
    if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const [rawKey, value] of Object.entries(item as Record<string, unknown>)) {
        const k = headerKey(rawKey);
        if (!IMPORT_COLUMN_KEYS.includes(k)) {
          addUnknown(rawKey);
          continue;
        }
        // Só texto e número entram; objeto, array ou booleano viram vazio (nunca interpretados).
        rec[k] = typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
      }
    }
    out.push({ line: idx + 1, cells: rec });
  });
  return out;
}

// "12,50" "12.50" "R$ 12,50" "1.234,56" -> centavos; null se inválido (negativo, zero, texto, fórmula).
export function parsePriceCents(raw: string): number | null {
  let s = raw.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = Math.max(lastComma, lastDot);
    s = `${s.slice(0, dec).replace(/[.,]/g, "")}.${s.slice(dec + 1)}`;
  } else if (lastComma >= 0) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return cents > 0 && cents <= MAX_PRICE_CENTS ? cents : null;
}

const FORMULA_START = /^[=+\-@]/;
const HTML_LIKE = /<[a-z!/][^>]*>/i;

// nomes já normalizados; productKeys = "categoria|produto" normalizados
export type ExistingCatalog = { categories: string[]; productKeys: Set<string> };

export function buildDraft(raw: RawRow[], existing: ExistingCatalog, warnings: Warning[]): ImportDraftRow[] {
  const rows: ImportDraftRow[] = [];
  const seen = new Set<string>();
  const existingCats = new Set(existing.categories);
  for (const r of raw) {
    const c = r.cells;
    const text = (k: string, multiline = false) => {
      const original = c[k] ?? "";
      if (FORMULA_START.test(original.trim())) warnings.push({ code: "FORMULA_AS_TEXT", line: r.line, field: k });
      if (HTML_LIKE.test(original)) warnings.push({ code: "HTML_AS_TEXT", line: r.line, field: k });
      return sanitizeText(original, { multiline });
    };
    const category = text("categoria");
    const name = text("nome");
    const description = text("descricao", true);
    const priceRaw = (c.preco ?? "").trim();
    if (!category && !name && !description && !priceRaw) continue; // linha vazia
    if (!name) {
      warnings.push({ code: "ROW_IGNORED_NO_NAME", line: r.line });
      rows.push({ line: r.line, status: "IGNORED", category, name: "", description, priceCents: null, issues: ["NAME_MISSING"], existingCategory: false });
      continue;
    }
    const issues: ImportDraftRow["issues"] = [];
    if (!category) issues.push("CATEGORY_MISSING");
    if (charLength(name) > MAX_NAME) issues.push("NAME_TOO_LONG"); // nunca corta em silêncio (RN-IMP2-08)
    if (charLength(description) > MAX_DESCRIPTION) issues.push("DESCRIPTION_TOO_LONG");
    const priceCents = priceRaw === "" ? null : parsePriceCents(priceRaw);
    if (priceRaw === "") issues.push("PRICE_MISSING");
    else if (priceCents === null) issues.push("PRICE_INVALID");
    const key = `${normalizeName(category)}|${normalizeName(name)}`;
    if (seen.has(key)) issues.push("DUPLICATE_IN_FILE");
    seen.add(key);
    if (existing.productKeys.has(key)) issues.push("ALREADY_EXISTS");
    // "Já existe" não bloqueia: o dono escolhe pular ou criar na confirmação (RN-IMP2-06).
    const blocking = issues.filter((i) => i !== "ALREADY_EXISTS");
    rows.push({ line: r.line, status: blocking.length ? "REVIEW" : "OK", category, name, description, priceCents, issues, existingCategory: existingCats.has(normalizeName(category)) });
  }
  return rows;
}
