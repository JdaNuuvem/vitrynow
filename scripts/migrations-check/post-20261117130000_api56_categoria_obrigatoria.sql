-- Conferência da 20261117130000_api56_categoria_obrigatoria sobre os dados de pre-20261117130000_api56_categoria_obrigatoria.sql.
CREATE TEMP TABLE _r (name text, ok boolean, det text);

INSERT INTO _r VALUES ('loja_A_orfaos_vao_para_sem_categoria_e_ficam_ocultos',
  (SELECT count(*) FROM "Product" WHERE "id" IN ('ct_pa1','ct_pa2') AND "categoryId" = 'cat_sem_ct_a' AND "active" = false) = 2,
  'os 2 órfãos da loja A foram para a categoria nova e ficaram active=false');
INSERT INTO _r VALUES ('loja_A_posicao_da_nova_categoria_e_max_mais_1',
  (SELECT "position" FROM "Category" WHERE "id" = 'cat_sem_ct_a') = 2, 'posição 2 = maior posição existente (1) + 1');
INSERT INTO _r VALUES ('loja_A_produto_categorizado_intacto',
  (SELECT "categoryId" = 'ct_a_cat1' AND "active" = true FROM "Product" WHERE "id" = 'ct_pa3'), 'quem já tinha categoria não muda nem some da vitrine');
INSERT INTO _r VALUES ('loja_B_sem_nenhuma_categoria_ganha_a_primeira',
  (SELECT "position" FROM "Category" WHERE "id" = 'cat_sem_ct_b') = 0
  AND (SELECT "categoryId" = 'cat_sem_ct_b' AND "active" = false FROM "Product" WHERE "id" = 'ct_pb1'), 'posição 0 e órfão oculto');
INSERT INTO _r VALUES ('loja_C_sem_orfaos_nao_ganha_categoria',
  NOT EXISTS (SELECT 1 FROM "Category" WHERE "id" = 'cat_sem_ct_c'), 'loja sem órfãos fica como estava');
INSERT INTO _r VALUES ('nenhum_produto_sem_categoria_sobrou',
  NOT EXISTS (SELECT 1 FROM "Product" WHERE "storeId" LIKE 'ct\_%' AND "categoryId" IS NULL), 'pronto para o NOT NULL do contract');
INSERT INTO _r VALUES ('nada_foi_apagado',
  (SELECT count(*) FROM "Product" WHERE "storeId" LIKE 'ct\_%') = 6, '6 produtos antes, 6 depois');
INSERT INTO _r VALUES ('isolamento_entre_lojas_categoria_nova_na_loja_certa',
  NOT EXISTS (SELECT 1 FROM "Product" p JOIN "Category" c ON c."id" = p."categoryId" WHERE p."storeId" LIKE 'ct\_%' AND c."storeId" <> p."storeId"),
  'nenhum produto aponta para categoria de outra loja');

-- Loja D: já tinha "Sem categoria" criada pelo dono. A migração cria OUTRA com o mesmo nome (não há unicidade por nome).
-- Não é falha de dados (nada se perde), mas o dono verá 2 categorias iguais: informativo (ok nulo => aparece como n/a).
INSERT INTO _r VALUES ('AVISO_loja_D_ficou_com_duas_categorias_Sem_categoria',
  CASE WHEN (SELECT count(*) FROM "Category" WHERE "storeId" = 'ct_d' AND "name" = 'Sem categoria') > 1 THEN NULL ELSE true END,
  'recomendação: reaproveitar a categoria existente com esse nome em vez de criar outra');
INSERT INTO _r VALUES ('loja_D_orfao_foi_para_a_categoria_criada_pela_migracao',
  (SELECT "categoryId" = 'cat_sem_ct_d' AND "active" = false FROM "Product" WHERE "id" = 'ct_pd1'), 'órfão da loja D oculto');

-- Idempotência: rodar de novo os MESMOS dois comandos da migração não pode mudar nada.
CREATE TEMP TABLE _antes AS SELECT (SELECT count(*) FROM "Category") AS cats, (SELECT count(*) FROM "Product" WHERE "active") AS ativos;
INSERT INTO "Category" ("id", "storeId", "name", "position", "createdAt")
SELECT 'cat_sem_' || s."id", s."id", 'Sem categoria',
       COALESCE((SELECT MAX(c."position") + 1 FROM "Category" c WHERE c."storeId" = s."id"), 0), CURRENT_TIMESTAMP
FROM "Store" s WHERE EXISTS (SELECT 1 FROM "Product" p WHERE p."storeId" = s."id" AND p."categoryId" IS NULL);
UPDATE "Product" p SET "categoryId" = 'cat_sem_' || p."storeId", "active" = false WHERE p."categoryId" IS NULL;
INSERT INTO _r VALUES ('reexecutar_a_migracao_nao_muda_nada',
  (SELECT cats FROM _antes) = (SELECT count(*) FROM "Category") AND (SELECT ativos FROM _antes) = (SELECT count(*) FROM "Product" WHERE "active"),
  'segunda execução: mesmas categorias e mesmos produtos ativos');

DELETE FROM "Store" WHERE "id" LIKE 'ct\_%';
SELECT name, CASE WHEN ok IS NULL THEN 'n' WHEN ok THEN 't' ELSE 'f' END, det FROM _r ORDER BY name;
