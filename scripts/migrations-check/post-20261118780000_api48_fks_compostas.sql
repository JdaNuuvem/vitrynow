-- Conferencia da 20261118780000_api48_fks_compostas: dados intactos, FKs compostas no lugar das simples, e o banco recusa referencia entre lojas.
SELECT 'dados_intactos',
  (SELECT count(*) FROM "Order" WHERE "id" IN ('fk_a_o','fk_b_o') AND "couponId" IS NOT NULL AND "delivererId" IS NOT NULL AND "receiptId" IS NOT NULL) = 2
  AND (SELECT count(*) FROM "Product" WHERE "id" IN ('fk_a_p','fk_b_p') AND "categoryId" IS NOT NULL) = 2,
  'as referencias validas de cada loja continuam';
SELECT 'fks_compostas_criadas',
  (SELECT count(*) FROM pg_constraint WHERE conname IN ('Product_categoryId_storeId_fkey','Order_couponId_storeId_fkey','Order_delivererId_storeId_fkey','Order_receiptId_storeId_fkey','ReceiptPayment_receiptId_storeId_fkey') AND contype = 'f') = 5,
  'as 5 FKs compostas existem';
SELECT 'fks_simples_removidas',
  NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('Product_categoryId_fkey','Order_couponId_fkey','Order_delivererId_fkey','Order_receiptId_fkey','ReceiptPayment_receiptId_fkey')),
  'as FKs simples antigas saíram';
DO $$ BEGIN
  BEGIN UPDATE "Product" SET "categoryId" = 'fk_b_cat' WHERE "id" = 'fk_a_p'; RAISE EXCEPTION 'nao recusou'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
SELECT 'banco_recusa_categoria_de_outra_loja', (SELECT "categoryId" FROM "Product" WHERE "id" = 'fk_a_p') = 'fk_a_cat', 'foreign_key_violation e valor inalterado';
