-- Depois: dados validos intactos e o banco recusa promocao >= preco e faixa de peso incoerente.
SELECT 'dados_validos_intactos', (SELECT count(*) FROM "Product" WHERE "id" IN ('pk_p1','pk_p2')) = 2 AND (SELECT "promoCents" FROM "Product" WHERE "id" = 'pk_p1') = 2400, 'produtos validos continuam';
SELECT 'checks_criados', (SELECT count(*) FROM pg_constraint WHERE conname IN ('Product_promo_lt_price_chk','Product_grams_chk') AND contype = 'c') = 2, 'os 2 CHECKs existem';
DO $$ BEGIN
  BEGIN UPDATE "Product" SET "promoCents" = 3000 WHERE "id" = 'pk_p1'; RAISE EXCEPTION 'nao recusou promo >= preco'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE "Product" SET "minGrams" = 6000 WHERE "id" = 'pk_p2'; RAISE EXCEPTION 'nao recusou faixa de peso'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT 'banco_recusa_dado_incoerente', (SELECT "promoCents" FROM "Product" WHERE "id" = 'pk_p1') = 2400 AND (SELECT "minGrams" FROM "Product" WHERE "id" = 'pk_p2') = 100, 'valores inalterados';
