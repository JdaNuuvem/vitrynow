-- Dados ANTES da 20261118840000_import_batch: uma loja com produto (tudo fictício). A migração é só aditiva (tabela nova).
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('imp_s','Loja IMP','loja-imp-mig','9702', now());
INSERT INTO "Category" ("id","storeId","name") VALUES ('imp_cat','imp_s','Pratos');
INSERT INTO "Product" ("id","storeId","categoryId","name","priceCents") VALUES ('imp_p','imp_s','imp_cat','Prato antigo',3000);
