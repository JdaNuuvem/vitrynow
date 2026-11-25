import type { Option, OptionGroup, Prisma, prisma as prismaClient } from "@meucardapio/db";
import type { GroupInput, GroupRow } from "./optionGroups.domain";
import { effectivePriceCents, type PricedProduct } from "../../lib/productPrice";
import { isSoldOutNow } from "../../lib/soldOut";

type Db = typeof prismaClient;
type Tx = Prisma.TransactionClient;

// Produto ligado à opção (RN-PD-12): só o necessário para herdar nome/preço e saber se está disponível.
const PRODUCT_SELECT = { name: true, priceCents: true, promoCents: true, promoStartsAt: true, promoEndsAt: true, saleUnit: true, minGrams: true, stepGrams: true, maxGrams: true, active: true, soldOut: true, soldOutUntil: true, kind: true } as const;
const OPTIONS_INCLUDE = { orderBy: { position: "asc" }, include: { product: { select: PRODUCT_SELECT } } } as const;
type LinkedOption = Option & { product: (PricedProduct & { name: string; active: boolean; soldOut: boolean; soldOutUntil: Date | null; kind: string }) | null };

export type GroupWithOptions = OptionGroup & { options: LinkedOption[] };
export type GroupWithUsage = GroupWithOptions & { productCount: number };

/** Opção informada que não pertence ao grupo (id de outro grupo/loja ou inexistente). */
export class OptionNotInGroupError extends Error {
  constructor(readonly optionId: string) {
    super("opção não pertence ao grupo");
    this.name = "OptionNotInGroupError";
  }
}

export interface OptionGroupsRepository {
  listGroups(storeId: string): Promise<GroupWithUsage[]>;
  findGroup(storeId: string, id: string): Promise<GroupWithOptions | null>;
  findGroupsByIds(storeId: string, ids: string[]): Promise<GroupWithOptions[]>;
  createGroup(storeId: string, input: GroupInput): Promise<GroupWithOptions>;
  updateGroup(storeId: string, id: string, input: GroupInput): Promise<GroupWithOptions>;
  deleteGroup(storeId: string, id: string): Promise<void>;
  countProductsUsing(groupId: string): Promise<number>;
  /** Produtos que ficariam com mais de um grupo BASE se `groupId` virasse BASE (nomes). */
  productsWithAnotherBase(storeId: string, groupId: string): Promise<string[]>;
  findProduct(storeId: string, productId: string): Promise<{ id: string; name: string; priceCents: number; kind: string; saleUnit: string; promoCents: number | null } | null>;
  listProductGroups(storeId: string, productId: string): Promise<GroupRow[]>;
  groupsForProducts(storeId: string, productIds: string[], nativeOnly?: boolean): Promise<Map<string, GroupRow[]>>;
  setProductGroups(storeId: string, productId: string, groupIds: string[]): Promise<void>;
  /** Produtos da LOJA (só os que existem nela) entre `ids`, com o tipo. Outra loja = ausente (mesma resposta de inexistente). */
  findProductKinds(storeId: string, ids: string[]): Promise<Array<{ id: string; kind: string; saleUnit: string }>>;
  /** Onde o adicional é usado: grupos e produtos que os têm (RN-PD-15). */
  addonUsage(storeId: string, productId: string): Promise<{ groups: Array<{ id: string; name: string }>; products: number }>;
}

const toRow = (group: GroupWithOptions, position?: number): GroupRow => ({
  id: group.id,
  name: group.name,
  helpText: group.helpText,
  minSelect: group.minSelect,
  maxSelect: group.maxSelect,
  maxPerOption: group.maxPerOption,
  priceMode: group.priceMode,
  source: group.source,
  position,
  options: [...group.options].sort((a, b) => a.position - b.position).map((o) => resolveOption(o)),
});

/** Opção como o cliente a vê. Opção ligada a adicional: nome do adicional; preço do adicional (INHERIT) ou próprio (OWN); some se o adicional foi inativado ou esgotou (RN-PD-13). */
export function resolveOption(o: LinkedOption, now: Date = new Date()) {
  const base = { id: o.id, position: o.position };
  if (!o.product) return { ...base, name: o.name, priceCents: o.priceCents, active: o.active };
  const available = o.active && o.product.active && !isSoldOutNow(o.product, now);
  return { ...base, name: o.product.name, priceCents: o.priceSource === "INHERIT" ? effectivePriceCents(o.product, now) : o.priceCents, active: available };
}

type OptionInput = GroupInput["options"][number];
// Opção ligada a adicional: o nome gravado é só cópia de apoio (o que vale é o do produto); INHERIT guarda 0 e lê o preço do adicional.
const optionData = (o: OptionInput) => {
  const linked = Boolean(o.productId);
  return {
    name: o.name,
    priceCents: linked && (o.priceSource ?? "INHERIT") === "INHERIT" ? 0 : o.priceCents,
    active: o.active ?? true,
    productId: o.productId ?? null,
    priceSource: linked ? (o.priceSource ?? "INHERIT") : ("OWN" as const),
  };
};

export class PrismaOptionGroupsRepository implements OptionGroupsRepository {
  constructor(private readonly db: Db) {}

