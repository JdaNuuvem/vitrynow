import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { accessFor, phaseOf, planFeatures, planLimits, READ_ONLY_DAYS, resolveEntitlements } from "../src/lib/entitlements";
import { FEATURE_REGISTRY, FEATURES, RELEASED_FEATURES } from "../src/lib/features";
import { activateSubscription } from "../src/lib/subscription";
import { makeApp, registerStore, resetDb } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-16T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

type Sub = Parameters<typeof phaseOf>[0];
const trial = (endsInMs: number): Sub => ({ status: "TRIAL", trialEndsAt: at(endsInMs), currentPeriodEnd: null });
const paid = (status: "ACTIVE" | "CANCELED", periodEndsInMs: number): Sub => ({
  status,
  trialEndsAt: at(-30 * DAY),
  currentPeriodEnd: at(periodEndsInMs),
});

describe("fase da assinatura (ADR-0003 §2.2)", () => {
  it.each([
    ["teste faltando 1 ms", trial(1), "TRIAL"],
    ["teste vence exatamente agora", trial(0), "READ_ONLY"],
    ["1 dia depois do teste", trial(-DAY), "READ_ONLY"],
    ["7 dias menos 1 ms depois do teste", trial(-(READ_ONLY_DAYS * DAY - 1)), "READ_ONLY"],
    ["exatamente 7 dias depois do teste", trial(-READ_ONLY_DAYS * DAY), "SUSPENDED"],
    ["30 dias depois do teste", trial(-30 * DAY), "SUSPENDED"],
    ["assinatura ativa em dia", paid("ACTIVE", 5 * DAY), "ACTIVE"],
    ["cancelada com período pago ainda correndo", paid("CANCELED", 3 * DAY), "ACTIVE"],
    ["ativa com renovação vencida há 2 dias (mesma regra do teste, A4)", paid("ACTIVE", -2 * DAY), "READ_ONLY"],
    ["ativa vencida há 8 dias", paid("ACTIVE", -8 * DAY), "SUSPENDED"],
    ["cancelada e período acabado há 1 dia", paid("CANCELED", -DAY), "READ_ONLY"],
  ] as const)("%s ⇒ %s", (_label, subscription, expected) => {
    expect(phaseOf(subscription, NOW).phase).toBe(expected);
  });

  it("readOnlyEndsAt = fim do teste (ou do período) + 7 dias; nulo em TRIAL e ACTIVE", () => {
    expect(phaseOf(trial(-DAY), NOW).readOnlyEndsAt).toEqual(at(-DAY + READ_ONLY_DAYS * DAY));
    expect(phaseOf(paid("ACTIVE", -2 * DAY), NOW).readOnlyEndsAt).toEqual(at(-2 * DAY + READ_ONLY_DAYS * DAY));
    expect(phaseOf(trial(DAY), NOW).readOnlyEndsAt).toBeNull();
    expect(phaseOf(paid("ACTIVE", DAY), NOW).readOnlyEndsAt).toBeNull();
  });

  it("nextPhaseAt: fim do teste, fim do período, fim da Consulta; nulo na Suspensão", () => {
    const basico = { features: [] as string[], limits: {} };
    const at2 = (sub: Sub) => resolveEntitlements({ ...sub, plan: null }, basico, NOW).nextPhaseAt;
    expect(at2(trial(2 * DAY))).toBe(at(2 * DAY).toISOString());
    expect(at2(paid("ACTIVE", 5 * DAY))).toBe(at(5 * DAY).toISOString());
    expect(at2(trial(-DAY))).toBe(at(-DAY + READ_ONLY_DAYS * DAY).toISOString());
    expect(at2(trial(-READ_ONLY_DAYS * DAY))).toBeNull();
  });

  it("reativação imediata: pagar dentro da Consulta ou da Suspensão volta a ACTIVE sem esperar nada", () => {
    expect(phaseOf(trial(-3 * DAY), NOW).phase).toBe("READ_ONLY");
    expect(phaseOf({ status: "ACTIVE", trialEndsAt: at(-3 * DAY), currentPeriodEnd: at(30 * DAY) }, NOW).phase).toBe("ACTIVE");
    expect(phaseOf(trial(-20 * DAY), NOW).phase).toBe("SUSPENDED");
    expect(phaseOf({ status: "ACTIVE", trialEndsAt: at(-20 * DAY), currentPeriodEnd: at(30 * DAY) }, NOW).phase).toBe("ACTIVE");
  });
});

