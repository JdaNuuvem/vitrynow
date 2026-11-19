import { createHash } from "node:crypto";
import { IMPORT_COLUMNS, IMPORT_MAX_BYTES, IMPORT_MAX_PER_HOUR, importGuideText, IMPORT_GUIDE_VERSION, type ImportConfirmInput, type ImportDraftRow, type ImportPreview } from "@meucardapio/shared-types";
import type { AuditLogger } from "../../shared/audit";
import { CodedError, NotFoundError } from "../../shared/errors";
import { MAX_CATEGORIES_PER_STORE, MAX_PRODUCTS_PER_STORE, normalizeName, type CatalogService, type ProductActor } from "../catalog/catalog.service";
import { buildDraft, toRawRows, type Warning } from "./importParse";

export type BatchRecord = { id: string; storeId: string; status: "PREVIEW" | "CONFIRMED" | "DISCARDED"; contentHash: string; draft: { rows: ImportDraftRow[]; warnings: Warning[] }; result: unknown };

// Porta de dados do lote (só a tabela ImportBatch e leituras do catálogo; ESCRITA de produto/categoria passa pelo CatalogService).
export interface ImportRepository {
  create(data: { storeId: string; userId: string; contentHash: string; draft: unknown }): Promise<BatchRecord>;
  find(storeId: string, id: string): Promise<BatchRecord | null>;
  countSince(storeId: string, since: Date): Promise<number>;
  /** PREVIEW -> novoStatus de forma atômica; false se outro pedido já finalizou o lote. */
  claim(storeId: string, id: string, to: "CONFIRMED" | "DISCARDED", result: unknown): Promise<boolean>;
  reopen(storeId: string, id: string): Promise<void>;
  setResult(storeId: string, id: string, result: unknown): Promise<void>;
  /** Nomes de produtos existentes da loja por categoria normalizada. */
  existingProductKeys(storeId: string): Promise<Set<string>>;
  countProducts(storeId: string): Promise<number>;
}

