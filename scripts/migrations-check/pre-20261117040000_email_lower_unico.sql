-- Dados SEM conflito, mas com e-mail fora do padrão: a migração deve normalizar (minúsculas, sem espaços nas pontas).
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('em_s1','Loja EM','loja-em','9301', now());
INSERT INTO "User" ("id","storeId","email","passwordHash") VALUES
  ('em_u1','em_s1','  Dono.Misto@Exemplo.Invalid ','hash-1'),
  ('em_u2','em_s1','ja.minusculo@exemplo.invalid','hash-2');
