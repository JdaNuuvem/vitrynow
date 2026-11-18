-- API-22: mesa e QR (ADR-0002 nível 1, RN-MB-01/06/12). Aditiva.
ALTER TYPE "OrderSource" ADD VALUE IF NOT EXISTS 'QR_MESA';
ALTER TABLE "Store" ADD COLUMN "qrOrderingEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "qrOrdersNeedApproval" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "Table" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "qrToken" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Table_qrToken_key" ON "Table"("qrToken");
CREATE UNIQUE INDEX "Table_storeId_label_key" ON "Table"("storeId", "label");
CREATE UNIQUE INDEX "Table_id_storeId_key" ON "Table"("id", "storeId");
ALTER TABLE "Table" ADD CONSTRAINT "Table_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD COLUMN "tableId" TEXT, ADD COLUMN "deviceTokenHash" TEXT;
CREATE INDEX "Order_storeId_tableId_status_idx" ON "Order"("storeId", "tableId", "status");
CREATE INDEX "Order_storeId_deviceTokenHash_idx" ON "Order"("storeId", "deviceTokenHash");
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableId_storeId_fkey" FOREIGN KEY ("tableId", "storeId") REFERENCES "Table"("id", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;
