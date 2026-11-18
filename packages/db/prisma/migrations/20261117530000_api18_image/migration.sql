-- API-18: imagens processadas (ADR-0010). Aditiva.
CREATE TYPE "ImageKind" AS ENUM ('PRODUCT', 'LOGO', 'COVER');
CREATE TYPE "ImageStatus" AS ENUM ('PENDING', 'READY');
CREATE TABLE "Image" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "ImageKind" NOT NULL,
    "keyBase" TEXT NOT NULL,
    "widths" INTEGER[],
    "bytes" INTEGER NOT NULL,
    "status" "ImageStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Image_storeId_status_createdAt_idx" ON "Image"("storeId", "status", "createdAt");
ALTER TABLE "Image" ADD CONSTRAINT "Image_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
