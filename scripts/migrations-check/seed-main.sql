-- Dados de teste no schema da MAIN (antes das migrações novas), para provar os backfills.
-- Tudo fictício. Usado por scripts/check-migrations.sh.
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('s1','Loja Fixture','loja-fixture','9001', now());
INSERT INTO "User" ("id","storeId","email","passwordHash") VALUES ('u1','s1','fixture@exemplo.invalid','hash-fixture');

INSERT INTO "DeviceToken" ("id","storeId","token","label") VALUES ('d1','s1','tok-device-AAAA1234','PC fixture');
INSERT INTO "PasswordResetToken" ("id","userId","token","expiresAt") VALUES ('r1','u1','reset-token-xyz', now() + interval '1 day');

INSERT INTO "Coupon" ("id","storeId","code","discountType","discountValue","maxUses","usedCount")
VALUES ('c1','s1','PROMO10','PERCENT',10,5,1);

-- o1: pedido já CANCELADO que usou cupom. Histórico inserido de propósito FORA da ordem do tempo
-- (CANCELADO antes de PENDENTE na ordem física), para provar se o backfill do "seq" segue o createdAt.
INSERT INTO "Order" ("id","storeId","code","type","status","couponId","updatedAt") VALUES ('o1','s1','0001','DELIVERY','CANCELADO','c1', now());
INSERT INTO "OrderStatusHistory" ("id","orderId","status","createdAt") VALUES ('h1b','o1','CANCELADO', now() - interval '1 hour');
INSERT INTO "OrderStatusHistory" ("id","orderId","status","createdAt") VALUES ('h1a','o1','PENDENTE',   now() - interval '2 hour');

-- o2: pedido em andamento (não pode ganhar canceledAt)
INSERT INTO "Order" ("id","storeId","code","type","status","updatedAt") VALUES ('o2','s1','0002','BALCAO','EM_PREPARO', now());
INSERT INTO "OrderStatusHistory" ("id","orderId","status") VALUES ('h2a','o2','PENDENTE'), ('h2b','o2','EM_PREPARO');
