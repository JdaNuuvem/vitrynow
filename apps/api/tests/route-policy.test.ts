import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { PANEL_ROUTE_POLICY, PUBLIC_ROUTE_POLICY, policyKey } from "../src/lib/routePolicy";
import { activateSubscription } from "../src/lib/subscription";
import { makeApp, registerStore, resetDb } from "./helpers";

// CA-B17-01..04, CA-B17-08/09 e a matriz de rotas do Leonardo (CA-MX-01..08): como a Consulta e a
// Suspensão tratam cada rota, e a lista central que faz uma rota nova sem classificação reprovar.

const DAY = 24 * 60 * 60 * 1000;

describe("lista central de rotas — contrato (CA-B17-08)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("toda rota de ESCRITA está classificada na tabela central (rota nova sem classificação reprova)", () => {
    const unclassified = app.routeRegistry.filter((r) => !r.classified).map((r) => `${r.method} ${r.url}`);
    expect(unclassified, `classifique em src/lib/routePolicy.ts: ${unclassified.join(", ")}`).toEqual([]);
  });

  it("não sobra entrada na tabela para rota que deixou de existir, e cada entrada vale para a audiência certa", () => {
    const byKey = new Map(app.routeRegistry.map((r) => [policyKey(r.method, r.url), r]));
    for (const key of Object.keys(PANEL_ROUTE_POLICY)) {
      expect(byKey.get(key)?.audience, `entrada de painel sem rota de painel: ${key}`).toBe("panel");
    }
    for (const key of Object.keys(PUBLIC_ROUTE_POLICY)) {
      expect(byKey.get(key)?.audience, `entrada pública sem rota pública: ${key}`).toBe("public");
    }
  });

  it("há rotas de painel, de dispositivo e públicas no registro (o gancho de rota está ativo)", () => {
    const audiences = new Set(app.routeRegistry.map((r) => r.audience));
    expect([...audiences].sort()).toEqual(["device", "panel", "public"]);
    expect(app.routeRegistry.length).toBeGreaterThan(40);
  });

  it("rota nova de escrita do painel SEM classificação aparece como não classificada e já nasce bloqueada na Consulta", async () => {
    const extra = makeApp();
    extra.register(async (instance) => {
      instance.post("/api/zz-rota-nova", { preHandler: instance.requirePanelAuth }, async () => ({ ok: true }));
    });
    await extra.ready();
    expect(extra.routeRegistry.find((r) => r.url === "/api/zz-rota-nova")).toMatchObject({ classified: false, audience: "panel" });

    const { cookie } = await registerStore(extra, { plan: "BASICO" });
    await prisma.subscription.updateMany({ data: { trialEndsAt: new Date(Date.now() - DAY) } });
    const blocked = await extra.inject({ method: "POST", url: "/api/zz-rota-nova", headers: { cookie: cookie! }, payload: {} });
    expect(blocked.statusCode).toBe(403);
    expect(JSON.parse(blocked.body).code).toBe("READ_ONLY");
    await extra.close();
    await resetDb();
  });
});

