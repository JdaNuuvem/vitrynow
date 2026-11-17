-- API-56 (PRD-13, RN-CT-07): produto passa a exigir categoria. Fase EXPAND: só dados.
-- Produto sem categoria NUNCA aparecia na vitrine (o menu é montado por categoria). Para não mudar o que o cliente vê,
-- cada loja com produto órfão ganha a categoria "Sem categoria" e os órfãos vão para ela como OCULTOS (active = false):
-- o dono decide depois o que publicar. Nada é apagado.
-- Se a loja JÁ tem uma categoria chamada "Sem categoria" (criada pelo dono), ela é reaproveitada (decisão do Atlas):
-- o painel não mostra duas iguais.
-- Fase CONTRACT (migração futura, depois do deploy da API nova): "Product"."categoryId" SET NOT NULL.

INSERT INTO "Category" ("id", "storeId", "name", "position", "createdAt")
SELECT 'cat_sem_' || s."id", s."id", 'Sem categoria',
       COALESCE((SELECT MAX(c."position") + 1 FROM "Category" c WHERE c."storeId" = s."id"), 0),
       CURRENT_TIMESTAMP
FROM "Store" s
WHERE EXISTS (SELECT 1 FROM "Product" p WHERE p."storeId" = s."id" AND p."categoryId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Category" c WHERE c."storeId" = s."id" AND c."name" = 'Sem categoria');

UPDATE "Product" p
SET "categoryId" = COALESCE(
      (SELECT c."id" FROM "Category" c WHERE c."storeId" = p."storeId" AND c."name" = 'Sem categoria' ORDER BY c."createdAt", c."id" LIMIT 1),
      'cat_sem_' || p."storeId"),
    "active" = false
WHERE p."categoryId" IS NULL;
