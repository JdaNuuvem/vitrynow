-- ADR-0007: histórico com autor/origem/motivo, campos de cancelamento e de estorno.
CREATE TYPE "HistorySource" AS ENUM ('PANEL', 'CUSTOMER', 'SYSTEM', 'WEBHOOK');
CREATE TYPE "HistoryKind" AS ENUM ('ADVANCE', 'UNDO', 'CANCEL', 'SYSTEM');

ALTER TABLE "OrderStatusHistory"
  ADD COLUMN "userId" TEXT,
  ADD COLUMN "source" "HistorySource" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "kind" "HistoryKind" NOT NULL DEFAULT 'ADVANCE',
  ADD COLUMN "reasonCode" TEXT,
  ADD COLUMN "reasonText" TEXT,
  ADD COLUMN "customerMessage" TEXT,
  ADD COLUMN "seq" SERIAL NOT NULL;

DROP INDEX IF EXISTS "OrderStatusHistory_orderId_idx";
CREATE INDEX "OrderStatusHistory_orderId_seq_idx" ON "OrderStatusHistory"("orderId", "seq");

ALTER TABLE "Order"
  ADD COLUMN "canceledAt" TIMESTAMP(3),
  ADD COLUMN "couponReleasedAt" TIMESTAMP(3);

-- Pedidos já cancelados: preserva a data (última entrada CANCELADO do histórico) e marca o cupom como já tratado.
UPDATE "Order" o SET "canceledAt" = h."createdAt"
FROM (SELECT "orderId", MAX("createdAt") AS "createdAt" FROM "OrderStatusHistory" WHERE "status" = 'CANCELADO' GROUP BY "orderId") h
WHERE h."orderId" = o."id" AND o."status" = 'CANCELADO';

ALTER TABLE "Payment"
  ADD COLUMN "refundAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refundLastError" TEXT,
  ADD COLUMN "refundRequestedAt" TIMESTAMP(3),
  ADD COLUMN "refundContext" JSONB,
  ADD COLUMN "lastRawStatus" TEXT,
  ADD COLUMN "lastCheckedAt" TIMESTAMP(3);