describe("o que cada fase permite (ADR-0003 §2.3)", () => {
  it("TRIAL e ACTIVE: tudo liberado", () => {
    for (const phase of ["TRIAL", "ACTIVE"] as const) {
      expect(accessFor(phase)).toEqual({
        storefront: "full",
        publicOrders: true,
        panelRead: true,
        panelWrite: true,
        canFinishInProgress: true,
        printing: "full",
      });
    }
  });

  it("READ_ONLY: lê, não recebe pedido novo, não escreve, mas encerra o que já foi recebido; imprime só a fila", () => {
    expect(accessFor("READ_ONLY")).toEqual({
      storefront: "notice",
      publicOrders: false,
      panelRead: true,
      panelWrite: false,
      canFinishInProgress: true,
      printing: "queue",
    });
  });

  it("SUSPENDED: painel e cardápio fechados, impressão recusada", () => {
    expect(accessFor("SUSPENDED")).toEqual({
      storefront: "unavailable",
      publicOrders: false,
      panelRead: false,
      panelWrite: false,
      canFinishInProgress: false,
      printing: "none",
    });
  });

  it("accessFor devolve cópia: alterar o resultado não muda a regra", () => {
    const copy = accessFor("READ_ONLY");
    copy.publicOrders = true;
    expect(accessFor("READ_ONLY").publicOrders).toBe(false);
  });
});

describe("recursos e limites do plano", () => {
  const basico = { features: [] as string[], limits: { maxUsers: 1, maxPrinters: 1 } };
  const pro = { features: ["multi_user"], limits: { maxUsers: null, maxPrinters: null } };

  it("CA-B10-03: o teste vale exatamente o que o BASICO tem, mesmo que exista assinatura com outro plano", () => {
    const withMore = { features: ["multi_user"], limits: { maxUsers: 1, maxPrinters: 1 } };
    const trialSub = { ...trial(5 * DAY), plan: pro };
    expect(resolveEntitlements(trialSub, basico, NOW).features).toEqual([]);
    expect(resolveEntitlements({ ...trial(5 * DAY), plan: null }, withMore, NOW).features).toEqual(["multi_user"]);
    expect(resolveEntitlements({ ...trial(5 * DAY), plan: null }, basico, NOW).limits).toEqual({ maxUsers: 1, maxPrinters: 1 });
  });

  it("assinatura em dia usa o plano contratado; PRO sem limite definido não limita", () => {
    const entitlements = resolveEntitlements({ ...paid("ACTIVE", 10 * DAY), plan: pro }, basico, NOW);
    expect(entitlements).toMatchObject({ phase: "ACTIVE", features: ["multi_user"], limits: { maxUsers: null, maxPrinters: null } });
  });

  it("em Consulta e Suspensão nenhum recurso de plano é liberado, mesmo com plano pago anterior", () => {
    expect(resolveEntitlements({ ...paid("ACTIVE", -DAY), plan: pro }, basico, NOW)).toMatchObject({ phase: "READ_ONLY", features: [] });
    expect(resolveEntitlements({ ...paid("ACTIVE", -9 * DAY), plan: pro }, basico, NOW)).toMatchObject({ phase: "SUSPENDED", features: [] });
  });

  it("planFeatures ignora chave desconhecida e recurso ainda não entregue (RN-B10-08)", () => {
    expect(planFeatures({ features: ["multi_user", "scheduled_orders", "whatsapp_auto", "inventado"] })).toEqual(["multi_user"]);
    expect(planFeatures(null)).toEqual([]);
  });

  it("planLimits: número, null (sem limite), ausente/inválido ⇒ padrão do BASICO", () => {
    expect(planLimits({ features: [], limits: { maxUsers: 3, maxPrinters: 2 } })).toEqual({ maxUsers: 3, maxPrinters: 2 });
    expect(planLimits({ features: [], limits: { maxUsers: null, maxPrinters: null } })).toEqual({ maxUsers: null, maxPrinters: null });
    expect(planLimits({ features: [], limits: {} })).toEqual({ maxUsers: 1, maxPrinters: 1 });
    expect(planLimits({ features: [], limits: { maxUsers: -1, maxPrinters: "muitas" } })).toEqual({ maxUsers: 1, maxPrinters: 1 });
    expect(planLimits({ features: [], limits: [1, 2] })).toEqual({ maxUsers: 1, maxPrinters: 1 });
    expect(planLimits({ features: [] })).toEqual({ maxUsers: 1, maxPrinters: 1 });
    expect(planLimits(null)).toEqual({ maxUsers: 1, maxPrinters: 1 });
  });
});

