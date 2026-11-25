import type { CashMovementType } from "@/core/domain/cashier";

export const movementReasons: Record<CashMovementType, readonly (readonly [string, string])[]> = {
  SUPRIMENTO: [["TROCO", "Troco"], ["APORTE_DONO", "Aporte do dono"], ["OUTRO", "Outro"]],
  SANGRIA: [["FORNECEDOR", "Fornecedor"], ["RETIRADA_DONO", "Retirada do dono"], ["DESPESA_LOJA", "Despesa da loja"],
    ["COFRE_BANCO", "Cofre ou banco"], ["OUTRO", "Outro"]],
};

export const closeReasons = [
  ["ERRO_CONTAGEM", "Erro de contagem"], ["TROCO_ERRADO", "Troco incorreto"],
  ["MOVIMENTO_NAO_REGISTRADO", "Movimentação sem registro"], ["VENDA_NAO_REGISTRADA", "Venda sem registro"],
  ["DEVOLUCAO_NAO_REGISTRADA", "Devolução sem registro"], ["NAO_SEI", "Motivo desconhecido"], ["OUTRO", "Outro"],
] as const;

export function movementReasonLabel(type: CashMovementType, code?: string | null) {
  if (code === "DEVOLUCAO") return "Devolução";
  return movementReasons[type].find(([key]) => code === key)?.[1] ?? type;
}
