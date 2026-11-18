// API-26 (ONB): verificação de e-mail (provedor FALSO, nada sai pela rede), cadastro sem código, endereço reservado e checklist guiado.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { FakeEmailSender, getEmailSender, setEmailSender, type EmailSender } from "../src/lib/emailSender";
import { makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);
const fake = () => getEmailSender() as FakeEmailSender;
const tokenFrom = (link: string) => link.split("#token=")[1];

describe("onboarding e verificação de e-mail", () => {
  let app: ReturnType<typeof makeApp>;
  let original: EmailSender;
  beforeEach(async () => {
    original = getEmailSender();
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    setEmailSender(original);
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const registerUnverified = async (slug: string, email = `${slug}@t.com`) => {
    const r = await registerStore(app, { slug, code: slug.toUpperCase().slice(0, 8), email, unverified: true });
    expect(r.response.statusCode).toBe(201);
    return { cookie: r.cookie!, email };
  };
  const waitMail = async (to: string) => {
    for (let i = 0; i < 30; i++) {
      const mail = fake().last(to);
      if (mail) return mail;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("e-mail de verificação não saiu");
  };
  const verify = (token: string) => app.inject({ method: "POST", url: "/auth/verify-email", payload: { token } });
  const resend = (cookie: string) => app.inject({ method: "POST", url: "/api/auth/verify-email/resend", headers: { cookie } });
  const backdateTokens = (email: string) => prisma.emailVerificationToken.updateMany({ where: { user: { email } }, data: { createdAt: new Date(Date.now() - 2 * 60_000) } });
  const onboarding = async (cookie: string) => json(await app.inject({ method: "GET", url: "/api/onboarding", headers: { cookie } }));
  const staffCookie = async (owner: string) => {
    const invite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: owner }, payload: { email: `s-${Math.random().toString(36).slice(2, 8)}@t.com`, password: "provisoria1" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: json(invite).user.email, password: "provisoria1" } });
    return (login.headers["set-cookie"] as string).split(";")[0];
  };

  it("cadastro manda o e-mail pelo provedor FALSO; o link confirma uma vez; reusar, errado e vencido dão o mesmo 400", async () => {
    const { email } = await registerUnverified("ver-a");
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeNull();
    const mail = await waitMail(email);
    expect(mail.subject).toContain("Confirme");
    const token = tokenFrom(mail.link!);
    expect(mail.html).toContain(mail.link!);

    expect((await verify(token)).statusCode).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).not.toBeNull();
    const again = await verify(token);
    expect([again.statusCode, json(again).code]).toEqual([400, "VERIFY_TOKEN_INVALID"]);
    expect(json(await verify("lixo")).code).toBe("VERIFY_TOKEN_INVALID");

    const { email: email2 } = await registerUnverified("ver-b");
    const token2 = tokenFrom((await waitMail(email2)).link!);
    await prisma.emailVerificationToken.updateMany({ where: { user: { email: email2 } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(json(await verify(token2)).code).toBe("VERIFY_TOKEN_INVALID");
    expect((await prisma.user.findUniqueOrThrow({ where: { email: email2 } })).emailVerifiedAt).toBeNull();
  });

  it("só o hash do token vai ao banco (o valor do link nunca é gravado)", async () => {
    const { email } = await registerUnverified("ver-c");
    const token = tokenFrom((await waitMail(email)).link!);
    const rows = await prisma.emailVerificationToken.findMany({ where: { user: { email } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reenviar: 60 s entre pedidos (429), depois 202 e o link ANTERIOR morre; já verificado => alreadyVerified; sem login => 401", async () => {
    const { cookie, email } = await registerUnverified("ver-d");
    const first = tokenFrom((await waitMail(email)).link!);
    const tooSoon = await resend(cookie);
    expect([tooSoon.statusCode, json(tooSoon).code]).toEqual([429, "VERIFY_RESEND_LIMITED"]);
    expect(Number(tooSoon.headers["retry-after"])).toBeGreaterThan(0);

    await backdateTokens(email);
    expect((await resend(cookie)).statusCode).toBe(202);
    const second = tokenFrom(fake().last(email)!.link!);
    expect(second).not.toBe(first);
    expect(json(await verify(first)).code).toBe("VERIFY_TOKEN_INVALID");
    expect((await verify(second)).statusCode).toBe(200);
    expect(json(await resend(cookie))).toEqual({ alreadyVerified: true });
    expect((await app.inject({ method: "POST", url: "/api/auth/verify-email/resend" })).statusCode).toBe(401);
  });

  it("no máximo 5 e-mails por hora, mesmo respeitando os 60 s", async () => {
    const { cookie, email } = await registerUnverified("ver-e");
    await waitMail(email); // o e-mail do cadastro sai em segundo plano: espera antes de mexer nas datas
    for (let i = 0; i < 4; i++) {
      await backdateTokens(email);
      expect((await resend(cookie)).statusCode).toBe(202);
    }
    await backdateTokens(email);
    const sixth = await resend(cookie);
    expect([sixth.statusCode, json(sixth).code]).toEqual([429, "VERIFY_RESEND_LIMITED"]);
  });

  it("provedor que falha: reenviar dá 503 sem gastar a cota; o cadastro continua valendo", async () => {
    setEmailSender({ send: async () => false });
    const r = await registerStore(app, { slug: "ver-f", code: "VERF", email: "ver-f@t.com", unverified: true });
    expect(r.response.statusCode).toBe(201);
    await new Promise((res) => setTimeout(res, 150));
    expect(await prisma.emailVerificationToken.count({ where: { user: { email: "ver-f@t.com" } } })).toBe(0); // token descartado
    const res = await resend(r.cookie!);
    expect([res.statusCode, json(res).code]).toEqual([503, "EMAIL_NOT_SENT"]);
    setEmailSender(original);
    expect((await resend(r.cookie!)).statusCode).toBe(202); // a tentativa que falhou não contou
  });

  it("CA-ONB-02 (portão): dono NÃO verificado não assina (403 EMAIL_NOT_VERIFIED); depois de verificar, o portão abre", async () => {
    const { cookie, email } = await registerUnverified("ver-g");
    const blocked = await app.inject({ method: "POST", url: "/api/store/subscription/checkout", headers: { cookie }, payload: { planCode: "NADA" } });
    expect([blocked.statusCode, json(blocked).code]).toEqual([403, "EMAIL_NOT_VERIFIED"]);
    await verify(tokenFrom((await waitMail(email)).link!));
    const open = await app.inject({ method: "POST", url: "/api/store/subscription/checkout", headers: { cookie }, payload: { planCode: "NADA" } });
    expect(open.statusCode).toBe(404); // passou do portão; o plano NADA não existe
  });

  it("CA-ONB-01/RN-ONB-01: cadastro sem código gera um único e curto; endereço reservado é recusado; CA-ONB-08: e-mail repetido é 409 e a conta fica intacta", async () => {
    const a = await app.inject({ method: "POST", url: "/auth/register", payload: { storeName: "Loja A", slug: "sem-codigo-a", email: "sc-a@t.com", password: "senha12345" } });
    const b = await app.inject({ method: "POST", url: "/auth/register", payload: { storeName: "Loja B", slug: "sem-codigo-b", email: "sc-b@t.com", password: "senha12345" } });
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    const stores = await prisma.store.findMany({ where: { slug: { startsWith: "sem-codigo" } } });
    expect(stores).toHaveLength(2);
    expect(stores.every((s) => /^[A-Z2-9]{6}$/.test(s.code))).toBe(true);
    expect(new Set(stores.map((s) => s.code)).size).toBe(2);

    const reserved = await app.inject({ method: "POST", url: "/auth/register", payload: { storeName: "X", slug: "admin", email: "adm@t.com", password: "senha12345" } });
    expect([reserved.statusCode, json(reserved).code]).toEqual([400, "SLUG_RESERVED"]);
    expect(await prisma.store.count({ where: { slug: "admin" } })).toBe(0);

    const dup = await app.inject({ method: "POST", url: "/auth/register", payload: { storeName: "Outra", slug: "sem-codigo-c", email: "sc-a@t.com", password: "outrasenha123" } });
    expect([dup.statusCode, json(dup).code]).toEqual([409, "EMAIL_IN_USE"]);
    expect(await prisma.store.count({ where: { slug: "sem-codigo-c" } })).toBe(0);
    expect(await prisma.user.count({ where: { email: "sc-a@t.com" } })).toBe(1);
  });

  it("disponibilidade do endereço na hora: livre, em uso, reservado, inválido", async () => {
    await registerUnverified("ocupado-1");
    const avail = async (slug: string) => app.inject({ method: "GET", url: `/auth/slug-availability?slug=${encodeURIComponent(slug)}` });
    expect(json(await avail("livre-1"))).toMatchObject({ available: true, reason: null });
    expect(json(await avail("ocupado-1"))).toMatchObject({ available: false, reason: "IN_USE" });
    expect(json(await avail("Admin"))).toMatchObject({ available: false, reason: "RESERVED" });
    expect(json(await avail("api"))).toMatchObject({ available: false, reason: "RESERVED" });
    const bad = await avail("com espaço");
    expect([bad.statusCode, json(bad).code]).toEqual([400, "SLUG_INVALID"]);
  });

  it("checklist: loja nova tem 0 de 8; dados da loja, horário e produto concluem sozinhos e liberam o selo (CA-ONB-03)", async () => {
    const { cookie } = await registerStore(app, { slug: "chk-a", code: "CHKA" });
    let o = await onboarding(cookie);
    expect(o.progress).toEqual({ done: 0, total: 8 });
    expect([o.next, o.readyToShare, o.emailVerified]).toEqual(["STORE_DATA", false, true]);
    expect(o.steps.map((s: { id: string }) => s.id)).toEqual(["STORE_DATA", "HOURS", "FIRST_PRODUCT", "DELIVERY", "PAYMENTS", "PRINTER", "TEST_ORDER", "SHARE"]);

    await app.inject({ method: "POST", url: "/api/store/settings", headers: { cookie }, payload: { address: "Rua A, 1", openingHours: "Seg a sáb, 09:00 às 17:00" } });
    o = await onboarding(cookie);
    expect(o.progress.done).toBe(2);
    expect(o.readyToShare).toBe(false);

    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie }, payload: { name: "Lanches" } })).category;
    await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie }, payload: { categoryId: cat.id, name: "X-Burger", priceCents: 1500 } });
    o = await onboarding(cookie);
    expect([o.progress.done, o.readyToShare, o.next]).toEqual([3, true, "DELIVERY"]);
  });

  it("CA-ONB-06: passo pulado fica pendente de retomar e dá para voltar; passo automático não aceita 'feito' na mão; passo manual aceita", async () => {
    const { cookie } = await registerStore(app, { slug: "chk-b", code: "CHKB" });
    const step = (id: string, status: string, c = cookie) => app.inject({ method: "POST", url: `/api/onboarding/steps/${id}`, headers: { cookie: c }, payload: { status } });
    expect((await step("HOURS", "SKIPPED")).statusCode).toBe(200);
    let o = await onboarding(cookie);
    expect(o.steps.find((s: { id: string }) => s.id === "HOURS").status).toBe("SKIPPED");
    expect(o.next).toBe("STORE_DATA"); // pendentes vêm antes dos pulados
    expect(o.progress.done).toBe(0);
    expect((await step("HOURS", "PENDING")).statusCode).toBe(200);
    expect((await onboarding(cookie)).steps.find((s: { id: string }) => s.id === "HOURS").status).toBe("PENDING");

    const auto = await step("FIRST_PRODUCT", "DONE");
    expect([auto.statusCode, json(auto).code]).toEqual([400, "STEP_AUTOMATIC"]);
    expect((await step("SHARE", "DONE")).statusCode).toBe(200);
    o = await onboarding(cookie);
    expect(o.progress.done).toBe(1);
    expect((await step("NAO_EXISTE", "DONE")).statusCode).toBe(404);
    expect((await step("SHARE", "TALVEZ")).statusCode).toBe(400);
  });

  it("checklist: só o OWNER marca passos; STAFF lê; sem login 401; cada loja vê só o seu estado", async () => {
    const a = await registerStore(app, { slug: "chk-c", code: "CHKC" });
    const b = await registerStore(app, { slug: "chk-d", code: "CHKD" });
    const staff = await staffCookie(a.cookie!);
    const mark = (cookie: string) => app.inject({ method: "POST", url: "/api/onboarding/steps/SHARE", headers: { cookie }, payload: { status: "DONE" } });
    expect((await mark(staff)).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/onboarding", headers: { cookie: staff } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/onboarding" })).statusCode).toBe(401);
    expect((await mark(a.cookie!)).statusCode).toBe(200);
    expect((await onboarding(b.cookie!)).progress.done).toBe(0);
    expect((await onboarding(a.cookie!)).progress.done).toBe(1);
  });

  it("CA-ONB-07: eventos de ativação, um por marco e por loja, sem duplicar mesmo lendo o checklist várias vezes", async () => {
    const { cookie } = await registerStore(app, { slug: "chk-e", code: "CHKE" });
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie }, payload: { name: "Lanches" } })).category;
    const product = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie }, payload: { categoryId: cat.id, name: "X-Burger", priceCents: 1500 } })).product;
    await app.inject({ method: "POST", url: "/stores/chk-e/orders", payload: { type: "BALCAO", items: [{ productId: product.id, quantity: 1 }] } });
    for (let i = 0; i < 3; i++) await onboarding(cookie);
    const events = await prisma.activationEvent.findMany({ where: { store: { slug: "chk-e" } }, orderBy: { kind: "asc" } });
    expect(events.map((e) => e.kind)).toEqual(["FIRST_PRODUCT", "FIRST_REAL_ORDER"]);
    const p = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(events[0].occurredAt.getTime()).toBe(p.createdAt.getTime()); // a hora do marco é a do fato, não a da leitura
  });
});
