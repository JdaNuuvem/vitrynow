-- Prato 3D: modelo GLB por produto (rascunho até publicar) e a fila de gerações no provedor externo.
ALTER TABLE "Product" ADD COLUMN "model3dUrl" TEXT;
ALTER TABLE "Product" ADD COLUMN "model3dPublished" BOOLEAN NOT NULL DEFAULT false;
-- Publicado exige modelo.
ALTER TABLE "Product" ADD CONSTRAINT "Product_model3d_published_has_url" CHECK (NOT "model3dPublished" OR "model3dUrl" IS NOT NULL);

CREATE TYPE "Dish3dStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "Dish3dJob" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "Dish3dStatus" NOT NULL DEFAULT 'RUNNING',
    "provider" TEXT NOT NULL,
    "providerRequestId" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "photoCount" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "modelKey" TEXT,
    "modelBytes" INTEGER,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Dish3dJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Dish3dJob_credits_check" CHECK ("credits" >= 0),
    CONSTRAINT "Dish3dJob_photos_check" CHECK ("photoCount" BETWEEN 1 AND 4),
    CONSTRAINT "Dish3dJob_error_len" CHECK ("error" IS NULL OR char_length("error") <= 60),
    -- Terminado tem data; sucesso tem modelo.
    CONSTRAINT "Dish3dJob_finished" CHECK (("status" = 'RUNNING') = ("finishedAt" IS NULL)),
    CONSTRAINT "Dish3dJob_success_has_model" CHECK ("status" <> 'SUCCEEDED' OR "modelKey" IS NOT NULL)
);

CREATE INDEX "Dish3dJob_status_nextCheckAt_idx" ON "Dish3dJob"("status", "nextCheckAt");
CREATE INDEX "Dish3dJob_storeId_productId_createdAt_idx" ON "Dish3dJob"("storeId", "productId", "createdAt");
-- No máximo UMA geração em andamento por produto (evita gastar crédito duas vezes com clique duplo).
CREATE UNIQUE INDEX "Dish3dJob_one_running_per_product" ON "Dish3dJob"("productId") WHERE "status" = 'RUNNING';

ALTER TABLE "Dish3dJob" ADD CONSTRAINT "Dish3dJob_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Dish3dJob" ADD CONSTRAINT "Dish3dJob_productId_storeId_fkey" FOREIGN KEY ("productId", "storeId") REFERENCES "Product"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- O PRO passa a listar o recurso (a rota ainda exige DISH3D_PROVIDER configurado).
UPDATE "Plan" SET "features" = array_append("features", 'dish_3d')
WHERE "code" = 'PRO' AND NOT ('dish_3d' = ANY("features"));
