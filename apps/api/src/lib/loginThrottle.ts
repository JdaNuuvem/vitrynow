// NG-05 / ST-03: bloqueio progressivo de login por conta e por conta+IP, além do rate limit por IP.
// Em memória (uma instância da API no MVP; com mais de uma, mover para Redis/banco — ADR-0008).
//
// Desenho:
//  - A chave é o e-mail normalizado, EXISTA ou NÃO: o bloqueio não revela se a conta existe.
//  - Duas contagens: por conta (limite alto, derruba brute force distribuído por muitos IPs) e por
//    conta+IP (limite baixo, derruba o atacante comum sem trancar o dono legítimo em outro IP).
//  - O bloqueio dobra a cada estouro (1 min, 2, 4, ... até 15 min) e some sozinho: no pior caso um
//    atacante atrapalha a conta por 15 min, nunca de vez.
//  - Login com a senha CERTA durante o bloqueio também é recusado (senão o bloqueio não adianta).

export type ThrottleDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type Entry = { failures: number; windowStart: number; blockedUntil: number; strikes: number };

const WINDOW_MS = 15 * 60 * 1000;
const MAX_BLOCK_MS = 15 * 60 * 1000;
const BASE_BLOCK_MS = 60 * 1000;
const MAX_ENTRIES = 20_000;

export class LoginThrottle {
  private readonly byAccount = new Map<string, Entry>();
  private readonly byAccountIp = new Map<string, Entry>();

  constructor(
    private readonly limits: { account: number; accountIp: number } = { account: 12, accountIp: 5 },
    private readonly now: () => number = () => Date.now(),
  ) {}

  static key(email: string): string {
    return email.trim().toLowerCase();
  }

  check(email: string, ip: string): ThrottleDecision {
    const t = this.now();
    const a = this.byAccount.get(LoginThrottle.key(email));
    const b = this.byAccountIp.get(`${LoginThrottle.key(email)}|${ip}`);
    const until = Math.max(a?.blockedUntil ?? 0, b?.blockedUntil ?? 0);
    if (until > t) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((until - t) / 1000)) };
    return { allowed: true };
  }

  fail(email: string, ip: string): void {
    this.bump(this.byAccount, LoginThrottle.key(email), this.limits.account);
    this.bump(this.byAccountIp, `${LoginThrottle.key(email)}|${ip}`, this.limits.accountIp);
  }

  // Senha certa zera só a contagem desta conta+IP e da conta (o dono voltou); o bloqueio ativo já foi
  // checado antes, então só chega aqui quem não estava bloqueado.
  succeed(email: string, ip: string): void {
    this.byAccount.delete(LoginThrottle.key(email));
    this.byAccountIp.delete(`${LoginThrottle.key(email)}|${ip}`);
  }

  private bump(map: Map<string, Entry>, key: string, limit: number): void {
    const t = this.now();
    if (map.size >= MAX_ENTRIES) this.sweep(map, t);
    let e = map.get(key);
    if (!e || t - e.windowStart > WINDOW_MS) {
      e = { failures: 0, windowStart: t, blockedUntil: e?.blockedUntil ?? 0, strikes: e && t - e.windowStart <= WINDOW_MS * 4 ? e.strikes : 0 };
      map.set(key, e);
    }
    e.failures += 1;
    if (e.failures >= limit) {
      e.strikes += 1;
      e.blockedUntil = t + Math.min(BASE_BLOCK_MS * 2 ** (e.strikes - 1), MAX_BLOCK_MS);
      e.failures = 0;
      e.windowStart = t;
    }
  }

  // Memória limitada: um atacante não consegue crescer o mapa sem fim com e-mails inventados.
  private sweep(map: Map<string, Entry>, t: number): void {
    for (const [k, e] of map) if (e.blockedUntil <= t && t - e.windowStart > WINDOW_MS) map.delete(k);
    if (map.size >= MAX_ENTRIES) {
      const oldest = [...map.entries()].sort((x, y) => x[1].windowStart - y[1].windowStart).slice(0, Math.floor(MAX_ENTRIES / 4));
      for (const [k] of oldest) map.delete(k);
    }
  }
}
