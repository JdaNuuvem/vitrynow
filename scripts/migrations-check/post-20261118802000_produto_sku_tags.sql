-- Produto antigo: sem SKU e sem tags (padrao neutro); varios produtos sem SKU convivem; SKU repetido na MESMA loja e recusado; em OUTRA loja pode.
SELECT 'produtos_antigos_sem_sku_e_sem_tags',
  (SELECT count(*) FROM "Product" WHERE "id" IN ('sk_a_p1','sk_a_p2','sk_b_p1') AND "sku" IS NULL AND coalesce(cardinality("tags"), 0) = 0) = 3,
  'padroes neutros, precos intactos';
UPDATE "Product" SET "sku" = 'PF-01' WHERE "id" = 'sk_a_p1';
UPDATE "Product" SET "sku" = 'PF-01' WHERE "id" = 'sk_b_p1';
DO $$ BEGIN
  BEGIN UPDATE "Product" SET "sku" = 'PF-01' WHERE "id" = 'sk_a_p2'; RAISE EXCEPTION 'nao recusou SKU repetido'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
SELECT 'sku_unico_por_loja',
  (SELECT "sku" FROM "Product" WHERE "id" = 'sk_a_p2') IS NULL AND (SELECT count(*) FROM "Product" WHERE "sku" = 'PF-01') = 2,
  'mesma loja recusa, outra loja aceita, NULL convive';
