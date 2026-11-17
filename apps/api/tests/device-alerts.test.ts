// PC-24 (servidor) — alertas dos dispositivos de impressão + detector `QUEUE_WITHOUT_PRINTER`. TELEMETRIA NÃO CONFIÁVEL.
// Critérios de aceite da Nightingale: C1 formato do orderId antes da consulta e mesma resposta/gravação; C2 corpo estrito e pequeno;
// C3 painel por CÓDIGO do pedido; C4 MODE_RECOVERED do cliente não apaga o alerta do servidor; C5 401 sem gravar, retenção, só OWNER, sem PII.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { subscribe } from "../src/realtime/hub";
import { resetLimits } from "../src/lib/slidingLimit";
import { queueWatchJob, QUEUE_WATCH_MINUTES } from "../src/jobs/queueWatch";
import { techCleanupJob, TECH_CLEANUP_ALLOWLIST } from "../src/jobs/techCleanup";
import { ALERT_NEW_ROWS_PER_HOUR, DeviceAlertService } from "../src/modules/deviceAlerts/deviceAlerts.service";
import { makeApp, registerStore, resetDb } from "./helpers";

const log = { info: () => {}, warn: () => {}, error: () => {} };

describe("PC-24 — alertas de dispositivo", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    resetLimits(); // o limite é por processo: cada teste começa com os baldes limpos
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
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const { id: storeId, slug } = json(response).store;
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } })).product.id as string;
    const mkToken = async (label = "PC") => json(await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: cookie! }, payload: { label } })).token.token as string;
    return { owner: cookie!, storeId: storeId as string, slug: slug as string, productId, token: await mkToken(), mkToken };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const order = async (ctx: Ctx, extra: Record<string, unknown> = {}) => {
    const r = await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }], ...extra } });
    expect(r.statusCode, r.body).toBe(201);
    return json(r) as { orderId: string; code: string };
  };
  const alert = (token: string, body: unknown) => app.inject({ method: "POST", url: "/api/device/alerts", headers: { ...bearer(token), "content-type": "application/json" }, payload: body as never });
  const rows = (storeId: string) => prisma.deviceAlert.findMany({ where: { storeId }, orderBy: { firstAt: "asc" } });
  const sockets = (storeId: string) => {
    const sent: string[] = [];
    subscribe(storeId, { readyState: 1, OPEN: 1, send: (m: string) => sent.push(m), on: vi.fn() } as never);
    return sent;
  };
  async function staffCookie(ctx: Ctx) {
    const invite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: ctx.owner }, payload: { email: `staff-${Date.now()}@t.com`, password: "provisoria1" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: json(invite).user.email, password: "provisoria1" } });
    return (login.headers["set-cookie"] as string).split(";")[0];
  }

  // ───────────── rota do dispositivo ─────────────
  it("204 sem corpo; grava loja, token e versão; o evento do painel leva SÓ o código", async () => {
    const ctx = await setup();
    const ws = sockets(ctx.storeId);
    const r = await alert(ctx.token, { code: "MODE_UNCONFIRMED", clientVersion: "1.4.2-rc.1" });
    expect([r.statusCode, r.body]).toEqual([204, ""]);
    const [row] = await rows(ctx.storeId);
    expect(row).toMatchObject({ code: "MODE_UNCONFIRMED", clientVersion: "1.4.2-rc.1", count: 1, orderId: null, orderKey: "" });
    expect(row.tokenId).not.toBeNull();
    expect(ws.filter((m) => m.includes("device.alert")).map((m) => JSON.parse(m))).toEqual([{ type: "device.alert", code: "MODE_UNCONFIRMED" }]);
    expect(r.headers["x-print-mode"]).toBe("LEGACY"); // como nas outras rotas /api/device/*
  });

  it("DEDUPE ATÔMICO: 25 alertas iguais simultâneos ⇒ 1 linha com count 25, e o painel é acordado UMA vez", async () => {
    const ctx = await setup();
    const ws = sockets(ctx.storeId);
    const results = await Promise.all(Array.from({ length: 25 }, () => alert(ctx.token, { code: "MODE_UNCONFIRMED", clientVersion: "1.0.0" })));
    expect(results.every((r) => r.statusCode === 204)).toBe(true);
    const all = await rows(ctx.storeId);
    expect(all).toHaveLength(1);
    expect(all[0].count).toBe(25);
    expect(ws.filter((m) => m.includes("device.alert"))).toHaveLength(1);
  });

  it("códigos diferentes e pedidos diferentes são linhas diferentes; outra janela de 10 min abre nova linha", async () => {
    const ctx = await setup();
    const a = await order(ctx);
    const b = await order(ctx);
    await alert(ctx.token, { code: "EMPTY_ZERO_TICKET", orderId: a.orderId });
    await alert(ctx.token, { code: "EMPTY_ZERO_TICKET", orderId: b.orderId });
    await alert(ctx.token, { code: "MODE_UNCONFIRMED" });
    expect(await rows(ctx.storeId)).toHaveLength(3);
    // a mesma chave numa janela ANTERIOR não é incrementada: simula movendo a linha para 11 min atrás
    await prisma.deviceAlert.updateMany({ where: { storeId: ctx.storeId, code: "MODE_UNCONFIRMED" }, data: { windowStart: new Date(Date.now() - 11 * 60_000) } });
    await alert(ctx.token, { code: "MODE_UNCONFIRMED" });
    expect((await rows(ctx.storeId)).filter((r) => r.code === "MODE_UNCONFIRMED")).toHaveLength(2);
  });

  it("C1 orderId: da loja ⇒ gravado; de OUTRA loja, inexistente ou de formato inválido ⇒ gravado SEM o id; resposta idêntica (204) nos 4 casos", async () => {
    const a = await setup();
    const b = await setup();
    const propria = await order(a);
    const alheia = await order(b);
    const respostas: [number, string][] = [];
    for (const orderId of [propria.orderId, alheia.orderId, "c" + "x".repeat(24), "../../etc/passwd", "x".repeat(60)]) {
      const r = await alert(a.token, { code: "NOTHING_TO_CHARGE_CONFLICT", orderId });
      respostas.push([r.statusCode, r.body]);
    }
    expect(new Set(respostas.map((r) => r.join("|")))).toEqual(new Set(["204|"]));
    const gravadas = await rows(a.storeId);
    const comId = gravadas.filter((r) => r.orderId);
    expect(comId).toHaveLength(1);
    expect(comId[0].orderId).toBe(propria.orderId);
    expect(gravadas.some((r) => r.orderId === alheia.orderId)).toBe(false); // nada de outra loja entra
    expect(await rows(b.storeId)).toHaveLength(0); // e o alerta de A não aparece na loja B
  });

  it("C1 anti-tempo: com orderId de formato válido a consulta roda SEMPRE (da loja ou não); formato inválido não consulta", async () => {
    const a = await setup();
    const b = await setup();
    const alheia = await order(b);
    const propria = await order(a);
    // proxy que CONTA as consultas de pedido sem alterar o `prisma` real (nada de spyOn: vaza para os outros testes)
    const consultas: unknown[] = [];
    const db = new Proxy(prisma, {
      get(alvo, prop, receptor) {
        if (prop === "order") return { findFirst: (args: unknown) => (consultas.push(args), alvo.order.findFirst(args as never)) };
        return Reflect.get(alvo, prop, receptor);
      },
    });
    const servico = new DeviceAlertService(db as never, () => {});
    const base = { storeId: a.storeId, tokenId: null, code: "EMPTY_ZERO_TICKET" as const };
    await servico.record({ ...base, orderId: propria.orderId });
    await servico.record({ ...base, orderId: alheia.orderId });
    await servico.record({ ...base, orderId: "c" + "y".repeat(24) });
    expect(consultas).toHaveLength(3); // 1 por alerta com formato válido, qualquer que seja o desfecho
    await servico.record({ ...base, orderId: "../../etc/passwd" });
    expect(consultas).toHaveLength(3); // formato inválido: nenhuma consulta (e grava sem id, mesma resposta)
  });

  it("TETO por loja: passando de 200 linhas novas na hora, orderIds novos NÃO criam linha própria (só incrementa a linha sem pedido)", async () => {
    const ctx = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await order(ctx)).orderId);
    // enche a hora com linhas "antigas" de outros códigos/janelas até o teto
    const agora = new Date();
    await prisma.deviceAlert.createMany({
      data: Array.from({ length: ALERT_NEW_ROWS_PER_HOUR }, (_, i) => ({
        storeId: ctx.storeId,
        code: "MODE_RECOVERED" as const,
        orderKey: `enche-${i}`,
        windowStart: new Date(agora.getTime() - 20 * 60_000),
        firstAt: agora,
        lastAt: agora,
        expiresAt: new Date(agora.getTime() + 86_400_000),
      })),
    });
    for (const id of ids) expect((await alert(ctx.token, { code: "EMPTY_ZERO_TICKET", orderId: id })).statusCode).toBe(204);
    const novas = (await rows(ctx.storeId)).filter((r) => r.code === "EMPTY_ZERO_TICKET");
    expect(novas).toHaveLength(1); // as 3 viraram UMA linha sem pedido, com count 3
    expect(novas[0]).toMatchObject({ orderId: null, orderKey: "", count: 3 });
  });

  it("C2 corpo ESTRITO: chave desconhecida, texto livre, código fora da lista, QUEUE_WITHOUT_PRINTER vindo do cliente e versão inválida ⇒ 400 e nada gravado", async () => {
    const ctx = await setup();
    for (const body of [
      { code: "MODE_UNCONFIRMED", message: "texto livre" },
      { code: "MODE_UNCONFIRMED", customerName: "Ana" },
      { code: "OUTRO_CODIGO" },
      { code: "QUEUE_WITHOUT_PRINTER" }, // só o servidor emite
      { code: "MODE_UNCONFIRMED", clientVersion: "1.0 <script>" },
      { code: "MODE_UNCONFIRMED", clientVersion: "x".repeat(21) },
      {},
      { code: 42 },
    ]) {
      const r = await alert(ctx.token, body);
      expect([r.statusCode, json(r).code], JSON.stringify(body)).toEqual([400, "VALIDATION_ERROR"]);
    }
    expect(await rows(ctx.storeId)).toHaveLength(0);
  });

  it("C2 corpo pequeno: acima de 2 KB ⇒ 413, nada gravado", async () => {
    const ctx = await setup();
    const r = await alert(ctx.token, { code: "MODE_UNCONFIRMED", clientVersion: "1.0.0", orderId: "c" + "a".repeat(24), lixo: "z".repeat(4000) });
    expect(r.statusCode).toBe(413);
    expect(await rows(ctx.storeId)).toHaveLength(0);
  });

  it("C5 sem token, token inválido ou REVOGADO ⇒ 401 e NADA gravado", async () => {
    const ctx = await setup();
    expect((await app.inject({ method: "POST", url: "/api/device/alerts", payload: { code: "MODE_UNCONFIRMED" } })).statusCode).toBe(401);
    expect((await alert("token-que-nao-existe", { code: "MODE_UNCONFIRMED" })).statusCode).toBe(401);
    await prisma.deviceToken.updateMany({ where: { storeId: ctx.storeId }, data: { revokedAt: new Date() } });
    expect((await alert(ctx.token, { code: "MODE_UNCONFIRMED" })).statusCode).toBe(401);
    expect(await prisma.deviceAlert.count()).toBe(0);
  });

  it("LIMITE POR TOKEN: 30 por minuto ⇒ a 31ª é 429; outro token da mesma loja não é afetado", async () => {
    const ctx = await setup();
    const outro = await ctx.mkToken("PC2");
    for (let i = 0; i < 30; i++) expect((await alert(ctx.token, { code: "MODE_UNCONFIRMED" })).statusCode, `chamada ${i + 1}`).toBe(204);
    expect((await alert(ctx.token, { code: "MODE_UNCONFIRMED" })).statusCode).toBe(429);
    expect((await alert(outro, { code: "MODE_UNCONFIRMED" })).statusCode).toBe(204);
  });

  // ───────────── leitura do dono ─────────────
  it("C5 só OWNER lê: STAFF ⇒ 403 e a tentativa fica registrada; sem sessão ⇒ 401", async () => {
    const ctx = await setup();
    const staff = await staffCookie(ctx);
    const r = await app.inject({ method: "GET", url: "/api/device-alerts", headers: { cookie: staff } });
    expect([r.statusCode, json(r).code]).toEqual([403, "FORBIDDEN_ROLE"]);
    await vi.waitFor(async () => expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "device_alert.read_denied" } })).toBe(1), { timeout: 10_000, interval: 100 });
    expect((await app.inject({ method: "GET", url: "/api/device-alerts" })).statusCode).toBe(401);
  });

  it("CONTADOR POR IP ANTES DA AUTENTICAÇÃO: Authorization aleatório a cada requisição (token inexistente) tem teto por IP (120/min) ⇒ 429 (e não 401) sem gravar; abaixo do teto segue 401", async () => {
    // Prova sem espiar o banco: com token inexistente a autenticação responderia 401. Se as barradas voltam 429, o contador por IP rodou ANTES dela.
    let n401 = 0;
    let n429 = 0;
    for (let i = 0; i < 125; i++) {
      const r = await app.inject({ method: "POST", url: "/api/device/alerts", headers: { authorization: `Bearer aleatorio-${i}` }, payload: { code: "MODE_UNCONFIRMED" } });
      if (r.statusCode === 401) n401 += 1;
      if (r.statusCode === 429) n429 += 1;
    }
    expect([n401, n429]).toEqual([120, 5]);
    expect(await prisma.deviceAlert.count()).toBe(0);
  });

  it("IPv6: dois endereços do MESMO /64 dividem o contador por IP (girar o final do endereço não escapa dos 120/min); outro /64 e IPv4 têm contadores próprios", async () => {
    const enviar = (remoteAddress: string, i: number) =>
      app.inject({ method: "POST", url: "/api/device/alerts", remoteAddress, headers: { authorization: `Bearer aleatorio-${remoteAddress}-${i}` }, payload: { code: "MODE_UNCONFIRMED" } });
    for (let i = 0; i < 60; i++) expect((await enviar("2001:db8:1:2::1", i)).statusCode).toBe(401);
    for (let i = 0; i < 60; i++) expect((await enviar("2001:db8:1:2:aaaa:bbbb:cccc:dddd", i)).statusCode).toBe(401); // outro endereço, mesmo /64: soma 120
    const barrada = await enviar("2001:db8:1:2::ffff", 0); // um terceiro endereço do mesmo /64
    expect([barrada.statusCode, json(barrada).code]).toEqual([429, "RATE_LIMITED"]);
    expect((await enviar("2001:db8:1:3::1", 0)).statusCode).toBe(401); // outro /64 não é afetado
    expect((await enviar("203.0.113.9", 0)).statusCode).toBe(401); // nem um IPv4
    expect(await prisma.deviceAlert.count()).toBe(0);
  });

  it("NEGATIVA DO STAFF em GET /api/device-alerts: balde por usuário (10/min); a 11ª ⇒ 429 sem gravar auditoria; a rota nunca abre; o dono segue lendo", async () => {
    const ctx = await setup();
    const staff = await staffCookie(ctx);
    for (let i = 0; i < 10; i++) expect((await app.inject({ method: "GET", url: "/api/device-alerts", headers: { cookie: staff } })).statusCode, `tentativa ${i + 1}`).toBe(403);
    const barrada = await app.inject({ method: "GET", url: "/api/device-alerts", headers: { cookie: staff } });
    expect([barrada.statusCode, json(barrada).code, barrada.headers["retry-after"]]).toEqual([429, "RATE_LIMITED", "60"]);
    await vi.waitFor(async () => expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "device_alert.read_denied" } })).toBe(10), { timeout: 10_000, interval: 100 });
    await new Promise((r) => setTimeout(r, 300));
    expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "device_alert.read_denied" } })).toBe(10); // a 11ª não gravou
    expect((await app.inject({ method: "GET", url: "/api/device-alerts", headers: { cookie: ctx.owner } })).statusCode).toBe(200); // o balde do dono é outro
    // o balde é POR USUÁRIO: um SEGUNDO STAFF da mesma loja não é barrado pelas tentativas do primeiro (leva 403, não 429)
    await new Promise((r) => setTimeout(r, 5)); // e-mail único do convite
    const outroStaff = await staffCookie(ctx);
    expect((await app.inject({ method: "GET", url: "/api/device-alerts", headers: { cookie: outroStaff } })).statusCode).toBe(403);
  });

  it("C3 o dono vê o pedido pelo CÓDIGO (não pelo id interno); isolamento entre lojas; sem PII na resposta nem na linha gravada", async () => {
    const a = await setup();
    const b = await setup();
    const o = await order(a, { type: "DELIVERY", customerName: "Ana Sigilosa", customerPhone: "11987654321", address: "Rua Sigilosa, 777" });
    await alert(a.token, { code: "NOTHING_TO_CHARGE_CONFLICT", orderId: o.orderId, clientVersion: "2.0.0" });
    await alert(b.token, { code: "MODE_UNCONFIRMED" });
    const lista = await app.inject({ method: "GET", url: "/api/device-alerts", headers: { cookie: a.owner } });
    expect(lista.statusCode).toBe(200);
    const corpo = json(lista);
    expect(corpo.alerts).toHaveLength(1); // só a loja A
    expect(corpo.alerts[0]).toMatchObject({ code: "NOTHING_TO_CHARGE_CONFLICT", orderCode: o.code, clientVersion: "2.0.0", count: 1 });
    expect(Object.keys(corpo.alerts[0]).sort()).toEqual(["clientVersion", "code", "count", "firstAt", "id", "lastAt", "orderCode"]);
    const dump = lista.body + JSON.stringify(await rows(a.storeId));
    for (const pii of ["Sigilosa", "11987654321", "Ana", "Rua"]) expect(dump, pii).not.toContain(pii);
    expect(lista.body).not.toContain(o.orderId); // o id interno do pedido não sai na leitura
  });

  it("C4 a faixa é o OU de dois sinais: MODE_RECOVERED do cliente encerra o MODE_UNCONFIRMED, mas NÃO apaga o alerta do detector do servidor", async () => {
    const ctx = await setup();
    const faixa = async () => json(await app.inject({ method: "GET", url: "/api/device-alerts", headers: { cookie: ctx.owner } })).banner.needsAttention;
    expect(await faixa()).toEqual({ queueWithoutPrinter: false, modeUnconfirmed: false, moneyAlert: false });
    await alert(ctx.token, { code: "MODE_UNCONFIRMED" });
    expect((await faixa()).modeUnconfirmed).toBe(true);
    // detector do servidor
    const antes = new Date(Date.now() - 30 * 60_000);
    await prisma.store.update({ where: { id: ctx.storeId }, data: { printMode: "QUEUE" } });
    const o = await order(ctx);
    await prisma.printJob.updateMany({ where: { orderId: o.orderId }, data: { createdAt: antes, availableAt: antes } });
    await queueWatchJob.runOnce({ now: new Date(), db: prisma, log, limit: 100 });
    // o cliente se declara recuperado (depois do aviso dele): isso NÃO pode apagar o do servidor
    await new Promise((r) => setTimeout(r, 20));
    await alert(ctx.token, { code: "MODE_RECOVERED" });
    expect(await faixa()).toEqual({ queueWithoutPrinter: true, modeUnconfirmed: false, moneyAlert: false });
  });

  it("C6 alertas de DINHEIRO aparecem na faixa do dono", async () => {
    const ctx = await setup();
    await alert(ctx.token, { code: "NOTHING_TO_CHARGE_INVALID" });
    const f = json(await app.inject({ method: "GET", url: "/api/device-alerts", headers: { cookie: ctx.owner } }));
    expect(f.banner.needsAttention.moneyAlert).toBe(true);
    expect(f.alerts[0].code).toBe("NOTHING_TO_CHARGE_INVALID");
  });

  // ───────────── detector do servidor (PC-24b) ─────────────
  const velho = async (orderId: string, minutos = 30) => {
    const quando = new Date(Date.now() - minutos * 60_000);
    await prisma.printJob.updateMany({ where: { orderId }, data: { createdAt: quando, availableAt: quando } });
  };
  const rodar = (now = new Date()) => queueWatchJob.runOnce({ now, db: prisma, log, limit: 100 });

  it("DETECTOR: loja em QUEUE com tíquete esperando há mais de 5 min e NENHUM claim ⇒ QUEUE_WITHOUT_PRINTER, sem cliente nenhum; evento só com o código", async () => {
    const ctx = await setup();
    const ws = sockets(ctx.storeId);
    await prisma.store.update({ where: { id: ctx.storeId }, data: { printMode: "QUEUE" } });
    const o = await order(ctx);
    await velho(o.orderId);
    expect((await rodar()).processed).toBe(1);
    const [row] = await rows(ctx.storeId);
    expect(row).toMatchObject({ code: "QUEUE_WITHOUT_PRINTER", tokenId: null, orderId: null, count: 1 });
    expect(ws.filter((m) => m.includes("device.alert")).map((m) => JSON.parse(m))).toEqual([{ type: "device.alert", code: "QUEUE_WITHOUT_PRINTER" }]);
    // idempotente: o tick seguinte na mesma janela só incrementa
    await rodar();
    const [depois] = await rows(ctx.storeId);
    expect(depois.count).toBe(2);
    expect(await rows(ctx.storeId)).toHaveLength(1);
  });

  it("DETECTOR: não alerta com claim recente, job novo (< 5 min), loja em LEGACY, só job de TESTE ou job já impresso; isolado por loja", async () => {
    const ctx = await setup();
    const outra = await setup();
    // 1) job novo: 2 min
    await prisma.store.update({ where: { id: ctx.storeId }, data: { printMode: "QUEUE" } });
    const novo = await order(ctx);
    await velho(novo.orderId, QUEUE_WATCH_MINUTES - 3);
    expect((await rodar()).processed).toBe(0);
    // 2) velho, MAS com um claim recente (a impressora está trabalhando)
    const velhoPedido = await order(ctx);
    await velho(velhoPedido.orderId);
    await prisma.printJob.updateMany({ where: { orderId: novo.orderId }, data: { claimedAt: new Date(Date.now() - 60_000) } });
    expect((await rodar()).processed).toBe(0);
    await prisma.printJob.updateMany({ where: { orderId: novo.orderId }, data: { claimedAt: null } });
    // 3) loja em LEGACY (a outra) com job velho: ninguém consome jobs, não é alerta
    const legado = await order(outra);
    await velho(legado.orderId);
    expect((await rodar()).processed).toBe(1); // só a loja `ctx`, agora sem claim
    expect((await rows(outra.storeId)).length).toBe(0);
    // 4) job de TESTE velho não conta; job impresso não conta
    await prisma.store.update({ where: { id: outra.storeId }, data: { printMode: "QUEUE" } });
    await prisma.printJob.updateMany({ where: { orderId: legado.orderId }, data: { status: "PRINTED" } });
    await prisma.printJob.create({ data: { storeId: outra.storeId, kind: "TEST", createdAt: new Date(Date.now() - 3_600_000), availableAt: new Date(Date.now() - 3_600_000), maxAttempts: 3 } });
    await rodar();
    expect((await rows(outra.storeId)).length).toBe(0);
  });

  it("DETECTOR em 2 execuções SIMULTÂNEAS: 1 linha (lock do job + upsert atômico)", async () => {
    const ctx = await setup();
    await prisma.store.update({ where: { id: ctx.storeId }, data: { printMode: "QUEUE" } });
    const o = await order(ctx);
    await velho(o.orderId);
    await Promise.all([rodar(), rodar(), rodar()]);
    const todas = await rows(ctx.storeId);
    expect(todas).toHaveLength(1);
    expect(todas[0].count).toBeGreaterThanOrEqual(1);
  });

  // ───────────── retenção ─────────────
  it("RETENÇÃO: DeviceAlert está na allowlist da tech.cleanup; o alerta vencido (30 dias + 1 dia de tolerância) é apagado, o recente fica", async () => {
    expect(TECH_CLEANUP_ALLOWLIST).toContain("DeviceAlert");
    const ctx = await setup();
    const agora = new Date();
    const base = { storeId: ctx.storeId, code: "MODE_RECOVERED" as const, firstAt: agora, lastAt: agora };
    await prisma.deviceAlert.create({ data: { ...base, orderKey: "velho", windowStart: agora, expiresAt: new Date(agora.getTime() - 3 * 86_400_000) } });
    await prisma.deviceAlert.create({ data: { ...base, orderKey: "novo", windowStart: agora, expiresAt: new Date(agora.getTime() + 20 * 86_400_000) } });
    await techCleanupJob.runOnce({ now: agora, db: prisma, log, limit: 100 });
    const sobrou = await rows(ctx.storeId);
    expect(sobrou.map((r) => r.orderKey)).toEqual(["novo"]);
  });

  it("o alerta guarda `expiresAt` = último aviso + 30 dias e o incremento o renova", async () => {
    const ctx = await setup();
    await alert(ctx.token, { code: "MODE_UNCONFIRMED" });
    const [r1] = await rows(ctx.storeId);
    const dias = (r1.expiresAt.getTime() - r1.lastAt.getTime()) / 86_400_000;
    expect(Math.round(dias)).toBe(30);
  });
});
