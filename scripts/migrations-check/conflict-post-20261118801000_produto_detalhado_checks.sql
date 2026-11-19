SELECT 'nada_alterado', (SELECT "promoCents" FROM "Product" WHERE "id" = 'pc_p1') = 1500 AND (SELECT "minGrams" FROM "Product" WHERE "id" = 'pc_p2') = 900, 'a migracao nunca corrige dado';
SELECT 'checks_nao_criados', NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('Product_promo_lt_price_chk','Product_grams_chk')), 'transacao desfeita';
