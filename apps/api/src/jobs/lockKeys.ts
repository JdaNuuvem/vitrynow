// Chaves de advisory lock dos jobs (ADR-0011 §3). Um único arquivo para que duas tarefas nunca
// escolham a mesma chave por acaso; o runner também recusa duplicatas no `register`.
// Reservadas para os jobs já previstos no ADR; o dono do job só importa a sua.
export const JOB_LOCK_KEYS = {
  "payment.reconcile": 7001n,
  "payment.expire": 7002n,
  "refund.retry": 7003n,
  "mp.token.refresh": 7004n,
  "subscription.transition": 7005n,
  "subscription.notices": 7006n,
  "schedule.release": 7007n,
  "message.outbox": 7008n,
  "tech.cleanup": 7009n,
  "print.queue_watch": 7010n,
  "menu.revalidate": 7011n, // era 7010n, o MESMO de print.queue_watch (PC-24 x API-58): o runner recusa chave repetida e a API não subia
} as const;

export type JobName = keyof typeof JOB_LOCK_KEYS;
