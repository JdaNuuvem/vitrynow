-- Opção antiga intacta: sem produto ligado e preço próprio (OWN).
SELECT 'opcao_antiga_intacta',
  (SELECT "priceCents" = 500 AND "productId" IS NULL AND "priceSource" = 'OWN' FROM "Option" WHERE "id" = 'ag_o'),
  'opcao antiga continua com preco proprio e sem adicional';
