-- Dados ANTES da 20261118802000_produto_sku_tags: dois produtos de lojas diferentes e um terceiro da mesma loja, todos sem codigo. Tudo ficticio.
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('sk_a','Loja SK A','loja-sk-a','9901', now()), ('sk_b','Loja SK B','loja-sk-b','9902', now());
INSERT INTO "Category" ("id","storeId","name") VALUES ('sk_a_cat','sk_a','Pratos'), ('sk_b_cat','sk_b','Pratos');
INSERT INTO "Product" ("id","storeId","categoryId","name","priceCents") VALUES ('sk_a_p1','sk_a','sk_a_cat','Prato A1',1000), ('sk_a_p2','sk_a','sk_a_cat','Prato A2',1100), ('sk_b_p1','sk_b','sk_b_cat','Prato B1',1200);
