-- SEC-29 (ST-67): contador de e-mails de confirmação que não bateram, por token de redefinição. Só aditiva (coluna com padrão 0).
ALTER TABLE "PasswordResetToken" ADD COLUMN     "emailFailures" INTEGER NOT NULL DEFAULT 0;
