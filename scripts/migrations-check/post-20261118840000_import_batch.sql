-- IMP-1: migração aditiva; o catálogo antigo fica idêntico e a tabela nova nasce vazia, com a FK por loja.
SELECT 'catalogo_antigo_intacto',
  (SELECT "priceCents" = 3000 AND "name" = 'Prato antigo' FROM "Product" WHERE "id" = 'imp_p'),
  'produto antigo não muda';
SELECT 'import_batch_nasce_vazia', (SELECT count(*) = 0 FROM "ImportBatch"), 'tabela nova sem linhas';
SELECT 'import_batch_fk_loja',
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ImportBatch_storeId_fkey'),
  'FK ImportBatch.storeId -> Store existe';
