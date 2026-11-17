-- CreateEnum
CREATE TYPE "DeviceAlertCode" AS ENUM ('NOTHING_TO_CHARGE_CONFLICT', 'NOTHING_TO_CHARGE_INVALID', 'EMPTY_ZERO_TICKET', 'MODE_UNCONFIRMED', 'MODE_RECOVERED', 'QUEUE_WITHOUT_PRINTER');

-- CreateTable
CREATE TABLE "DeviceAlert" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "tokenId" TEXT,
    "code" "DeviceAlertCode" NOT NULL,
    "orderId" TEXT,
    "orderKey" TEXT NOT NULL DEFAULT '',
    "clientVersion" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceAlert_storeId_lastAt_idx" ON "DeviceAlert"("storeId", "lastAt");

-- CreateIndex
CREATE INDEX "DeviceAlert_expiresAt_idx" ON "DeviceAlert"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAlert_storeId_code_orderKey_windowStart_key" ON "DeviceAlert"("storeId", "code", "orderKey", "windowStart");

-- AddForeignKey
ALTER TABLE "DeviceAlert" ADD CONSTRAINT "DeviceAlert_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
