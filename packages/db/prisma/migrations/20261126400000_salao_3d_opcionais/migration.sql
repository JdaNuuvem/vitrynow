-- Salão 3D (opcionais): garçom responsável, pessoas na mesa e reservas.
ALTER TABLE "Table" ADD COLUMN "waiterUserId" TEXT;
ALTER TABLE "Table" ADD COLUMN "guests" INTEGER;
ALTER TABLE "Table" ADD CONSTRAINT "Table_guests_check" CHECK ("guests" IS NULL OR "guests" BETWEEN 1 AND 50);
ALTER TABLE "Table" ADD CONSTRAINT "Table_waiterUserId_fkey" FOREIGN KEY ("waiterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "ReservationStatus" AS ENUM ('BOOKED', 'SEATED', 'CANCELED', 'NO_SHOW');

CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "tableId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "partySize" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 90,
    "status" "ReservationStatus" NOT NULL DEFAULT 'BOOKED',
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Reservation_check" CHECK (
      "partySize" BETWEEN 1 AND 100 AND "durationMin" BETWEEN 15 AND 720
      AND char_length("customerName") BETWEEN 1 AND 80
      AND ("customerPhone" IS NULL OR char_length("customerPhone") <= 20)
      AND ("notes" IS NULL OR char_length("notes") <= 300)
    )
);
CREATE INDEX "Reservation_storeId_startsAt_idx" ON "Reservation"("storeId", "startsAt");
CREATE INDEX "Reservation_tableId_startsAt_idx" ON "Reservation"("tableId", "startsAt");
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tableId_storeId_fkey" FOREIGN KEY ("tableId", "storeId") REFERENCES "Table"("id", "storeId") ON DELETE NO ACTION ON UPDATE CASCADE;
