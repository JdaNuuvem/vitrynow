-- Fechamento da mesa: taxa de serviço e desconto (todos os planos) e pagamento dividido (PRO, `tab_service`).
-- Taxa sugerida por loja; o recebimento decide se aplica. 0 = a loja não cobra.
ALTER TABLE "Store" ADD COLUMN "serviceFeePercent" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Store" ADD CONSTRAINT "Store_serviceFeePercent_range" CHECK ("serviceFeePercent" BETWEEN 0 AND 30);

-- O recibo continua imutável; garante a conta no próprio banco.
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_fee_discount_nonneg" CHECK ("serviceFeeCents" >= 0 AND "discountCents" >= 0);
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_total_matches" CHECK ("totalCents" = "subtotalCents" + "serviceFeeCents" - "discountCents");

-- Comanda/pagamento dividido entregue: o PRO passa a listar `tab_service`.
UPDATE "Plan" SET "features" = array_append("features", 'tab_service')
WHERE "code" = 'PRO' AND NOT ('tab_service' = ANY("features"));
