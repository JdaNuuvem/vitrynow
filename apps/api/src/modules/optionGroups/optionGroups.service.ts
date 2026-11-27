import type { Actor, AuditLogger } from "../../shared/audit";
import { CodedError, NotFoundError } from "../../shared/errors";
import {
  checkGroupConfig,
  checkProductGroups,
  fromPriceCents,
  unavailableGroups,
  type ConfigProblem,
  type GroupInput,
  type GroupRow,
} from "./optionGroups.domain";
import { OptionNotInGroupError, type GroupWithOptions, type OptionGroupsRepository } from "./optionGroups.repository";

export type GroupResult = { group: GroupWithOptions; warnings: ConfigProblem[] };

// Regras do painel para grupos de opções e para o vínculo produto ↔ grupo. Não conhece HTTP nem Prisma.
export class OptionGroupsService {
  constructor(
    private readonly repo: OptionGroupsRepository,
    private readonly audit: AuditLogger,
  ) {}

  listGroups(storeId: string) {
    return this.repo.listGroups(storeId);
  }

  async createGroup(actor: Actor, input: GroupInput): Promise<GroupResult> {
    const warnings = this.assertConfig(input);
    await this.assertLinkedProducts(actor.storeId, input);
    const group = await this.repo.createGroup(actor.storeId, input);
    this.audit.log({ ...actor, action: "option_group.create", targetType: "OptionGroup", targetId: group.id, metadata: { name: group.name, options: group.options.length } });
    return { group, warnings };
  }

  async updateGroup(actor: Actor, id: string, input: GroupInput): Promise<GroupResult> {
    const before = await this.requireGroup(actor.storeId, id);
    assertEditable(before);
    const warnings = this.assertConfig(input);
    await this.assertLinkedProducts(actor.storeId, input);
    if (input.priceMode === "BASE" && before.priceMode !== "BASE") {
      const clashes = await this.repo.productsWithAnotherBase(actor.storeId, id);
      if (clashes.length > 0) {
        throw new CodedError(409, "TWO_BASE_GROUPS", `Estes produtos já têm outro grupo de preço-base: ${clashes.join(", ")}.`, { products: clashes });
      }
    }
    let group;
    try {
      group = await this.repo.updateGroup(actor.storeId, id, input);
    } catch (error) {
      // SEC-10: opção que não é deste grupo (inclusive de outra loja) => 404, nada alterado.
      if (error instanceof OptionNotInGroupError) throw new NotFoundError("Esta opção não pertence a este grupo.");
      throw error;
    }
    this.audit.log({
      ...actor,
      action: "option_group.update",
      targetType: "OptionGroup",
      targetId: id,
      metadata: { name: group.name, before: { name: before.name, options: before.options.length }, after: { options: group.options.length } },
    });
    return { group, warnings };
  }

  // RN-B8-14: excluir é permitido (pedidos usam cópia). O painel mostra "usado em N produtos" antes (productCount).
  async deleteGroup(actor: Actor, id: string) {
    const group = await this.requireGroup(actor.storeId, id);
    assertEditable(group);
    const usedIn = await this.repo.countProductsUsing(id);
    await this.repo.deleteGroup(actor.storeId, id);
    this.audit.log({ ...actor, action: "option_group.delete", targetType: "OptionGroup", targetId: id, metadata: { name: group.name, usedIn } });
    return { usedIn };
  }

  /** Grupos do produto, o preço "a partir de" e os grupos que o deixam indisponível por regra (RN-B8-04/05). */
  async productGroups(storeId: string, productId: string) {
    await this.requireProduct(storeId, productId);
    const groups = await this.repo.listProductGroups(storeId, productId);
    return {
      groups,
      fromPriceCents: fromPriceCents(groups),
      unavailableBecause: unavailableGroups(groups).map((g) => ({ groupId: g.id, name: g.name })),
    };
  }

