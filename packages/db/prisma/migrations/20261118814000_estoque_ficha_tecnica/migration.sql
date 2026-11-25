-- ESTOQUE E LUCRO (todos os planos): insumos, ficha técnica (produto e opção), movimentações imutáveis e CMV do pedido.
-- Gerado com prisma migrate diff (drift 0) + CHECKs de integridade no fim.
-- CreateEnum
CREATE TYPE "StockUnit" AS ENUM ('G', 'ML', 'UN');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'SALE', 'SALE_REVERSAL', 'WASTE', 'SPOILAGE', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cogsCents" INTEGER,
ADD COLUMN     "stockDeductedAt" TIMESTAMP(3),
ADD COLUMN     "stockReversedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "cogsCents" INTEGER;

-- AlterTable
ALTER TABLE "OrderItemOption" ADD COLUMN     "optionId" TEXT;

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "StockUnit" NOT NULL,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "minStockQty" INTEGER,
    "unitCostMillicents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "RecipeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionRecipeItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "OptionRecipeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCostMillicents" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL,
    "orderId" TEXT,
    "reason" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ingredient_storeId_idx" ON "Ingredient"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_storeId_name_key" ON "Ingredient"("storeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_id_storeId_key" ON "Ingredient"("id", "storeId");

-- CreateIndex
CREATE INDEX "RecipeItem_storeId_idx" ON "RecipeItem"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeItem_productId_ingredientId_key" ON "RecipeItem"("productId", "ingredientId");

-- CreateIndex
CREATE INDEX "OptionRecipeItem_storeId_idx" ON "OptionRecipeItem"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "OptionRecipeItem_optionId_ingredientId_key" ON "OptionRecipeItem"("optionId", "ingredientId");

-- CreateIndex
CREATE INDEX "StockMovement_storeId_createdAt_idx" ON "StockMovement"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_storeId_type_createdAt_idx" ON "StockMovement"("storeId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_ingredientId_createdAt_idx" ON "StockMovement"("ingredientId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_orderId_idx" ON "StockMovement"("orderId");

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_productId_storeId_fkey" FOREIGN KEY ("productId", "storeId") REFERENCES "Product"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_ingredientId_storeId_fkey" FOREIGN KEY ("ingredientId", "storeId") REFERENCES "Ingredient"("id", "storeId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionRecipeItem" ADD CONSTRAINT "OptionRecipeItem_optionId_storeId_fkey" FOREIGN KEY ("optionId", "storeId") REFERENCES "Option"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionRecipeItem" ADD CONSTRAINT "OptionRecipeItem_ingredientId_storeId_fkey" FOREIGN KEY ("ingredientId", "storeId") REFERENCES "Ingredient"("id", "storeId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_ingredientId_storeId_fkey" FOREIGN KEY ("ingredientId", "storeId") REFERENCES "Ingredient"("id", "storeId") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Integridade: ficha técnica com quantidade positiva; custo nunca negativo; movimentação nunca zerada; motivo só nos lançamentos manuais.
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "OptionRecipeItem" ADD CONSTRAINT "OptionRecipeItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_cost_nonneg" CHECK ("unitCostMillicents" >= 0 AND ("minStockQty" IS NULL OR "minStockQty" >= 0));
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_quantity_nonzero" CHECK ("quantity" <> 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_order_link" CHECK (("type" IN ('SALE', 'SALE_REVERSAL')) = ("orderId" IS NOT NULL));
