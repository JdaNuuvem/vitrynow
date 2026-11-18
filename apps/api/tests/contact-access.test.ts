// API-54b — contato completo FALHA FECHADO (Nightingale, aprovado pelo Atlas): o rastro `order.view_contact` é gravado de
// forma SÍNCRONA antes de o dado sair; se não puder ser gravado, o contato sai MASCARADO e a resposta diz por quê.
// Determinístico: nenhum vi.waitFor — a gravação é parte da resposta.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { prismaAuditLogger, type AuditLogger } from "../src/shared/audit";
import { OrderService } from "../src/modules/orders/orders.service";
import { makeApp, registerStore, resetDb } from "./helpers";

const PHONE = "11987654321";
const ADDRESS = "Rua Sigilosa, 777, apto 12";

describe("API-54b — contato completo só com rastro gravado", () => {
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

  const json = (r: { body: string }) => JSON.parse(r.body);

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const { id: storeId, slug } = json(response).store;
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
    const productId = json(
      await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } }),
    ).product.id as string;
    const orderRes = await app.inject({
      method: "POST",
      url: `/stores/${slug}/orders`,
      payload: { type: "DELIVERY", customerName: "Ana", customerPhone: PHONE, address: ADDRESS, items: [{ productId, quantity: 1 }] },
    });
    expect(orderRes.statusCode, orderRes.body).toBe(201);
    const user = await prisma.user.findFirstOrThrow({ where: { storeId } });
    return {
      owner: cookie!,
      storeId: storeId as string,
      orderId: json(orderRes).orderId as string,
      actor: { storeId: storeId as string, userId: user.id, role: "OWNER" as const },
    };
  }

  const views = (storeId: string, orderId: string) => prisma.auditLog.count({ where: { storeId, action: "order.view_contact", targetId: orderId } });
  const serviceWith = (audit: AuditLogger, db: unknown = prisma, now?: () => Date) => new OrderService(db as typeof prisma, audit, () => {}, now);

  it("ORDEM: quando a resposta com contato COMPLETO sai, o registro JÁ existe (sem esperar nada)", async () => {
    const ctx = await setup();
    const res = await app.inject({ method: "GET", url: `/api/orders/${ctx.orderId}`, headers: { cookie: ctx.owner } });
    expect(json(res).order).toMatchObject({ customerPhone: PHONE, address: ADDRESS, contactMasked: false });
    expect(json(res).order).not.toHaveProperty("contactUnavailable");
    expect(await views(ctx.storeId, ctx.orderId)).toBe(1); // imediatamente, sem vi.waitFor
  });

  it("o gravador estrito é chamado ANTES de montar a resposta com contato completo", async () => {
    const ctx = await setup();
    const calls: string[] = [];
    const audit: AuditLogger = {
      log: () => {
        calls.push("log");
      },
      logStrict: async (entry) => {
        calls.push(`strict:${entry.action}`);
        await prismaAuditLogger.logStrict(entry);
      },
    };
    const order = (await serviceWith(audit).detail(ctx.actor, ctx.orderId)) as { customerPhone: string };
    expect(calls).toEqual(["strict:order.view_contact"]);
    expect(order.customerPhone).toBe(PHONE);
  });

  it("FALHA FECHADA: se o INSERT do rastro falha, o contato sai MASCARADO, com contactUnavailable, e nenhum dado completo no corpo", async () => {
    const ctx = await setup();
    const falha = vi.fn(async () => {
      throw new Error("banco indisponível");
    });
    const audit: AuditLogger = { log: () => {}, logStrict: falha };
    const order = (await serviceWith(audit).detail(ctx.actor, ctx.orderId)) as Record<string, unknown>;
    expect(falha).toHaveBeenCalledTimes(1);
    expect(order).toMatchObject({ customerPhone: "*******4321", address: null, contactMasked: true, contactUnavailable: "AUDIT_UNAVAILABLE", hasPhone: true, hasAddress: true });
    const dump = JSON.stringify(order);
    for (const dado of [PHONE, ADDRESS, "Sigilosa"]) expect(dump, dado).not.toContain(dado);
    expect(await views(ctx.storeId, ctx.orderId)).toBe(0);
  });

  it("FALHA FECHADA também quando a CONSULTA de dedupe falha (não dá para saber se há rastro ⇒ não libera)", async () => {
    const ctx = await setup();
    const dbQuebrado = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop === "auditLog") {
          return {
            findFirst: async () => {
              throw new Error("timeout na leitura");
            },
            create: target.auditLog.create.bind(target.auditLog),
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const order = (await serviceWith(prismaAuditLogger, dbQuebrado).detail(ctx.actor, ctx.orderId)) as Record<string, unknown>;
    expect(order).toMatchObject({ customerPhone: "*******4321", address: null, contactMasked: true, contactUnavailable: "AUDIT_UNAVAILABLE" });
    expect(JSON.stringify(order)).not.toContain(PHONE);
    expect(await views(ctx.storeId, ctx.orderId)).toBe(0);
  });

  it("falhou uma vez, funciona na repetição: o contato completo volta e fica 1 registro (a tela oferece 'tentar de novo')", async () => {
    const ctx = await setup();
    let primeira = true;
    const audit: AuditLogger = {
      log: () => {},
      logStrict: async (entry) => {
        if (primeira) {
          primeira = false;
          throw new Error("transitório");
        }
        await prismaAuditLogger.logStrict(entry);
      },
    };
    const svc = serviceWith(audit);
    expect(await svc.detail(ctx.actor, ctx.orderId)).toMatchObject({ contactUnavailable: "AUDIT_UNAVAILABLE", contactMasked: true });
    expect(await svc.detail(ctx.actor, ctx.orderId)).toMatchObject({ customerPhone: PHONE, contactMasked: false });
    expect(await views(ctx.storeId, ctx.orderId)).toBe(1);
  });

  it("DEDUPE de 10 min continua: 3 aberturas seguidas = 1 linha; passados 10 min grava de novo", async () => {
    const ctx = await setup();
    const strict = vi.fn(prismaAuditLogger.logStrict);
    const audit: AuditLogger = { log: () => {}, logStrict: strict };
    const svc = serviceWith(audit);
    for (let i = 0; i < 3; i++) await svc.detail(ctx.actor, ctx.orderId);
    expect(strict).toHaveBeenCalledTimes(1);
    expect(await views(ctx.storeId, ctx.orderId)).toBe(1);
    const futuro = serviceWith(audit, prisma, () => new Date(Date.now() + 11 * 60_000));
    await futuro.detail(ctx.actor, ctx.orderId);
    expect(strict).toHaveBeenCalledTimes(2);
    expect(await views(ctx.storeId, ctx.orderId)).toBe(2);
  });

  it("com registro recente, mesmo com o gravador quebrado o contato completo sai (o rastro já existe)", async () => {
    const ctx = await setup();
    await serviceWith(prismaAuditLogger).detail(ctx.actor, ctx.orderId); // cria o registro
    const quebrado: AuditLogger = {
      log: () => {},
      logStrict: async () => {
        throw new Error("não deveria ser chamado");
      },
    };
    const order = (await serviceWith(quebrado).detail(ctx.actor, ctx.orderId)) as Record<string, unknown>;
    expect(order).toMatchObject({ customerPhone: PHONE, contactMasked: false });
    expect(order).not.toHaveProperty("contactUnavailable");
  });

  it("contato MASCARADO por papel/idade e pedido SEM contato não gravam rastro nem chamam o gravador (nada a proteger)", async () => {
    const ctx = await setup();
    const strict = vi.fn(async () => {});
    const audit: AuditLogger = { log: () => {}, logStrict: strict };
    const staff = { ...ctx.actor, role: "STAFF" as const };
    for (const to of ["CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO"]) {
      await app.inject({ method: "POST", url: `/api/orders/${ctx.orderId}/transition`, headers: { cookie: ctx.owner }, payload: { to } });
    }
    await prisma.orderStatusHistory.updateMany({ where: { orderId: ctx.orderId }, data: { createdAt: new Date(Date.now() - 30 * 3600_000) } });
    const velho = (await serviceWith(audit).detail(staff, ctx.orderId)) as Record<string, unknown>;
    expect(velho).toMatchObject({ contactMasked: true, customerPhone: "*******4321" });
    expect(velho).not.toHaveProperty("contactUnavailable"); // mascarado por regra, não por falha
    await prisma.order.update({ where: { id: ctx.orderId }, data: { customerPhone: null, address: null } });
    await serviceWith(audit).detail(ctx.actor, ctx.orderId);
    expect(strict).not.toHaveBeenCalled();
  });

  it("a lista nunca carrega contactUnavailable (só o detalhe)", async () => {
    const ctx = await setup();
    const list = json(await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: ctx.owner } })).orders;
    for (const o of list) expect(o).not.toHaveProperty("contactUnavailable");
  });
});
