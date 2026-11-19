-- Dados ANTES da 20261118810000_modo_ocupado: uma loja sem os campos novos. Tudo fictício.
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('bz_s','Loja Ocupado','loja-bz-mig','9702', now());
-- Colunas novas (busyUntil, busyExtraMinutes, busyStartedAt) nascem NULL nas lojas antigas: nada a preencher.