  // Substitui os vínculos do produto, na ordem recebida. Grupo de outra loja => 404 (SEC-11).
  async setProductGroups(actor: Actor, productId: string, groupIds: string[]) {
    const product = await this.requireProduct(actor.storeId, productId);
    if (new Set(groupIds).size !== groupIds.length) throw new CodedError(400, "DUPLICATE_GROUP", "O mesmo grupo foi enviado mais de uma vez.");
    const found = await this.repo.findGroupsByIds(actor.storeId, groupIds);
    if (found.length !== groupIds.length) throw new NotFoundError("Grupo de opções não encontrado.");
    found.forEach(assertEditable);
    const ordered = groupIds.map((id) => found.find((g) => g.id === id)!);
    const problems = checkProductGroups(ordered);
    if (problems.length > 0) throw new CodedError(400, problems[0].code, problems[0].message, { problems });
    // Produto detalhado (RN-PD-15/24/07): adicional não tem grupos; produto por peso não aceita opções; grupo BASE (preço da variação) não convive com promoção.
    if (groupIds.length > 0) {
      if (product.kind === "ADICIONAL") throw new CodedError(400, "ADDON_HAS_GROUPS", "Um adicional não tem grupos de opções.");
      if (product.saleUnit !== "UN") throw new CodedError(400, "PRODUCT_WEIGHT_NO_OPTIONS", "Produto vendido por peso não aceita opções.");
      if (product.promoCents !== null && ordered.some((g) => g.priceMode === "BASE")) throw new CodedError(400, "PROMO_NOT_ALLOWED", "Este produto tem o preço definido pelas variações.");
    }
    await this.repo.setProductGroups(actor.storeId, productId, groupIds);
    this.audit.log({ ...actor, action: "product.option_groups_set", targetType: "Product", targetId: productId, metadata: { groupIds } });
    return this.productGroups(actor.storeId, productId);
  }

  /** Onde o adicional é usado (grupos e produtos), para a trava de exclusão e a tela do dono. */
  addonUsage(storeId: string, productId: string) {
    return this.repo.addonUsage(storeId, productId);
  }

  /** Para o cardápio e para o pedido: grupos de vários produtos da loja de uma vez. */
  groupsForProducts(storeId: string, productIds: string[], nativeOnly = false): Promise<Map<string, GroupRow[]>> {
    return this.repo.groupsForProducts(storeId, productIds, nativeOnly);
  }

  private assertConfig(input: GroupInput): ConfigProblem[] {
    const { errors, warnings } = checkGroupConfig(input);
    if (errors.length > 0) throw new CodedError(400, "OPTION_GROUP_INVALID", errors[0].message, { problems: errors });
    return warnings;
  }

  // RN-PD-12/15: a opção só aponta para produto ADICIONAL (por unidade) DA MESMA LOJA. Produto de outra loja ou inexistente = 404, a mesma resposta (nada de oráculo entre lojas).
  private async assertLinkedProducts(storeId: string, input: GroupInput) {
    const ids = [...new Set(input.options.map((o) => o.productId).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return;
    const found = await this.repo.findProductKinds(storeId, ids);
    if (found.length !== ids.length) throw new NotFoundError("Produto não encontrado.");
    if (found.some((p) => p.kind !== "ADICIONAL")) throw new CodedError(400, "OPTION_PRODUCT_NOT_ADDON", "Só um produto do tipo Adicional pode ser ligado a um grupo.");
    if (found.some((p) => p.saleUnit !== "UN")) throw new CodedError(400, "OPTION_PRODUCT_BY_WEIGHT", "Adicional vendido por peso não pode ser opção de grupo.");
    if (input.priceMode === "BASE" && input.options.some((o) => o.productId)) throw new CodedError(400, "OPTION_ADDON_IN_BASE_GROUP", "Adicional não pode ser variação de preço-base.");
  }

  private async requireGroup(storeId: string, id: string) {
    const group = await this.repo.findGroup(storeId, id);
    if (!group) throw new NotFoundError("Grupo de opções não encontrado.");
    return group;
  }

  private async requireProduct(storeId: string, id: string) {
    const product = await this.repo.findProduct(storeId, id);
    if (!product) throw new NotFoundError("Produto não encontrado.");
    return product;
  }
}

function assertEditable(group: GroupWithOptions) {
  if (group.source === "LEGACY_ADDITIONALS") {
    throw new CodedError(409, "LEGACY_ADDITIONALS_READ_ONLY", "Edite os adicionais legados no próprio produto.");
  }
}
