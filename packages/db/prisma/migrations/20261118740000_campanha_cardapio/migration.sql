-- CreateTable
CREATE TABLE "MenuCampaign" (
    "storeId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "draft" JSONB,
    "published" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MenuCampaign_pkey" PRIMARY KEY ("storeId")
);
-- AddForeignKey
ALTER TABLE "MenuCampaign" ADD CONSTRAINT "MenuCampaign_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
