-- API-65: estorno registrado pelo dono (devolvido direto no app do Mercado Pago).
ALTER TABLE "Payment" ADD COLUMN "refundManualAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "refundManualCode" TEXT;
