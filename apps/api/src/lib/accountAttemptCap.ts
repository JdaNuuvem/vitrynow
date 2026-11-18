// Teto de tentativas por CONTA, de qualquer IP (API-52a, condição do Atlas): a reautenticação de ação irreversível protege contra SESSÃO
// ROUBADA, e quem a tem troca de IP; a trava por (conta, IP) sozinha não basta. Mesma disciplina do login (ST-32): a tentativa é
// RESERVADA na entrada, de forma síncrona (sem `await` entre conferir e contar), então uma rajada paralela não passa do teto; a senha certa
// devolve a reserva. Estourou ⇒ recusa SEM testar a senha, mesmo certa, até a janela acabar.
//
// Em memória (uma instância da API no MVP). Com 2+ instâncias, mover a contagem para uma tabela com UPDATE atômico (mesmo contrato).
export class AccountAttemptCap {
  private readonly accounts = new Map<string, { attempts: number; windowStart: number }>();

  constructor(
    private readonly max = 10,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** SÍNCRONO. `allowed: false` quando a conta já gastou o teto na janela. */
  reserve(accountKey: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const t = this.now();
    let entry = this.accounts.get(accountKey);
    if (!entry || t - entry.windowStart >= this.windowMs) {
      entry = { attempts: 0, windowStart: t };
      this.accounts.set(accountKey, entry);
      if (this.accounts.size > 20_000) this.sweep(t);
    }
    if (entry.attempts >= this.max) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStart + this.windowMs - t) / 1000)) };
    entry.attempts += 1;
    return { allowed: true };
  }

  /** Senha certa: devolve a reserva (o dono voltou). O que o atacante já gastou fica. */
  succeed(accountKey: string): void {
    const entry = this.accounts.get(accountKey);
    if (entry && entry.attempts > 0) entry.attempts -= 1;
  }

  private sweep(t: number): void {
    for (const [key, entry] of this.accounts) if (t - entry.windowStart >= this.windowMs) this.accounts.delete(key);
  }
}
