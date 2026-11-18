-- Conferência da 20261117130000_api56_categoria_obrigatoria sobre os dados de pre-20261117130000_api56_categoria_obrigatoria.sql.
-- A categoria "Sem categoria" é procurada POR NOME (não pelo id), para valer para qualquer implementação da migração.
CREATE TEMP TABLE _r (name text, ok boolean, det text);
CREATE TEMP VIEW _sc AS SELECT "id", "storeId", "position", "createdAt" FROM "Category" WHERE "name" = 'Sem categoria' AND "storeId" LIKE 'ct\_%';

INSERT INTO _r VALUES ('loja_A_orfaos_vao_para_sem_categoria_e_ficam_ocultos',
  (SELECT count(*) FROM "Product" p JOIN _sc c ON c."id" = p."categoryId" AND c."storeId" = 'ct_a' WHERE p."id" IN ('ct_pa1','ct_pa2') AND p."active" = false) = 2,
  'os 2 órfãos da loja A foram para a categoria "Sem categoria" e ficaram active=false');
INSERT INTO _r VALUES ('loja_A_posicao_da_nova_categoria_e_max_mais_1',
  (SELECT "position" FROM _sc WHERE "storeId" = 'ct_a') = 2, 'posição 2 = maior posição existente (1) + 1');
INSERT INTO _r VALUES ('loja_A_produto_categorizado_intacto',
  (SELECT "categoryId" = 'ct_a_cat1' AND "active" = true FROM "Product" WHERE "id" = 'ct_pa3'), 'quem já tinha categoria não muda nem some da vitrine');
INSERT INTO _r VALUES ('loja_B_sem_nenhuma_categoria_ganha_a_primeira',
  (SELECT "position" FROM _sc WHERE "storeId" = 'ct_b') = 0
  AND (SELECT p."active" = false AND p."categoryId" = (SELECT "id" FROM _sc WHERE "storeId" = 'ct_b') FROM "Product" p WHERE p."id" = 'ct_pb1'), 'posição 0 e órfão oculto');
INSERT INTO _r VALUES ('loja_C_sem_orfaos_nao_ganha_categoria',
  NOT EXISTS (SELECT 1 FROM _sc WHERE "storeId" = 'ct_c'), 'loja sem órfãos fica como estava');
INSERT INTO _r VALUES ('nenhum_produto_sem_categoria_sobrou',
  NOT EXISTS (SELECT 1 FROM "Product" WHERE "storeId" LIKE 'ct\_%' AND "categoryId" IS NULL), 'pronto para o NOT NULL do contract');
INSERT INTO _r VALUES ('nada_foi_apagado',
  (SELECT count(*) FROM "Product" WHERE "storeId" LIKE 'ct\_%') = 7, '7 produtos antes, 7 depois');
INSERT INTO _r VALUES ('isolamento_entre_lojas_categoria_na_loja_certa',
  NOT EXISTS (SELECT 1 FROM "Product" p JOIN "Category" c ON c."id" = p."categoryId" WHERE p."storeId" LIKE 'ct\_%' AND c."storeId" <> p."storeId"),
  'nenhum produto aponta para categoria de outra loja');

-- Loja D (decisão do Atlas): já tinha "Sem categoria" criada pelo dono => a migração REAPROVEITA, não cria outra.
INSERT INTO _r VALUES ('loja_D_reaproveita_a_categoria_do_dono_sem_duplicar',
  (SELECT count(*) FROM "Category" WHERE "storeId" = 'ct_d' AND "name" = 'Sem categoria') = 1
  AND (SELECT "categoryId" = 'ct_d_dono' AND "active" = false FROM "Product" WHERE "id" = 'ct_pd1'),
  'uma só "Sem categoria" na loja D (a do dono) e o órfão foi para ela, oculto');

-- Loja E: o id 'cat_sem_ct_e' já pertencia a OUTRA categoria ("Entradas"). A migração não pode ter abortado nem mexido nela.
INSERT INTO _r VALUES ('loja_E_colisao_de_id_nao_aborta_e_preserva_a_categoria_existente',
  (SELECT "name" FROM "Category" WHERE "id" = 'cat_sem_ct_e') = 'Entradas'
  AND (SELECT count(*) FROM _sc WHERE "storeId" = 'ct_e') = 1
  AND (SELECT p."active" = false AND p."categoryId" = (SELECT "id" FROM _sc WHERE "storeId" = 'ct_e') FROM "Product" p WHERE p."id" = 'ct_pe1'),
  '"Entradas" intacta; nasceu uma "Sem categoria" com outro id e o órfão foi para ela, oculto');

-- Idempotência: rodar de novo os MESMOS dois comandos da migração (versão sem id fixo) não pode mudar nada.
CREATE TEMP TABLE _antes AS SELECT (SELECT count(*) FROM "Category") AS cats, (SELECT count(*) FROM "Product" WHERE "active") AS ativos;
INSERT INTO "Category" ("id", "storeId", "name", "position", "createdAt")
SELECT gen_random_uuid()::text, s."id", 'Sem categoria',
       COALESCE((SELECT MAX(c."position") + 1 FROM "Category" c WHERE c."storeId" = s."id"), 0), CURRENT_TIMESTAMP
FROM "Store" s WHERE EXISTS (SELECT 1 FROM "Product" p WHERE p."storeId" = s."id" AND p."categoryId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Category" c WHERE c."storeId" = s."id" AND c."name" = 'Sem categoria');
UPDATE "Product" p SET "categoryId" = (SELECT c."id" FROM "Category" c WHERE c."storeId" = p."storeId" AND c."name" = 'Sem categoria' ORDER BY c."createdAt", c."id" LIMIT 1), "active" = false
WHERE p."categoryId" IS NULL;
INSERT INTO _r VALUES ('reexecutar_a_migracao_nao_muda_nada',
  (SELECT cats FROM _antes) = (SELECT count(*) FROM "Category") AND (SELECT ativos FROM _antes) = (SELECT count(*) FROM "Product" WHERE "active"),
  'segunda execução: mesmas categorias e mesmos produtos ativos');

DELETE FROM "Store" WHERE "id" LIKE 'ct\_%';
SELECT name, CASE WHEN ok IS NULL THEN 'n' WHEN ok THEN 't' ELSE 'f' END, det FROM _r ORDER BY name;
