-- Conferência da 20261117160000_store_print_mode (modo de impressão por loja, ADR-0004 §8.12). Prova no BANCO: lojas existentes ficam
-- em LEGACY (nada muda para elas), loja nova sem informar nasce LEGACY, o enum só aceita LEGACY/QUEUE e a coluna não aceita NULL.
CREATE TEMP TABLE _r (name text, ok boolean, det text);

INSERT INTO _r VALUES ('lojas_existentes_ficam_LEGACY',
  (SELECT count(*) FROM "Store" WHERE "id" IN ('pm_s1','pm_s2') AND "printMode" = 'LEGACY') = 2,
  'as 2 lojas que já existiam viram LEGACY (comportamento atual preservado)');

INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('pm_s3','Loja PM 3','loja-pm-3','9603', now());
INSERT INTO _r VALUES ('loja_nova_sem_informar_nasce_LEGACY',
  (SELECT "printMode"::text FROM "Store" WHERE "id" = 'pm_s3') = 'LEGACY', 'DEFAULT LEGACY');

INSERT INTO _r VALUES ('enum_tem_exatamente_LEGACY_e_QUEUE',
  (SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'PrintMode') = 'LEGACY,QUEUE',
  'valores do enum PrintMode');

DO $$
DECLARE refused boolean;
BEGIN
  -- QUEUE é aceito e a loja pode voltar para LEGACY (a virada vale nos dois sentidos)
  UPDATE "Store" SET "printMode" = 'QUEUE' WHERE "id" = 'pm_s1';
  INSERT INTO _r VALUES ('queue_aceito', (SELECT "printMode"::text FROM "Store" WHERE "id" = 'pm_s1') = 'QUEUE', 'UPDATE para QUEUE');
  UPDATE "Store" SET "printMode" = 'LEGACY' WHERE "id" = 'pm_s1';
  INSERT INTO _r VALUES ('volta_para_LEGACY', (SELECT "printMode"::text FROM "Store" WHERE "id" = 'pm_s1') = 'LEGACY', 'UPDATE de volta para LEGACY');

  -- valor fora do enum é recusado pelo banco
  refused := false;
  BEGIN EXECUTE 'UPDATE "Store" SET "printMode" = ''TALVEZ'' WHERE "id" = ''pm_s2''';
  EXCEPTION WHEN invalid_text_representation THEN refused := true; END;
  INSERT INTO _r VALUES ('valor_fora_do_enum_recusado', refused, 'TALVEZ viola o enum');

  -- NULL é recusado (coluna NOT NULL)
  refused := false;
  BEGIN UPDATE "Store" SET "printMode" = NULL WHERE "id" = 'pm_s2';
  EXCEPTION WHEN not_null_violation THEN refused := true; END;
  INSERT INTO _r VALUES ('null_recusado', refused, 'coluna NOT NULL');
END $$;

DELETE FROM "Store" WHERE "id" LIKE 'pm\_s%';
SELECT name, CASE WHEN ok IS NULL THEN 'n' WHEN ok THEN 't' ELSE 'f' END, det FROM _r ORDER BY name;
