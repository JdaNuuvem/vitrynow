-- API-59: vinculo unico pedido -> movimentacao DEVOLUCAO (idempotencia de RN-CX-14).
ALTER TABLE "Order" ADD COLUMN "cashRefundMovementId" TEXT;
CREATE UNIQUE INDEX "Order_cashRefundMovementId_key" ON "Order"("cashRefundMovementId");
