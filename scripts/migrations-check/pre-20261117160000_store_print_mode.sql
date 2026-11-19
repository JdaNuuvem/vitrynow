-- ANTES da 20261117160000_store_print_mode: lojas que já existiam e que a migração NÃO pode mudar de comportamento (todas devem virar LEGACY).
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES
  ('pm_s1','Loja PM 1','loja-pm-1','9601', now()), ('pm_s2','Loja PM 2','loja-pm-2','9602', now());
