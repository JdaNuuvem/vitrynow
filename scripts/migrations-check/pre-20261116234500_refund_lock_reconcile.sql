-- Dados no schema INTERMEDIÁRIO (já com 210000/210100 aplicadas, antes de 234500_refund_lock_reconcile).
-- Cenário: 3 pedidos e 3 pagamentos em estados diferentes. Tudo fictício.
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('s6','Loja S6','loja-s6','9006', now());

-- o61: estorno em andamento COM data de solicitação  -> deve ser congelado com ESTA data
INSERT INTO "Order" ("id","storeId","code","type","status","updatedAt") VALUES ('o61','s6','0001','DELIVERY','CANCELADO', now());
INSERT INTO "Payment" ("id","orderId","status","amountCents","refundRequestedAt","updatedAt")
VALUES ('p61','o61','ESTORNO_PENDENTE', 5000, '2026-11-10 12:00:00', now());

-- o62: estorno em andamento SEM data de solicitação -> congelado com now() (nunca nulo)
INSERT INTO "Order" ("id","storeId","code","type","status","updatedAt") VALUES ('o62','s6','0002','BALCAO','EM_PREPARO', now());
INSERT INTO "Payment" ("id","orderId","status","amountCents","updatedAt") VALUES ('p62','o62','ESTORNO_PENDENTE', 3000, now());

-- o63: pagamento aprovado normal -> NÃO pode ser congelado
INSERT INTO "Order" ("id","storeId","code","type","status","updatedAt") VALUES ('o63','s6','0003','DELIVERY','CONFIRMADO', now());
INSERT INTO "Payment" ("id","orderId","status","amountCents","updatedAt") VALUES ('p63','o63','APROVADO', 4000, now());

-- o64: pedido sem pagamento (dinheiro) -> NÃO pode ser congelado
INSERT INTO "Order" ("id","storeId","code","type","status","updatedAt") VALUES ('o64','s6','0004','BALCAO','PENDENTE', now());
