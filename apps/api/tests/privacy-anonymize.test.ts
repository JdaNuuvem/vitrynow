// API-52 (LGPD, ADR-0014 §3.1; spec do Leonardo RN-PV-01..10, CA-PV-01..05 e 11): anonimizar cliente SEM destruir o financeiro.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { sendMfaCodeEmail } from "../src/lib/email";
import { ServerBusyError } from "../src/shared/errors";
import { bcryptPasswordHasher } from "../src/shared/passwordHasher";
import { AccountAttemptCap } from "../src/lib/accountAttemptCap";
import { login, makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/email", () => ({
  sendPasswordResetEmail: vi.fn(),
  sendMfaCodeEmail: vi.fn(),
}));
vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});

const PHONE = "11987654321";
const NOME = "Maria Conceição Silva";
const RUA = "Rua das Acácias, 1234, apto 56";
const OBS = "alergia a amendoim, portão azul";
const NOTA = "cliente VIP, ligar antes";
const DAY = 24 * 3_600_000;

// 60 s por teste: vários cadastram 2 lojas e cada execução paga um bcrypt; com a máquina carregada o padrão de 15 s estourava (timeout, não defeito).
describe("privacidade: anonimizar cliente", { timeout: 60_000 }, () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    delete process.env.MFA_ENFORCED;
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (r: { body: string }) => JSON.parse(r.body);
  let seq = 0;

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    const invited = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email: `staff-pv-${Date.now()}-${seq++}@t.com`, password: "provisoria1" } });
    const staff = (await login(app, json(invited).user.email, "provisoria1")).cookie!;
    return { owner: cookie!, staff, storeId };
  }

  async function mk(storeId: string, data: { status?: "CONCLUIDO" | "CANCELADO" | "PENDENTE" | "EM_PREPARO"; phone?: string | null; name?: string | null; ago?: number; total?: number; payment?: "PIX" | "DINHEIRO"; awaiting?: boolean } = {}) {
    seq += 1;
    const createdAt = new Date(Date.now() - (data.ago ?? 0));
    const order = await prisma.order.create({
      data: {
        storeId, code: `V${String(seq).padStart(4, "0")}`, type: "DELIVERY", status: data.status ?? "CONCLUIDO",
        customerName: data.name === undefined ? NOME : data.name, customerPhone: data.phone === undefined ? PHONE : data.phone,
        address: RUA, notes: OBS, internalNote: NOTA, totalCents: data.total ?? 2500, subtotalCents: data.total ?? 2500, paymentMethod: data.payment ?? "DINHEIRO",
        awaitingPayment: data.awaiting ?? false, createdAt, updatedAt: createdAt,
        items: { create: [{ productName: "Pizza", quantity: 1, unitPriceCents: data.total ?? 2500, notes: "sem cebola para a Maria" }] },
      },
    });
    await prisma.orderStatusHistory.create({ data: { orderId: order.id, status: data.status ?? "CONCLUIDO", createdAt: new Date(createdAt.getTime() + 600_000) } });
    return order.id;
  }

  const preview = (cookie: string, body: object) => app.inject({ method: "POST", url: "/api/privacy/anonymize/preview", headers: { cookie }, payload: body });
  const SENHA = "senha12345"; // a senha do `registerStore`; sem MFA ativa a execução pede a senha atual (parecer da Nightingale R1)
  const run = (cookie: string, body: object, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: "/api/privacy/anonymize", headers: { cookie, ...headers }, payload: { currentPassword: SENHA, ...body } });
  const summary = async (cookie: string) => json(await app.inject({ method: "GET", url: `/api/reports/summary?from=2020-01-01&to=${new Date(Date.now() + DAY).toISOString().slice(0, 10)}`, headers: { cookie } })); // `to` fixo: o campo `to` devolvido é o relógio da consulta

  it("CA-PV-01: 7 encerrados + 1 em aberto ⇒ BLOQUEIA citando o aberto; depois de concluir, anonimiza os 8", async () => {
    const ctx = await setup();
    for (let i = 0; i < 7; i++) await mk(ctx.storeId, { ago: (i + 1) * DAY });
    const aberto = await mk(ctx.storeId, { status: "EM_PREPARO", ago: 60_000 });
    const codigoAberto = (await prisma.order.findUniqueOrThrow({ where: { id: aberto } })).code;

    const prev = json(await preview(ctx.owner, { phone: PHONE }));
    expect(prev).toMatchObject({ orders: 8, blocked: true, blockers: [{ code: codigoAberto, status: "EM_PREPARO", reason: "OPEN" }], phoneMasked: "*******4321" });
    const bloqueado = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 8 });
    expect(bloqueado.statusCode).toBe(409);
    expect(json(bloqueado)).toMatchObject({ code: "OPEN_ORDERS", orders: [{ code: codigoAberto }] });
    expect(await prisma.order.count({ where: { storeId: ctx.storeId, anonymizedAt: { not: null } } })).toBe(0); // nada foi tocado

    await prisma.order.update({ where: { id: aberto }, data: { status: "CONCLUIDO" } });
    const ok = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 8 });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(json(ok)).toEqual({ anonymized: 8, nothingToRemove: false });
  });

  it("RN-PV-03: some TUDO o que é pessoal (nome, telefone, endereço, observações, nota interna, observação dos itens); FICA o financeiro e o resto", async () => {
    const ctx = await setup();
    const id = await mk(ctx.storeId, { total: 4321 });
    const antes = await prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
    expect((await run(ctx.owner, { phone: PHONE, reason: "STORE_DECISION", expectedOrders: 1 })).statusCode).toBe(200);
    const depois = await prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true, statusHistory: true } });
    expect(depois).toMatchObject({ customerName: null, customerPhone: null, address: null, notes: null, internalNote: null });
    expect(depois.anonymizedAt).toBeInstanceOf(Date);
    expect(depois.items[0].notes).toBeNull();
    // o que FICA, idêntico
    for (const campo of ["code", "type", "status", "totalCents", "subtotalCents", "discountCents", "deliveryFeeCents", "tipCents", "paymentMethod", "createdAt"] as const) {
      expect(depois[campo], campo).toEqual(antes[campo]);
    }
    expect(depois.items[0]).toMatchObject({ productName: "Pizza", quantity: 1, unitPriceCents: 4321 });
    expect(depois.statusHistory).toHaveLength(1);
    expect(depois.updatedAt.getTime()).toBe(antes.updatedAt.getTime()); // anonimizar não é atividade do pedido
  });

  it("CA-PV-02: faturamento, pedidos, ticket médio, por forma de pagamento e por dia são IDÊNTICOS antes e depois; só 'clientes distintos' diminui", async () => {
    const ctx = await setup();
    for (let i = 0; i < 4; i++) await mk(ctx.storeId, { ago: (i + 1) * DAY, total: 1000 + i * 100, payment: i % 2 ? "PIX" : "DINHEIRO" });
    await mk(ctx.storeId, { ago: DAY, phone: "21999990000", name: "Outro Cliente", total: 3000 }); // outra pessoa: não pode mudar
    const antes = await summary(ctx.owner);
    expect((await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 4 })).statusCode).toBe(200);
    const depois = await summary(ctx.owner);
    const { customerCount: cAntes, ...restoAntes } = antes;
    const { customerCount: cDepois, ...restoDepois } = depois;
    expect(restoDepois).toEqual(restoAntes);
    expect(cAntes).toBe(2);
    expect(cDepois).toBe(1); // RN-PV-05: a pessoa removida deixa de ser contada; o outro cliente continua
  });

  it("CA-PV-03: depois de anonimizar a busca por telefone e por nome NÃO acha; a lista e o detalhe não trazem o dado e marcam `anonymized`", async () => {
    const ctx = await setup();
    const id = await mk(ctx.storeId);
    await mk(ctx.storeId, { phone: "21999990000", name: "Outro Cliente" });
    const achaAntes = json(await app.inject({ method: "GET", url: `/api/orders/history?q=${PHONE}`, headers: { cookie: ctx.owner } }));
    expect(achaAntes.rows.map((r: { id: string }) => r.id)).toEqual([id]);
    expect((await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1 })).statusCode).toBe(200);
    for (const q of [PHONE, "4321", "Maria", "conceicao", "Acácias"]) {
      const res = json(await app.inject({ method: "GET", url: `/api/orders/history?q=${encodeURIComponent(q)}`, headers: { cookie: ctx.owner } }));
      expect(res.rows.map((r: { id: string }) => r.id), q).not.toContain(id);
    }
    const lista = json(await app.inject({ method: "GET", url: "/api/orders/history", headers: { cookie: ctx.owner } })).rows as { id: string; anonymized: boolean; customerName: string | null; hasPhone: boolean }[];
    expect(lista.find((r) => r.id === id)).toMatchObject({ anonymized: true, customerName: null, hasPhone: false });
    expect(lista.find((r) => r.id !== id)).toMatchObject({ anonymized: false });
    const detalhe = (await app.inject({ method: "GET", url: `/api/orders/${id}`, headers: { cookie: ctx.owner } })).body;
    for (const dado of [PHONE, NOME, "Acácias", OBS, NOTA, "sem cebola"]) expect(detalhe, dado).not.toContain(dado);
    expect(json({ body: detalhe }).order).toMatchObject({ anonymized: true, customerName: null, customerPhone: null, address: null });
  });

  it("CA-PV-04: STAFF recebe 403 FORBIDDEN_ROLE (prévia e execução); sem sessão, 401; OWNER sem MFA válida (ativa) recebe MFA_REQUIRED e nada muda", async () => {
    const ctx = await setup();
    await mk(ctx.storeId);
    for (const [url, body] of [["/api/privacy/anonymize/preview", { phone: PHONE }], ["/api/privacy/anonymize", { phone: PHONE, reason: "STORE_DECISION", expectedOrders: 1 }]] as const) {
      const res = await app.inject({ method: "POST", url, headers: { cookie: ctx.staff }, payload: body });
      expect(res.statusCode, url).toBe(403);
      expect(json(res).code, url).toBe("FORBIDDEN_ROLE");
      expect((await app.inject({ method: "POST", url, payload: body })).statusCode, `${url} sem sessão`).toBe(401);
    }
    process.env.MFA_ENFORCED = "true";
    const semMfa = await run(ctx.owner, { phone: PHONE, reason: "STORE_DECISION", expectedOrders: 1 }); // com a senha CERTA no corpo: com MFA ativa a senha NÃO substitui o código
    expect(semMfa.statusCode).toBe(403);
    expect(json(semMfa)).toMatchObject({ code: "MFA_REQUIRED", purpose: "anonymize_customer" });
    expect(await prisma.order.count({ where: { storeId: ctx.storeId, anonymizedAt: { not: null } } })).toBe(0);

    // com a prova verificada para ESTA ação, passa (uso único)
    const desafio = json(await app.inject({ method: "POST", url: "/api/mfa/challenge", headers: { cookie: ctx.owner }, payload: { purpose: "anonymize_customer" } }));
    const code = vi.mocked(sendMfaCodeEmail).mock.calls.at(-1)![0].code;
    expect((await app.inject({ method: "POST", url: "/api/mfa/verify", headers: { cookie: ctx.owner }, payload: { challengeId: desafio.challengeId, code } })).statusCode).toBe(200);
    const ok = await run(ctx.owner, { phone: PHONE, reason: "STORE_DECISION", expectedOrders: 1 }, { "x-mfa-challenge": desafio.challengeId });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(json(await run(ctx.owner, { phone: PHONE, reason: "STORE_DECISION", expectedOrders: 1 }, { "x-mfa-challenge": desafio.challengeId })).code).toBe("MFA_REQUIRED"); // a prova não vale duas vezes
  });

  it("REAUTENTICAÇÃO (R1): sem MFA ativa a execução exige a SENHA atual: ausente ⇒ 403 REAUTH_REQUIRED, errada ⇒ 403 PASSWORD_INVALID, e NADA muda; certa passa; a prévia não pede senha", async () => {
    const ctx = await setup();
    await mk(ctx.storeId);
    const intacto = async () => (await prisma.order.count({ where: { storeId: ctx.storeId, anonymizedAt: { not: null } } })) === 0;
    const semSenha = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1, currentPassword: undefined });
    expect(semSenha.statusCode).toBe(403);
    expect(json(semSenha).code).toBe("REAUTH_REQUIRED");
    const errada = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1, currentPassword: "senha-errada-1" });
    expect(errada.statusCode).toBe(403);
    expect(json(errada).code).toBe("PASSWORD_INVALID");
    expect(errada.body).not.toContain("senha-errada-1"); // nunca ecoa a senha
    expect(await intacto()).toBe(true);
    expect((await preview(ctx.owner, { phone: PHONE })).statusCode).toBe(200); // a prévia não é irreversível: sem senha
    expect((await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1 })).statusCode).toBe(200);
    // a senha nunca vai para a auditoria nem para o log
    const audit = JSON.stringify(await prisma.auditLog.findMany({ where: { storeId: ctx.storeId } }));
    expect(audit).not.toContain(SENHA);
    expect(audit).not.toContain("senha-errada");
  });

  it("a senha errada conta numa trava: depois de 5 erros o 6º pedido (mesmo com a senha certa) leva 429 RATE_LIMITED sem testar a senha", async () => {
    const ctx = await setup();
    await mk(ctx.storeId);
    for (let i = 0; i < 5; i++) {
      const res = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1, currentPassword: `errada-${i}-xxxx` });
      expect(res.statusCode, String(i)).toBe(403);
    }
    const barrado = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1 }); // senha CERTA, mas a trava já fechou
    expect(barrado.statusCode).toBe(429);
    expect(json(barrado).code).toBe("RATE_LIMITED");
    expect(barrado.headers["retry-after"]).toBeDefined();
    expect(await prisma.order.count({ where: { storeId: ctx.storeId, anonymizedAt: { not: null } } })).toBe(0);
  });

  it("teto por CONTA de qualquer IP (sessão roubada troca de IP): 10 erros de IPs DIFERENTES ⇒ a 11ª tentativa, de IP novo e com a senha CERTA, leva 429 e nada é anonimizado; outro dono segue livre", async () => {
    const ctx = await setup();
    const outro = await setup();
    await mk(ctx.storeId);
    await mk(outro.storeId);
    const deIp = (cookie: string, ip: string, password: string, expectedOrders = 1) =>
      app.inject({ method: "POST", url: "/api/privacy/anonymize", headers: { cookie }, remoteAddress: ip, payload: { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders, currentPassword: password } });
    for (let i = 0; i < 10; i++) {
      const res = await deIp(ctx.owner, `203.0.113.${10 + i}`, `errada-${i}-xxxx`); // cada IP erra UMA vez: o limite por (conta, IP) nunca dispara
      expect(res.statusCode, `erro ${i}`).toBe(403);
    }
    const barrada = await deIp(ctx.owner, "203.0.113.200", SENHA); // IP novo, senha CERTA
    expect(barrada.statusCode).toBe(429);
    expect(json(barrada).code).toBe("RATE_LIMITED");
    expect(barrada.headers["retry-after"]).toBeDefined();
    expect(await prisma.order.count({ where: { storeId: ctx.storeId, anonymizedAt: { not: null } } })).toBe(0);
    // o teto é POR CONTA: o dono de outra loja não é afetado
    expect((await deIp(outro.owner, "203.0.113.201", SENHA)).statusCode).toBe(200);
  });

  it("AccountAttemptCap: reserva síncrona (rajada paralela não passa do teto), a senha certa devolve, a janela anda e as contas são independentes", () => {
    let t = 1_000_000;
    const cap = new AccountAttemptCap(3, 60_000, () => t);
    expect([cap.reserve("a").allowed, cap.reserve("a").allowed, cap.reserve("a").allowed, cap.reserve("a").allowed]).toEqual([true, true, true, false]);
    const negada = cap.reserve("a");
    expect(negada).toMatchObject({ allowed: false });
    expect((negada as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
    expect(cap.reserve("b").allowed).toBe(true); // outra conta
    cap.succeed("a"); // senha certa devolve uma reserva
    expect(cap.reserve("a").allowed).toBe(true);
    expect(cap.reserve("a").allowed).toBe(false);
    t += 60_001; // a janela passou
    expect(cap.reserve("a").allowed).toBe(true);
    // rajada de 50 reservas no mesmo tique: só o teto passa
    const rajada = Array.from({ length: 50 }, () => cap.reserve("c").allowed).filter(Boolean).length;
    expect(rajada).toBe(3);
  });

  it("RN-PV-28: senha AUSENTE não gasta tentativa (só a errada conta): 8 pedidos sem senha ⇒ 403 REAUTH_REQUIRED e depois a senha certa ainda passa; a prévia diz `reauth: PASSWORD` (ou `MFA` com MFA ativa)", async () => {
    const ctx = await setup();
    await mk(ctx.storeId);
    // 8 < 10 (limite de rota por minuto) e > 5 (se gastassem tentativa, o par (conta, IP) fecharia e a senha certa levaria 429)
    for (let i = 0; i < 8; i++) {
      const res = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1, currentPassword: undefined });
      expect(res.statusCode, `sem senha ${i}`).toBe(403);
      expect(json(res).code).toBe("REAUTH_REQUIRED");
    }
    expect(json(await preview(ctx.owner, { phone: PHONE })).reauth).toBe("PASSWORD");
    process.env.MFA_ENFORCED = "true";
    expect(json(await preview(ctx.owner, { phone: PHONE })).reauth).toBe("MFA");
    delete process.env.MFA_ENFORCED;
    expect((await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1 })).statusCode).toBe(200); // nenhuma tentativa foi gasta
  });

  it("SEC-34: a reautenticação passa pela faixa de hash; faixa cheia ⇒ 503 SERVER_BUSY, NENHUMA senha testada e as DUAS reservas (par e conta) voltam; nada é anonimizado", async () => {
    const ctx = await setup();
    await mk(ctx.storeId);
    const busy = vi.spyOn(bcryptPasswordHasher, "verify").mockRejectedValue(new ServerBusyError());
    try {
      // 12 recusas seguidas: se a reserva não voltasse, o par fecharia em 5 (429) e o teto da conta em 10
      for (let i = 0; i < 8; i++) {
        const res = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1 });
        expect(res.statusCode, `ocupado ${i}`).toBe(503);
        expect(json(res).code).toBe("SERVER_BUSY");
        expect(res.headers["retry-after"]).toBeDefined();
      }
    } finally {
      busy.mockRestore();
    }
    expect(await prisma.order.count({ where: { storeId: ctx.storeId, anonymizedAt: { not: null } } })).toBe(0);
    expect((await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1 })).statusCode).toBe(200); // a faixa livre: passa, as reservas voltaram
  });

  it("auditoria em LOTES de 500 ids: 1.001 pedidos ⇒ 3 linhas (500+500+1), com todos os `orderIds` (reaplicação depois de restaurar backup) e sem dado pessoal", async () => {
    const ctx = await setup();
    const base = Date.now() - 5 * DAY;
    await prisma.order.createMany({
      data: Array.from({ length: 1001 }, (_, i) => ({
        storeId: ctx.storeId, code: `L${String(i).padStart(5, "0")}`, type: "BALCAO" as const, status: "CONCLUIDO" as const, customerName: NOME, customerPhone: PHONE,
        totalCents: 1000, awaitingPayment: false, createdAt: new Date(base + i * 1000), updatedAt: new Date(base + i * 1000),
      })),
    });
    const res = await run(ctx.owner, { phone: PHONE, reason: "STORE_DECISION", expectedOrders: 1001 });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ anonymized: 1001, nothingToRemove: false });
    const linhas = await prisma.auditLog.findMany({ where: { storeId: ctx.storeId, action: "privacy.anonymize_customer" }, orderBy: { createdAt: "asc" } });
    expect(linhas).toHaveLength(3);
    const metas = linhas.map((l) => l.metadata as { orders: number; orderIds: string[]; batch: number; batches: number });
    expect(metas.map((m) => m.orderIds.length).sort((a, b) => b - a)).toEqual([500, 500, 1]);
    expect(metas.every((m) => m.orders === 1001 && m.batches === 3)).toBe(true);
    const todos = new Set(metas.flatMap((m) => m.orderIds));
    const noBanco = await prisma.order.findMany({ where: { storeId: ctx.storeId }, select: { id: true } });
    expect(todos.size).toBe(1001);
    expect([...todos].sort()).toEqual(noBanco.map((o) => o.id).sort());
    const texto = JSON.stringify(linhas);
    for (const dado of [PHONE, NOME, "Maria"]) expect(texto).not.toContain(dado);
  }, 120_000);

  it("R2: a prévia por telefone diz que casa o número EXATO; um dígito diferente não acha ninguém", async () => {
    const ctx = await setup();
    await mk(ctx.storeId, { phone: "11987654321" });
    expect(json(await preview(ctx.owner, { phone: "11987654321" }))).toMatchObject({ orders: 1, phoneMatch: "EXACT_NUMBER" });
    expect(json(await preview(ctx.owner, { phone: "11987654322" }))).toMatchObject({ orders: 0, nothingToRemove: false, phoneMatch: "EXACT_NUMBER" });
    expect(json(await preview(ctx.owner, { phone: "1198765432" })).orders).toBe(0); // sem o último dígito
  });

  it("a confirmação repete o efeito: `expectedOrders` diferente da prévia ⇒ 409 COUNT_CHANGED e nada é feito", async () => {
    const ctx = await setup();
    await mk(ctx.storeId);
    await mk(ctx.storeId);
    const res = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1 });
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: "COUNT_CHANGED", orders: 2 });
    expect(await prisma.order.count({ where: { storeId: ctx.storeId, anonymizedAt: { not: null } } })).toBe(0);
  });

  it("só pedido ENCERRADO: PIX ainda AGUARDANDO (pedido aberto) e estorno em curso bloqueiam; PIX EXPIRADO/cancelado com awaitingPayment=true NÃO trava o titular", async () => {
    const ctx = await setup();
    const cancelado = await mk(ctx.storeId, { status: "CANCELADO" });
    const pix = await mk(ctx.storeId, { status: "PENDENTE", awaiting: true, payment: "PIX" });
    const bloqueio = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 2 });
    expect(bloqueio.statusCode).toBe(409);
    expect(json(bloqueio).orders).toHaveLength(1); // o PIX aguardando: pedido ainda aberto
    expect(json(bloqueio).error).toBe("Este cliente tem 1 pedido em andamento. Conclua ou cancele antes."); // singular

    // o PIX expirou e o pedido foi cancelado: `awaitingPayment` continua TRUE (só vira falso quando o pagamento é aprovado) e NÃO pode travar
    await prisma.order.update({ where: { id: pix }, data: { status: "CANCELADO" } });
    await prisma.payment.create({ data: { orderId: pix, amountCents: 2500, status: "EXPIRADO" } });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: pix } })).awaitingPayment).toBe(true);

    await prisma.payment.create({ data: { orderId: cancelado, amountCents: 2500, status: "ESTORNO_PENDENTE" } });
    const estorno = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 2 });
    expect(estorno.statusCode).toBe(409);
    expect(json(estorno).orders).toEqual([expect.objectContaining({ reason: "REFUND_PENDING" })]); // só o estorno bloqueia; o PIX expirado não
    await prisma.payment.update({ where: { orderId: cancelado }, data: { status: "REEMBOLSADO" } });
    expect((await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 2 })).statusCode).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: pix } })).customerPhone).toBeNull(); // o do PIX expirado também foi anonimizado
  });

  it("refundLockedAt (estorno travando a linha) também bloqueia; plural na mensagem", async () => {
    const ctx = await setup();
    const a = await mk(ctx.storeId, { status: "CANCELADO" });
    const b = await mk(ctx.storeId, { status: "CANCELADO" });
    await prisma.order.updateMany({ where: { id: { in: [a, b] } }, data: { refundLockedAt: new Date() } });
    const res = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 2 });
    expect(res.statusCode).toBe(409);
    expect(json(res).error).toBe("Este cliente tem 2 pedidos em andamento. Conclua ou cancele antes."); // plural
    expect(json(res).orders).toHaveLength(2);
  });

  it("OrderStatusHistory.reasonText (texto livre da equipe) sai; `reasonCode` FICA, então o relatório de cancelamentos não muda; e só o texto basta para o pedido ter o que anonimizar", async () => {
    const ctx = await setup();
    const id = await mk(ctx.storeId, { status: "CANCELADO" });
    await prisma.orderStatusHistory.create({ data: { orderId: id, status: "CANCELADO", kind: "CANCEL", reasonCode: "ITEM_EM_FALTA", reasonText: "o João Pereira (11955554444) pediu para cancelar" } });
    const ctas = async () => (await prisma.orderStatusHistory.findMany({ where: { orderId: id, reasonCode: { not: null } } })).map((h) => h.reasonCode);
    expect(await ctas()).toEqual(["ITEM_EM_FALTA"]);
    expect((await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1 })).statusCode).toBe(200);
    const historico = await prisma.orderStatusHistory.findMany({ where: { orderId: id } });
    expect(JSON.stringify(historico)).not.toContain("João");
    expect(JSON.stringify(historico)).not.toContain("11955554444");
    expect(historico.every((h) => h.reasonText === null)).toBe(true);
    expect(await ctas()).toEqual(["ITEM_EM_FALTA"]); // o código do motivo continua

    // pedido que só tem o texto livre (sem nome, telefone, endereço...) ainda conta como "tem o que remover"
    const soTexto = await mk(ctx.storeId, { status: "CANCELADO", phone: null, name: null });
    await prisma.order.update({ where: { id: soTexto }, data: { address: null, notes: null, internalNote: null } });
    await prisma.orderItem.updateMany({ where: { orderId: soTexto }, data: { notes: null } });
    const codigo = (await prisma.order.findUniqueOrThrow({ where: { id: soTexto } })).code;
    await prisma.orderStatusHistory.create({ data: { orderId: soTexto, status: "CANCELADO", kind: "CANCEL", reasonCode: "OUTRO", reasonText: "falou com a Dona Maria" } });
    expect(json(await preview(ctx.owner, { orderCode: codigo })).orders).toBe(1);
    expect(json(await run(ctx.owner, { orderCode: codigo, reason: "HOLDER_REQUEST", expectedOrders: 1 }))).toEqual({ anonymized: 1, nothingToRemove: false });
  });

  it("prévia por CÓDIGO devolve `otherOrdersSamePhone` (só a CONTAGEM de outros pedidos do mesmo telefone, com formatação e 55); por telefone devolve 0; nunca o telefone", async () => {
    const ctx = await setup();
    const outra = await setup();
    const alvo = await mk(ctx.storeId, { phone: "11987654321" });
    await mk(ctx.storeId, { phone: "(11) 98765-4321" });
    await mk(ctx.storeId, { phone: "+55 11 98765-4321" });
    await mk(ctx.storeId, { phone: "11900000000", name: "Outra Pessoa" }); // outra pessoa: não conta
    await mk(outra.storeId, { phone: "11987654321" }); // mesmo telefone em OUTRA loja: não conta
    const codigo = (await prisma.order.findUniqueOrThrow({ where: { id: alvo } })).code;
    const porCodigo = await preview(ctx.owner, { orderCode: codigo });
    expect(json(porCodigo)).toMatchObject({ orders: 1, otherOrdersSamePhone: 2 });
    expect(porCodigo.body).not.toContain("98765");
    expect(porCodigo.body).not.toContain("11987654321");
    expect(json(await preview(ctx.owner, { phone: "11987654321" }))).toMatchObject({ orders: 3, otherOrdersSamePhone: 0 });
    // depois de anonimizar só o pedido do código, o aviso passa a refletir os que ficaram
    expect((await run(ctx.owner, { orderCode: codigo, reason: "HOLDER_REQUEST", expectedOrders: 1 })).statusCode).toBe(200);
    expect(json(await preview(ctx.owner, { phone: "11987654321" })).orders).toBe(2); // os outros 2 continuam com o dado (o aviso servia)
  });

  it("RN-PV-07 e idempotência: segunda chamada e pedido sem dado pessoal respondem 'nada a remover' sem gravar nada; busca por CÓDIGO funciona", async () => {
    const ctx = await setup();
    const semDado = await mk(ctx.storeId, { phone: null, name: null });
    await prisma.order.update({ where: { id: semDado }, data: { address: null, notes: null, internalNote: null } });
    await prisma.orderItem.updateMany({ where: { orderId: semDado }, data: { notes: null } });
    const codigo = (await prisma.order.findUniqueOrThrow({ where: { id: semDado } })).code;
    expect(json(await preview(ctx.owner, { orderCode: codigo }))).toMatchObject({ orders: 0, nothingToRemove: true, blocked: false });
    expect(json(await run(ctx.owner, { orderCode: codigo, reason: "HOLDER_REQUEST", expectedOrders: 1 }))).toEqual({ anonymized: 0, nothingToRemove: true });

    const comDado = await mk(ctx.storeId);
    const cod2 = (await prisma.order.findUniqueOrThrow({ where: { id: comDado } })).code;
    expect(json(await run(ctx.owner, { orderCode: cod2.replace(/^V0*/, ""), reason: "HOLDER_REQUEST", expectedOrders: 1 }))).toMatchObject({ anonymized: 0 }); // "V…" não é só número: não casa por zeros
    expect(json(await run(ctx.owner, { orderCode: cod2, reason: "HOLDER_REQUEST", expectedOrders: 1 }))).toEqual({ anonymized: 1, nothingToRemove: false });
    expect(json(await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1 }))).toEqual({ anonymized: 0, nothingToRemove: true }); // já anonimizado
    expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "privacy.anonymize_customer" } })).toBe(1); // só a execução real grava
  });

  it("telefone com formatação e com código do país (55) acham a mesma pessoa; outra pessoa e outra LOJA não são tocadas", async () => {
    const a = await setup();
    const b = await setup();
    const alvo = await mk(a.storeId, { phone: "(11) 98765-4321" });
    const comPais = await mk(a.storeId, { phone: "+55 11 98765-4321" });
    const outro = await mk(a.storeId, { phone: "11987654322", name: "Outra Pessoa" });
    const deB = await mk(b.storeId); // MESMO telefone, em outra loja
    expect(json(await preview(a.owner, { phone: "5511987654321" })).orders).toBe(2);
    expect((await run(a.owner, { phone: "11 98765-4321", reason: "HOLDER_REQUEST", expectedOrders: 2 })).statusCode).toBe(200);
    const estado = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).anonymizedAt !== null;
    expect([await estado(alvo), await estado(comPais), await estado(outro), await estado(deB)]).toEqual([true, true, false, false]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: deB } })).customerPhone).toBe(PHONE); // a loja B segue intacta
  });

  it("validação: sem alvo, com os dois alvos, telefone curto e motivo fora da lista ⇒ 400; motivo livre nunca entra", async () => {
    const ctx = await setup();
    await mk(ctx.storeId);
    for (const body of [{}, { phone: PHONE, orderCode: "V0001" }, { orderCode: "" }]) expect((await preview(ctx.owner, body)).statusCode, JSON.stringify(body)).toBe(400);
    for (const body of [
      { phone: PHONE, reason: "porque sim", expectedOrders: 1 },
      { phone: PHONE, expectedOrders: 1 },
      { phone: PHONE, reason: "HOLDER_REQUEST" },
      { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 0 },
      { phone: "12345", reason: "HOLDER_REQUEST", expectedOrders: 1 },
    ]) expect((await run(ctx.owner, body)).statusCode, JSON.stringify(body)).toBe(400);
  });

  it("auditoria: a execução grava quantidade, período e motivo SEM o dado removido; e `feedback` e `store.settings_update` não guardam texto (CA-PV-11, varredura)", async () => {
    const ctx = await setup();
    const pedido = await mk(ctx.storeId);
    const SEGREDO_FEEDBACK = "meu telefone 11955554444 e o cliente Joaquim Pereira reclamou";
    expect((await app.inject({ method: "POST", url: "/api/feedback", headers: { cookie: ctx.owner }, payload: { message: SEGREDO_FEEDBACK } })).statusCode).toBe(201);
    const ajuste = await app.inject({ method: "POST", url: "/api/store/settings", headers: { cookie: ctx.owner }, payload: { address: "Av. Brasil 100, Centro", whatsapp: "11944443333" } });
    expect([200, 404], ajuste.body).toContain(ajuste.statusCode);
    expect((await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1 })).statusCode).toBe(200);

    await vi.waitFor(async () => {
      const acoes = (await prisma.auditLog.findMany({ where: { storeId: ctx.storeId } })).map((l) => l.action);
      expect(acoes).toEqual(expect.arrayContaining(["feedback.sent", "privacy.anonymize_customer"]));
    });
    const todas = JSON.stringify(await prisma.auditLog.findMany({ where: { storeId: ctx.storeId } }));
    for (const dado of [PHONE, "98765", NOME, "Maria", RUA, "Acácias", OBS, NOTA, SEGREDO_FEEDBACK, "Joaquim", "11955554444", "Av. Brasil", "11944443333"]) expect(todas, `AuditLog vazou: ${dado}`).not.toContain(dado);
    const anon = await prisma.auditLog.findFirstOrThrow({ where: { storeId: ctx.storeId, action: "privacy.anonymize_customer" } });
    expect(anon.metadata).toMatchObject({ orders: 1, by: "PHONE", reason: "HOLDER_REQUEST", orderIds: [pedido] }); // os ids (opacos) permitem REAPLICAR depois de restaurar um backup
    // o texto do feedback existe, mas na tabela PRÓPRIA
    expect((await prisma.feedback.findMany({ where: { storeId: ctx.storeId } })).map((f) => f.message)).toEqual([SEGREDO_FEEDBACK]);
  });
});
