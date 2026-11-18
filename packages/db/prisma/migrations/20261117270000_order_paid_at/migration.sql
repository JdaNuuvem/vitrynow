-- API-21: momento em que o dinheiro do pedido foi recebido (RN-CX-01/02). Aditiva.
ALTER TABLE "Order" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "paidAtApproximate" BOOLEAN NOT NULL DEFAULT false;
-- Pedidos em dinheiro já concluídos: o dinheiro foi recebido na conclusão (melhor estimativa disponível: a criação).
UPDATE "Order" SET "paidAt" = "createdAt", "paidAtApproximate" = true WHERE "paymentMethod" = 'DINHEIRO' AND "status" = 'CONCLUIDO' AND "totalCents" > 0;
-- PIX já aprovado: a hora da aprovação é a última atualização da cobrança (aproximação; o webhook novo grava o instante real).
UPDATE "Order" o SET "paidAt" = p."updatedAt", "paidAtApproximate" = true FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" IN ('APROVADO', 'ESTORNO_PENDENTE', 'REEMBOLSADO') AND o."paidAt" IS NULL;
-- O caixa FECHADO não é tocado: `CashSession.summarySnapshot` e as colunas de fechamento ficam exatamente como estavam.
