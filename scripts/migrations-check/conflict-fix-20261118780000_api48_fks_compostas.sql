-- O que o OPERADOR faz depois de ler o erro: decide manualmente (aqui, solta as referencias entre lojas); depois migrate resolve --rolled-back e novo deploy.
UPDATE "Product" SET "categoryId" = NULL WHERE "id" = 'fc_a_p';
UPDATE "Order" SET "delivererId" = NULL WHERE "id" = 'fc_a_o';
