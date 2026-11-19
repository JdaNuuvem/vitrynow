import type { CreateCategoryInput, CreateProductInput, SetSoldOutInput, UpdateProductInput } from "@meucardapio/shared-types";
import { nextSoldOutReset } from "../../lib/soldOut";
import { parseLocalDate, startOfStoreDay } from "../../lib/storeTime";
import { promoAboveHalf } from "../../lib/productPrice";
import type { Actor, AuditLogger } from "../../shared/audit";
import { CodedError, NotFoundError } from "../../shared/errors";
import { AdditionalNotInProductError, type CatalogRepository } from "./catalog.repository";

// Limites padrão do catálogo (RN-CT-01, RN-CT-16). Ao atingir, mensagem clara e nada é apagado.
export const MAX_CATEGORIES_PER_STORE = 50;
export const MAX_PRODUCTS_PER_STORE = 500;

// Quem edita o catálogo (RN-PD-10): o papel decide o teto da promoção (acima de 50% só o dono).
export type ProductActor = Actor & { role: string };

// Campos do produto detalhado que o cliente da API pode mandar (datas em AAAA-MM-DD no fuso da loja)
type DetailInput = {
  priceCents?: number;
  promoCents?: number | null;
  promoStartsOn?: string | null;
  promoEndsOn?: string | null;
  kind?: "PRATO" | "ADICIONAL";
  sellAlone?: boolean;
  saleUnit?: "UN" | "KG" | "HG";
  minGrams?: number;
  stepGrams?: number;
  maxGrams?: number;
  portionGrams?: number | null;
};
const invalid = (code: string, message: string, status = 400) => new CodedError(status, code, message);

// Nome de categoria único na loja, sem diferenciar maiúsculas nem acentos (RN-CT-01, CA-CT-02).
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// Regras do catálogo (categorias, produtos, adicionais). Não conhece HTTP nem Prisma.
export class CatalogService {
  constructor(
    private readonly repo: CatalogRepository,
    private readonly audit: AuditLogger,
  ) {}

  listCategories(storeId: string) {
    return this.repo.listCategories(storeId);
  }

  async createCategory(storeId: string, input: CreateCategoryInput) {
    const names = await this.repo.listCategoryNames(storeId);
    if (names.length >= MAX_CATEGORIES_PER_STORE) {
      throw new CodedError(409, "CATEGORY_LIMIT_REACHED", `A loja já tem ${MAX_CATEGORIES_PER_STORE} categorias (o máximo).`, { max: MAX_CATEGORIES_PER_STORE });
    }
    this.assertNameFree(names, input.name);
    const { icon, ...rest } = input;
    // Categoria nova entra no FIM da ordem (RN-CT-02), a menos que a posição venha explícita.
    const position = rest.position ?? (await this.repo.nextCategoryPosition(storeId));
    return this.repo.createCategory(storeId, { ...rest, position, icon: icon || null });
  }

  async updateCategory(storeId: string, id: string, input: Partial<CreateCategoryInput>) {
    await this.requireCategory(storeId, id);
    if (input.name !== undefined) this.assertNameFree(await this.repo.listCategoryNames(storeId), input.name, id);
    const { icon, ...rest } = input;
    // icon vazio limpa o emoji; ausente não mexe nele.
    return this.repo.updateCategory(id, { ...rest, icon: icon === "" ? null : icon });
  }

  async deleteCategory(actor: Actor, id: string) {
    const category = await this.requireCategory(actor.storeId, id);
    const productCount = await this.repo.countProductsInCategory(id);
    if (productCount > 0) {
      // RN-CT-04: só sai categoria sem nenhum produto (visível, oculto ou esgotado); a saída é "Mover produtos para…".
      throw new CodedError(
        409,
        "CATEGORY_NOT_EMPTY",
        `categoria tem ${productCount} produto(s) — mova ou exclua os produtos antes de excluir a categoria`,
        { count: productCount, hint: "MOVE_PRODUCTS" },
      );
    }
    await this.repo.deleteCategory(id);
    this.audit.log({ ...actor, action: "category.delete", targetType: "Category", targetId: id, metadata: { name: category.name } });
  }

  // "Mover produtos para…" (RN-CT-04): vale na hora; o histórico dos pedidos não muda.
  async moveProducts(actor: Actor, fromId: string, toId: string) {
    if (fromId === toId) throw new CodedError(400, "SAME_CATEGORY", "Escolha outra categoria de destino.");
    await this.requireCategory(actor.storeId, fromId);
    await this.requireCategory(actor.storeId, toId); // SEC-11: destino tem que ser desta loja
    const moved = await this.repo.moveProducts(actor.storeId, fromId, toId);
    this.audit.log({ ...actor, action: "category.move_products", targetType: "Category", targetId: fromId, metadata: { toCategoryId: toId, moved } });
    return { moved };
  }

