-- API-48b: `storeId` próprio nas tabelas filhas + FK COMPOSTA (paiId, storeId) -> pai(id, storeId).
-- O banco passa a recusar filho que aponte para pai de OUTRA loja (antes o isolamento dependia só da FK simples do pai).
-- Ordem segura para base com dados: coluna anulável -> preenche pelo pai -> NOT NULL -> índices únicos -> FKs.
-- OrderItem -> Product continua FK simples (SET NULL ao apagar produto não pode anular o storeId do item).

-- 1. Solta as FKs simples que serão trocadas pelas compostas.
ALTER TABLE "CashMovement" DROP CONSTRAINT "CashMovement_cashSessionId_fkey";
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_orderId_fkey";
ALTER TABLE "OrderItemAdditional" DROP CONSTRAINT "OrderItemAdditional_orderItemId_fkey";
ALTER TABLE "OrderItemOption" DROP CONSTRAINT "OrderItemOption_orderItemId_fkey";
ALTER TABLE "OrderStatusHistory" DROP CONSTRAINT "OrderStatusHistory_orderId_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_orderId_fkey";
ALTER TABLE "ProductAdditional" DROP CONSTRAINT "ProductAdditional_productId_fkey";

-- 2. Colunas anuláveis.
ALTER TABLE "CashMovement" ADD COLUMN "storeId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "storeId" TEXT;
ALTER TABLE "OrderItemAdditional" ADD COLUMN "storeId" TEXT;
ALTER TABLE "OrderItemOption" ADD COLUMN "storeId" TEXT;
ALTER TABLE "OrderStatusHistory" ADD COLUMN "storeId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "storeId" TEXT;
ALTER TABLE "ProductAdditional" ADD COLUMN "storeId" TEXT;

-- 3. Preenche pelo pai (OrderItem ANTES dos filhos dele).
UPDATE "OrderItem" i SET "storeId" = o."storeId" FROM "Order" o WHERE o."id" = i."orderId";
UPDATE "OrderItemAdditional" a SET "storeId" = i."storeId" FROM "OrderItem" i WHERE i."id" = a."orderItemId";
UPDATE "OrderItemOption" x SET "storeId" = i."storeId" FROM "OrderItem" i WHERE i."id" = x."orderItemId";
UPDATE "OrderStatusHistory" h SET "storeId" = o."storeId" FROM "Order" o WHERE o."id" = h."orderId";
UPDATE "Payment" p SET "storeId" = o."storeId" FROM "Order" o WHERE o."id" = p."orderId";
UPDATE "CashMovement" m SET "storeId" = s."storeId" FROM "CashSession" s WHERE s."id" = m."cashSessionId";
UPDATE "ProductAdditional" a SET "storeId" = p."storeId" FROM "Product" p WHERE p."id" = a."productId";

-- 4. Obrigatórias (falha aqui = havia filho órfão, sem pai; investigar antes de seguir).
ALTER TABLE "CashMovement" ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "OrderItem" ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "OrderItemAdditional" ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "OrderItemOption" ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "OrderStatusHistory" ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "ProductAdditional" ALTER COLUMN "storeId" SET NOT NULL;

-- 5. Alvos únicos das FKs compostas.
CREATE UNIQUE INDEX "CashSession_id_storeId_key" ON "CashSession"("id", "storeId");
CREATE UNIQUE INDEX "OrderItem_id_storeId_key" ON "OrderItem"("id", "storeId");
CREATE UNIQUE INDEX "Payment_orderId_storeId_key" ON "Payment"("orderId", "storeId");

-- 6. FKs compostas.
ALTER TABLE "ProductAdditional" ADD CONSTRAINT "ProductAdditional_productId_storeId_fkey" FOREIGN KEY ("productId", "storeId") REFERENCES "Product"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_storeId_fkey" FOREIGN KEY ("orderId", "storeId") REFERENCES "Order"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItemAdditional" ADD CONSTRAINT "OrderItemAdditional_orderItemId_storeId_fkey" FOREIGN KEY ("orderItemId", "storeId") REFERENCES "OrderItem"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItemOption" ADD CONSTRAINT "OrderItemOption_orderItemId_storeId_fkey" FOREIGN KEY ("orderItemId", "storeId") REFERENCES "OrderItem"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_storeId_fkey" FOREIGN KEY ("orderId", "storeId") REFERENCES "Order"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_cashSessionId_storeId_fkey" FOREIGN KEY ("cashSessionId", "storeId") REFERENCES "CashSession"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_storeId_fkey" FOREIGN KEY ("orderId", "storeId") REFERENCES "Order"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;
