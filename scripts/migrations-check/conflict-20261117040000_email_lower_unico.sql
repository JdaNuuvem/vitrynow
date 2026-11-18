-- Dados que a 20261117040000_email_lower_unico NÃO pode normalizar: duas contas cujo e-mail só difere em maiúsculas/espaços
-- (VITIMA@x.com e vitima@x.com; mais um terceiro limpo). Tudo fictício.
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('cf_s1','Loja CF','loja-cf','9201', now());
INSERT INTO "User" ("id","storeId","email","passwordHash") VALUES
  ('cf_u1','cf_s1','VITIMA@exemplo.invalid','hash-1'),
  ('cf_u2','cf_s1','vitima@exemplo.invalid','hash-2'),
  ('cf_u3','cf_s1',' Outro@Exemplo.Invalid ','hash-3');
