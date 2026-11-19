-- Dados ANTES da 20261118801000_produto_detalhado_checks: produto com promocao valida e produto comum. Tudo ficticio.
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('pk_s','Loja PK','loja-pk-mig','9801', now());
INSERT INTO "Category" ("id","storeId","name") VALUES ('pk_cat','pk_s','Pratos');
INSERT INTO "Product" ("id","storeId","categoryId","name","priceCents","promoCents") VALUES ('pk_p1','pk_s','pk_cat','Com promo',3000,2400), ('pk_p2','pk_s','pk_cat','Comum',1000,NULL);
