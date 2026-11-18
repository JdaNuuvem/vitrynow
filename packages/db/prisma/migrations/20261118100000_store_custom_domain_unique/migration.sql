-- SEC-14 (ST-18): domínio próprio da loja passa a ser único e em minúsculas.
-- Antes era texto livre: normaliza e, se houver repetição, a loja MAIS ANTIGA fica com o domínio e as outras voltam a NULL (o lojista cadastra de novo).
UPDATE "Store" SET "customDomain" = NULLIF(lower(btrim("customDomain")), '') WHERE "customDomain" IS NOT NULL;
UPDATE "Store" s SET "customDomain" = NULL
 WHERE s."customDomain" IS NOT NULL
   AND EXISTS (SELECT 1 FROM "Store" o WHERE o."customDomain" = s."customDomain" AND (o."createdAt", o."id") < (s."createdAt", s."id"));
CREATE UNIQUE INDEX "Store_customDomain_key" ON "Store"("customDomain");
