-- API-17 (B11): "Esgotado hoje". Aditiva. soldOutUntil NULL com soldOut = true significa "até eu reativar".
ALTER TABLE "Product" ADD COLUMN "soldOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "soldOutUntil" TIMESTAMP(3);
ALTER TABLE "Store" ADD COLUMN "hideSoldOutProducts" BOOLEAN NOT NULL DEFAULT false;
