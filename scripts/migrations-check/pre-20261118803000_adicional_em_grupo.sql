-- Dados ANTES da 20261118803000_adicional_em_grupo: grupo com uma opção comum. Tudo fictício.
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('ag_s','Loja AG','loja-ag-mig','9703', now());
INSERT INTO "OptionGroup" ("id","storeId","name") VALUES ('ag_g','ag_s','Extras');
INSERT INTO "Option" ("id","storeId","groupId","name","priceCents") VALUES ('ag_o','ag_s','ag_g','Bacon',500);
