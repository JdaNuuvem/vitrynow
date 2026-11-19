import type { Option, OptionGroup, Prisma, prisma as prismaClient } from "@meucardapio/db";
import type { GroupInput, GroupRow } from "./optionGroups.domain";

type Db = typeof prismaClient;
type Tx = Prisma.TransactionClient;

export type GroupWithOptions = OptionGroup & { options: Option[] };
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
  findProduct(storeId: string, productId: string): Promise<{ id: string; name: string; priceCents: number } | null>;
  listProductGroups(storeId: string, productId: string): Promise<GroupRow[]>;
  groupsForProducts(storeId: string, productIds: string[], nativeOnly?: boolean): Promise<Map<string, GroupRow[]>>;
  setProductGroups(storeId: string, productId: string, groupIds: string[]): Promise<void>;
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
  options: [...group.options].sort((a, b) => a.position - b.position).map((o) => ({ id: o.id, name: o.name, priceCents: o.priceCents, active: o.active, position: o.position })),
});

export class PrismaOptionGroupsRepository implements OptionGroupsRepository {
  constructor(private readonly db: Db) {}

  async listGroups(storeId: string) {
    const groups = await this.db.optionGroup.findMany({
      where: { storeId },
      orderBy: { createdAt: "asc" },
      include: { options: { orderBy: { position: "asc" } }, _count: { select: { products: true } } },
    });
    return groups.map(({ _count, ...group }) => ({ ...group, productCount: _count.products }));
  }

  findGroup(storeId: string, id: string) {
    return this.db.optionGroup.findFirst({ where: { id, storeId }, include: { options: { orderBy: { position: "asc" } } } });
  }

  findGroupsByIds(storeId: string, ids: string[]) {
    return this.db.optionGroup.findMany({ where: { storeId, id: { in: ids } }, include: { options: { orderBy: { position: "asc" } } } });
  }

  // FK composta (groupId, storeId): as opções entram por createMany com o groupId explícito (create aninhado não alcança).
  createGroup(storeId: string, input: GroupInput) {
    const { options, ...data } = input;
    return this.db.$transaction(async (tx: Tx) => {
      const group = await tx.optionGroup.create({ data: { ...data, storeId } });
      await tx.option.createMany({
        data: options.map((o, position) => ({ storeId, groupId: group.id, name: o.name, priceCents: o.priceCents, active: o.active ?? true, position })),
      });
      return tx.optionGroup.findFirstOrThrow({ where: { id: group.id, storeId }, include: { options: { orderBy: { position: "asc" } } } });
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
            data: { name: option.name, priceCents: option.priceCents, active: option.active ?? true, position },
          });
          if (result.count !== 1) throw new OptionNotInGroupError(option.id);
        } else {
          await tx.option.create({ data: { storeId, groupId: id, name: option.name, priceCents: option.priceCents, active: option.active ?? true, position } });
        }
      }
      return tx.optionGroup.findFirstOrThrow({ where: { id, storeId }, include: { options: { orderBy: { position: "asc" } } } });
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
    return this.db.product.findFirst({ where: { id: productId, storeId }, select: { id: true, name: true, priceCents: true } });
  }

  async listProductGroups(storeId: string, productId: string) {
    const links = await this.db.productOptionGroup.findMany({
      where: { storeId, productId, group: { source: "MANUAL" } },
      orderBy: { position: "asc" },
      include: { group: { include: { options: { orderBy: { position: "asc" } } } } },
    });
    return links.map((link) => toRow(link.group, link.position));
  }

  async groupsForProducts(storeId: string, productIds: string[], nativeOnly = false) {
    const map = new Map<string, GroupRow[]>(productIds.map((id) => [id, []]));
    if (productIds.length === 0) return map;
    const links = await this.db.productOptionGroup.findMany({
      where: { storeId, productId: { in: productIds }, ...(nativeOnly ? { group: { source: "MANUAL" } } : {}) },
      orderBy: { position: "asc" },
      include: { group: { include: { options: { orderBy: { position: "asc" } } } } },
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
}
