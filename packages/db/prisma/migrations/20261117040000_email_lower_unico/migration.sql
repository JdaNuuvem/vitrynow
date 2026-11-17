-- SEC-20 / ST-34: e-mail normalizado e único sem diferenciar maiúsculas.
-- Expand/contract: (1) falha listando conflitos, SEM apagar nada; (2) normaliza; (3) cria o índice.
-- A migração roda numa transação: se o passo 1 levantar a exceção, nada foi alterado.
DO $$
DECLARE
  conflicts text;
BEGIN
  SELECT string_agg(e || ' (' || n || ' contas)', ', ' ORDER BY e)
    INTO conflicts
    FROM (SELECT lower(btrim("email")) AS e, count(*) AS n FROM "User" GROUP BY 1 HAVING count(*) > 1) c;
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'E-mails duplicados ao normalizar (resolva manualmente antes; nada foi alterado): %', conflicts;
  END IF;
END $$;

UPDATE "User" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));

CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower("email"));
