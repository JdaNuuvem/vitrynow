-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('PRATO', 'ADICIONAL');
-- CreateEnum
CREATE TYPE "SaleUnit" AS ENUM ('UN', 'KG', 'HG');
-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "listPriceCents" INTEGER,
ADD COLUMN     "pricePerKgCents" INTEGER,
ADD COLUMN     "weightGrams" INTEGER;
-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isSingleDish" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" "ProductKind" NOT NULL DEFAULT 'PRATO',
ADD COLUMN     "maxGrams" INTEGER NOT NULL DEFAULT 5000,
ADD COLUMN     "minGrams" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "portionGrams" INTEGER,
ADD COLUMN     "promoCents" INTEGER,
ADD COLUMN     "promoEndsAt" TIMESTAMP(3),
ADD COLUMN     "promoStartsAt" TIMESTAMP(3),
ADD COLUMN     "saleUnit" "SaleUnit" NOT NULL DEFAULT 'UN',
ADD COLUMN     "sellAlone" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "serves" INTEGER,
ADD COLUMN     "stepGrams" INTEGER NOT NULL DEFAULT 50;
