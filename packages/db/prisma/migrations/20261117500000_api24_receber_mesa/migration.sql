-- API-24: receber a mesa (ADR-0012, RN-MB-03/04). Aditiva.
CREATE TYPE "ReceiptKind" AS ENUM ('TABLE', 'TAB');
CREATE TABLE "Receipt" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "kind" "ReceiptKind" NOT NULL DEFAULT 'TABLE',
  "tableId" TEXT,
  "subtotalCents" INTEGER NOT NULL,
  "serviceFeeCents" INTEGER NOT NULL DEFAULT 0,
  "discountCents" INTEGER NOT NULL DEFAULT 0,
  "totalCents" INTEGER NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedByUserId" TEXT NOT NULL,
  "cashSessionId" TEXT,
  CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Receipt_total_positive" CHECK ("totalCents" > 0 AND "subtotalCents" >= 0)
);
CREATE INDEX "Receipt_storeId_receivedAt_idx" ON "Receipt"("storeId", "receivedAt");
CREATE INDEX "Receipt_storeId_tableId_idx" ON "Receipt"("storeId", "tableId");
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_tableId_storeId_fkey" FOREIGN KEY ("tableId", "storeId") REFERENCES "Table"("id", "storeId") ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE TABLE "ReceiptPayment" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "method" "OrderPaymentMethod" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "changeForCents" INTEGER,
  CONSTRAINT "ReceiptPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReceiptPayment_amount_positive" CHECK ("amountCents" > 0)
);
CREATE INDEX "ReceiptPayment_receiptId_idx" ON "ReceiptPayment"("receiptId");
CREATE INDEX "ReceiptPayment_storeId_method_idx" ON "ReceiptPayment"("storeId", "method");
ALTER TABLE "ReceiptPayment" ADD CONSTRAINT "ReceiptPayment_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD COLUMN "receiptId" TEXT;
CREATE INDEX "Order_receiptId_idx" ON "Order"("receiptId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
