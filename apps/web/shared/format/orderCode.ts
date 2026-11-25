// SSOT D9 — CÓDIGO DO PEDIDO: o servidor gera o código (apps/api/src/lib/order-code.ts, ex.: "0042");
// o web só o EXIBE, sempre por aqui, para o formato nunca divergir entre telas.

/** "#0042" */
export const orderHash = (code: string) => `#${code}`;

/** "Pedido #0042" */
export const orderLabel = (code: string) => `Pedido ${orderHash(code)}`;
