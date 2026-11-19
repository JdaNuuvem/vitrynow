-- Dados ANTES da 20261118830000_reels: loja e produto antigos (sem nenhuma tabela de vídeo). Tudo fictício.
INSERT INTO "Store" ("id","name","slug","code","updatedAt") VALUES ('rl_s','Loja Reels','loja-reels-mig','9801', now());
INSERT INTO "Product" ("id","storeId","name","priceCents") VALUES ('rl_p','rl_s','Prato antigo',2500);
