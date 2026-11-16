-- NG-06 / ST-06 / R11: tokens de dispositivo e de redefinição de senha só com hash (SHA-256).
-- Backfill: chaves e links existentes continuam valendo (o app compara sha256(token enviado)).

-- DeviceToken
ALTER TABLE "DeviceToken" ADD COLUMN "tokenHash" TEXT, ADD COLUMN "tokenPreview" TEXT;
UPDATE "DeviceToken"
   SET "tokenHash" = encode(sha256(convert_to("token", 'UTF8')), 'hex'),
       "tokenPreview" = right("token", 4);
ALTER TABLE "DeviceToken" ALTER COLUMN "tokenHash" SET NOT NULL, ALTER COLUMN "tokenPreview" SET NOT NULL;
CREATE UNIQUE INDEX "DeviceToken_tokenHash_key" ON "DeviceToken"("tokenHash");
DROP INDEX "DeviceToken_token_key";
ALTER TABLE "DeviceToken" DROP COLUMN "token";

-- PasswordResetToken
ALTER TABLE "PasswordResetToken" RENAME COLUMN "token" TO "tokenHash";
UPDATE "PasswordResetToken" SET "tokenHash" = encode(sha256(convert_to("tokenHash", 'UTF8')), 'hex');
ALTER INDEX "PasswordResetToken_token_key" RENAME TO "PasswordResetToken_tokenHash_key";
