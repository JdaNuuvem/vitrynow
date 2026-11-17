-- Dados ANTES da 20261117130000_api56_categoria_obrigatoria (produto sem categoria). Tudo fictício.
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES
  ('ct_a','Loja A','loja-ct-a','9401', now()), ('ct_b','Loja B','loja-ct-b','9402', now()),
  ('ct_c','Loja C','loja-ct-c','9403', now()), ('ct_d','Loja D','loja-ct-d','9404', now());

-- Loja A: 2 categorias (posições 0 e 1), 2 produtos ÓRFÃOS ativos e 1 produto categorizado
INSERT INTO "Category" ("id","storeId","name","position") VALUES ('ct_a_cat1','ct_a','Lanches',0), ('ct_a_cat2','ct_a','Bebidas',1);
INSERT INTO "Product" ("id","storeId","categoryId","name","priceCents","active") VALUES
  ('ct_pa1','ct_a',NULL,'Orfão A1',1000,true), ('ct_pa2','ct_a',NULL,'Orfão A2',1200,true), ('ct_pa3','ct_a','ct_a_cat1','Com categoria A3',1500,true);

-- Loja B: NENHUMA categoria e 1 produto órfão
INSERT INTO "Product" ("id","storeId","categoryId","name","priceCents","active") VALUES ('ct_pb1','ct_b',NULL,'Orfão B1',900,true);

-- Loja C: sem órfãos (não pode ganhar categoria nova)
INSERT INTO "Category" ("id","storeId","name","position") VALUES ('ct_c_cat1','ct_c','Pizzas',0);
INSERT INTO "Product" ("id","storeId","categoryId","name","priceCents","active") VALUES ('ct_pc1','ct_c','ct_c_cat1','Com categoria C1',3000,true);

-- Loja D: JÁ TEM uma categoria criada pelo dono chamada "Sem categoria" e 1 órfão
INSERT INTO "Category" ("id","storeId","name","position") VALUES ('ct_d_dono','ct_d','Sem categoria',0);
INSERT INTO "Product" ("id","storeId","categoryId","name","priceCents","active") VALUES ('ct_pd1','ct_d',NULL,'Orfão D1',700,true);

-- Loja E (colisão do id fixo): tem uma categoria de OUTRO nome cujo id é exatamente 'cat_sem_ct_e' e 1 órfão. A migração
-- NÃO pode abortar por chave duplicada: o id da categoria nova não pode ser derivado do id da loja (API-56, decisão do Atlas).
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('ct_e','Loja E','loja-ct-e','9405', now());
INSERT INTO "Category" ("id","storeId","name","position") VALUES ('cat_sem_ct_e','ct_e','Entradas',0);
INSERT INTO "Product" ("id","storeId","categoryId","name","priceCents","active") VALUES ('ct_pe1','ct_e',NULL,'Orfão E1',500,true);
