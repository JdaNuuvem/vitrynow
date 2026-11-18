-- API-25: back-office da plataforma (contas de equipe, auditoria, suspensão manual) e livro-razão de créditos (ADR-0015 §3D).

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('ADMIN', 'SUPPORT');
CREATE TYPE "AiCreditReason" AS ENUM ('PURCHASE', 'GRANT', 'ADJUST', 'RESERVE', 'CONSUME', 'RELEASE');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "platformSuspendedAt" TIMESTAMP(3),
ADD COLUMN "platformSuspendedReason" TEXT;

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL DEFAULT 'SUPPORT',
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "storeId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiCreditLedger" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "AiCreditReason" NOT NULL,
    "note" TEXT,
    "externalRef" TEXT,
    "priceCents" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "jobId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "actorAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiCreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");
CREATE INDEX "PlatformAuditLog_storeId_createdAt_idx" ON "PlatformAuditLog"("storeId", "createdAt");
CREATE INDEX "PlatformAuditLog_adminId_createdAt_idx" ON "PlatformAuditLog"("adminId", "createdAt");
CREATE UNIQUE INDEX "AiCreditLedger_storeId_idempotencyKey_key" ON "AiCreditLedger"("storeId", "idempotencyKey");
CREATE INDEX "AiCreditLedger_storeId_createdAt_idx" ON "AiCreditLedger"("storeId", "createdAt");

-- AddForeignKey
ALTER TABLE "PlatformAuditLog" ADD CONSTRAINT "PlatformAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiCreditLedger" ADD CONSTRAINT "AiCreditLedger_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiCreditLedger" ADD CONSTRAINT "AiCreditLedger_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Imutabilidade (RN-CRE-02, RN-BKO-03): só INSERT. UPDATE e DELETE são recusados no banco, não só na aplicação.
CREATE FUNCTION "forbid_row_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'tabela % é imutável (somente INSERT)', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiCreditLedger_immutable" BEFORE UPDATE OR DELETE ON "AiCreditLedger"
  FOR EACH ROW EXECUTE FUNCTION "forbid_row_mutation"();
CREATE TRIGGER "PlatformAuditLog_immutable" BEFORE UPDATE OR DELETE ON "PlatformAuditLog"
  FOR EACH ROW EXECUTE FUNCTION "forbid_row_mutation"();
