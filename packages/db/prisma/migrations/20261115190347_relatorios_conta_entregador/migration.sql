-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "delivererId" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "customDomain" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "primaryColor" TEXT;

-- CreateTable
CREATE TABLE "Deliverer" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deliverer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deliverer_storeId_idx" ON "Deliverer"("storeId");

-- CreateIndex
CREATE INDEX "Order_delivererId_idx" ON "Order"("delivererId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_delivererId_fkey" FOREIGN KEY ("delivererId") REFERENCES "Deliverer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverer" ADD CONSTRAINT "Deliverer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
