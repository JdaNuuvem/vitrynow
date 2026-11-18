-- ANTES da 20261117150000_api07_pix_por_loja: pagamentos que já existiam (PIX da conta da plataforma) e que a migração NÃO pode tocar.
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('pa_s1','Loja PA 1','loja-pa-1','9501', now());
INSERT INTO "Order" ("id","storeId","code","type","status","updatedAt") VALUES
  ('pa_o1','pa_s1','0001','DELIVERY','CONCLUIDO', now()), ('pa_o2','pa_s1','0002','BALCAO','PENDENTE', now());
INSERT INTO "Payment" ("id","orderId","status","amountCents","updatedAt") VALUES
  ('pa_p1','pa_o1','APROVADO', 4500, now()), ('pa_p2','pa_o2','PENDENTE', 2500, now());
