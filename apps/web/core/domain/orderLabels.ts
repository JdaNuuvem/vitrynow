import type { OrderStatus, OrderType } from "./orders";

export const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDENTE: "Pendente",
  CONFIRMADO: "Confirmado",
  EM_PREPARO: "Em preparo",
  PRONTO: "Pronto",
  CONCLUIDO: "Concluído",
  CANCELADO: "Cancelado",
};

export const TYPE_LABELS: Record<OrderType, string> = {
  DELIVERY: "Delivery",
  MESA: "Mesa",
  BALCAO: "Retirada",
};
