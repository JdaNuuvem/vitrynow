-- API-26 (ONB): verificação de e-mail, checklist de onboarding e eventos de ativação. Aditiva.
-- Contas já existentes ficam NÃO verificadas (precisam confirmar antes de assinar); nenhuma é marcada como verificada sem prova.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "OnboardingStepStatus" AS ENUM ('DONE', 'SKIPPED');
CREATE TABLE "OnboardingStep" (
    "storeId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "status" "OnboardingStepStatus" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OnboardingStep_pkey" PRIMARY KEY ("storeId", "step")
);
ALTER TABLE "OnboardingStep" ADD CONSTRAINT "OnboardingStep_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ActivationEvent" (
    "storeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ActivationEvent_pkey" PRIMARY KEY ("storeId", "kind")
);
ALTER TABLE "ActivationEvent" ADD CONSTRAINT "ActivationEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
