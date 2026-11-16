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

-- Pedido cancelado antes desta migração: o cupom já foi tratado pelo fluxo antigo. Marca como tratado
-- (couponReleasedAt é a trava de idempotência da devolução; NULL aqui permitiria devolver em dobro).
UPDATE "Order" SET "couponReleasedAt" = "canceledAt"
WHERE "status" = 'CANCELADO' AND "couponId" IS NOT NULL AND "canceledAt" IS NOT NULL;

-- Backfill determinístico do seq: ordem do tempo (createdAt, id). Sem isto o SERIAL numera pela ordem
-- física das linhas, que pode divergir do histórico real. Depois, a sequência continua do maior valor.
UPDATE "OrderStatusHistory" h SET "seq" = r.rn
FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "OrderStatusHistory") r
WHERE r."id" = h."id";
SELECT setval(pg_get_serial_sequence('"OrderStatusHistory"', 'seq'),
              GREATEST((SELECT COALESCE(max("seq"), 0) FROM "OrderStatusHistory"), 1),
              (SELECT count(*) > 0 FROM "OrderStatusHistory"));

ALTER TABLE "Payment"
  ADD COLUMN "refundAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refundLastError" TEXT,
  ADD COLUMN "refundRequestedAt" TIMESTAMP(3),
  ADD COLUMN "refundContext" JSONB,
  ADD COLUMN "lastRawStatus" TEXT,
  ADD COLUMN "lastCheckedAt" TIMESTAMP(3);