  async listGroups(storeId: string) {
    const groups = await this.db.optionGroup.findMany({
      where: { storeId },
      orderBy: { createdAt: "asc" },
      include: { options: OPTIONS_INCLUDE, _count: { select: { products: true } } },
    });
    return groups.map(({ _count, ...group }) => ({ ...group, productCount: _count.products }));
  }

  findGroup(storeId: string, id: string) {
    return this.db.optionGroup.findFirst({ where: { id, storeId }, include: { options: OPTIONS_INCLUDE } });
  }

  findGroupsByIds(storeId: string, ids: string[]) {
    return this.db.optionGroup.findMany({ where: { storeId, id: { in: ids } }, include: { options: OPTIONS_INCLUDE } });
  }

  // FK composta (groupId, storeId): as opções entram por createMany com o groupId explícito (create aninhado não alcança).
  createGroup(storeId: string, input: GroupInput) {
    const { options, ...data } = input;
    return this.db.$transaction(async (tx: Tx) => {
      const group = await tx.optionGroup.create({ data: { ...data, storeId } });
      await tx.option.createMany({
        data: options.map((o, position) => ({ storeId, groupId: group.id, ...optionData(o), position })),
      });
      return tx.optionGroup.findFirstOrThrow({ where: { id: group.id, storeId }, include: { options: OPTIONS_INCLUDE } });
    });
  }

  // Grupo e opções mudam juntos (uma transação). Opção com id só vale se é DESTE grupo (SEC-10: ids vêm do cliente).
  updateGroup(storeId: string, id: string, input: GroupInput) {
    const { options, ...data } = input;
    return this.db.$transaction(async (tx: Tx) => {
      await tx.optionGroup.updateMany({ where: { id, storeId }, data });
      const keepIds = options.filter((o) => o.id).map((o) => o.id as string);
      await tx.option.deleteMany({ where: { groupId: id, storeId, id: { notIn: keepIds } } });
      for (const [position, option] of options.entries()) {
        if (option.id) {
          const result = await tx.option.updateMany({
            where: { id: option.id, groupId: id, storeId },
            data: { ...optionData(option), position },
          });
          if (result.count !== 1) throw new OptionNotInGroupError(option.id);
        } else {
          await tx.option.create({ data: { storeId, groupId: id, ...optionData(option), position } });
        }
      }
      return tx.optionGroup.findFirstOrThrow({ where: { id, storeId }, include: { options: OPTIONS_INCLUDE } });
    });
  }

  async deleteGroup(storeId: string, id: string) {
    await this.db.optionGroup.deleteMany({ where: { id, storeId } });
  }

  countProductsUsing(groupId: string) {
    return this.db.productOptionGroup.count({ where: { groupId } });
  }

  async productsWithAnotherBase(storeId: string, groupId: string) {
    const links = await this.db.productOptionGroup.findMany({
      where: { storeId, groupId },
      include: { product: { include: { optionGroups: { include: { group: { select: { id: true, priceMode: true } } } } } } },
    });
    return links
      .filter((link) => link.product.optionGroups.some((other) => other.groupId !== groupId && other.group.priceMode === "BASE"))
      .map((link) => link.product.name);
  }

  findProduct(storeId: string, productId: string) {
    return this.db.product.findFirst({ where: { id: productId, storeId }, select: { id: true, name: true, priceCents: true, kind: true, saleUnit: true, promoCents: true } });
  }

  async listProductGroups(storeId: string, productId: string) {
    const links = await this.db.productOptionGroup.findMany({
      where: { storeId, productId, group: { source: "MANUAL" } },
      orderBy: { position: "asc" },
      include: { group: { include: { options: OPTIONS_INCLUDE } } },
    });
    return links.map((link) => toRow(link.group, link.position));
  }

  async groupsForProducts(storeId: string, productIds: string[], nativeOnly = false) {
    const map = new Map<string, GroupRow[]>(productIds.map((id) => [id, []]));
    if (productIds.length === 0) return map;
    const links = await this.db.productOptionGroup.findMany({
      where: { storeId, productId: { in: productIds }, ...(nativeOnly ? { group: { source: "MANUAL" } } : {}) },
      orderBy: { position: "asc" },
      include: { group: { include: { options: OPTIONS_INCLUDE } } },
    });
    for (const link of links) map.get(link.productId)?.push(toRow(link.group, link.position));
    return map;
  }

  async setProductGroups(storeId: string, productId: string, groupIds: string[]) {
    await this.db.$transaction([
      this.db.productOptionGroup.deleteMany({ where: { storeId, productId, group: { source: "MANUAL" } } }),
      this.db.productOptionGroup.createMany({ data: groupIds.map((groupId, position) => ({ storeId, productId, groupId, position })) }),
    ]);
  }

  async findProductKinds(storeId: string, ids: string[]) {
    if (ids.length === 0) return [];
    return this.db.product.findMany({ where: { storeId, id: { in: ids } }, select: { id: true, kind: true, saleUnit: true } });
  }

  async addonUsage(storeId: string, productId: string) {
    const options = await this.db.option.findMany({ where: { storeId, productId }, select: { group: { select: { id: true, name: true, products: { select: { productId: true } } } } } });
    const groups = new Map(options.map((o) => [o.group.id, { id: o.group.id, name: o.group.name }]));
    const products = new Set(options.flatMap((o) => o.group.products.map((p) => p.productId)));
    return { groups: [...groups.values()], products: products.size };
  }
}
