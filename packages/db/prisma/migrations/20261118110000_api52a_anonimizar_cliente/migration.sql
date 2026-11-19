-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "anonymizedAt" TIMESTAMP(3);
-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "Feedback_storeId_createdAt_idx" ON "Feedback"("storeId", "createdAt");
-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
