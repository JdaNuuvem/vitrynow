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
  "dish3d.poll": 7012n, // PRATO 3D
  "menu.revalidate": 7011n, // API-58 (lote 2): 7010 e do print.queue_watch (PC-24); o runner recusa lockKey repetido
} as const;

export type JobName = keyof typeof JOB_LOCK_KEYS;
