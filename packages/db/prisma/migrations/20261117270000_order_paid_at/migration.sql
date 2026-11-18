-- API-21: momento em que o dinheiro do pedido foi recebido (RN-CX-01/02). Aditiva.
ALTER TABLE "Order" ADD COLUMN "paidAt" TIMESTAMP(3);
-- Pedidos em dinheiro já concluídos: o dinheiro foi recebido na conclusão (melhor estimativa disponível: a criação).
UPDATE "Order" SET "paidAt" = "createdAt" WHERE "paymentMethod" = 'DINHEIRO' AND "status" = 'CONCLUIDO' AND "totalCents" > 0;
