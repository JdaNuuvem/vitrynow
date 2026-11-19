-- Reels (ADR-0021, REEL-1): vídeo de até 30 s por produto, fila de mídia e denúncias. Aditiva: só tabelas novas.
-- CreateEnum
CREATE TYPE "ReelStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "MediaJobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ReelReportReason" AS ENUM ('PESSOA_IDENTIFICAVEL', 'MUSICA_DE_TERCEIROS', 'OUTRO');

-- CreateEnum
CREATE TYPE "ReelReportStatus" AS ENUM ('OPEN', 'KEPT', 'REMOVED');

-- CreateTable
CREATE TABLE "Reel" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT,
    "status" "ReelStatus" NOT NULL DEFAULT 'PROCESSING',
    "keyBase" TEXT NOT NULL,
    "originalKey" TEXT,
    "originalBytes" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "errorCode" TEXT,
    "uploadedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "takedownAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reelId" TEXT NOT NULL,
    "status" "MediaJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReelReport" (
    "id" TEXT NOT NULL,
    "reelId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reason" "ReelReportReason" NOT NULL,
    "note" TEXT,
    "reporterKey" TEXT NOT NULL,
    "status" "ReelReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReelReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reel_storeId_status_idx" ON "Reel"("storeId", "status");

-- CreateIndex
CREATE INDEX "Reel_productId_idx" ON "Reel"("productId");

-- CreateIndex
CREATE INDEX "Reel_status_createdAt_idx" ON "Reel"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reel_id_storeId_key" ON "Reel"("id", "storeId");

-- CreateIndex
CREATE INDEX "MediaJob_status_availableAt_idx" ON "MediaJob"("status", "availableAt");

-- CreateIndex
CREATE INDEX "MediaJob_storeId_status_idx" ON "MediaJob"("storeId", "status");

-- CreateIndex
CREATE INDEX "MediaJob_reelId_idx" ON "MediaJob"("reelId");

-- CreateIndex
CREATE INDEX "ReelReport_status_createdAt_idx" ON "ReelReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReelReport_storeId_idx" ON "ReelReport"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "ReelReport_reelId_reporterKey_key" ON "ReelReport"("reelId", "reporterKey");

-- AddForeignKey
ALTER TABLE "Reel" ADD CONSTRAINT "Reel_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaJob" ADD CONSTRAINT "MediaJob_reelId_storeId_fkey" FOREIGN KEY ("reelId", "storeId") REFERENCES "Reel"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelReport" ADD CONSTRAINT "ReelReport_reelId_storeId_fkey" FOREIGN KEY ("reelId", "storeId") REFERENCES "Reel"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Um vídeo ATIVO por produto (RN-REEL-01): o banco recusa o segundo mesmo com duas requisições simultâneas.
CREATE UNIQUE INDEX "Reel_productId_ativo_key" ON "Reel"("productId") WHERE "productId" IS NOT NULL AND "status" IN ('PROCESSING','READY','PUBLISHED');
-- Um job de conversão em andamento por vídeo.
CREATE UNIQUE INDEX "MediaJob_reel_aberto_key" ON "MediaJob"("reelId") WHERE "status" IN ('PENDING','RUNNING');
