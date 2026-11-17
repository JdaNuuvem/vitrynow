// B8 — grupos de opções e variações: regras PURAS (sem banco, sem HTTP). RN-B8-01..05, 10 e CA-B8-01..05, 07.
// O servidor é a única fonte do preço da linha (RN-B8-03); a vitrine só mostra.

export type PriceMode = "SUM" | "BASE";

export type OptionRow = { id: string; name: string; priceCents: number; active: boolean; position?: number };
export type GroupRow = {
  id: string;
  name: string;
  helpText?: string | null;
  minSelect: number;
  /** null = sem limite (adicionais legados). */
  maxSelect: number | null;
  maxPerOption: number;
  priceMode: PriceMode;
  /** Ordem do grupo dentro do produto. */
  position?: number;
  options: OptionRow[];
};

export type Selection = { optionId: string; quantity?: number };

export type OptionIssueCode =
  | "OPTION_REQUIRED"
  | "OPTION_MAX_EXCEEDED"
  | "OPTION_PER_OPTION_MAX"
  | "OPTION_NOT_FOUND"
  | "OPTION_DUPLICATE"
  | "OPTION_QUANTITY_INVALID"
  | "PRODUCT_UNAVAILABLE_BY_RULE";

export type OptionIssue = { code: OptionIssueCode; groupId?: string; groupName?: string; optionId?: string; message: string };

/** Cópia gravada no pedido (RN-B8-07): mudar o cardápio depois não altera pedidos antigos. */
export type OptionCopy = { groupName: string; name: string; priceCents: number; quantity: number; priceMode: PriceMode };

export type ResolveResult =
  | { ok: true; unitPriceCents: number; baseCents: number; extrasCents: number; copies: OptionCopy[] }
  | { ok: false; issues: OptionIssue[] };

// Limites padrão (RN-B8-10, RN-CT-16).
export const MAX_GROUPS_PER_PRODUCT = 10;
export const MAX_OPTIONS_PER_GROUP = 30;
export const MAX_OPTION_PRICE_CENTS = 100_000_000;

const activeOptions = (group: GroupRow) => group.options.filter((o) => o.active);

/** Máximo efetivo do grupo: BASE é sempre 1; sem limite = infinito. */
function effectiveMax(group: GroupRow): number {
  if (group.priceMode === "BASE") return 1;
  return group.maxSelect ?? Number.POSITIVE_INFINITY;
}
const effectiveMin = (group: GroupRow) => (group.priceMode === "BASE" ? 1 : group.minSelect);
const effectivePerOption = (group: GroupRow) => (group.priceMode === "BASE" ? 1 : group.maxPerOption);

/**
 * Produto indisponível por regra (RN-B8-05): algum grupo obrigatório ficou sem opção ativa, ou sem capacidade
 * (opções ativas × máximo por opção) para atingir o mínimo. É automático; o painel avisa o dono.
 */
export function unavailableGroups(groups: GroupRow[]): GroupRow[] {
  return groups.filter((g) => {
    const min = effectiveMin(g);
    if (min < 1) return false;
    return activeOptions(g).length * effectivePerOption(g) < min;
  });
}

/** Menor preço entre as opções ativas do grupo BASE ("a partir de R$ X", RN-B8-04); null sem grupo BASE. */
export function fromPriceCents(groups: GroupRow[]): number | null {
  const base = groups.find((g) => g.priceMode === "BASE");
  if (!base) return null;
  const prices = activeOptions(base).map((o) => o.priceCents);
  return prices.length > 0 ? Math.min(...prices) : null;
}

/**
 * Valida as escolhas de UMA linha do pedido e calcula o preço unitário.
 * `groups` são os grupos VINCULADOS ao produto (RN-B8-02: opção de outro produto ou de outra loja nunca chega aqui,
 * pois a lista é carregada pelo produto da loja e a opção desconhecida é recusada).
 */
