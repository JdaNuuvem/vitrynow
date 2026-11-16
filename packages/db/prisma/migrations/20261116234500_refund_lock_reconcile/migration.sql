-- ADR-0007 §11 (C5): trava do estorno na própria linha do pedido + marca de conciliação manual. Expand: tudo nulo.
ALTER TABLE "Order" ADD COLUMN "refundLockedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "reconcileNote" TEXT;

-- Estornos já em andamento antes desta migração: congela o pedido correspondente.
UPDATE "Order" o SET "refundLockedAt" = COALESCE(p."refundRequestedAt", now())
FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" = 'ESTORNO_PENDENTE';
