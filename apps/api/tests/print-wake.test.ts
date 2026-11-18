// API-47: com o canal do dispositivo reduzido a print.available/ping, a impressora AINDA é acordada por pedido novo nos dois modos (LEGACY e QUEUE).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb, useMockedProvider } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../src/lib/mercadopago";

describe("API-47 — a impressora continua sendo acordada por pedido novo", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    useMockedProvider(mp);
    vi.clearAllMocks();
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
  const json = (r: { body: string }) => JSON.parse(r.body);

  for (const mode of ["LEGACY", "QUEUE"] as const) {
    it(`loja ${mode}: pedido novo emite print.available no /ws/device REAL (e nenhum order.*)`, async () => {
      const slug = `loja-wake-${mode.toLowerCase()}`;
      const { cookie, response } = await registerStore(app, { slug, code: "WK" + mode.slice(0, 2) });
      const storeId = json(response).store.id as string;
      await prisma.store.update({ where: { id: storeId }, data: { printMode: mode } });
      const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
      const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } })).product.id;
      const key = json(await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: cookie! }, payload: { label: "PC" } })).token.token as string;
      const ws = await app.injectWS("/ws/device", { headers: { authorization: `Bearer ${key}` } });
      const got: string[] = [];
      ws.on("message", (m: Buffer) => got.push(JSON.parse(m.toString()).type));
      try {
        const res = await app.inject({ method: "POST", url: `/stores/${slug}/orders`, payload: { type: "BALCAO", items: [{ productId, quantity: 1 }] } });
        expect(res.statusCode, res.body).toBe(201);
        await vi.waitFor(() => expect(got).toContain("print.available"));
        expect(got.filter((t) => t !== "print.available" && t !== "ping")).toEqual([]);
        // o legado continua enxergando o pedido pelo REST (o acordar só dispara o "cheque agora")
        if (mode === "LEGACY") {
          const pending = await app.inject({ method: "GET", url: "/api/device/orders/pending", headers: { authorization: `Bearer ${key}` } });
          expect(json(pending).orders).toHaveLength(1);
        }
      } finally {
        ws.terminate();
      }
    });
  }
});
