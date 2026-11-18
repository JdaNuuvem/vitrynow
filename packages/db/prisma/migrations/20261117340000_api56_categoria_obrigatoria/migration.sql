-- PROPOSTA (Hopper) para a API-56: mesma regra da versão atual (reaproveita "Sem categoria" que a loja já tenha; órfãos ficam
-- ocultos; nada é apagado), mas SEM id fixo derivado do id da loja. O id novo é um UUID gerado pelo banco (gen_random_uuid(),
-- nativo desde o Postgres 13), então não colide com nenhuma categoria existente, e o UPDATE acha a categoria POR NOME.
-- Fase CONTRACT (migração futura, depois do deploy da API nova): "Product"."categoryId" SET NOT NULL.

INSERT INTO "Category" ("id", "storeId", "name", "position", "createdAt")
SELECT gen_random_uuid()::text, s."id", 'Sem categoria',
       COALESCE((SELECT MAX(c."position") + 1 FROM "Category" c WHERE c."storeId" = s."id"), 0),
       CURRENT_TIMESTAMP
FROM "Store" s
WHERE EXISTS (SELECT 1 FROM "Product" p WHERE p."storeId" = s."id" AND p."categoryId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Category" c WHERE c."storeId" = s."id" AND c."name" = 'Sem categoria');

UPDATE "Product" p
SET "categoryId" = (
      SELECT c."id" FROM "Category" c
      WHERE c."storeId" = p."storeId" AND c."name" = 'Sem categoria'
      ORDER BY c."createdAt", c."id" LIMIT 1),
    "active" = false
WHERE p."categoryId" IS NULL;
