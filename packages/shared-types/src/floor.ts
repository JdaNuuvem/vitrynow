import { z } from "zod";
import { textField } from "./text";

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
export const TABLE_STATUSES = ["INACTIVE", "ASK_BILL", "CALL_WAITER", "WAITING", "OCCUPIED", "FREE"] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const TABLE_STATUS_LABEL: Record<TableStatus, string> = {
  INACTIVE: "Inativa",
  ASK_BILL: "Pediu a conta",
  CALL_WAITER: "Chamou o garçom",
  WAITING: "Aguardando atendimento",
  OCCUPIED: "Ocupada",
  FREE: "Livre",
};

export function tableStatusOf(t: { active: boolean; pendingOrders: number; accountOrders: number; callWaiterAt: Date | string | null; askBillAt: Date | string | null }): TableStatus {
  if (!t.active) return "INACTIVE";
  if (t.askBillAt) return "ASK_BILL";
  if (t.callWaiterAt) return "CALL_WAITER";
  if (t.pendingOrders > 0) return "WAITING";
  if (t.accountOrders > 0) return "OCCUPIED";
  return "FREE";
}
