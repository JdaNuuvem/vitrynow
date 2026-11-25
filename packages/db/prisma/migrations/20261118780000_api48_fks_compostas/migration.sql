-- API-48 (ADR-0009 §1.1, D-T2): FKs COMPOSTAS (id, storeId) nas relacoes entre tabelas de loja que ainda usavam FK simples. O banco passa a recusar
-- referencia entre lojas (Product->Category, Order->Coupon/Deliverer/Receipt, ReceiptPayment->Receipt) mesmo que um bug esqueca o filtro por loja.
-- Passo 1: se ja existe referencia entre lojas, a migracao FALHA listando quantas por relacao e NAO altera nada (roda numa transacao; nunca apaga nem corrige dado:
-- o operador decide). Passo 2: indices unicos (id, storeId), alvo das FKs. Passo 3: troca das FKs. A exclusao de cupom/entregador passa a zerar o vinculo
-- no servico (a FK composta nao pode anular `storeId`).
DO $$
DECLARE
  found text;
BEGIN
  SELECT string_agg(rel || '=' || n, ', ' ORDER BY rel) INTO found FROM (
    SELECT 'Product.categoryId' AS rel, count(*) AS n FROM "Product" p JOIN "Category" c ON c."id" = p."categoryId" WHERE c."storeId" <> p."storeId"
    UNION ALL SELECT 'Order.couponId', count(*) FROM "Order" o JOIN "Coupon" c ON c."id" = o."couponId" WHERE c."storeId" <> o."storeId"
    UNION ALL SELECT 'Order.delivererId', count(*) FROM "Order" o JOIN "Deliverer" d ON d."id" = o."delivererId" WHERE d."storeId" <> o."storeId"
    UNION ALL SELECT 'Order.receiptId', count(*) FROM "Order" o JOIN "Receipt" r ON r."id" = o."receiptId" WHERE r."storeId" <> o."storeId"
    UNION ALL SELECT 'ReceiptPayment.receiptId', count(*) FROM "ReceiptPayment" rp JOIN "Receipt" r ON r."id" = rp."receiptId" WHERE r."storeId" <> rp."storeId"
  ) t WHERE n > 0;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'FKs compostas (API-48): referencias entre lojas encontradas (resolva manualmente antes; nada foi alterado): %', found;
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_couponId_fkey";
-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_delivererId_fkey";
-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_receiptId_fkey";
-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_categoryId_fkey";
-- DropForeignKey
ALTER TABLE "ReceiptPayment" DROP CONSTRAINT "ReceiptPayment_receiptId_fkey";
-- CreateIndex
CREATE UNIQUE INDEX "Category_id_storeId_key" ON "Category"("id", "storeId");
-- CreateIndex
CREATE UNIQUE INDEX "Coupon_id_storeId_key" ON "Coupon"("id", "storeId");
-- CreateIndex
CREATE UNIQUE INDEX "Deliverer_id_storeId_key" ON "Deliverer"("id", "storeId");
-- CreateIndex
CREATE UNIQUE INDEX "Receipt_id_storeId_key" ON "Receipt"("id", "storeId");
-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_storeId_fkey" FOREIGN KEY ("categoryId", "storeId") REFERENCES "Category"("id", "storeId") ON DELETE NO ACTION ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_couponId_storeId_fkey" FOREIGN KEY ("couponId", "storeId") REFERENCES "Coupon"("id", "storeId") ON DELETE NO ACTION ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_delivererId_storeId_fkey" FOREIGN KEY ("delivererId", "storeId") REFERENCES "Deliverer"("id", "storeId") ON DELETE NO ACTION ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_receiptId_storeId_fkey" FOREIGN KEY ("receiptId", "storeId") REFERENCES "Receipt"("id", "storeId") ON DELETE NO ACTION ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ReceiptPayment" ADD CONSTRAINT "ReceiptPayment_receiptId_storeId_fkey" FOREIGN KEY ("receiptId", "storeId") REFERENCES "Receipt"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;
