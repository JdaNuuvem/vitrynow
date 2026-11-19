-- Depois de a migracao FALHAR: NADA foi alterado nem apagado e as FKs compostas nao foram criadas (transacao desfeita).
SELECT 'nada_apagado_nem_alterado',
  (SELECT "categoryId" FROM "Product" WHERE "id" = 'fc_a_p') = 'fc_b_cat' AND (SELECT "delivererId" FROM "Order" WHERE "id" = 'fc_a_o') = 'fc_b_d',
  'as referencias entre lojas continuam como estavam (a migracao nunca corrige dado)'
UNION ALL
SELECT 'fks_compostas_nao_criadas',
  NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('Product_categoryId_storeId_fkey','Order_delivererId_storeId_fkey')),
  'a migracao desfez tudo';
