import type { TableStatus } from "@meucardapio/shared-types";

// SALÃO 3D — paleta da cena. O WebGL precisa de cor concreta: os STATUS vêm dos tokens do tema (lidos em tempo de execução,
// então acompanham claro/escuro); os MATERIAIS (piso de madeira, parede, mesa) são a paleta fixa da maquete.
export const MATERIALS = {
  floor: "#b9834f",
  floorLine: "#9c6b3d",
  wall: "#eceae4",
  counter: "#f4f3ef",
  tableTop: "#6b4a2f",
  chair: "#8a6440",
  plant: "#4f8a3c",
  door: "#7a5a3a",
} as const;

const STATUS_TOKEN: Record<TableStatus, string> = {
  FREE: "--ok",
  OCCUPIED: "--danger",
  WAITING: "--info-ink",
  CALL_WAITER: "--warn",
  ASK_BILL: "--color-primary",
  INACTIVE: "--line-strong",
};

/** Cor do status pelo token CSS (fallback neutro se o token não resolver). */
export function statusColor(status: TableStatus): string {
  if (typeof window === "undefined") return "gray";
  const value = getComputedStyle(document.documentElement).getPropertyValue(STATUS_TOKEN[status]).trim();
  return value || "gray";
}

export const STATUS_TOKEN_VAR = STATUS_TOKEN;
