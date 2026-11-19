-- PD (produto detalhado), endurecimento: as regras que o servidor já valida passam a valer TAMBÉM no banco (defesa em profundidade, parecer da Nightingale P3):
-- promoção menor que o preço normal e faixa de peso coerente. Antes de criar, se algum produto já viola, a migração FALHA listando a contagem e NÃO altera nada
-- (transação; nunca corrige nem apaga dado: o operador decide). Aditiva; o Prisma não modela CHECK, então o drift continua 0.
DO $$
DECLARE
  found text;
BEGIN
  SELECT string_agg(rel || '=' || n, ', ' ORDER BY rel) INTO found FROM (
    SELECT 'Product.promoCents' AS rel, count(*) AS n FROM "Product" WHERE "promoCents" IS NOT NULL AND ("promoCents" < 1 OR "promoCents" >= "priceCents")
    UNION ALL SELECT 'Product.grams', count(*) FROM "Product" WHERE "minGrams" < 1 OR "stepGrams" < 1 OR "minGrams" > "maxGrams"
  ) t WHERE n > 0;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'CHECKs do produto detalhado: produtos que violam as regras (resolva manualmente antes; nada foi alterado): %', found;
  END IF;
END $$;

ALTER TABLE "Product" ADD CONSTRAINT "Product_promo_lt_price_chk" CHECK ("promoCents" IS NULL OR ("promoCents" >= 1 AND "promoCents" < "priceCents"));
ALTER TABLE "Product" ADD CONSTRAINT "Product_grams_chk" CHECK ("minGrams" >= 1 AND "stepGrams" >= 1 AND "minGrams" <= "maxGrams");
