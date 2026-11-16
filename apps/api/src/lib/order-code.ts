import type { Prisma } from "@meucardapio/db";

// Código sequencial legível por loja ("0001", "0002", ...), gerado por nós — não depende de
// serviço externo. Atômico: um único INSERT ... ON CONFLICT DO UPDATE ... RETURNING trava a
// linha do contador da loja até o fim da transação, então dois pedidos simultâneos nunca
// recebem o mesmo número (B01). Precisa rodar DENTRO da mesma transação que cria o pedido:
// se o pedido falhar, o número volta junto (sem buracos).
export async function nextOrderCode(tx: Prisma.TransactionClient, storeId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ orderSeq: number }[]>`
    INSERT INTO "StoreCounter" ("storeId", "orderSeq") VALUES (${storeId}, 1)
    ON CONFLICT ("storeId") DO UPDATE SET "orderSeq" = "StoreCounter"."orderSeq" + 1
    RETURNING "orderSeq"`;
  return String(rows[0].orderSeq).padStart(4, "0");
}

// Pedidos da mesma loja entram em fila no contador; o relógio da transação (padrão 5 s) conta a
// espera, então em rajada os últimos estourariam (P2028 → 500). Folga explícita.
export const ORDER_TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;
