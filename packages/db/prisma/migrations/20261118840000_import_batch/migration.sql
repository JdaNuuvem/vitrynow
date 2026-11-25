-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PREVIEW', 'CONFIRMED', 'DISCARDED');

-- CreateTable (aditiva: importação assistida de produtos, IMP-1; o rascunho NUNCA vira produto até a confirmação)
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PREVIEW',
    "contentHash" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_storeId_createdAt_idx" ON "ImportBatch"("storeId", "createdAt");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
