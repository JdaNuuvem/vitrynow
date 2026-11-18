-- API-13: pedido lançado no painel (RN-B2-06/09/10). Aditiva.
CREATE TYPE "OrderSource" AS ENUM ('CLIENTE', 'PAINEL');
ALTER TABLE "Order" ADD COLUMN "source" "OrderSource" NOT NULL DEFAULT 'CLIENTE',
  ADD COLUMN "channel" TEXT,
  ADD COLUMN "createdByUserId" TEXT,
  ADD COLUMN "manualKey" TEXT,
  ADD COLUMN "manualBodyHash" TEXT,
  ADD COLUMN "manualDiscountPercent" INTEGER,
  ADD COLUMN "manualDiscountReason" TEXT;
CREATE UNIQUE INDEX "Order_storeId_manualKey_key" ON "Order"("storeId", "manualKey");
ALTER TABLE "Store" ADD COLUMN "manualDiscountStaffLimitPercent" INTEGER NOT NULL DEFAULT 10;
-- O motivo do desconto manual é CÓDIGO de lista fechada; qualquer texto livre legado é descartado.
UPDATE "Order" SET "manualDiscountReason" = NULL WHERE "manualDiscountReason" IS NOT NULL AND "manualDiscountReason" NOT IN ('CORTESIA', 'ERRO_DO_PEDIDO', 'CLIENTE_FREQUENTE', 'PROMOCAO_DO_DIA', 'OUTRO');
