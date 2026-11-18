-- API-61: estorno encerrado pelo dono sem devolução automática (o dinheiro continua como recebido).
ALTER TABLE "Payment" ADD COLUMN "refundAbandonedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "refundAbandonCode" TEXT;
