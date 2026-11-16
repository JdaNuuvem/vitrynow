// NG-05 / SEC-20 (ADR-0008 §8): limite de tentativas de login.
//
// Regras (decisão do Atlas, ST-32/ST-33):
//  1. A tentativa é RESERVADA NA ENTRADA, de forma síncrona (uma só passada pelo laço de eventos, sem `await`
//     entre conferir e contar). Antes, `check()` e `fail()` ficavam separados por um `await bcrypt`, e uma
//     rajada paralela passava toda pelo `check()` antes de qualquer `fail()` (ST-32). Reserva negada => 429
//     SEM testar a senha.
//  2. Limite ESTRITO por par (conta, IP): poucas tentativas por janela; estourou => bloqueio progressivo
//     (1 min, 2, 4, ... até 15 min) só para aquele par.
//  3. NÃO existe bloqueio duro por conta (ST-33): quem sabe o e-mail do dono não pode trancá-lo. O total por
//     conta só ATRASA (espera crescente) e dispara UM aviso por janela para o dono, e nunca impede um login
//     correto vindo de um IP que não estourou o próprio limite.
//  4. A chave é o e-mail normalizado, EXISTA ou NÃO a conta: nada aqui revela se ela existe.
//
// Em memória (uma instância da API no MVP). Com 2+ instâncias, mover as contagens para uma tabela com
// UPDATE atômico (mesmo contrato).

export type Reservation =
  | { allowed: true; delayMs: number; alertOwner: boolean }
  | { allowed: false; retryAfterSeconds: number };

type Pair = { attempts: number; windowStart: number; blockedUntil: number; strikes: number };
type Account = { attempts: number; windowStart: number; alertedAt: number };

export type ThrottleLimits = {
  pairAttempts: number; // tentativas por (conta, IP) por janela
  accountThreshold: number; // a partir daqui a conta passa a atrasar e avisar o dono
  delayStepMs: number; // atraso somado a cada tentativa acima do limiar
  delayMaxMs: number;
};

const WINDOW_MS = 15 * 60 * 1000;
const BASE_BLOCK_MS = 60 * 1000;
const MAX_BLOCK_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 20_000;

export class LoginThrottle {
  private readonly pairs = new Map<string, Pair>();
  private readonly accounts = new Map<string, Account>();

  constructor(
    private readonly limits: ThrottleLimits = { pairAttempts: 5, accountThreshold: 12, delayStepMs: 250, delayMaxMs: 5000 },
    private readonly now: () => number = () => Date.now(),
  ) {}

  static key(email: string): string {
    return email.trim().toLowerCase();
  }

  // SÍNCRONO de propósito: não pode haver `await` entre a decisão e a contagem.
  reserve(email: string, ip: string): Reservation {
    const t = this.now();
    const acc = LoginThrottle.key(email);
    const pk = `${acc}|${ip}`;
    if (this.pairs.size >= MAX_ENTRIES) this.sweep(t);

    let pair = this.pairs.get(pk);
    if (pair && pair.blockedUntil > t) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((pair.blockedUntil - t) / 1000)) };
    }
    if (!pair || t - pair.windowStart > WINDOW_MS) {
      pair = { attempts: 0, windowStart: t, blockedUntil: 0, strikes: pair && t - pair.windowStart <= WINDOW_MS * 4 ? pair.strikes : 0 };
      this.pairs.set(pk, pair);
    }
    if (pair.attempts >= this.limits.pairAttempts) {
      pair.strikes += 1;
      pair.blockedUntil = t + Math.min(BASE_BLOCK_MS * 2 ** (pair.strikes - 1), MAX_BLOCK_MS);
      pair.attempts = 0;
      pair.windowStart = t;
      return { allowed: false, retryAfterSeconds: Math.ceil((pair.blockedUntil - t) / 1000) };
    }
    pair.attempts += 1; // reserva: já conta, mesmo que a senha esteja certa (succeed() devolve)

    let account = this.accounts.get(acc);
    if (!account || t - account.windowStart > WINDOW_MS) {
      account = { attempts: 0, windowStart: t, alertedAt: account?.alertedAt ?? 0 };
      this.accounts.set(acc, account);
    }
    account.attempts += 1;

    let delayMs = 0;
    let alertOwner = false;
    if (account.attempts > this.limits.accountThreshold) {
      delayMs = Math.min((account.attempts - this.limits.accountThreshold) * this.limits.delayStepMs, this.limits.delayMaxMs);
      if (t - account.alertedAt > WINDOW_MS) {
        account.alertedAt = t;
        alertOwner = true;
      }
    }
    return { allowed: true, delayMs, alertOwner };
  }

  // Senha certa: devolve a reserva da conta e zera o par (o dono voltou). O que o atacante já gastou fica.
  succeed(email: string, ip: string): void {
    const acc = LoginThrottle.key(email);
    this.pairs.delete(`${acc}|${ip}`);
    const account = this.accounts.get(acc);
    if (account && account.attempts > 0) account.attempts -= 1;
  }

  // Memória limitada: e-mails inventados não crescem o mapa sem fim.
  private sweep(t: number): void {
    for (const [k, p] of this.pairs) if (p.blockedUntil <= t && t - p.windowStart > WINDOW_MS) this.pairs.delete(k);
    for (const [k, a] of this.accounts) if (t - a.windowStart > WINDOW_MS) this.accounts.delete(k);
    if (this.pairs.size >= MAX_ENTRIES) {
      const oldest = [...this.pairs.entries()].sort((x, y) => x[1].windowStart - y[1].windowStart).slice(0, Math.floor(MAX_ENTRIES / 4));
      for (const [k] of oldest) this.pairs.delete(k);
    }
    if (this.accounts.size >= MAX_ENTRIES) {
      const oldest = [...this.accounts.entries()].sort((x, y) => x[1].windowStart - y[1].windowStart).slice(0, Math.floor(MAX_ENTRIES / 4));
      for (const [k] of oldest) this.accounts.delete(k);
    }
  }
}
