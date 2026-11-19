-- Dados ANTES da 20261118780000_api48_fks_compostas: 2 lojas, cada uma com categoria, produto, cupom, entregador, recibo, pagamento do recibo e pedido
-- que usa tudo da PROPRIA loja (referencias validas). Tudo fictício.
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('fk_a','Loja FK A','loja-fk-a','9601', now()), ('fk_b','Loja FK B','loja-fk-b','9602', now());
INSERT INTO "Category" ("id","storeId","name") VALUES ('fk_a_cat','fk_a','Lanches A'), ('fk_b_cat','fk_b','Lanches B');
INSERT INTO "Product" ("id","storeId","categoryId","name","priceCents") VALUES ('fk_a_p','fk_a','fk_a_cat','Prod A',1000), ('fk_b_p','fk_b','fk_b_cat','Prod B',2000);
INSERT INTO "Coupon" ("id","storeId","code","discountType","discountValue") VALUES ('fk_a_cp','fk_a','FKA10','PERCENT',10), ('fk_b_cp','fk_b','FKB10','PERCENT',10);
INSERT INTO "Deliverer" ("id","storeId","name") VALUES ('fk_a_d','fk_a','Moto A'), ('fk_b_d','fk_b','Moto B');
INSERT INTO "Receipt" ("id","storeId","subtotalCents","totalCents","receivedByUserId") VALUES ('fk_a_r','fk_a',1000,1000,'u'), ('fk_b_r','fk_b',2000,2000,'u');
INSERT INTO "ReceiptPayment" ("id","receiptId","storeId","method","amountCents") VALUES ('fk_a_rp','fk_a_r','fk_a','PIX',1000), ('fk_b_rp','fk_b_r','fk_b','PIX',2000);
INSERT INTO "Order" ("id","storeId","code","type","status","couponId","delivererId","receiptId","updatedAt") VALUES
  ('fk_a_o','fk_a','0001','DELIVERY','CONCLUIDO','fk_a_cp','fk_a_d','fk_a_r', now()), ('fk_b_o','fk_b','0001','DELIVERY','CONCLUIDO','fk_b_cp','fk_b_d','fk_b_r', now());
