-- API-54: observação interna do pedido (nunca ao cliente nem ao tíquete) e índice do histórico/kanban por período. Só aditiva.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "internalNote" TEXT;

-- CreateIndex
CREATE INDEX "Order_storeId_createdAt_idx" ON "Order"("storeId", "createdAt");