const HOUR = 60 * 60 * 1000;
const csvQuote = (v: string) => (/[";,\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export class CatalogImportService {
  constructor(
    private readonly repo: ImportRepository,
    private readonly catalog: CatalogService,
    private readonly audit: AuditLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // e1: o modelo sai da MESMA lista de colunas que valida a importação.
  template(format: "csv" | "json") {
    if (format === "json") {
      const body = JSON.stringify([Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, c.example]))], null, 2);
      return { contentType: "application/json; charset=utf-8", filename: "modelo-produtos.json", body };
    }
    const body = `﻿${IMPORT_COLUMNS.map((c) => c.key).join(";")}\r\n${IMPORT_COLUMNS.map((c) => csvQuote(c.example)).join(";")}\r\n`;
    return { contentType: "text/csv; charset=utf-8", filename: "modelo-produtos.csv", body };
  }

  guide() {
    return { version: IMPORT_GUIDE_VERSION, text: importGuideText() };
  }

  // e2: valida e mostra; NÃO grava produto nem categoria. Só o lote (rascunho) é guardado.
  async preview(actor: ProductActor, input: { format: "csv" | "json"; content: string }): Promise<ImportPreview> {
    if (Buffer.byteLength(input.content, "utf8") > IMPORT_MAX_BYTES) throw new CodedError(413, "FILE_TOO_LARGE", "O arquivo passou do tamanho permitido.");
    const since = new Date(this.now().getTime() - HOUR);
    if ((await this.repo.countSince(actor.storeId, since)) >= IMPORT_MAX_PER_HOUR) {
      throw new CodedError(429, "IMPORT_RATE_LIMITED", "Limite de 3 importações por hora. Tente de novo mais tarde.");
    }
    const warnings: Warning[] = [];
    const raw = toRawRows(input.format, input.content, warnings);
    const [categories, productKeys] = await Promise.all([this.catalog.listCategories(actor.storeId), this.repo.existingProductKeys(actor.storeId)]);
    const rows = buildDraft(raw, { categories: categories.map((c) => normalizeName(c.name)), productKeys }, warnings);
    const draft = { rows, warnings };
    const contentHash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    const batch = await this.repo.create({ storeId: actor.storeId, userId: actor.userId, contentHash, draft });
    const preview = this.toPreview(batch);
    this.audit.log({ storeId: actor.storeId, userId: actor.userId, action: "catalog.import.preview", targetType: "ImportBatch", targetId: batch.id, metadata: { ...preview.totals } });
    return preview;
  }

  async get(storeId: string, id: string): Promise<ImportPreview & { result: unknown }> {
    const batch = await this.require(storeId, id);
    return { ...this.toPreview(batch), result: batch.result ?? null };
  }

  async discard(actor: ProductActor, id: string) {
    const batch = await this.require(actor.storeId, id);
    if (batch.status === "DISCARDED") return { status: "DISCARDED" as const }; // idempotente
    if (batch.status === "CONFIRMED") throw new CodedError(409, "IMPORT_NOT_PENDING", "Esta importação já foi finalizada.");
    if (!(await this.repo.claim(actor.storeId, id, "DISCARDED", null))) throw new CodedError(409, "IMPORT_NOT_PENDING", "Esta importação já foi finalizada.");
    this.audit.log({ storeId: actor.storeId, userId: actor.userId, action: "catalog.import.discard", targetType: "ImportBatch", targetId: id });
    return { status: "DISCARDED" as const };
  }

  // e3: publica PELO MESMO serviço do cadastro manual (mesmos tetos, mesmas recusas). Idempotente por lote.
  async confirm(actor: ProductActor, id: string, input: ImportConfirmInput) {
    const batch = await this.require(actor.storeId, id);
    if (batch.status === "CONFIRMED") return batch.result as ConfirmResult; // repetir devolve o mesmo resultado
    if (batch.status === "DISCARDED") throw new CodedError(409, "IMPORT_NOT_PENDING", "Esta importação já foi finalizada.");
    if (input.contentHash && input.contentHash !== batch.contentHash) throw new CodedError(409, "IMPORT_BATCH_CHANGED", "A importação mudou. Veja a prévia de novo.");
    const rows = batch.draft.rows;
    if (!input.skipInvalid && rows.some((r) => r.status === "REVIEW")) {
      throw new CodedError(409, "IMPORT_HAS_PENDING_ROWS", "Há linhas para revisar. Corrija a planilha ou publique só as válidas.", { review: rows.filter((r) => r.status === "REVIEW").length });
    }
    const existingKeys = await this.repo.existingProductKeys(actor.storeId);
    const toCreate = rows.filter((r) => r.status === "OK" && r.priceCents !== null && (input.duplicates === "create" || !existingKeys.has(`${normalizeName(r.category)}|${normalizeName(r.name)}`)));
    const skippedExisting = rows.filter((r) => r.status === "OK").length - toCreate.length;

    // Tetos conferidos ANTES de gravar (nada pela metade por falta de espaço).
    const categories = await this.catalog.listCategories(actor.storeId);
    const known = new Map(categories.map((c) => [normalizeName(c.name), c.id]));
    const newNames = [...new Set(toCreate.map((r) => normalizeName(r.category)))].filter((n) => !known.has(n));
    if (categories.length + newNames.length > MAX_CATEGORIES_PER_STORE) {
      throw new CodedError(409, "CATEGORY_LIMIT_REACHED", `A loja já tem ${MAX_CATEGORIES_PER_STORE} categorias (o máximo).`, { max: MAX_CATEGORIES_PER_STORE });
    }
    if ((await this.repo.countProducts(actor.storeId)) + toCreate.length > MAX_PRODUCTS_PER_STORE) {
      throw new CodedError(409, "PRODUCT_LIMIT_REACHED", `A loja já tem ${MAX_PRODUCTS_PER_STORE} produtos (o máximo).`, { max: MAX_PRODUCTS_PER_STORE });
    }

    if (!(await this.repo.claim(actor.storeId, id, "CONFIRMED", null))) {
      const again = await this.require(actor.storeId, id); // outro pedido igual venceu: devolve o resultado dele
      if (again.status === "CONFIRMED" && again.result) return again.result as ConfirmResult;
      throw new CodedError(409, "IMPORT_NOT_PENDING", "Esta importação já foi finalizada.");
    }
    let createdProducts = 0;
    let createdCategories = 0;
    try {
      for (const r of toCreate) {
        const key = normalizeName(r.category);
        let categoryId = known.get(key);
        if (!categoryId) {
          const category = await this.catalog.createCategory(actor.storeId, { name: r.category });
          categoryId = category.id;
          known.set(key, categoryId);
          createdCategories++;
        }
        await this.catalog.createProduct(actor, { categoryId, name: r.name, description: r.description || undefined, priceCents: r.priceCents! });
        createdProducts++;
      }
    } catch (error) {
      await this.repo.reopen(actor.storeId, id); // permite repetir: o que já foi criado vira "Já existe" e é pulado
      throw error;
    }
    const result: ConfirmResult = { batchId: id, status: "CONFIRMED", createdProducts, createdCategories, skippedExisting, ignoredRows: rows.length - toCreate.length - skippedExisting };
    await this.repo.setResult(actor.storeId, id, result);
    this.audit.log({ storeId: actor.storeId, userId: actor.userId, action: "catalog.import.confirm", targetType: "ImportBatch", targetId: id, metadata: { createdProducts, createdCategories, skippedExisting, ignoredRows: result.ignoredRows } });
    return result;
  }

  private async require(storeId: string, id: string) {
    const batch = await this.repo.find(storeId, id); // sempre por loja: lote de outra loja = 404
    if (!batch) throw new NotFoundError("importação não encontrada");
    return batch;
  }

  private toPreview(batch: BatchRecord): ImportPreview {
    const rows = batch.draft.rows;
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    const newCategories = new Set(rows.filter((r) => r.status === "OK" && !r.existingCategory).map((r) => normalizeName(r.category))).size;
    return {
      batchId: batch.id,
      contentHash: batch.contentHash,
      status: batch.status,
      rows,
      warnings: batch.draft.warnings.map((w) => ({ code: w.code, line: w.line, ...(w.field ? { field: w.field } : {}) })),
      totals: { rows: rows.length, ok: count("OK"), review: count("REVIEW"), ignored: count("IGNORED"), newCategories },
    };
  }
}

export type ConfirmResult = { batchId: string; status: "CONFIRMED"; createdProducts: number; createdCategories: number; skippedExisting: number; ignoredRows: number };
