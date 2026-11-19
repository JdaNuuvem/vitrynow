-- Dados de teste no schema ATUAL da MAIN (antes das migrações novas), para provar os backfills.
-- ATENÇÃO: esta fixture segue o schema da main. Quando um merge mudar uma tabela usada aqui, atualize-a
-- (o verificador avisa "fixture desatualizada" se o INSERT falhar). Última revisão: main com NG-06 (tokens só com hash).
-- Tudo fictício. Usado por scripts/check-migrations.sh.
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('s1','Loja Fixture','loja-fixture','9001', now());
INSERT INTO "User" ("id","storeId","email","passwordHash") VALUES ('u1','s1','fixture@exemplo.invalid','hash-fixture');

INSERT INTO "DeviceToken" ("id","storeId","tokenHash","tokenPreview","label") VALUES ('d1','s1',encode(sha256(convert_to('tok-device-AAAA1234','UTF8')),'hex'),'1234','PC fixture');
INSERT INTO "PasswordResetToken" ("id","userId","tokenHash","expiresAt") VALUES ('r1','u1',encode(sha256(convert_to('reset-token-xyz','UTF8')),'hex'), now() + interval '1 day');

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

-- Cupons LEGADOS que a regra nova do Leonardo (CA-CP-01..12) não aceitaria no cadastro: percentual acima de 100, 100% sem
-- limite de usos, fixo zero, código curto demais, validade já passada. Qualquer migração futura que restrinja cupom (CHECK,
-- NOT NULL, índice) roda sobre eles no S3/S4: tem de NEUTRALIZAR (ex.: active=false) e nunca falhar nem apagar.
INSERT INTO "Coupon" ("id","storeId","code","discountType","discountValue","maxUses","usedCount","active") VALUES
  ('c_leg150','s1','LEGADO150','PERCENT',150,NULL,0,true),
  ('c_leg100','s1','LEGADO100','PERCENT',100,NULL,3,true),
  ('c_legfix0','s1','LEGFIXO0','FIXED',0,NULL,0,true),
  ('c_legcurto','s1','AB','PERCENT',10,5,0,true);
INSERT INTO "Coupon" ("id","storeId","code","discountType","discountValue","maxUses","usedCount","active","expiresAt")
  VALUES ('c_legvenc','s1','LEGVENCIDO','PERCENT',20,NULL,1,true, now() - interval '30 days');
