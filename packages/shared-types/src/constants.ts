// SSOT D3/D4 — fonte única dos STATUS do pedido e dos PAPÉIS do painel, SEM zod: o web importa por
// "@meucardapio/shared-types/constants" e não leva os schemas inteiros para o navegador. O index reexporta tudo.

/** Ordem de vida do pedido (também a ordem das colunas do quadro, menos CANCELADO). */
export const ORDER_STATUSES = ["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO", "CANCELADO"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Status em que o pedido não anda mais (sai do "em andamento"). */
export const FINAL_ORDER_STATUSES = ["CONCLUIDO", "CANCELADO"] as const satisfies readonly OrderStatus[];

export const isFinalOrderStatus = (status: string): boolean => (FINAL_ORDER_STATUSES as readonly string[]).includes(status);

/** Em andamento = todo status que não é final (histórico, "pedidos em aberto"). Derivado: um status novo entra sozinho. */
export const OPEN_ORDER_STATUSES = ORDER_STATUSES.filter((status) => !isFinalOrderStatus(status)) as readonly Exclude<OrderStatus, (typeof FINAL_ORDER_STATUSES)[number]>[];

/** Ainda na fila da cozinha (não ficou pronto): é o que conta no limite de pedidos abertos por mesa no QR. */
export const QUEUED_ORDER_STATUSES = ["PENDENTE", "CONFIRMADO", "EM_PREPARO"] as const satisfies readonly OrderStatus[];

// SSOT D1 — fusos que o produto aceita (Brasil, os 4 offsets em uso). Lista FECHADA: a loja só escolhe daqui; `Store.timezone`
// guarda o IANA. Antes o campo aceitava qualquer texto (1-64 caracteres). Herdado do PR #165 (fechado na triagem de 25/11).
export const STORE_TIMEZONES = [
  "America/Sao_Paulo", // UTC−3 (padrão do produto)
  "America/Bahia",
  "America/Fortaleza",
  "America/Recife",
  "America/Belem",
  "America/Maceio",
  "America/Araguaina",
  "America/Santarem",
  "America/Campo_Grande", // UTC−4
  "America/Cuiaba",
  "America/Manaus",
  "America/Porto_Velho",
  "America/Boa_Vista",
  "America/Rio_Branco", // UTC−5
  "America/Eirunepe",
  "America/Noronha", // UTC−2
] as const;
export type StoreTimezone = (typeof STORE_TIMEZONES)[number];
export const isStoreTimezone = (value: unknown): value is StoreTimezone => typeof value === "string" && (STORE_TIMEZONES as readonly string[]).includes(value);

export const PANEL_ROLES = ["OWNER", "STAFF"] as const;
export type PanelRole = (typeof PANEL_ROLES)[number];