  // Reordenar (RN-CT-02): a ordem enviada vira a posição. Ids de outra loja nunca são tocados.
  async reorderCategories(storeId: string, ids: string[]) {
    await this.assertAllOwned(ids, (await this.repo.listCategoryIds(storeId)));
    await this.repo.setCategoryOrder(storeId, ids);
  }

  async reorderProducts(storeId: string, categoryId: string, ids: string[]) {
    await this.requireCategory(storeId, categoryId);
    await this.assertAllOwned(ids, await this.repo.listProductIds(storeId, categoryId));
    await this.repo.setProductOrder(storeId, categoryId, ids);
  }

  async createProduct(actor: ProductActor, input: CreateProductInput) {
    const storeId = actor.storeId;
    const { additionals, promoStartsOn, promoEndsOn, ...rest } = input;
    const data = { ...rest, ...(await this.detail(actor, null, { ...rest, promoStartsOn, promoEndsOn })) };
    // SEC-11: categoryId vem do cliente; categoria de outra loja injetaria o produto no cardápio dela.
    await this.requireCategory(storeId, data.categoryId);
    if ((await this.repo.countProducts(storeId)) >= MAX_PRODUCTS_PER_STORE) {
      throw new CodedError(409, "PRODUCT_LIMIT_REACHED", `A loja já tem ${MAX_PRODUCTS_PER_STORE} produtos (o máximo).`, { max: MAX_PRODUCTS_PER_STORE });
    }
    // Produto novo entra no FIM da categoria (RN-CT-02).
    const position = data.position ?? (await this.repo.nextProductPosition(data.categoryId));
    return this.repo.createProduct(storeId, { ...data, position }, additionals);
  }

  async updateProduct(actor: ProductActor, id: string, input: UpdateProductInput) {
    const before = await this.requireProduct(actor.storeId, id);
    const { additionals, promoStartsOn, promoEndsOn, ...rest } = input;
    const data = { ...rest, ...(await this.detail(actor, before, { ...rest, promoStartsOn, promoEndsOn })) };
    if (data.categoryId) await this.requireCategory(actor.storeId, data.categoryId);
    let product;
    try {
      product = await this.repo.updateProduct(id, data, additionals);
    } catch (error) {
      // SEC-10: adicional que não é deste produto (inclusive de outra loja) => 404, nada alterado.
      if (error instanceof AdditionalNotInProductError) throw new NotFoundError("adicional não encontrado neste produto");
      throw error;
    }
    // RN-PD-09: toda mudança de promoção (valor, início ou fim) também grava auditoria (só números e instantes, sem texto livre).
    if (data.promoCents !== undefined || data.promoStartsAt !== undefined || data.promoEndsAt !== undefined) {
      const changed = (data.promoCents !== undefined && data.promoCents !== before.promoCents) || (data.promoStartsAt !== undefined && (data.promoStartsAt?.getTime() ?? null) !== (before.promoStartsAt?.getTime() ?? null)) || (data.promoEndsAt !== undefined && (data.promoEndsAt?.getTime() ?? null) !== (before.promoEndsAt?.getTime() ?? null));
      if (changed) {
        this.audit.log({
          ...actor,
          action: "product.promo_change",
          targetType: "Product",
          targetId: id,
          metadata: { name: before.name, beforeCents: before.promoCents, afterCents: product.promoCents, startsAt: product.promoStartsAt, endsAt: product.promoEndsAt },
        });
      }
    }
    // RN-CT-13: toda mudança de preço grava auditoria com valor antes e depois.
    if (data.priceCents !== undefined && data.priceCents !== before.priceCents) {
      this.audit.log({
        ...actor,
        action: "product.price_change",
        targetType: "Product",
        targetId: id,
        metadata: { name: before.name, beforeCents: before.priceCents, afterCents: data.priceCents },
      });
    }
    return product;
  }

  // API-17: liga/desliga "esgotado". TODAY volta às 04:00 do fuso da loja; MANUAL só volta quando reativado.
  async setSoldOut(actor: Actor, id: string, input: SetSoldOutInput) {
    const product = await this.requireProduct(actor.storeId, id);
    const duration = input.duration ?? "TODAY";
    const soldOutUntil = input.soldOut && duration === "TODAY" ? nextSoldOutReset() : null;
    const updated = await this.repo.updateProduct(id, { soldOut: input.soldOut, soldOutUntil });
    this.audit.log({
      ...actor,
      action: input.soldOut ? "product.sold_out" : "product.sold_out_cleared",
      targetType: "Product",
      targetId: id,
      metadata: { name: product.name, duration: input.soldOut ? duration : null, until: soldOutUntil },
    });
    return updated;
  }

