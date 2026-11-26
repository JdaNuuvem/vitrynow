-- Desperdício de pedido cancelado JÁ PREPARADO: a movimentação WASTE com motivo PEDIDO_CANCELADO fica ligada ao pedido.
-- Antes: só SALE/SALE_REVERSAL podiam (e precisavam) ter orderId.
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_order_link";
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_order_link" CHECK (
  ("type" IN ('SALE', 'SALE_REVERSAL') OR ("type" = 'WASTE' AND "reason" IS NOT DISTINCT FROM 'PEDIDO_CANCELADO')) = ("orderId" IS NOT NULL)
);
