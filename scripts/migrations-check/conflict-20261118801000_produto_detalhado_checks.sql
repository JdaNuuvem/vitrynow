-- Dados que a 20261118801000 NAO pode aceitar: promocao >= preco normal e faixa de peso invertida (possiveis so ate aqui, sem CHECK).
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('pc_s','Loja PC','loja-pc','9811', now());
INSERT INTO "Category" ("id","storeId","name") VALUES ('pc_cat','pc_s','Pratos');
INSERT INTO "Product" ("id","storeId","categoryId","name","priceCents","promoCents") VALUES ('pc_p1','pc_s','pc_cat','Promo errada',1000,1500);
INSERT INTO "Product" ("id","storeId","categoryId","name","priceCents","minGrams","maxGrams") VALUES ('pc_p2','pc_s','pc_cat','Faixa errada',1000,900,100);
