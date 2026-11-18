-- API-57 (PRD-13, RN-PZ-01): tempo médio de preparo por modalidade, para a previsão ao cliente.
-- Só aditiva: colunas nulas, sem backfill. Nulo = sem previsão (nada é inventado).
ALTER TABLE "Store" ADD COLUMN "prepMinutesDelivery" INTEGER;
ALTER TABLE "Store" ADD COLUMN "prepMinutesPickup" INTEGER;
