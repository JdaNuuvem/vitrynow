-- SEC-28b (ST-65): marca o token cujo e-mail NÃO foi enviado, para a tentativa não gastar a cota de 3 pedidos por hora. Só aditiva (coluna anulável).
ALTER TABLE "PasswordResetToken" ADD COLUMN     "sendFailedAt" TIMESTAMP(3);
