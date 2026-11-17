// API-02 / C5 — corridas do ESTORNO contra o resto do pedido, com BARREIRA determinística (não é smoke).
// Técnica (a mesma do QA-15 do Deming): uma transação do teste segura `SELECT … FOR UPDATE` na linha do pedido;
// disparam-se as ações; todas LEEM o pedido (leitura não bloqueia) e travam no UPDATE; só então soltamos a barreira.
// Aí as escritas disputam a mesma linha de verdade. Em READ COMMITTED o Postgres reavalia o WHERE do UPDATE
// (EPQ) sobre a linha nova — por isso a trava do estorno vive NA LINHA DO PEDIDO (`refundLockedAt`), e não numa
// subconsulta em outra tabela (essa usaria o snapshot antigo).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { subscribe } from "../src/realtime/hub";
import { makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../src/lib/mercadopago";
const refundPayment = vi.mocked(mp.refundPayment);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ROUNDS = 6;

describe("C5 — estorno × pedido, com barreira de linha", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    vi.clearAllMocks();
    refundPayment.mockResolvedValue(undefined);
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

  async function loja() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(
      await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } }),
    ).product.id as string;
    return { cookie: cookie!, store, productId };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  // Pedido com PIX já aprovado, levado até `ate` pelo painel.
  async function pedidoPago(l: Loja, ate: "PENDENTE" | "PRONTO") {
    const res = await app.inject({
      method: "POST",
      url: `/stores/${l.store.slug}/orders`,
      payload: { type: "BALCAO", items: [{ productId: l.productId, quantity: 1 }], paymentMethod: "DINHEIRO" },
    });
    expect(res.statusCode).toBe(201);
    const orderId = json(res).orderId as string;
    await prisma.order.update({ where: { id: orderId }, data: { paymentMethod: "PIX" } });
    await prisma.payment.create({ data: { orderId, providerPaymentId: `mp-${orderId}`, amountCents: 1000, status: "APROVADO" } });
    const passos = ate === "PRONTO" ? ["CONFIRMADO", "EM_PREPARO", "PRONTO"] : [];
    for (const to of passos) {
      const r = await app.inject({ method: "POST", url: `/api/orders/${orderId}/transition`, headers: { cookie: l.cookie }, payload: { to } });
      expect(r.statusCode, `avançar para ${to}`).toBe(200);
    }
    return orderId;
  }

  async function comBarreira<T>(orderId: string, disparar: () => Promise<T>[]): Promise<T[]> {
    let soltar!: () => void;
    const solta = new Promise<void>((r) => (soltar = r));
    let travou!: () => void;
    const travada = new Promise<void>((r) => (travou = r));
    const tx = prisma.$transaction(
      async (t) => {
        await t.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
        travou();
        await solta;
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
    await travada;
    const acoes = disparar();
    await sleep(700);
    soltar();
    await tx;
    return Promise.all(acoes);
  }

  const cancelarPainel = (l: Loja, id: string) =>
    app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: l.cookie }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
  const transicao = (l: Loja, id: string, to: string) =>
    app.inject({ method: "POST", url: `/api/orders/${id}/transition`, headers: { cookie: l.cookie }, payload: { to } });
  const cancelarCliente = (l: Loja, id: string) => app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders/${id}/cancel` });

  // Estados proibidos: dinheiro devolvido com pedido entregue/ativo, ou pedido cancelado com dinheiro retido.
  async function invariante(orderId: string, contexto: string) {
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true } });
    const par = `${o.status}/${o.payment?.status}`;
    expect(par, `${contexto}: pedido/pagamento = ${par}`).not.toMatch(/^(CONCLUIDO|CONFIRMADO|EM_PREPARO|PRONTO|PENDENTE)\/REEMBOLSADO$/);
    expect(par, contexto).not.toBe("CANCELADO/APROVADO");
    return o;
  }

  it(`C5 cancelar com estorno × CONCLUIR (pedido pago em PRONTO), ${ROUNDS} rodadas: um vence; nunca CONCLUIDO + REEMBOLSADO`, async () => {
    const l = await loja();
    const vencedores = new Set<string>();
    for (let i = 0; i < ROUNDS; i++) {
      refundPayment.mockClear();
      const id = await pedidoPago(l, "PRONTO");
      const [cancelar, concluir] = await comBarreira(id, () => [cancelarPainel(l, id), transicao(l, id, "CONCLUIDO")]);
      const o = await invariante(id, `rodada ${i} cancelar=${cancelar.statusCode} concluir=${concluir.statusCode}`);
      if (cancelar.statusCode === 200) {
        expect(concluir.statusCode).toBe(409);
        expect(`${o.status}/${o.payment?.status}`).toBe("CANCELADO/REEMBOLSADO");
        expect(refundPayment).toHaveBeenCalledTimes(1);
        vencedores.add("cancelar");
      } else {
        expect(concluir.statusCode).toBe(200);
        expect(cancelar.statusCode).toBe(409); // pedido já final: o estorno nem começa
        expect(`${o.status}/${o.payment?.status}`).toBe("CONCLUIDO/APROVADO");
        expect(refundPayment).not.toHaveBeenCalled(); // dinheiro intocado
        vencedores.add("concluir");
      }
    }
    // Sem a barreira nenhum dos dois ganhava sempre; só registramos quem venceu (varia com o agendamento do banco).
    expect(vencedores.size).toBeGreaterThan(0);
  });

  it(`cancelar com estorno × ACEITAR (pedido pago ainda PENDENTE), ${ROUNDS} rodadas: o pedido nunca fica aceito com o dinheiro devolvido`, async () => {
    const l = await loja();
    for (let i = 0; i < ROUNDS; i++) {
      refundPayment.mockClear();
      const id = await pedidoPago(l, "PENDENTE");
      const [cancelar, aceitar] = await comBarreira(id, () => [cancelarPainel(l, id), transicao(l, id, "CONFIRMADO")]);
      const o = await invariante(id, `rodada ${i} cancelar=${cancelar.statusCode} aceitar=${aceitar.statusCode}`);
      // O dono pode cancelar (com estorno) qualquer pedido ativo: "aceitar e depois cancelar" também é válido.
      // O que nunca pode: aceitar DEPOIS de o estorno começar, ou terminar aceito com o dinheiro devolvido.
      expect(cancelar.statusCode, `rodada ${i}`).toBe(200);
      expect([200, 409]).toContain(aceitar.statusCode);
      expect(`${o.status}/${o.payment?.status}`).toBe("CANCELADO/REEMBOLSADO");
      expect(refundPayment).toHaveBeenCalledTimes(1);
      const aceitos = await prisma.orderStatusHistory.count({ where: { orderId: id, status: "CONFIRMADO" } });
      expect(aceitos).toBe(aceitar.statusCode === 200 ? 1 : 0); // histórico coerente com a resposta
    }
  });

  it(`CLIENTE cancela × loja ACEITA (pedido pago), ${ROUNDS} rodadas: vence o primeiro e o resultado fecha com o dinheiro`, async () => {
    const l = await loja();
    for (let i = 0; i < ROUNDS; i++) {
      refundPayment.mockClear();
      const id = await pedidoPago(l, "PENDENTE");
      const [cliente, aceitar] = await comBarreira(id, () => [cancelarCliente(l, id), transicao(l, id, "CONFIRMADO")]);
      const o = await invariante(id, `rodada ${i} cliente=${cliente.statusCode} aceitar=${aceitar.statusCode}`);
      expect([cliente.statusCode, aceitar.statusCode].sort()).toEqual([200, 409]);
      expect(`${o.status}/${o.payment?.status}`).toBe(cliente.statusCode === 200 ? "CANCELADO/REEMBOLSADO" : "CONFIRMADO/APROVADO");
    }
  });

  it("o estorno congela o pedido NA LINHA: depois da Tx 1 nem um avanço que leu antes consegue concluir", async () => {
    const l = await loja();
    const id = await pedidoPago(l, "PRONTO");
    let liberar!: () => void;
    refundPayment.mockImplementationOnce(() => new Promise<void>((r) => (liberar = r))); // provedor "demora"
    const cancelando = cancelarPainel(l, id);
    await vi.waitFor(async () => expect((await prisma.order.findUnique({ where: { id } }))?.refundLockedAt).not.toBeNull());
    const concluir = await transicao(l, id, "CONCLUIDO");
    expect(concluir.statusCode).toBe(409);
    expect(json(concluir).code).toBe("REFUND_PENDING");
    expect((await prisma.order.findUnique({ where: { id } }))?.status).toBe("PRONTO");
    liberar();
    expect((await cancelando).statusCode).toBe(200);
    await invariante(id, "depois de liberar");
  });

  it("se o pedido ficou final no meio do estorno (defensivo): o dinheiro devolvido vira CONCILIAÇÃO visível, com alerta — nunca REEMBOLSADO em silêncio", async () => {
    const l = await loja();
    const id = await pedidoPago(l, "PRONTO");
    const sent: string[] = [];
    subscribe(l.store.id, { readyState: 1, OPEN: 1, send: (m: string) => sent.push(m), on: vi.fn() } as never);
    // Durante a chamada ao provedor, algo fora do fluxo normal conclui o pedido (a trava impede isso pelas rotas).
    refundPayment.mockImplementationOnce(async () => {
      await prisma.order.update({ where: { id }, data: { status: "CONCLUIDO" } });
    });
    const res = await cancelarPainel(l, id);
    expect(res.statusCode).toBe(200);
    const o = await prisma.order.findUniqueOrThrow({ where: { id }, include: { payment: true } });
    expect({ status: o.status, payment: o.payment?.status }).toEqual({ status: "CONCLUIDO", payment: "REEMBOLSADO" }); // o dinheiro voltou de fato
    expect(o.payment?.reconcileNote).toContain("CONCLUIDO");
    expect(sent.some((m) => m.includes("payment.reconcile_needed"))).toBe(true);
    expect(sent.some((m) => m.includes("order.cancel_notice"))).toBe(false); // não houve cancelamento de pedido
    await vi.waitFor(async () => expect(await prisma.auditLog.count({ where: { storeId: l.store.id, action: "order.refund_reconcile" } })).toBe(1));

    const listado = json(await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: l.cookie } })).orders.find((x: { id: string }) => x.id === id);
    expect(listado.payment).toMatchObject({ reconcileRequired: true, status: "REEMBOLSADO" });
  });
});
