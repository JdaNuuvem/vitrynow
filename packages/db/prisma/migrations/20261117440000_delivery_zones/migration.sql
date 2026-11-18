-- API-16 (B9): taxa de entrega por bairro. Aditiva; loja sem bairros continua com a taxa única (CA-B9-09).
CREATE TYPE "DeliveryOutsideMode" AS ENUM ('REFUSE', 'DEFAULT_FEE');

ALTER TABLE "Store" ADD COLUMN "deliveryOutsideMode" "DeliveryOutsideMode" NOT NULL DEFAULT 'REFUSE';
ALTER TABLE "Store" ADD COLUMN "freeShippingFromCents" INTEGER;

ALTER TABLE "Order" ADD COLUMN "deliveryZoneName" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryEtaMinMinutes" INTEGER;
ALTER TABLE "Order" ADD COLUMN "deliveryEtaMaxMinutes" INTEGER;

CREATE TABLE "DeliveryZone" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "etaMinMinutes" INTEGER,
    "etaMaxMinutes" INTEGER,
    "freeFromCents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeliveryZone_id_storeId_key" ON "DeliveryZone"("id", "storeId");
CREATE UNIQUE INDEX "DeliveryZone_storeId_nameKey_key" ON "DeliveryZone"("storeId", "nameKey");
CREATE INDEX "DeliveryZone_storeId_idx" ON "DeliveryZone"("storeId");
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
