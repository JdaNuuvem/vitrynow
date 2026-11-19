-- Dados que a 20261118780000_api48_fks_compostas NAO pode aceitar: produto da loja A apontando para a categoria da loja B e pedido da loja A com entregador da loja B.
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('fc_a','Loja FC A','loja-fc-a','9611', now()), ('fc_b','Loja FC B','loja-fc-b','9612', now());
INSERT INTO "Category" ("id","storeId","name") VALUES ('fc_b_cat','fc_b','Lanches B');
INSERT INTO "Product" ("id","storeId","categoryId","name","priceCents") VALUES ('fc_a_p','fc_a','fc_b_cat','Prod A em cat de B',1000);
INSERT INTO "Deliverer" ("id","storeId","name") VALUES ('fc_b_d','fc_b','Moto B');
INSERT INTO "Order" ("id","storeId","code","type","status","delivererId","updatedAt") VALUES ('fc_a_o','fc_a','0001','DELIVERY','CONCLUIDO','fc_b_d', now());
