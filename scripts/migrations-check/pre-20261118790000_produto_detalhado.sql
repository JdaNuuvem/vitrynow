-- Dados ANTES da 20261118790000_produto_detalhado: um produto e um pedido com item (produto antigo, sem nenhum campo novo). Tudo fictício.
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('pd_s','Loja PD','loja-pd-mig','9701', now());
INSERT INTO "Category" ("id","storeId","name") VALUES ('pd_cat','pd_s','Pratos');
INSERT INTO "Product" ("id","storeId","categoryId","name","priceCents") VALUES ('pd_p','pd_s','pd_cat','Prato antigo',3000);
INSERT INTO "Order" ("id","storeId","code","type","status","updatedAt") VALUES ('pd_o','pd_s','0001','BALCAO','CONCLUIDO', now());
INSERT INTO "OrderItem" ("id","orderId","productId","productName","quantity","unitPriceCents") VALUES ('pd_i','pd_o','pd_p','Prato antigo',2,3000);
