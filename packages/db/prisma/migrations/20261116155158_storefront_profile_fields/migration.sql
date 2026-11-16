-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "address" TEXT,
ADD COLUMN     "coverImageUrl" TEXT,
ADD COLUMN     "deliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "minOrderCents" INTEGER,
ADD COLUMN     "openingHours" TEXT,
ADD COLUMN     "pickupEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "whatsapp" TEXT;
