-- Prato 3D em tamanho real: medida informada pelo dono (largura) e a altura resultante, em milímetros
ALTER TABLE "Product" ADD COLUMN "model3dWidthMm" INTEGER, ADD COLUMN "model3dHeightMm" INTEGER;
