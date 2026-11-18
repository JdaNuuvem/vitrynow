-- Conferência da 20261117150000_api07_pix_por_loja (PIX por loja). Prova no BANCO as regras de ADR-0001/0009: uma conta ativa por loja,
-- um vendedor do provedor em UMA só loja, histórico de contas desconectadas, state do OAuth único, e que os pagamentos antigos ficam intactos.
CREATE TEMP TABLE _r (name text, ok boolean, det text);

-- pagamentos que já existiam (pre): intactos, sem conta associada
INSERT INTO _r VALUES ('pagamentos_antigos_intactos',
  (SELECT count(*) FROM "Payment" WHERE "id" IN ('pa_p1','pa_p2') AND "paymentAccountId" IS NULL) = 2
  AND (SELECT "status"::text FROM "Payment" WHERE "id" = 'pa_p1') = 'APROVADO',
  '2 pagamentos antigos continuam, sem conta, com o mesmo status');

INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES
  ('pa_s2','Loja PA 2','loja-pa-2','9502', now()), ('pa_s3','Loja PA 3','loja-pa-3','9503', now());

DO $$
DECLARE refused boolean;
BEGIN
  -- 1) uma conta ATIVA por loja: a segunda CONNECTED na mesma loja é recusada pelo banco
  INSERT INTO "PaymentAccount" ("id","storeId","sellerUserId") VALUES ('pa_c1','pa_s1','vend-1');
  refused := false;
  BEGIN INSERT INTO "PaymentAccount" ("id","storeId","sellerUserId") VALUES ('pa_c1b','pa_s1','vend-1b');
  EXCEPTION WHEN unique_violation THEN refused := true; END;
  INSERT INTO _r VALUES ('uma_conta_ativa_por_loja', refused, 'segunda conta ativa na mesma loja viola o índice parcial');

  -- 2) NEEDS_RECONNECT também conta como ativa (status <> DISCONNECTED): reconectar exige desconectar a antiga antes
  UPDATE "PaymentAccount" SET "status" = 'NEEDS_RECONNECT' WHERE "id" = 'pa_c1';
  refused := false;
  BEGIN INSERT INTO "PaymentAccount" ("id","storeId","sellerUserId") VALUES ('pa_c1c','pa_s1','vend-1c');
  EXCEPTION WHEN unique_violation THEN refused := true; END;
  INSERT INTO _r VALUES ('needs_reconnect_ainda_ocupa_a_vaga', refused, 'conta em NEEDS_RECONNECT bloqueia uma nova: o fluxo precisa DESCONECTAR a antiga primeiro');

  -- 3) desconectada libera a vaga e vira histórico (várias desconectadas convivem)
  UPDATE "PaymentAccount" SET "status" = 'DISCONNECTED', "disconnectedAt" = now() WHERE "id" = 'pa_c1';
  refused := true;
  BEGIN
    INSERT INTO "PaymentAccount" ("id","storeId","sellerUserId") VALUES ('pa_c1d','pa_s1','vend-1d');
    INSERT INTO "PaymentAccount" ("id","storeId","sellerUserId","status") VALUES ('pa_c1e','pa_s1','vend-1e','DISCONNECTED');
    refused := false;
  EXCEPTION WHEN OTHERS THEN refused := true; END;
  INSERT INTO _r VALUES ('desconectada_libera_a_vaga_e_historico_convive', NOT refused, 'nova conta ativa + outra desconectada na mesma loja após desconectar a antiga');

  -- 4) um vendedor do provedor em UMA só loja ativa (anti-sequestro): vend-1d já está ativo na loja 1
  refused := false;
  BEGIN INSERT INTO "PaymentAccount" ("id","storeId","sellerUserId") VALUES ('pa_c2','pa_s2','vend-1d');
  EXCEPTION WHEN unique_violation THEN refused := true; END;
  INSERT INTO _r VALUES ('vendedor_em_uma_loja_so', refused, 'o mesmo vendedor em outra loja ativa viola o índice parcial (decisão D1-3; ver observação de produto)');
  -- ...e depois de desconectado numa loja, pode ir para outra
  UPDATE "PaymentAccount" SET "status" = 'DISCONNECTED' WHERE "id" = 'pa_c1d';
  refused := true;
  BEGIN INSERT INTO "PaymentAccount" ("id","storeId","sellerUserId") VALUES ('pa_c2b','pa_s2','vend-1d'); refused := false;
  EXCEPTION WHEN OTHERS THEN refused := true; END;
  INSERT INTO _r VALUES ('vendedor_desconectado_pode_ir_para_outra_loja', NOT refused, 'depois de desconectar, o vendedor pode conectar em outra loja');

  -- 5) Payment.paymentAccountId: FK aceita conta existente e recusa inexistente
  refused := false;
  BEGIN UPDATE "Payment" SET "paymentAccountId" = 'conta-que-nao-existe' WHERE "id" = 'pa_p2';
  EXCEPTION WHEN foreign_key_violation THEN refused := true; END;
  INSERT INTO _r VALUES ('payment_fk_recusa_conta_inexistente', refused, 'FK de Payment.paymentAccountId');
  UPDATE "Payment" SET "paymentAccountId" = 'pa_c2b' WHERE "id" = 'pa_p2';
  -- 6) apagar a conta NÃO apaga o pagamento (SET NULL): o histórico financeiro sobrevive
  DELETE FROM "PaymentAccount" WHERE "id" = 'pa_c2b';
  INSERT INTO _r VALUES ('apagar_conta_nao_apaga_pagamento',
    (SELECT count(*) FROM "Payment" WHERE "id" = 'pa_p2') = 1 AND (SELECT "paymentAccountId" FROM "Payment" WHERE "id" = 'pa_p2') IS NULL,
    'ON DELETE SET NULL: o pagamento fica, sem conta');

  -- 7) state do OAuth: único por hash (um state não pode ser reutilizado/duplicado)
  INSERT INTO "PaymentOAuthState" ("id","storeId","userId","sid","stateHash","expiresAt") VALUES ('pa_st1','pa_s1','u','s','hash-igual', now() + interval '10 minutes');
  refused := false;
  BEGIN INSERT INTO "PaymentOAuthState" ("id","storeId","userId","sid","stateHash","expiresAt") VALUES ('pa_st2','pa_s1','u','s','hash-igual', now() + interval '10 minutes');
  EXCEPTION WHEN unique_violation THEN refused := true; END;
  INSERT INTO _r VALUES ('state_oauth_unico_por_hash', refused, 'stateHash duplicado recusado');
END $$;

INSERT INTO _r VALUES ('indice_unico_PaymentAccount_id_storeId_existe',
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='PaymentAccount_id_storeId_key'), 'alvo de uma FK composta futura (isolamento por loja)');
-- OBSERVAÇÃO (informativa, ok nulo => n/a): PaymentOAuthState não tem FK para Store: apagar a loja deixa states até o job de limpeza.
INSERT INTO _r VALUES ('AVISO_PaymentOAuthState_sem_FK_para_Store', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'PaymentOAuthState' AND constraint_type = 'FOREIGN KEY') THEN true ELSE NULL END,
  'states orfãos até expirar: PaymentOAuthState precisa estar na allowlist do tech.cleanup (ADR-0011)');

DELETE FROM "PaymentOAuthState" WHERE "id" LIKE 'pa\_%';
DELETE FROM "Store" WHERE "id" LIKE 'pa\_s%';
SELECT name, CASE WHEN ok IS NULL THEN 'n' WHEN ok THEN 't' ELSE 'f' END, det FROM _r ORDER BY name;
