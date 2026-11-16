-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'REEMBOLSADO';

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_productId_fkey";

-- AlterTable
ALTER TABLE "DeviceToken" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "productName" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "productId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: itens de pedidos já existentes ganham o snapshot do nome do produto.
UPDATE "OrderItem" oi
SET "productName" = p.name
FROM "Product" p
WHERE p.id = oi."productId" AND oi."productName" = '';

-- Impede duas sessões de caixa abertas ao mesmo tempo na mesma loja (corrige race condition
-- de dois cliques/abas abrindo caixa simultaneamente — índice único parcial, Postgres trata
-- NULL como distinto então um UNIQUE comum em (storeId, closedAt) não bastaria).
CREATE UNIQUE INDEX "CashSession_storeId_open_unique" ON "CashSession" ("storeId") WHERE "closedAt" IS NULL;
