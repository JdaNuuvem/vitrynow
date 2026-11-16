# Jobs no processo da API (ADR-0011)

Um `JobRunner` dentro da API, sem Redis nem cron. O estado fica no Postgres e cada job é idempotente e "por nível": acha **todo** o trabalho vencido e o processa, então tick perdido ou reinício se recuperam sozinhos.

## Como criar um job

1. Reserve (ou use) a chave em `lockKeys.ts`. As chaves do ADR-0011 §3 já estão lá.
2. Crie `meuJob.ts` exportando um `Job`:
   ```ts
   export const meuJob: Job = {
     name: "payment.expire",              // "dominio.acao"
     everyMs: 60_000,                     // >= 1000; o runner aplica jitter de ±10 %
     lockKey: JOB_LOCK_KEYS["payment.expire"],
     limit: 100,                          // itens por execução
     async runOnce({ now, db, log, limit }) {
       // 1) reivindicar o lote numa transação CURTA
       const claimed = await claimWithLock(db, JOB_LOCK_KEYS["payment.expire"], (tx) =>
         tx.$queryRaw`SELECT id FROM "..." WHERE <vencido em ${now}> LIMIT ${limit} FOR UPDATE SKIP LOCKED`);
       // 2) trabalho pesado / chamadas externas FORA da transação
       // 3) mudar estado com UPDATE ... WHERE estado = :esperado (idempotente)
       return { processed: 0 };
     },
     lagMs: async ({ now, db }) => null,  // opcional: idade do item vencido mais antigo
   };
   ```
3. Acrescente **uma linha** em `registry.ts` (`registeredJobs`). O teste `tests/jobs/registry.test.ts` confere nome, lock único e limites.

## Regras

- Use `ctx.now`, nunca `new Date()` solto. Dia calendário (avisos) no fuso da loja (`Store.timezone`).
- Exceção em um item não pode derrubar o lote; erro de job vira `job.fail` no log e o runner segue.
- **Nenhum job apaga dado de negócio.** `tech.cleanup` só limpa as tabelas da lista de permissão (`TECH_CLEANUP_ALLOWLIST`), protegida por teste.
- Testes: chame `runner.run("nome")` com relógio falso; cubra duas execuções concorrentes ⇒ um efeito e recuperação após atraso.

## Ambiente

| Variável | Efeito |
|---|---|
| `JOBS_ENABLED` | `false` desliga o runner. Padrão: ligado, **exceto** com `NODE_ENV=test`. |
| `JOBS_ONLY` | Lista separada por vírgula; só esses jobs agendam (depuração). |

`app.jobs.snapshot()` devolve, por job, última execução, duração, processados, atraso e falhas seguidas (para `/health` e métricas, INF-08).
