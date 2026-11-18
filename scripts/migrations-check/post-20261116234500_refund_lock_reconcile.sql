-- Conferência após 234500_refund_lock_reconcile sobre os dados de pre-234500_refund_lock_reconcile.sql.
SELECT 'refundLockedAt_preserva_data_da_solicitacao',
       (SELECT "refundLockedAt" = '2026-11-10 12:00:00' FROM "Order" WHERE "id"='o61'),
       'o61 congelado com a data real do estorno'
UNION ALL
SELECT 'refundLockedAt_sem_data_usa_now',
       (SELECT "refundLockedAt" IS NOT NULL AND "refundLockedAt" > now() - interval '5 minutes' FROM "Order" WHERE "id"='o62'),
       'o62 congelado mesmo sem refundRequestedAt'
UNION ALL
SELECT 'pagamento_aprovado_nao_congela',
       (SELECT "refundLockedAt" IS NULL FROM "Order" WHERE "id"='o63'),
       'o63 (APROVADO) continua livre'
UNION ALL
SELECT 'pedido_sem_pagamento_nao_congela',
       (SELECT "refundLockedAt" IS NULL FROM "Order" WHERE "id"='o64'),
       'o64 (sem pagamento) continua livre'
UNION ALL
SELECT 'so_dois_pedidos_congelados',
       (SELECT count(*) FROM "Order" WHERE "refundLockedAt" IS NOT NULL) = 2,
       'nenhum pedido a mais foi tocado'
UNION ALL
SELECT 'reconcileNote_nula_em_todos',
       (SELECT count(*) FROM "Payment" WHERE "reconcileNote" IS NOT NULL) = 0,
       'coluna nova entra vazia (expand)'
UNION ALL
SELECT 'status_dos_pagamentos_intactos',
       (SELECT string_agg("status"::text, ',' ORDER BY "id") FROM "Payment") = 'ESTORNO_PENDENTE,ESTORNO_PENDENTE,APROVADO',
       'a migração não muda status de pagamento';
