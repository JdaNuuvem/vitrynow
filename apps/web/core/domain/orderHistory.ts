// Histórico de pedidos (GET /api/orders/history, API-54/API-70, RN-HP). Linha de LISTA: telefone sempre mascarado pelo servidor e sem endereço.

// O que o servidor decide mostrar na situação do pedido. O PIX que ninguém pagou é "aguardando" ou "expirado", nunca "aberto" (RN-HP-05).
export const HISTORY_DISPLAYS = ["ABERTO", "CONCLUIDO", "CANCELADO", "AGUARDANDO_PAGAMENTO", "PAGAMENTO_EXPIRADO"] as const;
export type HistoryDisplay = (typeof HISTORY_DISPLAYS)[number];

export type HistoryRow = {
  id: string;
  code: string;
  createdAt: string;
  customerName: string | null;
  customerPhone: string | null;
  hasPhone: boolean;
  type: string;
  totalCents: number;
  status: string;
  display: HistoryDisplay | string;
  paymentMethod: string | null;
  paymentStatus: string | null;
  refundPending: boolean;
  notPrinted: boolean;
};

export type HistoryResponse = {
  rows: HistoryRow[];
  total: number;
  nextCursor: string | null;
  period: { from: string; to: string };
  timezone: string;
};

// Filtros da Fatia 1: só a situação "Em aberto" e o período. Busca, tipo, pagamento e estorno pendente chegam na Fatia 2.
export type HistoryQuery = {
  status?: "ALL" | "ABERTO" | "CONCLUIDO" | "CANCELADO" | "AGUARDANDO_PAGAMENTO" | "PAGAMENTO_EXPIRADO";
  period?: "today" | "yesterday" | "7d" | "30d" | "custom";
  from?: string; // AAAA-MM-DD no fuso da loja (period=custom)
  to?: string;
  cursor?: string;
  limit?: number;
};
