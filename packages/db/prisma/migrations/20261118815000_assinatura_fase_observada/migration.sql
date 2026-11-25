-- Job subscription.transition: fase observada da assinatura e quando mudou (histórico; o acesso continua calculado na leitura).
ALTER TABLE "Subscription" ADD COLUMN "phase" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "phaseChangedAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_phase_known" CHECK ("phase" IS NULL OR "phase" IN ('TRIAL', 'ACTIVE', 'READ_ONLY', 'SUSPENDED'));
