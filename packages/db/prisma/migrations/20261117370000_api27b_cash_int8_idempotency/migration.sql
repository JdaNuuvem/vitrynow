-- API-27b (CA-CX-29): esperado e diferenca do caixa em 64 bits; (M3) chave de idempotencia da movimentacao.
ALTER TABLE "CashSession" ALTER COLUMN "expectedClosingCents" TYPE BIGINT, ALTER COLUMN "differenceCents" TYPE BIGINT;
ALTER TABLE "CashMovement" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "CashMovement_cashSessionId_idempotencyKey_key" ON "CashMovement"("cashSessionId", "idempotencyKey");
