// SSOT D3/D4 — fonte única dos STATUS do pedido e dos PAPÉIS do painel, SEM zod: o web importa por
// "@meucardapio/shared-types/constants" e não leva os schemas inteiros para o navegador. O index reexporta tudo.

/** Ordem de vida do pedido (também a ordem das colunas do quadro, menos CANCELADO). */
export const ORDER_STATUSES = ["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO", "CANCELADO"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Status em que o pedido não anda mais (sai do "em andamento"). */
export const FINAL_ORDER_STATUSES = ["CONCLUIDO", "CANCELADO"] as const satisfies readonly OrderStatus[];

export const isFinalOrderStatus = (status: string): boolean => (FINAL_ORDER_STATUSES as readonly string[]).includes(status);

export const PANEL_ROLES = ["OWNER", "STAFF"] as const;
export type PanelRole = (typeof PANEL_ROLES)[number];
