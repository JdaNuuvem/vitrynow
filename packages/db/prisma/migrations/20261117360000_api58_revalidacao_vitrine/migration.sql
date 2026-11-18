-- API-58 (ADR-0013 §2.4): fila de revalidação sob demanda da vitrine. Só aditiva (tabela nova).
-- CreateTable
CREATE TABLE "MenuRevalidation" (
    "slug" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MenuRevalidation_pkey" PRIMARY KEY ("slug")
);

-- CreateIndex
CREATE INDEX "MenuRevalidation_nextAttemptAt_idx" ON "MenuRevalidation"("nextAttemptAt");

