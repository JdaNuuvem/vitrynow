export type OrderType = "MESA" | "DELIVERY" | "BALCAO";

// Lista como valor de execução: os testes percorrem o enum inteiro para garantir que nenhum pedido
// some do quadro (contrato B3 §10). SAIU_PARA_ENTREGA entra com a API-02 (contrato B3 §7 item 8).
export const ORDER_STATUSES = ["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO", "CANCELADO"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderItem = { id: string; quantity: number; productName: string };

export type PaymentStatus = "PENDENTE" | "APROVADO" | "REJEITADO" | "EXPIRADO" | "REEMBOLSADO";

export type Order = {
  id: string;
  code: string;
  type: OrderType;
  status: OrderStatus;
  customerName: string | null;
  totalCents: number;
  items: OrderItem[];
  delivererId: string | null;
  payment: { status: PaymentStatus } | null;
};

export type Deliverer = { id: string; name: string; phone: string | null; active: boolean };
