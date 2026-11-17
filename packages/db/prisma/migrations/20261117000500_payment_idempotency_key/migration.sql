-- ADR-0007 §6.2: chave de idempotência do pagamento, gerada antes de chamar o provedor.
ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
