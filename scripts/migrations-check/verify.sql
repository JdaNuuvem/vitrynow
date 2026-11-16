-- Conferências pós-migração sobre os dados de seed-main.sql. Cada linha: nome | ok | detalhe.
-- ok = NULL significa "não se aplica" (a migração correspondente não está no conjunto testado).
-- Usado por scripts/check-migrations.sh (-A -t -F '|').
WITH has(t, c) AS (SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public')
SELECT 'migracoes_todas_concluidas',
       (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) = 0,
       (SELECT count(*) FROM _prisma_migrations)::text || ' aplicadas'
UNION ALL
SELECT 'device_token_virou_hash_sha256',
       CASE WHEN EXISTS (SELECT 1 FROM has WHERE t='DeviceToken' AND c='tokenHash') THEN
         (SELECT count(*) FROM "DeviceToken" WHERE "id"='d1'
            AND "tokenHash" = encode(sha256(convert_to('tok-device-AAAA1234','UTF8')),'hex') AND "tokenPreview"='1234') = 1 END,
       'chave existente continua valendo (hash do token antigo)'
UNION ALL
SELECT 'reset_token_virou_hash_sha256',
       CASE WHEN EXISTS (SELECT 1 FROM has WHERE t='PasswordResetToken' AND c='tokenHash') THEN
         (SELECT count(*) FROM "PasswordResetToken" WHERE "id"='r1'
            AND "tokenHash" = encode(sha256(convert_to('reset-token-xyz','UTF8')),'hex')) = 1 END,
       'link de redefinição existente continua valendo'
UNION ALL
SELECT 'user_tokenVersion_comeca_em_0',
       CASE WHEN EXISTS (SELECT 1 FROM has WHERE t='User' AND c='tokenVersion') THEN
         (SELECT count(*) FROM "User" WHERE "tokenVersion" <> 0) = 0 END,
       'sessões existentes não são derrubadas'
UNION ALL
SELECT 'historico_seq_segue_createdAt',
       CASE WHEN EXISTS (SELECT 1 FROM has WHERE t='OrderStatusHistory' AND c='seq') THEN
         (SELECT array_agg("status"::text ORDER BY "seq") FROM "OrderStatusHistory" WHERE "orderId"='o1')
         = (SELECT array_agg("status"::text ORDER BY "createdAt") FROM "OrderStatusHistory" WHERE "orderId"='o1') END,
       'seq do histórico antigo deve respeitar a ordem do tempo'
UNION ALL
SELECT 'cancelado_antigo_ganha_canceledAt',
       CASE WHEN EXISTS (SELECT 1 FROM has WHERE t='Order' AND c='canceledAt') THEN
         (SELECT "canceledAt" IS NOT NULL FROM "Order" WHERE "id"='o1') AND (SELECT "canceledAt" IS NULL FROM "Order" WHERE "id"='o2') END,
       'o1 (cancelado) preenchido; o2 (em preparo) continua nulo'
UNION ALL
SELECT 'cancelado_antigo_cupom_marcado_tratado',
       CASE WHEN EXISTS (SELECT 1 FROM has WHERE t='Order' AND c='couponReleasedAt') THEN
         (SELECT "couponReleasedAt" IS NOT NULL FROM "Order" WHERE "id"='o1') END,
       'comentário da migração promete marcar o cupom como já tratado; sem isso um job pode devolver o cupom de novo'
UNION ALL
SELECT 'enum_OrderStatus_tem_SAIU_PARA_ENTREGA',
       CASE WHEN EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='HistoryKind') THEN
         EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='OrderStatus' AND e.enumlabel='SAIU_PARA_ENTREGA') END,
       'valor novo do enum presente';
