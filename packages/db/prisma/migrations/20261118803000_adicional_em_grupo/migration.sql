-- RN-PD-12: opção de grupo que aponta para um produto ADICIONAL da mesma loja (FK composta). Aditiva: opções antigas ficam OWN, sem produto.
-- CreateEnum
CREATE TYPE "OptionPriceSource" AS ENUM ('OWN', 'INHERIT');

-- AlterTable
ALTER TABLE "Option" ADD COLUMN     "priceSource" "OptionPriceSource" NOT NULL DEFAULT 'OWN',
ADD COLUMN     "productId" TEXT;

-- CreateIndex
CREATE INDEX "Option_productId_idx" ON "Option"("productId");

-- AddForeignKey (NO ACTION (como RESTRICT, mas só no fim do comando, para o cascade da loja funcionar): excluir adicional em uso é recusado também pelo banco; MATCH SIMPLE: sem productId não há vínculo)
ALTER TABLE "Option" ADD CONSTRAINT "Option_productId_storeId_fkey" FOREIGN KEY ("productId", "storeId") REFERENCES "Product"("id", "storeId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Integridade: herdar preço só faz sentido com produto ligado.
ALTER TABLE "Option" ADD CONSTRAINT "Option_inherit_needs_product_check" CHECK ("priceSource" = 'OWN' OR "productId" IS NOT NULL);
