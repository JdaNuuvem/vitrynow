// QA — SEC-19 (logout por aparelho): a revogação precisa durar tanto quanto a SESSÃO pode ser renovada.
// A sessão renova o cookie mantendo o mesmo `sid` e um `exp` maior (até o teto absoluto de 14 dias).
// Se a linha de RevokedSession só dura até o `exp` do token usado no logout, quem copiou o cookie e o
// renovou ANTES do logout volta a valer assim que a limpeza apagar a linha.
// Convenção: bug(...) = it.fails; com QA_STRICT=1 roda como teste normal.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "../helpers";

const bug = process.env.QA_STRICT ? it : it.fails;
const DAY = 86_400;

describe("QA revogação por aparelho (SEC-19)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { app = makeApp(); await app.ready(); });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await prisma.$disconnect(); });

  const payloadOf = (cookie: string) => JSON.parse(Buffer.from(cookie.split("=")[1].split(".")[1], "base64url").toString()) as { sid: string; exp: number; auth_time: number };

  it("S1 (controle) o logout derruba o cookie copiado imediatamente e os outros aparelhos seguem", async () => {
    const { cookie, credentials } = await registerStore(app);
    const outro = await app.inject({ method: "POST", url: "/auth/login", payload: { email: credentials.email, password: credentials.password } });
    const outroCookie = (outro.headers["set-cookie"] as string).split(";")[0];
    expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: cookie! } })).statusCode).toBe(200);
    await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: cookie! } });
    expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: cookie! } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: outroCookie } })).statusCode).toBe(200);
  });

  bug("S2 (SEC-19b) a revogação dura até o TETO ABSOLUTO da sessão (auth_time + 14 d), não só até o exp do token do logout", async () => {
    const { cookie } = await registerStore(app);
    const { sid, auth_time } = payloadOf(cookie!);
    await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: cookie! } });
    const row = await prisma.revokedSession.findUniqueOrThrow({ where: { sid } });
    const ateOndeUmTokenDaMesmaSessaoPodeValer = new Date((auth_time + 14 * DAY) * 1000);
    expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(ateOndeUmTokenDaMesmaSessaoPodeValer.getTime() - 5_000);
  });
});
