import type { TableStatus } from "@meucardapio/shared-types";

// SALÃO 3D: o que a tela recebe de GET /api/tables e GET /api/floor (a API calcula o status).
export type TableShape = "SQUARE" | "ROUND" | "RECT";
export type FloorElementKind = "WALL" | "COUNTER" | "PLANT" | "DOOR";

export type TableLayout = { posX: number; posZ: number; rotation: number; shape: TableShape; seats: number; area: string | null };

export type SalaoTable = {
  id: string;
  label: string;
  active: boolean;
  status: TableStatus;
  layout: TableLayout;
  pendingOrders: number;
  accountOrders: number;
  accountCents: number;
  openedAt: string | null;
  callWaiterAt: string | null;
  askBillAt: string | null;
  guests: number | null;
  waiter: { id: string; name: string } | null;
  nextReservation: { id: string; customerName: string; partySize: number; startsAt: string } | null;
};

export type Reservation = {
  id: string; tableId: string | null; tableLabel: string | null; customerName: string; customerPhone: string | null;
  partySize: number; startsAt: string; durationMin: number; status: "BOOKED" | "SEATED" | "CANCELED" | "NO_SHOW"; notes: string | null;
};

export type TeamMember = { id: string; email: string; role: string };

export type FloorElement = { id?: string; kind: FloorElementKind; posX: number; posZ: number; width: number; depth: number; rotation: number; area?: string | null };

export type TableAccount = {
  table: { id: string; label: string };
  orders: { id: string; code: string; status: string; totalCents: number; createdAt: string; customerName: string | null; items: { productName: string; quantity: number; unitPriceCents: number }[] }[];
  pendingOrders: number;
  totalCents: number;
};

/** Seleção na cena: uma mesa ou um elemento (índice na lista, só no modo edição). */
export type Selection = { kind: "table"; id: string } | { kind: "element"; index: number } | null;
