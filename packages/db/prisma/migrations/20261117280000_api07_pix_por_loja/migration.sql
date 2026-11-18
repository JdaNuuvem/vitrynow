-- API-07 (ADR-0001, ADR-0009): PIX por loja via OAuth do Mercado Pago. Só aditiva: tabelas novas e Payment.paymentAccountId nulo.
-- CreateEnum
CREATE TYPE "PaymentAccountStatus" AS ENUM ('CONNECTED', 'NEEDS_RECONNECT', 'DISCONNECTED');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "paymentAccountId" TEXT;

-- CreateTable
CREATE TABLE "PaymentAccount" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mercadopago',
    "sellerUserId" TEXT NOT NULL,
    "status" "PaymentAccountStatus" NOT NULL DEFAULT 'CONNECTED',
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "lastRefreshAt" TIMESTAMP(3),
    "lastRefreshAttemptAt" TIMESTAMP(3),
    "refreshFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOAuthState" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sid" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentAccount_storeId_status_idx" ON "PaymentAccount"("storeId", "status");

-- CreateIndex
CREATE INDEX "PaymentAccount_status_expiresAt_idx" ON "PaymentAccount"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAccount_id_storeId_key" ON "PaymentAccount"("id", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOAuthState_stateHash_key" ON "PaymentOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "PaymentOAuthState_expiresAt_idx" ON "PaymentOAuthState"("expiresAt");

-- AddForeignKey
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Índices únicos PARCIAIS (o Prisma não os expressa): no máximo UMA conta ativa por loja e um vendedor do provedor em UMA
-- só loja (anti-sequestro/confusão, D1-2/D1-3). Contas DISCONNECTED ficam no histórico sem bloquear a reconexão.
CREATE UNIQUE INDEX "PaymentAccount_one_active_per_store" ON "PaymentAccount"("storeId") WHERE "status" <> 'DISCONNECTED';
CREATE UNIQUE INDEX "PaymentAccount_one_store_per_seller" ON "PaymentAccount"("provider", "sellerUserId") WHERE "status" <> 'DISCONNECTED';
