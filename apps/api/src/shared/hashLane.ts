import os from "node:os";
import { ServerBusyError } from "./errors";

// SEC-34 — faixa de hash de senha ("hashLane"). O `bcrypt` nativo roda no threadpool do libuv (o mesmo de `dns.lookup`, `fs`, `crypto`): sem
// limite, 16 logins simultâneos ocupam as 4 threads e TODA requisição da API passa a esperar. A faixa limita quantos hashes rodam ao mesmo tempo e
// quantos esperam, e recusa o resto IMEDIATAMENTE com 503 `SERVER_BUSY` (melhor que derrubar a API inteira).
//
// Regras (Atlas, Nightingale, Sun Tzu R1–R7):
//  - EM VOO = min(UV_THREADPOOL_SIZE / 2, núcleos − 1), no mínimo 1 (`laneSize`). A sobra do threadpool fica para `dns.lookup`/`fs`.
//  - FILA com teto de 32 e espera máxima curta (~2 s): sem espera ilimitada. Estourou ⇒ recusa.
//  - JUSTIÇA: no máximo `maxPerKey` (2) pedidos por `clientKey()` somando os em execução e os na fila; uma origem sozinha nunca enche a faixa.
//  - A VAGA é devolvida em `finally` (erro dentro do hash, qualquer saída), uma única vez.
//  - A recusa é SEMPRE o mesmo `ServerBusyError` (corpo e `Retry-After` fixos): nada que dependa da conta, da profundidade da fila ou da chave.
//  - Quem espera aqui NÃO pode estar segurando transação nem conexão do banco (R2): o chamador adquire a faixa ANTES de abrir a transação.
export type HashLaneOptions = {
  inFlight: number;
  maxQueue: number;
  maxWaitMs: number;
  maxPerKey: number;
};

export type HashLaneStats = { ran: number; rejectedFull: number; rejectedKey: number; rejectedWait: number };

type Waiter = { key: string; grant: (release: () => void) => void; deny: (error: Error) => void; timer: NodeJS.Timeout };

/** Hashes em voo: metade do threadpool do libuv, nunca mais que núcleos − 1 e nunca menos que 1. */
export function laneSize(threadpoolSize: number = Number(process.env.UV_THREADPOOL_SIZE) || 4, cores: number = os.availableParallelism()): number {
  return Math.max(1, Math.min(Math.floor(threadpoolSize / 2), cores - 1));
}

export const HASH_LANE_QUEUE_MAX = 32;
export const HASH_LANE_WAIT_MAX_MS = 2000;
export const HASH_LANE_PER_KEY_MAX = 2;

export function defaultHashLaneOptions(): HashLaneOptions {
  return { inFlight: laneSize(), maxQueue: HASH_LANE_QUEUE_MAX, maxWaitMs: HASH_LANE_WAIT_MAX_MS, maxPerKey: HASH_LANE_PER_KEY_MAX };
}

export class HashLane {
  private running = 0;
  private readonly queue: Waiter[] = [];
  private readonly perKey = new Map<string, number>();
  readonly stats: HashLaneStats = { ran: 0, rejectedFull: 0, rejectedKey: 0, rejectedWait: 0 };
  private lastWarnAt = 0;

  constructor(
    readonly options: HashLaneOptions = defaultHashLaneOptions(),
    private readonly warn: (message: string) => void = (message) => console.warn(message),
  ) {}

  /** Em execução agora. */
  get active(): number {
    return this.running;
  }

  /** Esperando uma vaga. */
  get waiting(): number {
    return this.queue.length;
  }

  /** Executa `task` com uma vaga da faixa; a vaga volta em `finally`. Recusa com `ServerBusyError` ANTES de rodar a tarefa. */
  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const release = await this.acquire(key);
    try {
      return await task();
    } finally {
      release();
    }
  }

  private acquire(key: string): Promise<() => void> {
    const held = this.perKey.get(key) ?? 0;
    if (held >= this.options.maxPerKey) return this.refuse("rejectedKey");
    if (this.running < this.options.inFlight) {
      this.running += 1;
      this.perKey.set(key, held + 1);
      return Promise.resolve(this.releaser(key));
    }
    if (this.queue.length >= this.options.maxQueue) return this.refuse("rejectedFull");
    this.perKey.set(key, held + 1);
    return new Promise<() => void>((grant, deny) => {
      const waiter: Waiter = {
        key,
        grant,
        deny,
        timer: setTimeout(() => {
          const index = this.queue.indexOf(waiter);
          if (index === -1) return;
          this.queue.splice(index, 1);
          this.drop(key);
          this.stats.rejectedWait += 1;
          this.report();
          deny(new ServerBusyError());
        }, this.options.maxWaitMs),
      };
      waiter.timer.unref();
      this.queue.push(waiter);
    });
  }

  private refuse(counter: "rejectedFull" | "rejectedKey"): Promise<never> {
    this.stats[counter] += 1;
    this.report();
    return Promise.reject(new ServerBusyError());
  }

  private releaser(key: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.stats.ran += 1;
      this.running -= 1;
      this.drop(key);
      this.pump();
    };
  }

  private drop(key: string): void {
    const held = (this.perKey.get(key) ?? 1) - 1;
    if (held <= 0) this.perKey.delete(key);
    else this.perKey.set(key, held);
  }

  private pump(): void {
    while (this.running < this.options.inFlight && this.queue.length > 0) {
      const waiter = this.queue.shift() as Waiter;
      clearTimeout(waiter.timer);
      this.running += 1;
      waiter.grant(this.releaser(waiter.key));
    }
  }

  // Alerta de fila cheia (para o runbook): no máximo uma linha por minuto, só contagens, sem chave, IP, e-mail ou senha.
  private report(): void {
    const now = Date.now();
    if (now - this.lastWarnAt < 60_000) return;
    this.lastWarnAt = now;
    const { rejectedFull, rejectedKey, rejectedWait } = this.stats;
    this.warn(`[hashlane] pedidos recusados com 503 SERVER_BUSY (fila cheia: ${rejectedFull}, teto por origem: ${rejectedKey}, espera esgotada: ${rejectedWait}; acumulado desde o início)`);
  }
}

/** A faixa única do processo: TODO hash e conferência de senha da API passa por ela (há um teste de varredura que garante isso). */
export const hashLane = new HashLane();
