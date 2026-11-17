-- NG-16: token de acesso do cliente ao próprio pedido (hash). Expand: coluna nula + índice único.
-- Pedidos já existentes ficam sem token e, por desenho (fail-closed), sem acesso público ao status/cancelamento.
ALTER TABLE "Order" ADD COLUMN "publicTokenHash" TEXT;
CREATE UNIQUE INDEX "Order_publicTokenHash_key" ON "Order"("publicTokenHash");
