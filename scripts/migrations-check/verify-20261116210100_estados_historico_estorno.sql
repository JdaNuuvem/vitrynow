-- Backfills da 20261116210100 sobre os dados de seed-main.sql (semeados ANTES dela).
SELECT 'historico_seq_segue_createdAt',
       (SELECT array_agg("status"::text ORDER BY "seq") FROM "OrderStatusHistory" WHERE "orderId"='o1')
       = (SELECT array_agg("status"::text ORDER BY "createdAt") FROM "OrderStatusHistory" WHERE "orderId"='o1'),
       'seq do histórico antigo deve respeitar a ordem do tempo'
UNION ALL
SELECT 'cancelado_antigo_ganha_canceledAt',
       (SELECT "canceledAt" IS NOT NULL FROM "Order" WHERE "id"='o1') AND (SELECT "canceledAt" IS NULL FROM "Order" WHERE "id"='o2'),
       'o1 (cancelado) preenchido; o2 (em preparo) continua nulo'
UNION ALL
SELECT 'cancelado_antigo_cupom_marcado_tratado',
       (SELECT "couponReleasedAt" IS NOT NULL FROM "Order" WHERE "id"='o1'),
       'couponReleasedAt é a trava de idempotência da devolução: sem isso o cupom do cancelado antigo pode ser devolvido em dobro';
