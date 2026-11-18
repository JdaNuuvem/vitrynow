-- Depois da 20261117040000_email_lower_unico sobre os dados de pre-20261117040000_email_lower_unico.sql.
CREATE TEMP TABLE _r (name text, ok boolean, det text);

INSERT INTO _r VALUES ('email_normalizado',
  (SELECT "email" FROM "User" WHERE "id" = 'em_u1') = 'dono.misto@exemplo.invalid',
  'caixa mista e espaços nas pontas viram minúsculo sem espaços');
INSERT INTO _r VALUES ('email_ja_minusculo_intacto',
  (SELECT "email" FROM "User" WHERE "id" = 'em_u2') = 'ja.minusculo@exemplo.invalid', 'e-mail já normalizado não muda');
INSERT INTO _r VALUES ('nenhuma_conta_apagada',
  (SELECT count(*) FROM "User" WHERE "id" IN ('em_u1','em_u2')) = 2, 'as duas contas continuam');
INSERT INTO _r VALUES ('indice_lower_email_existe',
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='User' AND indexname='User_email_lower_key'),
  'índice único por expressão lower(email)');

DO $$
DECLARE refused boolean := false;
BEGIN
  -- o ST-34 em si: VITIMA@ não pode coexistir com vitima@ (conta nova com a mesma caixa diferente)
  BEGIN
    INSERT INTO "User" ("id","storeId","email","passwordHash") VALUES ('em_u3','em_s1','DONO.MISTO@EXEMPLO.INVALID','hash-3');
  EXCEPTION WHEN unique_violation THEN refused := true; END;
  INSERT INTO _r VALUES ('indice_recusa_mesmo_email_em_outra_caixa', refused,
    'DONO.MISTO@... deve ser recusado porque dono.misto@... já existe (ST-34)');
END $$;

DELETE FROM "Store" WHERE "id" = 'em_s1';
SELECT name, CASE WHEN ok THEN 't' ELSE 'f' END, det FROM _r ORDER BY name;
