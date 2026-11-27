-- Alerta de perda alta configurável por loja (antes fixo em 5%).
ALTER TABLE "Store" ADD COLUMN "lossAlertPercent" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Store" ADD CONSTRAINT "Store_lossAlertPercent_check" CHECK ("lossAlertPercent" BETWEEN 1 AND 100);
