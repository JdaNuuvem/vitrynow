export type OrderType = "MESA" | "DELIVERY" | "BALCAO";

export type OrderStatus = "PENDENTE" | "CONFIRMADO" | "EM_PREPARO" | "PRONTO" | "CONCLUIDO" | "CANCELADO";

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