describe("contrato de recursos (CA-B10-08, ADR-0003 §2.6)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("o registro tem exatamente as chaves do ADR-0003 e `released` booleano", () => {
    expect([...FEATURES].sort()).toEqual(["advanced_reports", "multi_user", "scheduled_orders", "table_qr", "tab_service", "whatsapp_auto"].sort());
    for (const feature of FEATURES) {
      expect(typeof FEATURE_REGISTRY[feature].released).toBe("boolean");
      expect(["BASICO", "PRO"]).toContain(FEATURE_REGISTRY[feature].tier);
    }
    expect(FEATURES.filter((f) => FEATURE_REGISTRY[f].tier === "BASICO")).toEqual(["table_qr"]);
  });

  it("nenhum plano gravado no banco libera recurso que não foi entregue", async () => {
    const plans = await prisma.plan.findMany();
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      for (const key of plan.features) {
        expect(RELEASED_FEATURES as string[], `plano ${plan.code} libera "${key}" sem estar entregue`).toContain(key);
      }
    }
  });

  it("planos padrão: BASICO ativo com 1 usuário e 1 impressora; PRO inativo", async () => {
    const basico = await prisma.plan.findUniqueOrThrow({ where: { code: "BASICO" } });
    const proPlan = await prisma.plan.findUniqueOrThrow({ where: { code: "PRO" } });
    expect(basico.active).toBe(true);
    expect(basico.limits).toEqual({ maxUsers: 1, maxPrinters: 1 });
    expect(proPlan.active).toBe(false);
  });
});

