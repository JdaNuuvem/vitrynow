-- API-08 (ADR-0003 §2.1/§2.6, RN-B10-05): limites por plano, PRO invisível até lançar e "Quero ser avisado".
-- Só aditiva (expand): coluna nova com default, tabela nova, dados dos planos padrão.

ALTER TABLE "Plan" ADD COLUMN "limits" JSONB NOT NULL DEFAULT '{}';

UPDATE "Plan" SET "limits" = '{"maxUsers":1,"maxPrinters":1}'::jsonb WHERE "code" = 'BASICO';
-- PRO: limites ainda a definir (Claudio/Ogilvy); null = sem limite.
UPDATE "Plan" SET "limits" = '{"maxUsers":null,"maxPrinters":null}'::jsonb WHERE "code" = 'PRO';
-- O PRO só é oferecido quando agendado e WhatsApp existirem (ADR-0003 §2.6).
UPDATE "Plan" SET "active" = false WHERE "code" = 'PRO';

CREATE TABLE "FeatureInterest" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureInterest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeatureInterest_storeId_feature_key" ON "FeatureInterest"("storeId", "feature");
CREATE UNIQUE INDEX "FeatureInterest_id_storeId_key" ON "FeatureInterest"("id", "storeId");

ALTER TABLE "FeatureInterest" ADD CONSTRAINT "FeatureInterest_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
