-- O que o OPERADOR faz depois de ler o erro da migração: decidir manualmente qual conta fica (aqui, renomeia a duplicada;
-- o produto decide se funde ou apaga, a migração nunca apaga nada). Depois: prisma migrate resolve --rolled-back <nome> e novo deploy.
UPDATE "User" SET "email" = 'vitima.2@exemplo.invalid' WHERE "id" = 'cf_u2';
