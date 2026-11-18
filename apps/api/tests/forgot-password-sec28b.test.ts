import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import * as emailLib from "../src/lib/email";
import { FORGOT_MIN_DURATION_MS, RESET_COOLDOWN_MS, RESET_MAX_ATTEMPTS_PER_HOUR, RESET_MAX_PER_HOUR, floorExceeded, issueResetToken, markResetSendFailed, padToMinimum, resetFloorStats } from "../src/lib/passwordReset";
import { makeApp, registerStore, resetDb } from "./helpers";

// SEC-28b (ST-64, ST-65, ST-66; Sun Tzu): (1) conta existente, inexistente e limitada executam a MESMA sequência de instruções no banco (o piso de
// tempo só esconde a diferença enquanto ela cabe nele); (2) pedido cujo e-mail NÃO saiu não gasta a cota nem o intervalo; (3) o e-mail novo diz
// que vale o link mais recente.

const provider = vi.hoisted(() => ({ error: null as unknown, calls: 0 }));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async () => {
        provider.calls += 1;
        return { error: provider.error };
      },
    };
  },
}));

let ipSeq = 0;
const nextIp = () => `10.78.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

// Registra cada ida ao banco que o `issueResetToken` faz DENTRO da transação (a consulta do usuário, antes dela, é a mesma em todo caminho),
// na ordem. Patch manual e restaurado no `finally`: o delegado `prisma.user` é um Proxy do Prisma e não aceita `vi.spyOn`.
async function withTrace<T>(trace: string[], fn: () => Promise<T>): Promise<T> {
  const wrap = (target: object, path: string): object =>
    new Proxy(target, {
      get(t, prop, receiver) {
        const value = Reflect.get(t, prop, receiver);
        const name = `${path}.${String(prop)}`;
        if (typeof value === "function") {
          return (...args: unknown[]) => {
            trace.push(name);
            return (value as (...a: unknown[]) => unknown).apply(t, args);
          };
        }
        if (value && typeof value === "object" && !(value instanceof Date)) return wrap(value as object, name);
        return value;
      },
    });
  const holder = prisma as unknown as { $transaction: (fn: (tx: unknown) => unknown, options?: unknown) => Promise<unknown> };
  const original = holder.$transaction;
  holder.$transaction = ((fn2: (tx: unknown) => unknown, options?: unknown) => original.call(prisma, (tx: unknown) => fn2(wrap(tx as object, "tx")), options)) as never;
  try {
    return await fn();
  } finally {
    holder.$transaction = original;
  }
}

describe("ST-64: os três caminhos do forgot-password fazem a MESMA sequência de idas ao banco", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDb(); // não deixar loja/usuário para o arquivo vizinho
  });

  const EXPECTED = ["tx.$queryRaw", "tx.passwordResetToken.findMany", "tx.passwordResetToken.updateMany", "tx.$executeRaw"];

  it("conta existente (emite), inexistente, no intervalo de 60 s e com a cota esgotada: a sequência é idêntica (4 idas na transação) e só a conta existente grava", async () => {
    const app = makeApp();
    await app.ready();
    const { credentials } = await registerStore(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });

    const run = async (email: string) => {
      const trace: string[] = [];
      const issued = await withTrace(trace, () => issueResetToken(email));
      return { trace, issued };
    };

    const emits = await run(credentials.email);
    expect(emits.issued).not.toBeNull();
    const missing = await run("nao-existe@exemplo.com");
    expect(missing.issued).toBeNull();
    const cooldown = await run(credentials.email); // 2º pedido dentro dos 60 s
    expect(cooldown.issued).toBeNull();
    // cota esgotada: 3 entregues na última hora (recuadas para fora do intervalo de 60 s)
    await prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    await prisma.passwordResetToken.createMany({
      data: [1, 2].map((n) => ({ userId: user.id, tokenHash: `cota-${n}-${Date.now()}`, expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 5 * 60_000) })),
    });
    const capped = await run(credentials.email);
    expect(capped.issued).toBeNull();

    for (const path of [emits, missing, cooldown, capped]) expect(path.trace).toEqual(EXPECTED); // mesma ordem, mesma quantidade
    // só a conta existente grava: a inexistente não deixa linha nenhuma
    expect(await prisma.passwordResetToken.count({ where: { userId: "-" } })).toBe(0);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(3);
  }, 60000);

  it("pedidos simultâneos de contas INEXISTENTES: nenhum emite e nenhuma linha é gravada", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => issueResetToken(`fantasma-${i}@exemplo.com`)));
    expect(results.every((r) => r === null)).toBe(true);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  }, 60000);

  it("o piso de duração subiu para 350 ms (cobre o p99 dos três caminhos com o banco fora da máquina)", () => {
    expect(FORGOT_MIN_DURATION_MS).toBeGreaterThanOrEqual(350);
    expect(FORGOT_MIN_DURATION_MS).toBeLessThanOrEqual(400);
  });
});

describe("ST-65: o pedido cujo e-mail NÃO saiu é devolvido (não gasta a cota de 3/hora nem o intervalo de 60 s)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    await resetDb();
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDb(); // não deixar loja/usuário para o arquivo vizinho
  });

  const forgot = (email: string) => app.inject({ method: "POST", url: "/auth/forgot-password", remoteAddress: nextIp(), payload: { email } });
  const failedCount = (userId: string) => prisma.passwordResetToken.count({ where: { userId, sendFailedAt: { not: null } } });

  it("envio que devolve `false`: o token é marcado e o pedido seguinte, SEM esperar os 60 s, emite de novo", async () => {
    const sent: string[] = [];
    let ok = false;
    vi.spyOn(emailLib, "sendPasswordResetEmail").mockImplementation(async ({ resetUrl }) => {
      sent.push(resetUrl);
      return ok;
    });
    const { credentials } = await registerStore(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });

    expect((await forgot(credentials.email)).statusCode).toBe(200);
    await vi.waitFor(async () => expect(await failedCount(user.id)).toBe(1), { timeout: 10_000, interval: 100 });
    expect((await forgot(credentials.email)).statusCode).toBe(200); // sem esperar o intervalo de 60 s
    await vi.waitFor(() => expect(sent).toHaveLength(2), { timeout: 10_000, interval: 100 });
    await vi.waitFor(async () => expect(await failedCount(user.id)).toBe(2), { timeout: 10_000, interval: 100 });

    // agora o provedor volta: este pedido SAI e passa a contar (cota e intervalo), então o seguinte é barrado em silêncio
    ok = true;
    await forgot(credentials.email);
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await failedCount(user.id)).toBe(2); // o entregue NÃO é marcado
    await forgot(credentials.email);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sent).toHaveLength(3); // 60 s depois do entregue
  }, 60000);

  it("envio que LANÇA exceção também devolve a tentativa; `undefined` (mock antigo, void) conta como enviado", async () => {
    let mode: "throw" | "void" = "throw";
    vi.spyOn(emailLib, "sendPasswordResetEmail").mockImplementation((async () => {
      if (mode === "throw") throw new Error("provedor fora do ar");
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { credentials } = await registerStore(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
    await forgot(credentials.email);
    await vi.waitFor(async () => expect(await failedCount(user.id)).toBe(1));
    mode = "void";
    await forgot(credentials.email);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await failedCount(user.id)).toBe(1); // o segundo foi "enviado": não marcado
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(2);
  }, 60000);

  it("a devolução tem TETO: só falhas ⇒ no máximo 8 tentativas por hora; com 3 entregues a cota fecha mesmo com falhas no meio", async () => {
    const { credentials } = await registerStore(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
    let issued = 0;
    for (let i = 0; i < RESET_MAX_ATTEMPTS_PER_HOUR + 2; i += 1) {
      const result = await issueResetToken(credentials.email);
      if (result) {
        issued += 1;
        await markResetSendFailed(result.id);
      }
    }
    expect(issued).toBe(RESET_MAX_ATTEMPTS_PER_HOUR); // a 9ª e a 10ª são barradas
    expect(await failedCount(user.id)).toBe(RESET_MAX_ATTEMPTS_PER_HOUR);

    // com a cota: 3 entregues (fora do intervalo) + falhas ⇒ fechado
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    for (let n = 0; n < RESET_MAX_PER_HOUR; n += 1) {
      await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: `ok-${n}-${Date.now()}`, expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - (RESET_COOLDOWN_MS + 5_000 + n)) } });
    }
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: `falha-${Date.now()}`, expiresAt: new Date(Date.now() - 1000), sendFailedAt: new Date(), createdAt: new Date(Date.now() - 1000) } });
    expect(await issueResetToken(credentials.email)).toBeNull();
  }, 60000);

  it("markResetSendFailed só marca token ainda não usado e não marcado (usado nunca vira 'falha de envio')", async () => {
    const { credentials } = await registerStore(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
    const issued = (await issueResetToken(credentials.email))!;
    await prisma.passwordResetToken.update({ where: { id: issued.id }, data: { usedAt: new Date() } });
    await markResetSendFailed(issued.id);
    expect(await failedCount(user.id)).toBe(0);
  }, 60000);
});

describe("ST-65/ST-66: sendPasswordResetEmail informa se saiu, e o texto diz 'use o link mais recente'", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    provider.error = null;
    provider.calls = 0;
  });

  it("sem chave: em desenvolvimento/teste o link vai ao console e vale `true`; fora disso NÃO saiu ⇒ `false` e o link não é registrado", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "test");
    expect(await emailLib.sendPasswordResetEmail({ to: "a@b.co", resetUrl: "https://x/reset-senha#token=SEGREDO" })).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockClear();
    vi.stubEnv("NODE_ENV", "production");
    expect(await emailLib.sendPasswordResetEmail({ to: "a@b.co", resetUrl: "https://x/reset-senha#token=SEGREDO" })).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain("SEGREDO");
  });

  it("com chave: provedor aceita ⇒ `true`; provedor devolve erro ⇒ `false` (e o log leva o e-mail mascarado)", async () => {
    vi.stubEnv("RESEND_API_KEY", "chave-de-teste");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await emailLib.sendPasswordResetEmail({ to: "maria@exemplo.com", resetUrl: "https://x/reset-senha#token=T" })).toBe(true);
    expect(provider.calls).toBe(1);
    provider.error = { name: "rate_limit_exceeded", message: "muitos pedidos" };
    expect(await emailLib.sendPasswordResetEmail({ to: "maria@exemplo.com", resetUrl: "https://x/reset-senha#token=T" })).toBe(false);
    expect(JSON.stringify(error.mock.calls)).not.toContain("maria@exemplo.com");
    expect(JSON.stringify(error.mock.calls)).toContain("m***@exemplo.com");
  });

  it("ST-66: o e-mail traz o link e avisa que vale só o mais recente (os anteriores deixam de valer)", () => {
    const html = emailLib.passwordResetEmailHtml("https://app.exemplo/reset-senha#token=ABC");
    expect(html).toContain('href="https://app.exemplo/reset-senha#token=ABC"');
    expect(html).toContain("mais recente");
    expect(html).toContain("anteriores deixam de valer");
    expect(html).toContain("válido por 1 hora");
  });
});

describe("SEC-33: aviso `<rota>_floor_exceeded` quando a resposta passa do piso de tempo", () => {
  beforeEach(() => resetFloorStats());
  afterEach(() => vi.restoreAllMocks());

  it("dentro do piso: espera e NÃO conta; fora do piso: conta e avisa uma vez por minuto por rota, com o tempo gasto e sem dado de conta", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await padToMinimum(performance.now(), 20); // dentro do piso: dorme o resto e segue
    expect(floorExceeded).toEqual({ forgot: 0, reset: 0 });
    expect(warn).not.toHaveBeenCalled();

    await padToMinimum(performance.now() - 1000, FORGOT_MIN_DURATION_MS); // já passou 1 s: piso excedido
    expect(floorExceeded.forgot).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("[forgot_floor_exceeded]");
    expect(line).toMatch(/\d+ ms > 350 ms/);
    await padToMinimum(performance.now() - 1000, FORGOT_MIN_DURATION_MS); // 2ª no mesmo minuto: conta, não repete o aviso
    expect(floorExceeded.forgot).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);

    await padToMinimum(performance.now() - 1000, 300, "reset"); // outra rota tem o próprio aviso e o próprio contador
    expect(floorExceeded).toEqual({ forgot: 2, reset: 1 });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).toContain("[reset_floor_exceeded]");
  });
});

describe("SEC-33c: commit sem fsync SÓ na transação do forgot-password, em todos os caminhos, sem vazar para o pool", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDb();
  });

  // Lê `synchronous_commit` DENTRO da transação do issueResetToken (antes da 2ª instrução) com a MESMA conexão que ela usa.
  async function insideTransaction(email: string) {
    const seen: string[] = [];
    const holder = prisma as unknown as { $transaction: (fn: (tx: unknown) => unknown, options?: unknown) => Promise<unknown> };
    const original = holder.$transaction;
    holder.$transaction = ((fn: (tx: any) => unknown, options?: unknown) =>
      original.call(prisma, (tx: any) => {
        const proxied = new Proxy(tx, {
          get(target, prop, receiver) {
            if (prop !== "passwordResetToken") return Reflect.get(target, prop, receiver);
            return new Proxy(target.passwordResetToken, {
              get(model, name, r2) {
                if (name !== "findMany") return Reflect.get(model, name, r2);
                return async (...args: unknown[]) => {
                  const rows = (await target.$queryRaw`SELECT current_setting('synchronous_commit') AS v`) as { v: string }[];
                  seen.push(rows[0].v);
                  return model.findMany(...args);
                };
              },
            });
          },
        });
        return fn(proxied);
      }, options)) as never;
    try {
      const issued = await issueResetToken(email);
      return { issued, seen };
    } finally {
      holder.$transaction = original;
    }
  }

  it("`synchronous_commit` é off DENTRO da transação nos 4 caminhos (emite, inexistente, no intervalo, cota esgotada) e a sequência continua com 4 idas", async () => {
    const app = makeApp();
    await app.ready();
    const { credentials } = await registerStore(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });

    const emits = await insideTransaction(credentials.email);
    expect(emits.issued).not.toBeNull();
    const missing = await insideTransaction("fantasma@exemplo.com");
    expect(missing.issued).toBeNull();
    const cooldown = await insideTransaction(credentials.email);
    expect(cooldown.issued).toBeNull();
    await prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    await prisma.passwordResetToken.createMany({
      data: [1, 2].map((n) => ({ userId: user.id, tokenHash: `cota33c-${n}-${Date.now()}`, expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 5 * 60_000) })),
    });
    const capped = await insideTransaction(credentials.email);
    expect(capped.issued).toBeNull();
    for (const path of [emits, missing, cooldown, capped]) expect(path.seen).toEqual(["off"]);

    // a sequência de idas não ganhou operação (o set_config vai na MESMA instrução do lock)
    const trace: string[] = [];
    await withTrace(trace, () => issueResetToken("outra-conta-fantasma@exemplo.com"));
    expect(trace).toEqual(["tx.$queryRaw", "tx.passwordResetToken.findMany", "tx.passwordResetToken.updateMany", "tx.$executeRaw"]);
    await app.close();
  }, 60000);

  it("NÃO vaza: depois do commit, as conexões do pool seguem com o padrão do banco (on), e a leitura fora da transação do reset vê `on`", async () => {
    const app = makeApp();
    await app.ready();
    const { credentials } = await registerStore(app);
    await issueResetToken(credentials.email);
    await issueResetToken("fantasma2@exemplo.com");
    const values = await Promise.all(Array.from({ length: 16 }, () => prisma.$queryRaw<{ v: string }[]>`SELECT current_setting('synchronous_commit') AS v`));
    expect(values.map((r) => r[0].v)).toEqual(Array(16).fill("on"));
    await app.close();
  }, 60000);
});

