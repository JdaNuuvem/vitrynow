-- CA-PD-16: produto e item antigos continuam IDENTICOS; os campos novos nascem com o padrao neutro (sem promocao, unidade UN, sem peso).
SELECT 'produto_antigo_com_padroes_neutros',
  (SELECT "priceCents" = 3000 AND "promoCents" IS NULL AND "promoStartsAt" IS NULL AND "promoEndsAt" IS NULL AND "kind" = 'PRATO' AND "sellAlone" = true AND "saleUnit" = 'UN'
     AND "minGrams" = 100 AND "stepGrams" = 50 AND "maxGrams" = 5000 AND "isSingleDish" = false AND "portionGrams" IS NULL AND "serves" IS NULL FROM "Product" WHERE "id" = 'pd_p'),
  'defaults aplicados sem mudar preco';
SELECT 'item_antigo_intacto',
  (SELECT "quantity" = 2 AND "unitPriceCents" = 3000 AND "listPriceCents" IS NULL AND "weightGrams" IS NULL AND "pricePerKgCents" IS NULL FROM "OrderItem" WHERE "id" = 'pd_i'),
  'quantidade e preco do item antigo nao mudam';
