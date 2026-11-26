-- Aditiva: produto antigo intacto; as tabelas novas nascem vazias; o banco recusa 2 vídeos ativos no mesmo produto.
SELECT 'produto_antigo_intacto', (SELECT "priceCents" = 2500 FROM "Product" WHERE "id" = 'rl_p'), 'produto nao muda';
SELECT 'tabelas_de_reels_vazias', (SELECT (SELECT count(*) FROM "Reel") = 0 AND (SELECT count(*) FROM "MediaJob") = 0 AND (SELECT count(*) FROM "ReelReport") = 0), 'nada migrado';
