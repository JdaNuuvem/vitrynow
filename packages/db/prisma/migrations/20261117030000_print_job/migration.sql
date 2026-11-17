-- ADR-0004: fila de impressão (PrintJob). FK composta (orderId, storeId) -> Order(id, storeId) por ADR-0009: o banco recusa job de outra loja.
-- CreateEnum
CREATE TYPE "PrintKind" AS ENUM ('ORDER_KITCHEN', 'ORDER_REPRINT', 'ORDER_CANCEL_NOTICE', 'TEST');

-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'CLAIMED', 'PRINTED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "PrintKind" NOT NULL,
    "orderId" TEXT,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "claimedByTokenId" TEXT,
    "printedAt" TIMESTAMP(3),
    "ackStatus" TEXT,
    "lastErrorCode" TEXT,
    "lastError" TEXT,
    "reprintNumber" INTEGER,
    "requestedByUserId" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_dedupeKey_key" ON "PrintJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "PrintJob_storeId_status_availableAt_createdAt_idx" ON "PrintJob"("storeId", "status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "PrintJob_orderId_idx" ON "PrintJob"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_id_storeId_key" ON "PrintJob"("id", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_id_storeId_key" ON "Order"("id", "storeId");

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_orderId_storeId_fkey" FOREIGN KEY ("orderId", "storeId") REFERENCES "Order"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;
