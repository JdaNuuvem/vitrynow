// API-10 (RN-A-06, ADR-0003 §2.4): avisos de assinatura 7/3/1 dias antes + entrada em Consulta + entrada em Suspensão, uma vez cada.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import * as emailLib from "../src/lib/email";
import { READ_ONLY_DAYS } from "../src/lib/entitlements";
import { activateSubscription } from "../src/lib/subscription";
import { dueAtOf, dueNotice, NOTICE_TEXT } from "../src/lib/subscriptionNotices";
import { subscriptionNoticesJob } from "../src/jobs/subscriptionNotices";
import { JobRunner } from "../src/jobs/runner";
import { login, makeApp, registerStore, resetDb } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const silent = { info() {}, warn() {}, error() {} };
const base = new Date("2026-11-20T12:00:00.000Z");
const trial = (ends: Date) => ({ status: "TRIAL" as const, trialEndsAt: ends, currentPeriodEnd: null });

describe("dueNotice (regra pura)", () => {
  it("janelas: >7 dias nada; 7..3 = D7; 3..1 = D3; ≤1 = D1 (a mais próxima do vencimento vence)", () => {
    const at = (ms: number) => dueNotice(trial(new Date(base.getTime() + ms)), base)?.kind ?? null;
    expect(at(8 * DAY)).toBeNull();
    expect(at(7 * DAY + 1)).toBeNull();
    expect(at(7 * DAY)).toBe("D7");
    expect(at(5 * DAY)).toBe("D7");
    expect(at(3 * DAY + 1)).toBe("D7");
    expect(at(3 * DAY)).toBe("D3");
    expect(at(2 * DAY)).toBe("D3");
    expect(at(1 * DAY + 1)).toBe("D3");
    expect(at(1 * DAY)).toBe("D1");
    expect(at(HOUR)).toBe("D1");
    expect(at(1)).toBe("D1");
  });

  it("depois do vencimento: READ_ONLY por 7 dias; depois SUSPENDED; o vencimento é o do teste (TRIAL) ou do período pago", () => {
    const ends = new Date(base.getTime() - 1);
    expect(dueNotice(trial(ends), base)?.kind).toBe("READ_ONLY");
    expect(dueNotice(trial(new Date(base.getTime() - (READ_ONLY_DAYS * DAY - 1))), base)?.kind).toBe("READ_ONLY"); // último instante da Consulta
    expect(dueNotice(trial(new Date(base.getTime() - READ_ONLY_DAYS * DAY)), base)?.kind).toBe("SUSPENDED"); // exatamente no limite: já suspensa
    expect(dueNotice(trial(new Date(base.getTime() - 30 * DAY)), base)?.kind).toBe("SUSPENDED");
    const paid = { status: "ACTIVE" as const, trialEndsAt: new Date(base.getTime() - 60 * DAY), currentPeriodEnd: new Date(base.getTime() + 2 * DAY) };
    expect(dueAtOf(paid).getTime()).toBe(paid.currentPeriodEnd.getTime()); // o período pago manda, não o teste antigo
    expect(dueNotice(paid, base)).toEqual({ kind: "D3", dueAt: paid.currentPeriodEnd });
    expect(dueNotice({ ...paid, status: "CANCELED" }, base)?.kind).toBe("D3"); // cancelada com período correndo: avisa o fim do acesso
  });

  it("os textos são FIXOS: sem plano, valor, pagamento nem dado da loja; D1 diz 'amanhã'; Suspensão não promete apagar dado", () => {
    for (const [kind, text] of Object.entries(NOTICE_TEXT)) {
      const all = `${text.subject} ${text.lines.join(" ")}`;
      expect(all, kind).not.toMatch(/R\$|\d+,\d{2}|PIX|cartão|plano (pro|básico)|https?:/i);
    }
    expect(NOTICE_TEXT.D1.subject).toContain("amanhã");
    expect(NOTICE_TEXT.SUSPENDED.lines.join(" ")).toContain("Não apagamos seus dados");
  });
});

