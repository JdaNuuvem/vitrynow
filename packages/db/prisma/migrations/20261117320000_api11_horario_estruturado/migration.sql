-- API-11 (B5): horário estruturado aplicado no servidor. Só aditiva (expand): colunas nulas, sem backfill.
-- O texto livre `openingHours` continua como informação (RN-B5-07); loja sem grade segue aberta quando ligada (RN-B5-06).
ALTER TABLE "Store" ADD COLUMN "schedule" JSONB;
ALTER TABLE "Store" ADD COLUMN "pausedUntil" TIMESTAMP(3);
ALTER TABLE "Store" ADD COLUMN "closedUntil" TIMESTAMP(3);
