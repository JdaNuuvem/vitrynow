import type { OrderStatus, OrderType } from "./orders";

export const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDENTE: "Pendente",
  CONFIRMADO: "Confirmado",
  EM_PREPARO: "Em preparo",
  PRONTO: "Pronto",
  SAIU_PARA_ENTREGA: "Em entrega",
  CONCLUIDO: "Concluído",
  CANCELADO: "Cancelado",
};

export const TYPE_LABELS: Record<OrderType, string> = {
  DELIVERY: "Delivery",
  MESA: "Mesa",
  BALCAO: "Retirada",
};

// Status que esta tela não conhece (a API ganhou um valor novo): texto neutro, nunca o código cru.
export const UNKNOWN_STATUS_LABEL = "Outro status";

export function statusLabel(status: string): string {
  return (STATUS_LABELS as Record<string, string>)[status] ?? UNKNOWN_STATUS_LABEL;
}
