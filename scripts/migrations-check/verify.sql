-- Conferência genérica pós-migração (vale para qualquer conjunto). Cada linha: nome | ok | detalhe.
-- Checks específicos de uma migração ficam em verify-<migração>.sql e só rodam quando ela está entre as NOVAS
-- (se a base já a contém, a fixture é semeada DEPOIS dela e o check não faria sentido).
SELECT 'migracoes_todas_concluidas',
       (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) = 0,
       (SELECT count(*) FROM _prisma_migrations)::text || ' aplicadas';