describe("Consulta e Suspensão por rota (integração)", () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;

  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    cookie = (await registerStore(app, { slug: "loja-fase", code: "FS1", plan: "BASICO" })).cookie!;
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const inject = (method: "GET" | "POST", url: string, payload?: unknown, headers: Record<string, string> = { cookie }) =>
    app.inject({ method, url, headers, payload: payload as never });
  const codeOf = (response: { body: string }) => {
    try {
      return (JSON.parse(response.body) as { code?: string }).code;
    } catch {
      return undefined;
    }
  };
  const toReadOnly = () => prisma.subscription.updateMany({ data: { trialEndsAt: new Date(Date.now() - DAY) } });
  const toSuspended = () => prisma.subscription.updateMany({ data: { trialEndsAt: new Date(Date.now() - 8 * DAY) } });
  // `logout-all` derruba a própria sessão do teste (é o que ele faz): fica fora dos laços e tem teste próprio.
  const loopEntries = () => Object.entries(PANEL_ROUTE_POLICY).filter(([key]) => key !== "POST /auth/logout-all");
  const concrete = (key: string) => {
    const [method, url] = key.split(" ");
    return { method: method as "GET" | "POST", url: url.replace(/:[A-Za-z]+/g, "x") };
  };

  async function seedCatalog() {
    const category = await inject("POST", "/api/catalog/categories", { name: "Lanches" });
    const product = await inject("POST", "/api/catalog/products", {
      categoryId: JSON.parse(category.body).category.id,
      name: "Combo",
      priceCents: 1500,
    });
    return JSON.parse(product.body).product.id as string;
  }
  const placeOrder = (productId: string) =>
    app.inject({
      method: "POST",
      url: "/stores/loja-fase/orders",
      payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId, quantity: 1 }] },
    });

  it("loja em dia (TRIAL): nenhuma rota é bloqueada pela assinatura", async () => {
    for (const [key, policy] of loopEntries()) {
      if (policy === "billing") continue;
      const { method, url } = concrete(key);
      const response = await inject(method, url, method === "POST" ? {} : undefined);
      expect(["READ_ONLY", "SUSPENDED"], key).not.toContain(codeOf(response));
    }
  });

  it("CA-MX-01: na Consulta, escrita de cadastro e config devolve 403 READ_ONLY; liberadas e 'billing' passam do portão", async () => {
    await toReadOnly();
    for (const [key, policy] of loopEntries()) {
      const { method, url } = concrete(key);
      const response = await inject(method, url, method === "POST" ? {} : undefined);
      if (policy === "blocked") {
        expect(response.statusCode, key).toBe(403);
        expect(codeOf(response), key).toBe("READ_ONLY");
      } else {
        expect(["READ_ONLY", "SUSPENDED"], key).not.toContain(codeOf(response));
      }
    }
  });

  it("CA-MX-02: na Suspensão só a conta/pagamento funciona; todo o resto devolve 402 SUSPENDED", async () => {
    await toSuspended();
    for (const [key, policy] of loopEntries()) {
      const { method, url } = concrete(key);
      const response = await inject(method, url, method === "POST" ? {} : undefined);
      if (policy === "billing") {
        expect(codeOf(response), key).not.toBe("SUSPENDED");
      } else {
        expect(response.statusCode, key).toBe(402);
        expect(codeOf(response), key).toBe("SUSPENDED");
      }
    }
    // leituras do painel sem entrada na tabela também fecham
    for (const url of ["/api/orders", "/api/cashier/current", "/api/reports/summary", "/api/catalog/categories", "/api/audit-log"]) {
      const response = await inject("GET", url);
      expect(codeOf(response), url).toBe("SUSPENDED");
    }
  });

  it("CA-MX-01: na Consulta as leituras do painel continuam funcionando (inclui /ws/panel pelo mesmo portão)", async () => {
    await toReadOnly();
    for (const url of ["/api/orders", "/api/cashier/current", "/api/reports/summary", "/api/catalog/categories", "/api/audit-log", "/api/store/settings"]) {
      expect((await inject("GET", url)).statusCode, url).toBe(200);
    }
  });

  it("classes das rotas novas (API-12b, API-19, API-27, API-54, SEC-29): reprint termina pedido recebido; configuração e anotação são bloqueadas; tracking e inspect do link são livres", () => {
    expect(PANEL_ROUTE_POLICY["POST /api/orders/:id/reprint"]).toBe("finish");
    expect(PANEL_ROUTE_POLICY["POST /api/orders"]).toBe("blocked"); // API-13: pedido manual é pedido NOVO (RN-B2-13)
    expect(PANEL_ROUTE_POLICY["POST /api/cashier/notices/:id/dismiss"]).toBe("allowed");
    for (const key of ["POST /api/store/payments/mercadopago/connect", "POST /api/store/payments/mercadopago/disconnect"]) expect(PANEL_ROUTE_POLICY[key], key).toBe("blocked");
    for (const key of ["POST /api/orders/:id/internal-note", "PUT /api/store/print-mode", "POST /api/print-jobs/test", "PUT /api/cashier/staff-withdrawal-limit"]) expect(PANEL_ROUTE_POLICY[key], key).toBe("blocked");
    expect(PUBLIC_ROUTE_POLICY["GET /stores/:slug/orders/:orderId/tracking"]).toBe("public-allowed");
    expect(PUBLIC_ROUTE_POLICY["POST /auth/reset-password/inspect"]).toBe("exempt");
  });

  it("CA-B17-01 / CA-MX-03: pedido criado ANTES da virada pode ser concluído e estornado na Consulta; abrir outro caixa não", async () => {
    const productId = await seedCatalog();
    const created = await placeOrder(productId);
    expect(created.statusCode).toBe(201);
    const orderId = JSON.parse(created.body).orderId as string;
    expect((await inject("POST", "/api/cashier/open", { openingBalanceCents: 1000 })).statusCode).toBe(201);

    await toReadOnly();

    for (const to of ["CONFIRMADO", "EM_PREPARO", "PRONTO", "CONCLUIDO"]) {
      const step = await inject("POST", `/api/orders/${orderId}/transition`, { to });
      expect(step.statusCode, to).toBe(200);
    }
    expect(await prisma.order.findUnique({ where: { id: orderId } })).toMatchObject({ status: "CONCLUIDO" });

    // CA-MX-04: fechar o caixa pode; abrir outro e lançar sangria não
    const close = await inject("POST", "/api/cashier/close", { closingBalanceCents: 2500, reason: "OUTRO", reasonText: "diferença de teste" });
    expect(close.statusCode, JSON.stringify(close.body ?? "")).toBe(200);
    expect(codeOf(await inject("POST", "/api/cashier/open", { openingBalanceCents: 0 }))).toBe("READ_ONLY");
    expect(codeOf(await inject("POST", "/api/cashier/movements", { type: "SANGRIA", amountCents: 100 }))).toBe("READ_ONLY");
  });

  it("CA-B17-01 (API-02): na Consulta o pedido já recebido pode ser cancelado e desfeito; na Suspensão nada disso", async () => {
    const productId = await seedCatalog();
    const first = JSON.parse((await placeOrder(productId)).body).orderId as string;
    const second = JSON.parse((await placeOrder(productId)).body).orderId as string;

    await toReadOnly();
    const cancel = await inject("POST", `/api/orders/${first}/cancel`, { reason: { code: "ITEM_EM_FALTA" } });
    expect(cancel.statusCode).toBe(200);
    expect(await prisma.order.findUnique({ where: { id: first } })).toMatchObject({ status: "CANCELADO" });
    expect(["READ_ONLY", "SUSPENDED"]).not.toContain(codeOf(await inject("POST", `/api/orders/${first}/undo`)));
    expect(["READ_ONLY", "SUSPENDED"]).not.toContain(codeOf(await inject("POST", `/api/orders/${second}/refund/retry`)));

    await toSuspended();
    for (const [url, body] of [
      [`/api/orders/${second}/cancel`, { reason: { code: "ITEM_EM_FALTA" } }],
      [`/api/orders/${second}/transition`, { to: "CONFIRMADO" }],
      [`/api/orders/${second}/undo`, {}],
    ] as const) {
      const response = await inject("POST", url, body);
      expect(response.statusCode, url).toBe(402);
      expect(codeOf(response), url).toBe("SUSPENDED");
    }
  });

  it("logout-all (sair de todos os dispositivos) segue permitido na Consulta e na Suspensão", async () => {
    await toSuspended();
    const response = await inject("POST", "/auth/logout-all");
    expect(["READ_ONLY", "SUSPENDED"]).not.toContain(codeOf(response));
  });

  it("CA-B17-02: na Consulta e na Suspensão o pedido do cardápio é recusado com 409 SUBSCRIPTION_INACTIVE (sem citar plano)", async () => {
    const productId = await seedCatalog();
    expect((await placeOrder(productId)).statusCode).toBe(201);

    for (const phase of [toReadOnly, toSuspended]) {
      await phase();
      const response = await placeOrder(productId);
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body)).toEqual({ error: "Esta loja não está recebendo pedidos agora.", code: "SUBSCRIPTION_INACTIVE" });
    }
    expect(await prisma.order.count()).toBe(1);
  });

  it("cardápio: Consulta mostra a loja com acceptingOrders=false; Suspensão devolve 503 neutro sem dados da loja", async () => {
    await seedCatalog();
    const open = JSON.parse((await app.inject({ method: "GET", url: "/stores/loja-fase/menu" })).body);
    expect(open.store.acceptingOrders).toBe(true);
    expect(open.store.accepting).toBe(true);
    expect(JSON.stringify(open)).not.toMatch(/phase|READ_ONLY|nextPhaseAt|subscription/i); // a vitrine não vê assinatura

    await toReadOnly();
    const consulta = await app.inject({ method: "GET", url: "/stores/loja-fase/menu" });
    expect(consulta.statusCode).toBe(200);
    expect(JSON.parse(consulta.body).store).toMatchObject({ slug: "loja-fase", acceptingOrders: false, accepting: false });
    expect(consulta.body).not.toMatch(/phase|READ_ONLY|nextPhaseAt|subscription/i);
    expect(JSON.parse(consulta.body).categories.length).toBe(1);

    await toSuspended();
    const suspensa = await app.inject({ method: "GET", url: "/stores/loja-fase/menu" });
    expect(suspensa.statusCode).toBe(503);
    expect(JSON.parse(suspensa.body)).toEqual({ error: "Loja indisponível no momento.", code: "STORE_UNAVAILABLE" });
    expect(suspensa.body).not.toContain("Lanches");
  });

  it("acompanhar e cancelar pedido pelo cliente seguem funcionando na Consulta e na Suspensão", async () => {
    await seedCatalog();
    for (const phase of [toReadOnly, toSuspended]) {
      await phase();
      const status = await app.inject({ method: "GET", url: "/stores/loja-fase/orders/inexistente/payment-status" });
      const cancel = await app.inject({ method: "POST", url: "/stores/loja-fase/orders/inexistente/cancel", payload: {} });
      const tracking = await app.inject({ method: "GET", url: "/stores/loja-fase/orders/inexistente/tracking" }); // API-19: o cliente acompanha o que já fez
      for (const response of [status, cancel, tracking]) {
        expect(response.statusCode).toBe(404); // chegou até a rota (pedido não existe), não foi barrado pela assinatura
      }
    }
  });

  it("CA-MX-05 / reativação imediata: pagar na Consulta ou na Suspensão libera a loja na requisição seguinte", async () => {
    const subscription = await prisma.subscription.findFirstOrThrow();

    // nome ÚNICO por fase: a categoria "Liberada" da 1ª fase continua existindo na 2ª e o nome repetido agora dá 409 (regra de nome único da categoria)
    for (const [i, phase] of [toReadOnly, toSuspended].entries()) {
      await phase();
      expect(codeOf(await inject("POST", "/api/catalog/categories", { name: `Bloqueada ${i}` }))).toMatch(/READ_ONLY|SUSPENDED/);
      await activateSubscription({ subscriptionId: subscription.id, planCode: "BASICO" });
      expect((await inject("POST", "/api/catalog/categories", { name: `Liberada ${i}` })).statusCode).toBe(201);
      await prisma.subscription.update({ where: { id: subscription.id }, data: { status: "TRIAL", currentPeriodEnd: null } });
    }
  });

  it("CA-MX-07: impressora — Consulta ainda lê a fila; Suspensão devolve 402 SUSPENDED", async () => {
    const created = await inject("POST", "/api/device-tokens", { label: "PC" });
    const token = JSON.parse(created.body).token.token as string;
    const device = { authorization: `Bearer ${token}` };

    expect((await inject("GET", "/api/device/orders/pending", undefined, device)).statusCode).toBe(200);
    await toReadOnly();
    expect((await inject("GET", "/api/device/orders/pending", undefined, device)).statusCode).toBe(200);
    await toSuspended();
    const suspended = await inject("GET", "/api/device/orders/pending", undefined, device);
    expect(suspended.statusCode).toBe(402);
    expect(codeOf(suspended)).toBe("SUSPENDED");
  });

  it("CA-MX-08: o webhook de pagamento nunca é barrado pela assinatura, nem na Suspensão", async () => {
    await toSuspended();
    const response = await app.inject({ method: "POST", url: "/api/payments/webhook", payload: { type: "payment", data: { id: "x" } } });
    expect(["READ_ONLY", "SUSPENDED", "SUBSCRIPTION_INACTIVE"]).not.toContain(codeOf(response));
    expect(response.statusCode).not.toBe(402);
  });

  it("CA-B17-09: exportar/ler, trocar a própria senha e pagar seguem permitidos na Consulta; nada vaza para Suspensão", async () => {
    await toReadOnly();
    const wrongPassword = await inject("POST", "/auth/change-password", { currentPassword: "errada", newPassword: "outra-senha-123" });
    expect(["READ_ONLY", "SUSPENDED"]).not.toContain(codeOf(wrongPassword));
    const subscription = await inject("GET", "/api/store/subscription");
    expect(subscription.statusCode).toBe(200);
    expect(JSON.parse(subscription.body).subscription).toMatchObject({
      phase: "READ_ONLY",
      canFinishInProgress: true,
      nextPhaseAt: expect.any(String),
      access: { panelWrite: false, publicOrders: false },
    });
    // a leitura da assinatura também funciona suspenso (é a tela de pagamento)
    await toSuspended();
    const suspended = await inject("GET", "/api/store/subscription");
    expect(suspended.statusCode).toBe(200);
    expect(JSON.parse(suspended.body).subscription.phase).toBe("SUSPENDED");
  });

  it("política `export`: liberada na Consulta e, na Suspensão, só para OWNER (STAFF recebe 402)", async () => {
    const extra = makeApp();
    PANEL_ROUTE_POLICY["GET /api/zz-export"] = "export";
    try {
      extra.register(async (instance) => {
        instance.get("/api/zz-export", { preHandler: instance.requirePanelAuth }, async () => ({ csv: "ok" }));
      });
      await extra.ready();
      const owner = (await registerStore(extra, { plan: "BASICO" })).cookie!;
      const get = () => extra.inject({ method: "GET", url: "/api/zz-export", headers: { cookie: owner } });
      expect((await get()).statusCode).toBe(200);
      await toReadOnly();
      expect((await get()).statusCode).toBe(200);
      await toSuspended();
      expect((await get()).statusCode).toBe(200); // OWNER
      await prisma.user.updateMany({ data: { role: "STAFF" } });
      const staff = await get();
      expect([401, 402]).toContain(staff.statusCode); // STAFF: 402 SUSPENDED (ou sessão relida com o novo papel)
      expect(staff.statusCode === 200).toBe(false);
    } finally {
      delete PANEL_ROUTE_POLICY["GET /api/zz-export"];
      await extra.close();
      await resetDb();
    }
  });

  it("dados NUNCA são apagados na Consulta nem na Suspensão (nenhuma rota/job apaga)", async () => {
    const productId = await seedCatalog();
    await placeOrder(productId);
    const before = { products: await prisma.product.count(), orders: await prisma.order.count(), categories: await prisma.category.count() };
    await toReadOnly();
    await inject("GET", "/api/orders");
    await toSuspended();
    await inject("GET", "/api/orders");
    expect({ products: await prisma.product.count(), orders: await prisma.order.count(), categories: await prisma.category.count() }).toEqual(before);
  });
});
