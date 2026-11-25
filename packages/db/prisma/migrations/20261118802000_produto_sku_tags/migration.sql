-- CreateEnum
CREATE TYPE "ProductTag" AS ENUM ('VEGANO', 'VEGETARIANO', 'SEM_GLUTEN', 'SEM_LACTOSE', 'PICANTE', 'FIT');
-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "sku" TEXT,
ADD COLUMN     "tags" "ProductTag"[] DEFAULT ARRAY[]::"ProductTag"[];
-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_sku_key" ON "Product"("storeId", "sku");