  async deleteProduct(actor: Actor, id: string) {
    const product = await this.requireProduct(actor.storeId, id);
    // RN-PD-15: adicional em uso em algum grupo não se exclui (a saída é tirar dos grupos ou ocultar).
    const usage = await this.repo.addonUsage(actor.storeId, id);
    if (usage.groups.length > 0) {
      throw new CodedError(409, "ADDON_IN_USE", `Este adicional é usado em ${usage.products} produto(s). Remova-o dos grupos primeiro.`, { products: usage.products, groups: usage.groups, hint: "REMOVE_FROM_GROUPS" });
    }
    // RN-CT-12: com pedido em aberto a exclusão é bloqueada; a saída é ocultar (active=false).
    const openOrders = await this.repo.countOpenOrdersWithProduct(id);
    if (openOrders > 0) {
      throw new CodedError(409, "PRODUCT_IN_OPEN_ORDERS", `${product.name} está em ${openOrders} pedido(s) em aberto. Oculte em vez de excluir.`, {
        count: openOrders,
        hint: "HIDE_INSTEAD",
      });
    }
    await this.repo.deleteProduct(id);
    this.audit.log({
      ...actor,
      action: "product.delete",
      targetType: "Product",
      targetId: id,
      metadata: { name: product.name, priceCents: product.priceCents },
    });
  }

  private assertNameFree(names: Array<{ id: string; name: string }>, name: string, exceptId?: string) {
    const wanted = normalizeName(name);
    if (names.some((existing) => existing.id !== exceptId && normalizeName(existing.name) === wanted)) {
      throw new CodedError(409, "CATEGORY_NAME_TAKEN", "Já existe uma categoria com esse nome.");
    }
  }

  private assertAllOwned(ids: string[], ownedIds: string[]) {
    const owned = new Set(ownedIds);
    if (new Set(ids).size !== ids.length || ids.some((id) => !owned.has(id))) {
      throw new NotFoundError("item não encontrado na ordem enviada");
    }
  }

  private async requireCategory(storeId: string, id: string) {
    const category = await this.repo.findCategory(storeId, id);
    if (!category) throw new NotFoundError("categoria não encontrada");
    return category;
  }

  /**
   * Regras do produto detalhado (RN-PD-01..10, 15, 17, 24, 27): confere o ESTADO FINAL (o que já existe + o que veio) e devolve só o que mudou, já convertido
   * (datas do fuso da loja → instantes UTC). Nada é gravado se alguma regra falhar. `before` nulo = criação.
   */
  private async detail(
    actor: ProductActor,
    before: { id: string; priceCents: number; promoCents: number | null; promoStartsAt: Date | null; promoEndsAt: Date | null; kind: string; saleUnit: string; minGrams: number; stepGrams: number; maxGrams: number; portionGrams: number | null } | null,
    input: DetailInput,
  ) {
    const out: { promoCents?: number | null; promoStartsAt?: Date | null; promoEndsAt?: Date | null; sellAlone?: boolean; kind?: "PRATO" | "ADICIONAL" } = {};
    const needsTz = input.promoStartsOn != null || input.promoEndsOn != null;
    const tz = needsTz ? await this.repo.storeTimezone(actor.storeId) : ""; // sem datas de promoção o fuso não é usado (SSOT: sem literal de fuso fora de storeTime.ts)
    const now = new Date();

    // Vigência: AAAA-MM-DD no fuso da loja. Início = 00:00 do dia; fim = 00:00 do dia SEGUINTE (o dia final vale inteiro; `início ≤ agora < fim`).
    if (input.promoStartsOn !== undefined) {
      if (input.promoStartsOn === null) out.promoStartsAt = null;
      else {
        const date = parseLocalDate(input.promoStartsOn, tz);
        if (!date) throw invalid("PROMO_INVALID", "Data de início da promoção inválida.");
        out.promoStartsAt = date;
      }
    }
    if (input.promoEndsOn !== undefined) {
      if (input.promoEndsOn === null) out.promoEndsAt = null;
      else {
        const day = parseLocalDate(input.promoEndsOn, tz);
        if (!day) throw invalid("PROMO_EXPIRY_INVALID", "Data final da promoção inválida.");
        out.promoEndsAt = startOfStoreDay(new Date(day.getTime() + 36 * 3600_000), tz, 0); // dia seguinte (36 h cobre dias de 23 e 25 h) normalizado para 00:00 local
        if (out.promoEndsAt.getTime() <= now.getTime()) throw invalid("PROMO_EXPIRY_INVALID", "A data final da promoção já passou.");
      }
    }
    if (input.promoCents !== undefined) out.promoCents = input.promoCents;
    // Desligar a promoção limpa as datas junto (sem promoção, data não faz sentido).
    if (input.promoCents === null) {
      out.promoStartsAt = null;
      out.promoEndsAt = null;
    }

    const price = input.priceCents ?? before?.priceCents ?? 0;
    const promo = out.promoCents !== undefined ? out.promoCents : (before?.promoCents ?? null);
    const startsAt = out.promoStartsAt !== undefined ? out.promoStartsAt : (before?.promoStartsAt ?? null);
    const endsAt = out.promoEndsAt !== undefined ? out.promoEndsAt : (before?.promoEndsAt ?? null);
    if (promo !== null) {
      // RN-PD-01 e RN-PD-09: 1 ≤ promo < normal (inclusive ao EDITAR o preço normal para um valor ≤ promoção).
      if (promo < 1 || promo >= price) throw invalid("PROMO_INVALID", "O preço promocional precisa ser menor que o preço normal.");
      if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) throw invalid("PROMO_INVALID", "A promoção termina antes de começar.");
      // RN-PD-10: acima de 50% só o dono (inteiros: promo × 2 < normal; 50% exato passa).
      if (actor.role !== "OWNER" && promoAboveHalf(price, promo)) throw invalid("FORBIDDEN_ROLE", "Acima do seu limite. Peça ao dono.", 403);
    }

