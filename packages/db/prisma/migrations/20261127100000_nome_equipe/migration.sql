-- Nome de exibição da equipe (garçom no salão, listas do painel). Opcional; vazio = parte do e-mail antes do @.
ALTER TABLE "User" ADD COLUMN "displayName" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_displayName_len" CHECK ("displayName" IS NULL OR char_length("displayName") BETWEEN 1 AND 40);