describe("limite de impressoras e aviso de interesse (integração)", () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(async () => {
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const createToken = (cookie: string, label = "PC") =>
    app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie }, payload: { label } });
  const interest = (cookie: string | undefined, feature: unknown) =>
    app.inject({ method: "POST", url: "/api/store/feature-interest", headers: cookie ? { cookie } : {}, payload: { feature } });

  it("GET /api/store/subscription traz fase, limites e acesso; o teste não libera equipe", async () => {
    const { cookie } = await registerStore(app);
    const body = JSON.parse((await app.inject({ method: "GET", url: "/api/store/subscription", headers: { cookie: cookie! } })).body);
    expect(body.subscription).toMatchObject({
      state: "trial",
      phase: "TRIAL",
      features: [],
      limits: { maxUsers: 1, maxPrinters: 1 },
      readOnlyEndsAt: null,
      access: { publicOrders: true, panelWrite: true },
    });
  });

  it("CA-B10-02: BASICO aceita a 1ª chave de impressora e recusa a 2ª com 402 LIMIT_REACHED", async () => {
    const { cookie } = await registerStore(app);
    expect((await createToken(cookie!)).statusCode).toBe(200);

    const second = await createToken(cookie!, "Outro PC");
    expect(second.statusCode).toBe(402);
    expect(JSON.parse(second.body)).toMatchObject({ code: "LIMIT_REACHED", details: { limit: "maxPrinters", max: 1, current: 1 } });
    expect(await prisma.deviceToken.count()).toBe(1);
  });

  it("chave revogada não conta: revogar libera criar outra", async () => {
    const { cookie } = await registerStore(app);
    const first = JSON.parse((await createToken(cookie!)).body).token;
    expect((await createToken(cookie!)).statusCode).toBe(402);

    const revoke = await app.inject({ method: "POST", url: `/api/device-tokens/${first.id}/revoke`, headers: { cookie: cookie! } });
    expect(revoke.statusCode).toBe(200);
    expect((await createToken(cookie!)).statusCode).toBe(200);
  });

  it("o limite é por loja: a chave de uma loja não consome a vaga de outra", async () => {
    const a = await registerStore(app);
    const b = await registerStore(app);
    expect((await createToken(a.cookie!)).statusCode).toBe(200);
    expect((await createToken(b.cookie!)).statusCode).toBe(200);
    expect((await createToken(a.cookie!)).statusCode).toBe(402);
  });

  it("plano sem limite (PRO) cria quantas chaves quiser", async () => {
    const { cookie } = await registerStore(app);
    const subscription = await prisma.subscription.findFirstOrThrow();
    await activateSubscription({ subscriptionId: subscription.id, planCode: "PRO" });

    for (let i = 0; i < 3; i++) expect((await createToken(cookie!, `PC ${i}`)).statusCode).toBe(200);
  });

  it("SEC-21: 20 convites de equipe em paralelo com maxUsers=3 criam exatamente 2 (dono + 2) e o resto leva 402", async () => {
    const original = await prisma.plan.findUniqueOrThrow({ where: { code: "PRO" } });
    await prisma.plan.update({ where: { code: "PRO" }, data: { limits: { maxUsers: 3, maxPrinters: null } } });
    try {
      const { cookie } = await registerStore(app);
      const subscription = await prisma.subscription.findFirstOrThrow();
      await activateSubscription({ subscriptionId: subscription.id, planCode: "PRO" });

      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          app.inject({
            method: "POST",
            url: "/api/users",
            remoteAddress: `10.9.0.${i + 1}`,
            headers: { cookie: cookie! },
            payload: { email: `func${i}@teste.com`, password: "senha-forte-123" },
          }),
        ),
      );
      const codes = results.map((r) => r.statusCode).sort();
      expect(await prisma.user.count()).toBe(3);
      expect(codes.filter((c) => c === 201)).toHaveLength(2);
      expect(codes.filter((c) => c === 402)).toHaveLength(18);
      expect(JSON.parse(results.find((r) => r.statusCode === 402)!.body)).toMatchObject({
        code: "LIMIT_REACHED",
        details: { limit: "maxUsers", max: 3 },
      });
    } finally {
      await prisma.plan.update({ where: { code: "PRO" }, data: { limits: original.limits as object } });
    }
  });

  it("SEC-21: a janela do limite se fecha sempre (402, sucesso, erro): 30 pedidos seguidos não travam", async () => {
    const { cookie } = await registerStore(app);
    for (let i = 0; i < 30; i++) {
      const response = await createToken(cookie!, `PC ${i}`);
      expect(response.statusCode, `tentativa ${i}`).toBe(i === 0 ? 200 : 402);
    }
  });

  it("CA-B10-04: 'Quero ser avisado' 3 vezes grava 1 registro por loja e recurso", async () => {
    const { cookie } = await registerStore(app);
    for (let i = 0; i < 3; i++) expect((await interest(cookie, "scheduled_orders")).statusCode).toBe(200);
    expect(await prisma.featureInterest.count()).toBe(1);

    expect((await interest(cookie, "whatsapp_auto")).statusCode).toBe(200);
    expect(await prisma.featureInterest.count()).toBe(2);

    const other = await registerStore(app);
    expect((await interest(other.cookie, "scheduled_orders")).statusCode).toBe(200);
    expect(await prisma.featureInterest.count()).toBe(3);
  });

  it("aviso de interesse: recurso desconhecido ⇒ 400, sem login ⇒ 401, plano que já inclui ⇒ 409", async () => {
    const { cookie } = await registerStore(app);
    expect((await interest(cookie, "inventado")).statusCode).toBe(400);
    expect((await interest(cookie, undefined)).statusCode).toBe(400);
    expect((await interest(undefined, "scheduled_orders")).statusCode).toBe(401);

    const subscription = await prisma.subscription.findFirstOrThrow();
    await activateSubscription({ subscriptionId: subscription.id, planCode: "PRO" });
    const included = await interest(cookie, "multi_user");
    expect(included.statusCode).toBe(409);
    expect(JSON.parse(included.body).code).toBe("FEATURE_ALREADY_AVAILABLE");
    expect(await prisma.featureInterest.count()).toBe(0);
  });

  it("aviso de interesse só vale para recurso do PRO: recurso do BASICO (table_qr) ⇒ 409 e nada é gravado", async () => {
    const { cookie } = await registerStore(app);
    const response = await interest(cookie, "table_qr");
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).code).toBe("FEATURE_ALREADY_AVAILABLE");
    expect(await prisma.featureInterest.count()).toBe(0);
  });

  it("402 de recurso trancado traz a chave em `feature` e em `details.feature`", async () => {
    const { cookie } = await registerStore(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: cookie! },
      payload: { email: "staff@teste.com", password: "senha123" },
    });
    expect(response.statusCode).toBe(402);
    expect(JSON.parse(response.body)).toMatchObject({ code: "FEATURE_LOCKED", feature: "multi_user", details: { feature: "multi_user" } });
  });
});
