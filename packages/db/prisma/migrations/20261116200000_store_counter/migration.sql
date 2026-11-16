-- B01: contador atômico por loja para o código do pedido (evita a corrida de "último + 1").
CREATE TABLE "StoreCounter" (
    "storeId" TEXT NOT NULL,
    "orderSeq" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "StoreCounter_pkey" PRIMARY KEY ("storeId")
);

ALTER TABLE "StoreCounter" ADD CONSTRAINT "StoreCounter_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserva a numeração existente: parte do maior código numérico já usado em cada loja.
INSERT INTO "StoreCounter" ("storeId", "orderSeq")
SELECT "storeId", MAX(CAST("code" AS INTEGER))
FROM "Order"
WHERE "code" ~ '^[0-9]+$'
GROUP BY "storeId";
