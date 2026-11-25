-- QR de mesa (API-22/24) já está entregue em routes/tables.ts: o recurso `table_qr` passa a constar nos planos.
-- Idempotente: só acrescenta a chave se ela ainda não estiver na lista.
UPDATE "Plan" SET "features" = array_append("features", 'table_qr')
WHERE "code" IN ('BASICO', 'PRO') AND NOT ('table_qr' = ANY("features"));