    // Tipo: ADICIONAL nasce sem vender sozinho (RN-PD-11); o dono pode marcar "Também vender sozinho".
    if (input.kind !== undefined) out.kind = input.kind;
    const kind = input.kind ?? before?.kind ?? "PRATO";
    if (!before && input.kind === "ADICIONAL" && input.sellAlone === undefined) out.sellAlone = false;

    // Unidade de venda e gramas (RN-PD-17/18/24/27)
    const saleUnit = input.saleUnit ?? before?.saleUnit ?? "UN";
    const minG = input.minGrams ?? before?.minGrams ?? 100;
    const stepG = input.stepGrams ?? before?.stepGrams ?? 50;
    const maxG = input.maxGrams ?? before?.maxGrams ?? 5000;
    if (saleUnit !== "UN") {
      if (minG > maxG) throw invalid("WEIGHT_OUT_OF_RANGE", "O peso mínimo não pode ser maior que o máximo.");
      const portion = input.portionGrams !== undefined ? input.portionGrams : (before?.portionGrams ?? null);
      if (portion !== null) throw invalid("VALIDATION_ERROR", "Produto vendido por peso não tem gramatura de porção.");
      if (maxG !== minG && stepG > maxG - minG) throw invalid("WEIGHT_STEP_INVALID", "O passo é maior que a faixa de peso.");
    }
    if (before && (input.saleUnit !== undefined || input.kind !== undefined) && (saleUnit !== "UN" || kind === "ADICIONAL")) {
      const state = await this.repo.optionState(actor.storeId, before.id);
      if (saleUnit !== "UN" && (state.groups > 0 || state.legacyAdditionals > 0)) throw invalid("PRODUCT_WEIGHT_NO_OPTIONS", "Produto vendido por peso não aceita opções.");
      if (kind === "ADICIONAL" && state.groups > 0) throw invalid("ADDON_HAS_GROUPS", "Um adicional não tem grupos de opções.");
    }
    // Deixar de ser adicional (ou virar por peso) com o produto ligado a grupos o deixaria apontado por uma opção inválida.
    if (before && (kind !== "ADICIONAL" || saleUnit !== "UN") && (input.kind !== undefined || input.saleUnit !== undefined)) {
      const usage = await this.repo.addonUsage(actor.storeId, before.id);
      if (usage.groups.length > 0) throw new CodedError(409, "ADDON_IN_USE", `Este adicional é usado em ${usage.products} produto(s). Remova-o dos grupos primeiro.`, { products: usage.products, groups: usage.groups, hint: "REMOVE_FROM_GROUPS" });
    }
    if (promo !== null && before && out.promoCents !== undefined) {
      if ((await this.repo.optionState(actor.storeId, before.id)).hasBaseGroup) throw invalid("PROMO_NOT_ALLOWED", "Este produto tem o preço definido pelas variações.");
    }
    return out;
  }

  private async requireProduct(storeId: string, id: string) {
    const product = await this.repo.findProduct(storeId, id);
    if (!product) throw new NotFoundError("produto não encontrado");
    return product;
  }
}
