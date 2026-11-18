// SEC-40 — guardas (preHandler/onRequest) que respondem 401/402/403 SEM `return reply...send()` só barram o handler porque `reply.sent` vira true; um
// `onSend` ASSÍNCRONO global (compressão, métricas, log) atrasa isso e o handler passa a rodar depois da negativa (achado do Dev Catálogo: um STAFF chegou a
// criar print-job de teste). Regra: toda guarda que envia resposta RETORNA o envio. Duas provas: (1) comportamento com um `onSend` lento; (2) varredura do código.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { buildApp } from "../src/app";
import { registerStore, resetDb } from "./helpers";

describe("SEC-40 — guardas retornam o envio", () => {
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    app = buildApp();
    // `onSend` ASSÍNCRONO e lento, o pior caso para quem depende só de `reply.sent`
    app.addHook("onSend", async (_request, _reply, payload) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return payload;
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  const json = (r: { body: string }) => JSON.parse(r.body);

  async function lojaComStaff() {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    const email = `s-${Math.random().toString(36).slice(2, 8)}@t.com`;
    const convite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email, password: "provisoria-12" } });
    const staffId = json(convite).user.id as string;
    const staff = ((await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "provisoria-12" } })).headers["set-cookie"] as string).split(";")[0];
    return { owner: cookie!, staff, storeId, staffId };
  }

  it("requireOwner: STAFF não cria usuário (403) e nada é gravado, mesmo com onSend assíncrono", async () => {
    const l = await lojaComStaff();
    const antes = await prisma.user.count({ where: { storeId: l.storeId } });
    const r = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: l.staff }, payload: { email: "invasor@t.com", password: "provisoria-12" } });
    expect(r.statusCode).toBe(403);
    expect(await prisma.user.count({ where: { storeId: l.storeId } })).toBe(antes);
    expect(await prisma.user.count({ where: { email: "invasor@t.com" } })).toBe(0);
  });

  it("ownerOrRecordDenied: STAFF não troca o modo de impressão (403) e o modo não muda", async () => {
    const l = await lojaComStaff();
    const modo = async () => (await prisma.store.findUniqueOrThrow({ where: { id: l.storeId }, select: { printMode: true } })).printMode;
    const antes = await modo();
    const alvo = antes === "QUEUE" ? "LEGACY" : "QUEUE";
    const r = await app.inject({ method: "PUT", url: "/api/store/print-mode", headers: { cookie: l.staff }, payload: { mode: alvo } });
    expect(r.statusCode).toBe(403);
    expect(await modo()).toBe(antes);
  });

  it("requireMfa: o dono SEM a confirmação de segurança não remove usuário (403 MFA_REQUIRED) e o usuário continua", async () => {
    const l = await lojaComStaff();
    process.env.MFA_ENFORCED = "true"; // sem isto a confirmação de segurança é aceita direto (compatível com o front atual)
    try {
      const r = await app.inject({ method: "POST", url: `/api/users/${l.staffId}/delete`, headers: { cookie: l.owner } });
      expect([r.statusCode, json(r).code]).toEqual([403, "MFA_REQUIRED"]);
      expect(await prisma.user.count({ where: { id: l.staffId } })).toBe(1);
    } finally {
      delete process.env.MFA_ENFORCED;
    }
  });

  it("requireDeviceAuth: sem chave ou com chave inválida ⇒ 401 e o handler não roda (nenhum job é reivindicado)", async () => {
    const l = await lojaComStaff();
    for (const headers of [{}, { authorization: "Bearer chave-que-nao-existe" }]) {
      const r = await app.inject({ method: "GET", url: "/api/device/orders/pending", headers });
      expect(r.statusCode).toBe(401);
    }
    expect(await prisma.printJob.count({ where: { storeId: l.storeId } })).toBe(0);
  });
});

// ───────────── varredura ─────────────
describe("SEC-40 — varredura: nenhum envio de resposta sem `return` em guarda", () => {
  const srcDir = path.resolve(__dirname, "..", "src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? files(full) : full.endsWith(".ts") ? [full] : [];
    });
  // O handler 404 do app (`setNotFoundHandler`) não é guarda: nada roda depois dele.
  const ALLOWED = new Set(["app.ts"]);

  it("toda linha `reply.code(...).send(...)` começa por `return` OU é seguida de `return` (função auxiliar que devolve null/false)", () => {
    const offenders: string[] = [];
    for (const file of files(srcDir)) {
      if (ALLOWED.has(path.basename(file))) continue;
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!/^\s*(?:await\s+)?reply(?:\.[a-zA-Z]+\([^)]*\))*\.send\(/.test(line)) return;
        if (/^\s*return\b/.test(line)) return;
        const next = lines.slice(i + 1).find((l) => l.trim() !== "") ?? "";
        if (/^\s*return\b/.test(next)) return;
        offenders.push(`${path.relative(srcDir, file)}:${i + 1}: ${line.trim().slice(0, 90)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
