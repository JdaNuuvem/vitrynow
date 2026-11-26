-- Desperdício: observação da perda, desfazer lançamento (uma vez só), agrupamento da perda de prato e validade do lote comprado.
ALTER TABLE "StockMovement" ADD COLUMN "note" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "groupId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "reversalOfId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "expiresOn" DATE;

CREATE UNIQUE INDEX "StockMovement_reversalOfId_key" ON "StockMovement"("reversalOfId");
CREATE INDEX "StockMovement_groupId_idx" ON "StockMovement"("groupId");

-- Só perda (WASTE/SPOILAGE) é desfeita, e a validade só existe em compra.
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reversal_loss_only" CHECK ("reversalOfId" IS NULL OR "type" IN ('WASTE', 'SPOILAGE'));
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_expiry_purchase_only" CHECK ("expiresOn" IS NULL OR "type" = 'PURCHASE');
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_note_len" CHECK ("note" IS NULL OR char_length("note") <= 200);
