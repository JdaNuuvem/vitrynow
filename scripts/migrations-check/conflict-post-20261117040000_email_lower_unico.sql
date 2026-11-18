-- Depois da migração FALHAR sobre e-mails em conflito: NADA pode ter sido alterado (a migração roda numa transação).
SELECT 'nenhuma_conta_apagada',
       (SELECT count(*) FROM "User" WHERE "id" IN ('cf_u1','cf_u2','cf_u3')) = 3,
       'as 3 contas continuam existindo'
UNION ALL
SELECT 'emails_intactos_sem_normalizar',
       (SELECT string_agg("email", ',' ORDER BY "id") FROM "User" WHERE "id" IN ('cf_u1','cf_u2','cf_u3'))
         = 'VITIMA@exemplo.invalid,vitima@exemplo.invalid, Outro@Exemplo.Invalid ',
       'e-mails exatamente como estavam (a normalização do passo 2 foi desfeita junto com o passo 1)'
UNION ALL
SELECT 'indice_lower_nao_foi_criado',
       NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='User_email_lower_key'),
       'o índice só nasce no passo 3, depois dos conflitos resolvidos';