export function resolveLine(product: { name: string; priceCents: number }, groups: GroupRow[], selections: Selection[]): ResolveResult {
  const issues: OptionIssue[] = [];

  const unavailable = unavailableGroups(groups);
  for (const group of unavailable) {
    issues.push({
      code: "PRODUCT_UNAVAILABLE_BY_RULE",
      groupId: group.id,
      groupName: group.name,
      message: `"${product.name}" está indisponível: o grupo "${group.name}" não tem opções ativas.`,
    });
  }

  // Índice opção → (grupo, opção) só entre opções ATIVAS dos grupos vinculados.
  const lookup = new Map<string, { group: GroupRow; option: OptionRow }>();
  for (const group of groups) for (const option of activeOptions(group)) lookup.set(option.id, { group, option });

  const chosenByGroup = new Map<string, Array<{ option: OptionRow; quantity: number }>>();
  const seen = new Set<string>();
  for (const selection of selections) {
    const quantity = selection.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      issues.push({ code: "OPTION_QUANTITY_INVALID", optionId: selection.optionId, message: `Quantidade inválida para uma opção de "${product.name}".` });
      continue;
    }
    const found = lookup.get(selection.optionId);
    if (!found) {
      // Inexistente, inativa, de outro produto ou de outra loja: a mensagem é a mesma (nada de oráculo).
      issues.push({ code: "OPTION_NOT_FOUND", optionId: selection.optionId, message: `Uma opção escolhida para "${product.name}" não está disponível.` });
      continue;
    }
    if (seen.has(selection.optionId)) {
      issues.push({ code: "OPTION_DUPLICATE", groupId: found.group.id, groupName: found.group.name, optionId: selection.optionId, message: `A opção "${found.option.name}" foi enviada mais de uma vez em "${product.name}".` });
      continue;
    }
    seen.add(selection.optionId);
    const list = chosenByGroup.get(found.group.id) ?? [];
    list.push({ option: found.option, quantity });
    chosenByGroup.set(found.group.id, list);
  }

  for (const group of groups) {
    const chosen = chosenByGroup.get(group.id) ?? [];
    const total = chosen.reduce((sum, c) => sum + c.quantity, 0);
    const min = effectiveMin(group);
    const max = effectiveMax(group);
    const perOption = effectivePerOption(group);

    if (total < min && !unavailable.includes(group)) {
      issues.push({ code: "OPTION_REQUIRED", groupId: group.id, groupName: group.name, message: `Escolha ${min === 1 ? "uma opção" : `ao menos ${min} opções`} em "${group.name}" para "${product.name}".` });
    }
    if (total > max) {
      issues.push({ code: "OPTION_MAX_EXCEEDED", groupId: group.id, groupName: group.name, message: `Em "${group.name}" de "${product.name}" escolha no máximo ${max}.` });
    }
    for (const c of chosen) {
      if (c.quantity > perOption) {
        issues.push({ code: "OPTION_PER_OPTION_MAX", groupId: group.id, groupName: group.name, optionId: c.option.id, message: `A opção "${c.option.name}" aceita no máximo ${perOption} por item.` });
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  // Preço (RN-B8-03): (BASE escolhida ou preço do produto) + Σ SOMA × quantidade.
  let baseCents = product.priceCents;
  let extrasCents = 0;
  const copies: OptionCopy[] = [];
  for (const group of groups) {
    for (const { option, quantity } of chosenByGroup.get(group.id) ?? []) {
      if (group.priceMode === "BASE") baseCents = option.priceCents;
      else extrasCents += option.priceCents * quantity;
      copies.push({ groupName: group.name, name: option.name, priceCents: option.priceCents, quantity, priceMode: group.priceMode });
    }
  }
  return { ok: true, unitPriceCents: baseCents + extrasCents, baseCents, extrasCents, copies };
}

// ───────────── configuração do grupo (painel) ─────────────

export type GroupInput = {
  name: string;
  helpText?: string | null;
  minSelect: number;
  maxSelect: number | null;
  maxPerOption: number;
  priceMode: PriceMode;
  options: Array<{ id?: string; name: string; priceCents: number; active?: boolean }>;
};

export type ConfigProblem = { code: string; message: string };

/** Erros que IMPEDEM salvar (configuração impossível) e avisos que o painel mostra mas permitem salvar. */
export function checkGroupConfig(input: GroupInput): { errors: ConfigProblem[]; warnings: ConfigProblem[] } {
  const errors: ConfigProblem[] = [];
  const warnings: ConfigProblem[] = [];
  const err = (code: string, message: string) => errors.push({ code, message });

  if (input.priceMode === "BASE") {
    if (input.minSelect !== 1 || input.maxSelect !== 1 || input.maxPerOption !== 1) {
      err("BASE_MUST_BE_ONE", "Grupo de preço-base (variação) é sempre de escolha única e obrigatória: mínimo 1 e máximo 1.");
    }
  } else {
    if (input.maxSelect !== null && input.maxSelect < 1) err("MAX_BELOW_ONE", "O máximo precisa ser pelo menos 1 (ou sem limite).");
    if (input.maxSelect !== null && input.maxSelect < input.minSelect) err("MAX_BELOW_MIN", "O máximo não pode ser menor que o mínimo.");
  }
  if (input.options.length > MAX_OPTIONS_PER_GROUP) err("TOO_MANY_OPTIONS", `Cada grupo aceita até ${MAX_OPTIONS_PER_GROUP} opções.`);

  const active = input.options.filter((o) => o.active !== false);
  const capacity = active.length * (input.priceMode === "BASE" ? 1 : input.maxPerOption);
  const min = input.priceMode === "BASE" ? 1 : input.minSelect;
  if (min > 0 && capacity < min) {
    warnings.push({ code: "MIN_ABOVE_ACTIVE_OPTIONS", message: `O mínimo (${min}) é maior que o que as opções ativas permitem (${capacity}): os produtos com este grupo ficam indisponíveis.` });
  }
  if (input.priceMode === "BASE" && input.options.some((o) => o.priceCents === 0)) {
    warnings.push({ code: "BASE_PRICE_ZERO", message: "Há uma variação com preço R$ 0,00 (ficaria de graça)." });
  }
  return { errors, warnings };
}

/** Regras do conjunto de grupos de UM produto (RN-B8-10 e "dois grupos BASE no mesmo produto: bloqueado"). */
export function checkProductGroups(groups: Array<Pick<GroupRow, "id" | "name" | "priceMode">>): ConfigProblem[] {
  const errors: ConfigProblem[] = [];
  if (groups.length > MAX_GROUPS_PER_PRODUCT) errors.push({ code: "TOO_MANY_GROUPS", message: `Cada produto aceita até ${MAX_GROUPS_PER_PRODUCT} grupos de opções.` });
  const bases = groups.filter((g) => g.priceMode === "BASE");
  if (bases.length > 1) errors.push({ code: "TWO_BASE_GROUPS", message: `Um produto só pode ter um grupo de preço-base (variação); há ${bases.length}: ${bases.map((g) => `"${g.name}"`).join(", ")}.` });
  return errors;
}
