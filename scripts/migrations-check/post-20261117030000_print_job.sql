-- Conferência da 20261117030000_print_job (API-12): a FK composta e o índice único Order(id, storeId) TÊM de proteger
-- o isolamento entre lojas NO BANCO (ADR-0009), e não só no código. Cada check tenta uma gravação proibida dentro de
-- um bloco com exceção e devolve t se o banco a RECUSOU. Usa só linhas próprias (prefixo pj_), desfeitas no fim.
-- Formato: nome|t/f|detalhe (como os demais post-*.sql).
CREATE TEMP TABLE _r (name text, ok boolean, det text);

INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES
  ('pj_s1','Loja PJ 1','loja-pj-1','9101', now()), ('pj_s2','Loja PJ 2','loja-pj-2','9102', now());
INSERT INTO "Order" ("id","storeId","code","type","status","updatedAt") VALUES ('pj_o1','pj_s1','0001','BALCAO','PENDENTE', now());

DO $$
DECLARE refused boolean;
BEGIN
  -- 1) job da loja 2 apontando para pedido da loja 1: o banco tem de recusar (FK composta)
  refused := false;
  BEGIN
    INSERT INTO "PrintJob" ("id","storeId","kind","orderId","updatedAt") VALUES ('pj_j_cross','pj_s2','ORDER_KITCHEN','pj_o1', now());
  EXCEPTION WHEN foreign_key_violation THEN refused := true; END;
  INSERT INTO _r VALUES ('fk_composta_recusa_job_de_outra_loja', refused, 'job da loja 2 com pedido da loja 1 deve violar a FK composta');

  -- 2) job da MESMA loja funciona (a FK não pode bloquear o uso normal)
  refused := true;
  BEGIN
    INSERT INTO "PrintJob" ("id","storeId","kind","orderId","updatedAt") VALUES ('pj_j_ok','pj_s1','ORDER_KITCHEN','pj_o1', now());
    refused := false;
  EXCEPTION WHEN OTHERS THEN refused := true; END;
  INSERT INTO _r VALUES ('job_da_mesma_loja_aceito', NOT refused, 'job da loja 1 com pedido da loja 1 deve ser aceito');

  -- 3) job sem pedido (TEST) funciona: orderId é opcional
  refused := true;
  BEGIN
    INSERT INTO "PrintJob" ("id","storeId","kind","updatedAt") VALUES ('pj_j_test','pj_s2','TEST', now());
    refused := false;
  EXCEPTION WHEN OTHERS THEN refused := true; END;
  INSERT INTO _r VALUES ('job_sem_pedido_aceito', NOT refused, 'job TEST sem orderId deve ser aceito');

  -- 4) dedupeKey único: o mesmo evento não gera dois jobs
  UPDATE "PrintJob" SET "dedupeKey" = 'pj-evento-1' WHERE "id" = 'pj_j_ok';
  refused := false;
  BEGIN
    INSERT INTO "PrintJob" ("id","storeId","kind","dedupeKey","updatedAt") VALUES ('pj_j_dup','pj_s1','TEST','pj-evento-1', now());
  EXCEPTION WHEN unique_violation THEN refused := true; END;
  INSERT INTO _r VALUES ('dedupeKey_unica', refused, 'segundo job com a mesma dedupeKey deve violar a unicidade');

  -- 5) apagar o pedido leva o job junto (ON DELETE CASCADE) e não deixa órfão
  DELETE FROM "Order" WHERE "id" = 'pj_o1';
  INSERT INTO _r VALUES ('cascata_apaga_job_do_pedido',
                         NOT EXISTS (SELECT 1 FROM "PrintJob" WHERE "orderId" = 'pj_o1'), 'sem job órfão depois de apagar o pedido');
END $$;

-- índice único Order(id, storeId) existe (é o alvo da FK composta)
INSERT INTO _r VALUES ('indice_unico_Order_id_storeId',
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='Order' AND indexname='Order_id_storeId_key'),
  'índice único usado pela FK composta');

-- limpeza das linhas de teste (cascata a partir de Store)
DELETE FROM "Store" WHERE "id" IN ('pj_s1','pj_s2');

SELECT name, CASE WHEN ok THEN 't' ELSE 'f' END, det FROM _r ORDER BY name;
