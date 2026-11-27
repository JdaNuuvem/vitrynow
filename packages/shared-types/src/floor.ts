import { z } from "zod";
import { textField } from "./text";
import { PHONE_INVALID_MESSAGE, PHONE_MAX_INPUT, isValidBrPhone } from "./phone";

// SALÃO 3D: planta do salão (mesas + elementos fixos) e o STATUS operacional da mesa. Fonte única: a API calcula
// o status com `tableStatusOf` e a tela só desenha; ninguém repete a regra.

export const TABLE_SHAPES = ["SQUARE", "ROUND", "RECT"] as const;
export const FLOOR_ELEMENT_KINDS = ["WALL", "COUNTER", "PLANT", "DOOR"] as const;
export const FLOOR_MAX_ELEMENTS = 200;
export const FLOOR_LIMIT_METERS = 200;

const coord = z.number().finite().min(-FLOOR_LIMIT_METERS).max(FLOOR_LIMIT_METERS);
const rotation = z.number().int().min(0).max(359);
const area = textField({ max: 40, min: 1 }).nullable().optional();

export const tableLayoutSchema = z.object({
  posX: coord.optional(),
  posZ: coord.optional(),
  rotation: rotation.optional(),
  shape: z.enum(TABLE_SHAPES).optional(),
  seats: z.number().int().min(1).max(20).optional(),
  area,
}).strict();

export const floorElementSchema = z.object({
  kind: z.enum(FLOOR_ELEMENT_KINDS),
  posX: coord,
  posZ: coord,
  width: z.number().finite().positive().max(100),
  depth: z.number().finite().positive().max(100),
  rotation,
  area,
}).strict();
export type FloorElementInput = z.infer<typeof floorElementSchema>;

// Salvar a planta inteira (modo edição): posição das mesas + lista COMPLETA de elementos (substitui a anterior).
export const floorLayoutSchema = z.object({
  tables: z.array(tableLayoutSchema.extend({ id: z.string().min(1).max(50) })).max(500),
  elements: z.array(floorElementSchema).max(FLOOR_MAX_ELEMENTS),
}).strict().refine((v) => new Set(v.tables.map((t) => t.id)).size === v.tables.length, "mesa repetida");
export type FloorLayoutInput = z.infer<typeof floorLayoutSchema>;

// Avisos do QR que a equipe marca como atendidos.
export const tableAlertClearSchema = z.object({ kind: z.enum(["CALL_WAITER", "ASK_BILL", "ALL"]) }).strict();

// Status operacional, do mais urgente para o menos.
export const TABLE_STATUSES = ["INACTIVE", "ASK_BILL", "CALL_WAITER", "WAITING", "OCCUPIED", "RESERVED", "FREE"] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const TABLE_STATUS_LABEL: Record<TableStatus, string> = {
  INACTIVE: "Inativa",
  ASK_BILL: "Pediu a conta",
  CALL_WAITER: "Chamou o garçom",
  WAITING: "Aguardando atendimento",
  OCCUPIED: "Ocupada",
  RESERVED: "Reservada",
  FREE: "Livre",
};

export function tableStatusOf(t: { active: boolean; pendingOrders: number; accountOrders: number; callWaiterAt: Date | string | null; askBillAt: Date | string | null; reservedSoon?: boolean; guests?: number | null }): TableStatus {
  if (!t.active) return "INACTIVE";
  if (t.askBillAt) return "ASK_BILL";
  if (t.callWaiterAt) return "CALL_WAITER";
  if (t.pendingOrders > 0) return "WAITING";
  if (t.accountOrders > 0 || (t.guests ?? 0) > 0) return "OCCUPIED"; // pessoas sentadas sem pedido ainda = ocupada
  if (t.reservedSoon) return "RESERVED";
  return "FREE";
}

// ---------- Opcionais do salão ----------
// Reserva "logo": de 30 min antes até 15 min depois do horário (a mesa aparece como Reservada no mapa).
export const RESERVATION_SOON_BEFORE_MIN = 30;
export const RESERVATION_SOON_AFTER_MIN = 15;
export const RESERVATION_STATUSES = ["BOOKED", "SEATED", "CANCELED", "NO_SHOW"] as const;
export const RESERVATION_STATUS_LABEL: Record<(typeof RESERVATION_STATUSES)[number], string> = { BOOKED: "Reservada", SEATED: "Chegou", CANCELED: "Cancelada", NO_SHOW: "Não veio" };

const isoInstant = z.string().max(40).refine((v) => !Number.isNaN(new Date(v).getTime()), "data inválida");

export const createReservationSchema = z.object({
  tableId: z.string().min(1).max(50).nullable().optional(),
  customerName: textField({ max: 80, min: 1 }),
  customerPhone: z.string().trim().max(PHONE_MAX_INPUT, PHONE_INVALID_MESSAGE).refine(isValidBrPhone, PHONE_INVALID_MESSAGE).optional(), // regra única do telefone (./phone)
  partySize: z.number().int().min(1).max(100),
  startsAt: isoInstant,
  durationMin: z.number().int().min(15).max(720).optional(),
  notes: textField({ max: 300, multiline: true }).optional(),
}).strict();
export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const updateReservationSchema = createReservationSchema.partial().extend({ status: z.enum(RESERVATION_STATUSES).optional() }).strict()
  .refine((v) => Object.keys(v).length > 0, "nada para alterar");

export const reservationsQuerySchema = z.object({ from: isoInstant.optional(), to: isoInstant.optional() });

// Garçom responsável (null = ninguém) e pessoas na mesa (null = não informado).
export const tableWaiterSchema = z.object({ userId: z.string().min(1).max(50).nullable() }).strict();
export const tableGuestsSchema = z.object({ guests: z.number().int().min(1).max(50).nullable() }).strict();
// Nome de exibição da equipe (garçom no salão). Fonte única do "nome ou parte do e-mail".
export const memberDisplayNameSchema = z.object({ displayName: textField({ max: 40, min: 1 }).nullable() }).strict();
export function memberName(user: { displayName?: string | null; email: string }): string {
  return user.displayName?.trim() || user.email.split("@")[0];
}
