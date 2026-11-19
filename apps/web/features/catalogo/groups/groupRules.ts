import type { OptionGroup } from "@/core/domain/optionGroups";

export function groupRule(group: OptionGroup) {
  if (group.priceMode === "BASE") return "Preço-base · uma escolha obrigatória";
  const minimum = group.minSelect > 0 ? `Mínimo ${group.minSelect}` : "Opcional";
  const maximum = group.maxSelect === null ? "Sem limite de escolhas" : `Máximo ${group.maxSelect}`;
  return `${minimum} · ${maximum} · Até ${group.maxPerOption} por opção`;
}