describe("job subscription.notices (integração)", () => {
  let app: ReturnType<typeof makeApp>;
  let send: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    send = vi.spyOn(emailLib, "sendSubscriptionNoticeEmail").mockResolvedValue(true);
  });
  afterEach(async () => {
    send.mockRestore();
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (r: { body: string }) => JSON.parse(r.body);
  const runner = () => {
    const r = new JobRunner({ db: prisma, log: silent, now: () => clock });
    r.register(subscriptionNoticesJob);
    return r;
  };
  let clock = base;
  let seq = 0;

  async function loja(trialEndsIn: number, opts: { staff?: boolean } = {}) {
    seq += 1;
    const { response } = await registerStore(app, { slug: `aviso-${seq}`, code: `AV${seq}`, plan: "BASICO" });
    const storeId = json(response).store.id as string;
    await prisma.subscription.update({ where: { storeId }, data: { status: "TRIAL", trialEndsAt: new Date(base.getTime() + trialEndsIn) } });
    if (opts.staff) {
      // convidar equipe exige PRO (multi_user): ativa só para convidar e volta ao teste grátis com o vencimento que o caso pede
      await activateSubscription({ subscriptionId: (await prisma.subscription.findUniqueOrThrow({ where: { storeId } })).id, planCode: "PRO" });
      const owner = await prisma.user.findFirstOrThrow({ where: { storeId, role: "OWNER" } });
      const { cookie } = await login(app, owner.email, "senha12345");
      const invited = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email: `staff-av-${seq}@t.com`, password: "provisoria1" } });
      expect(invited.statusCode, invited.body).toBe(201);
      await prisma.subscription.update({ where: { storeId }, data: { status: "TRIAL", planId: null, currentPeriodEnd: null, trialEndsAt: new Date(base.getTime() + trialEndsIn) } });
    }
    return { storeId, ownerEmail: (await prisma.user.findFirstOrThrow({ where: { storeId, role: "OWNER" } })).email };
  }
  const sent = () => send.mock.calls.map((c) => ({ to: c[0].to, subject: c[0].subject }));

  it("envia o aviso devido UMA vez: rodar o job de novo (ou reiniciar) não repete", async () => {
    clock = base;
    const a = await loja(2 * DAY);
    await runner().run("subscription.notices");
    expect(sent()).toEqual([{ to: a.ownerEmail, subject: NOTICE_TEXT.D3.subject }]);
    await runner().run("subscription.notices"); // outro runner = "reinício"
    await runner().run("subscription.notices");
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.subscriptionNotice.count()).toBe(1);
  });

  it("a série anda com o tempo: D7 → D3 → D1 → Consulta → Suspensão, cada uma UMA vez, e nenhuma depois da Suspensão", async () => {
    const a = await loja(7 * DAY);
    const passos: [number, string][] = [[0, "D7"], [4 * DAY, "D3"], [6 * DAY, "D1"], [7 * DAY + HOUR, "READ_ONLY"], [14 * DAY + 2 * HOUR, "SUSPENDED"], [20 * DAY, ""]];
    const vistos: string[] = [];
    for (const [offset, esperado] of passos) {
      clock = new Date(base.getTime() + offset);
      send.mockClear();
      await runner().run("subscription.notices");
      await runner().run("subscription.notices"); // repetido no mesmo instante: nada novo
      if (esperado) {
        expect(send, esperado).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0].subject, esperado).toBe(NOTICE_TEXT[esperado as keyof typeof NOTICE_TEXT].subject);
        vistos.push(esperado);
      } else expect(send, "depois da suspensão não manda mais nada").not.toHaveBeenCalled();
    }
    expect(vistos).toEqual(["D7", "D3", "D1", "READ_ONLY", "SUSPENDED"]);
    expect(await prisma.subscriptionNotice.count({ where: { subscription: { storeId: a.storeId } } })).toBe(5);
  });

  it("só o OWNER recebe (STAFF nunca) e cada loja só recebe o seu; loja fora da janela não recebe", async () => {
    clock = base;
    const a = await loja(2 * DAY, { staff: true });
    const b = await loja(5 * DAY);
    await loja(30 * DAY); // longe do vencimento
    await runner().run("subscription.notices");
    const para = sent().map((e) => e.to).sort();
    expect(para).toEqual([a.ownerEmail, b.ownerEmail].sort());
    expect(para.some((e) => e.startsWith("staff-av-"))).toBe(false);
    expect(sent().find((e) => e.to === a.ownerEmail)?.subject).toBe(NOTICE_TEXT.D3.subject);
    expect(sent().find((e) => e.to === b.ownerEmail)?.subject).toBe(NOTICE_TEXT.D7.subject);
  });

  it("e-mail que NÃO saiu não conta como enviado: o próximo ciclo tenta de novo e só então fica registrado", async () => {
    clock = base;
    const a = await loja(HOUR * 20);
    send.mockResolvedValueOnce(false);
    await runner().run("subscription.notices");
    expect(await prisma.subscriptionNotice.count()).toBe(0); // reserva desfeita
    await runner().run("subscription.notices");
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent()[1]).toEqual({ to: a.ownerEmail, subject: NOTICE_TEXT.D1.subject });
    expect(await prisma.subscriptionNotice.count()).toBe(1);
    await runner().run("subscription.notices");
    expect(send).toHaveBeenCalledTimes(2); // agora sim, uma vez
  });

  it("2 execuções simultâneas (duas instâncias) enviam UMA vez só (a chave única decide)", async () => {
    clock = base;
    await loja(2 * DAY);
    await Promise.all([runner().run("subscription.notices"), runner().run("subscription.notices"), runner().run("subscription.notices")]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.subscriptionNotice.count()).toBe(1);
  });

  it("RENOVAR o plano muda o vencimento e reabre a série: o aviso do novo período é enviado de novo", async () => {
    clock = base;
    const a = await loja(2 * DAY);
    await runner().run("subscription.notices");
    expect(send).toHaveBeenCalledTimes(1);
    // pagou: novo período de 30 dias que também chega a 2 dias do fim
    await prisma.subscription.update({ where: { storeId: a.storeId }, data: { status: "ACTIVE", currentPeriodEnd: new Date(base.getTime() + 30 * DAY) } });
    clock = new Date(base.getTime() + 28 * DAY);
    await runner().run("subscription.notices");
    expect(send).toHaveBeenCalledTimes(2);
    expect(await prisma.subscriptionNotice.count()).toBe(2); // dois vencimentos diferentes
  });

  it("apagar a loja apaga os avisos dela (cascata) e o job não toca em loja já suspensa há tempo", async () => {
    clock = base;
    const a = await loja(2 * DAY);
    await runner().run("subscription.notices");
    await prisma.store.delete({ where: { id: a.storeId } });
    expect(await prisma.subscriptionNotice.count()).toBe(0);
    send.mockClear();
    const velha = await loja(-40 * DAY); // suspensa há 40 dias: fora da janela do job
    await runner().run("subscription.notices");
    expect(send).not.toHaveBeenCalled();
    expect(velha.storeId).toBeTruthy();
  });
});
