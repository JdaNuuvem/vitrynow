// Campanha principal do cardápio (CONTRATO-CAMPANHA): revisão otimista, publicação por cópia, DTO público, mídia, papel e isolamento entre 2 lojas.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { isMenuAffectingRoute } from "../src/plugins/menuRevalidation";
import { login, makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);
const draftOf = (over: Record<string, unknown> = {}) => ({ title: "Semana da pizza", description: "Peça a sua", imageUrl: "", imageLayout: "photo", imagePosition: "center", action: null, ...over });

describe("campanha do cardápio", { timeout: 90_000 }, () => {
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

  async function loja(slug: string, code: string) {
    const r = await registerStore(app, { slug, code });
    const storeId = json(r.response).store.id as string;
    const cookie = r.cookie!;
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie }, payload: { name: "Pizzas" } })).category.id as string;
    const prod = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie }, payload: { categoryId: cat, name: "Calabresa", priceCents: 3000 } })).product.id as string;
    return { slug, storeId, cookie, cat, prod, credentials: r.credentials };
  }
  const get = (c: string) => app.inject({ method: "GET", url: "/api/store/menu-campaign", headers: { cookie: c } });
  const put = (c: string, revision: number, draft: unknown) => app.inject({ method: "PUT", url: "/api/store/menu-campaign", headers: { cookie: c }, payload: { revision, draft } as never });
  const act = (c: string, what: "publish" | "unpublish", revision: number) => app.inject({ method: "POST", url: `/api/store/menu-campaign/${what}`, headers: { cookie: c }, payload: { revision } });
  const menu = async (slug: string) => json(await app.inject({ method: "GET", url: `/stores/${slug}/menu` }));

  it("loja sem campanha: revisão 0, rascunho e publicada nulos; cardápio com campaign null", async () => {
    const a = await loja("camp-a", "CA1");
    expect(json(await get(a.cookie))).toEqual({ revision: 0, draft: null, published: null });
    expect((await menu(a.slug)).store.campaign).toBeNull();
  });

  it("salvar rascunho NÃO publica; publicar copia o rascunho; salvar de novo não muda o que o público vê; retirar libera o banner e mantém o rascunho", async () => {
    const a = await loja("camp-a", "CA1");
    const saved = await put(a.cookie, 0, draftOf({ title: "  Semana da pizza  " }));
    expect(saved.statusCode, saved.body).toBe(200);
    expect(json(saved)).toMatchObject({ revision: 1, draft: { title: "Semana da pizza" }, published: null });
    expect((await menu(a.slug)).store.campaign).toBeNull();

    const pub = await act(a.cookie, "publish", 1);
    expect(pub.statusCode, pub.body).toBe(200);
    const campanha = (await menu(a.slug)).store.campaign;
    expect(campanha).toMatchObject({ title: "Semana da pizza", imageLayout: "photo" });
    expect(Object.keys(campanha).sort()).toEqual(["description", "id", "imageLayout", "imagePosition", "imageUrl", "title"]);
    expect(JSON.stringify(campanha)).not.toContain(a.storeId);

    await put(a.cookie, 2, draftOf({ title: "Outro texto" }));
    expect((await menu(a.slug)).store.campaign.title).toBe("Semana da pizza"); // a cópia publicada não mudou

    const off = await act(a.cookie, "unpublish", 3);
    expect(json(off)).toMatchObject({ revision: 4, published: null, draft: { title: "Outro texto" } });
    expect((await menu(a.slug)).store.campaign).toBeNull();
  });

  it("revisão velha = 409 CAMPAIGN_CHANGED sem gravar; duas escritas simultâneas com a mesma revisão: uma vence e a outra recebe 409", async () => {
    const a = await loja("camp-a", "CA1");
    await put(a.cookie, 0, draftOf());
    const velha = await put(a.cookie, 0, draftOf({ title: "perdida" }));
    expect(velha.statusCode).toBe(409);
    expect(json(velha)).toEqual({ error: "A campanha mudou. Recarregue os dados antes de salvar.", code: "CAMPAIGN_CHANGED" });
    expect(json(await get(a.cookie)).draft.title).toBe("Semana da pizza");

    const corrida = await Promise.all([put(a.cookie, 1, draftOf({ title: "A" })), put(a.cookie, 1, draftOf({ title: "B" })), put(a.cookie, 1, draftOf({ title: "C" }))]);
    expect(corrida.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
    expect(json(await get(a.cookie)).revision).toBe(2);
    // primeira escrita simultânea numa loja sem linha: uma cria, as outras 409
    const b = await loja("camp-b", "CB1");
    const inicio = await Promise.all([put(b.cookie, 0, draftOf()), put(b.cookie, 0, draftOf())]);
    expect(inicio.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });

  it("validação: título > 80, descrição > 250, rótulo > 35, imagem http, https com usuário e senha, campo extra e revisão negativa = 400", async () => {
    const a = await loja("camp-a", "CA1");
    const casos = [
      draftOf({ title: "x".repeat(81) }),
      draftOf({ description: "x".repeat(251) }),
      draftOf({ action: { label: "x".repeat(36), target: { kind: "category", id: a.cat } } }),
      draftOf({ imageUrl: "http://exemplo.com/a.png" }),
      draftOf({ imageUrl: "https://user:pass@exemplo.com/a.png" }),
      draftOf({ imageLayout: "outro" }),
      { ...draftOf(), extra: 1 },
    ];
    for (const c of casos) expect((await put(a.cookie, 0, c)).statusCode, JSON.stringify(c).slice(0, 80)).toBe(400);
    expect((await put(a.cookie, -1, draftOf())).statusCode).toBe(400);
    expect(json(await get(a.cookie)).revision).toBe(0);
    expect((await put(a.cookie, 0, draftOf({ imageUrl: "https://exemplo.com/a.png", title: "", description: "" }))).statusCode).toBe(200); // rascunho pode ter texto vazio
  });

  it("publicar: sem rascunho 400; título vazio 400; ação sem rótulo 400; destino de OUTRA loja 400; destino válido publica", async () => {
    const a = await loja("camp-a", "CA1");
    const b = await loja("camp-b", "CB1");
    expect((await act(a.cookie, "publish", 0)).statusCode).toBe(400);
    await put(a.cookie, 0, draftOf({ title: "" }));
    expect((await act(a.cookie, "publish", 1)).statusCode).toBe(400);
    await put(a.cookie, 1, draftOf({ action: { label: "", target: { kind: "category", id: a.cat } } }));
    expect((await act(a.cookie, "publish", 2)).statusCode).toBe(400);
    await put(a.cookie, 2, draftOf({ action: { label: "Ver", target: { kind: "category", id: b.cat } } }));
    expect((await act(a.cookie, "publish", 3)).statusCode).toBe(400);
    await put(a.cookie, 3, draftOf({ action: { label: "Ver", target: { kind: "product", id: b.prod } } }));
    expect((await act(a.cookie, "publish", 4)).statusCode).toBe(400);
    await put(a.cookie, 4, draftOf({ action: { label: "Ver", target: { kind: "product", id: a.prod } } }));
    expect((await act(a.cookie, "publish", 5)).statusCode).toBe(200);
    expect((await menu(a.slug)).store.campaign.action).toEqual({ label: "Ver", target: { kind: "product", id: a.prod } });
  });

  it("destino removido depois: o banner continua, só o botão some", async () => {
    const a = await loja("camp-a", "CA1");
    await put(a.cookie, 0, draftOf({ action: { label: "Ver", target: { kind: "product", id: a.prod } } }));
    await act(a.cookie, "publish", 1);
    await app.inject({ method: "POST", url: `/api/catalog/products/${a.prod}`, headers: { cookie: a.cookie }, payload: { active: false } });
    const campanha = (await menu(a.slug)).store.campaign;
    expect(campanha.title).toBe("Semana da pizza");
    expect(campanha).not.toHaveProperty("action");
  });

  it("imagem gerenciada: só da PRÓPRIA loja; de outra loja ou inexistente = mesma resposta 400; e a remoção da imagem em uso dá IMAGE_IN_USE", async () => {
    const a = await loja("camp-a", "CA1");
    const b = await loja("camp-b", "CB1");
    const uuidA = "11111111-1111-4111-8111-111111111111";
    const uuidB = "22222222-2222-4222-8222-222222222222";
    const imgA = await prisma.image.create({ data: { storeId: a.storeId, kind: "COVER", keyBase: `stores/${a.storeId}/${uuidA}`, widths: [800], bytes: 1, status: "READY" } });
    await prisma.image.create({ data: { storeId: b.storeId, kind: "COVER", keyBase: `stores/${b.storeId}/${uuidB}`, widths: [800], bytes: 1, status: "READY" } });
    const urlA = `/media/stores/${a.storeId}/${uuidA}-800.webp`;
    const alheia = await put(a.cookie, 0, draftOf({ imageUrl: `/media/stores/${b.storeId}/${uuidB}-800.webp` }));
    const inexistente = await put(a.cookie, 0, draftOf({ imageUrl: `/media/stores/${a.storeId}/33333333-3333-4333-8333-333333333333-800.webp` }));
    const prefixoAlheio = await put(a.cookie, 0, draftOf({ imageUrl: `/media/stores/${a.storeId}/${uuidB}-800.webp` })); // uuid da imagem de B sob o id de A
    for (const r of [alheia, inexistente, prefixoAlheio]) expect(r.statusCode).toBe(400);
    expect(alheia.body).toBe(inexistente.body);
    expect((await put(a.cookie, 0, draftOf({ imageUrl: urlA }))).statusCode).toBe(200);
    await act(a.cookie, "publish", 1);
    await put(a.cookie, 2, draftOf({ imageUrl: "" })); // rascunho já não usa; a PUBLICADA ainda usa
    const { mediaService } = await import("../src/modules/media/media.module");
    await expect(mediaService.remove(a.storeId, imgA.id)).rejects.toMatchObject({ code: "IMAGE_IN_USE" });
    await act(a.cookie, "unpublish", 3);
    await expect(mediaService.remove(a.storeId, imgA.id)).resolves.toBeUndefined();
  });

  it("OWNER apenas: STAFF 403 nas 4 rotas e sem sessão 401; a sessão manda no escopo (loja B nunca vê nem altera a de A)", async () => {
    const a = await loja("camp-a", "CA1");
    const b = await loja("camp-b", "CB1");
    const bcrypt = await import("bcryptjs");
    await prisma.user.create({ data: { storeId: a.storeId, email: "staff-camp@teste.com", passwordHash: await bcrypt.hash(a.credentials.password, 10), role: "STAFF" } });
    const staff = (await login(app, "staff-camp@teste.com", a.credentials.password)).cookie!;
    expect((await get(staff)).statusCode).toBe(403);
    expect((await put(staff, 0, draftOf())).statusCode).toBe(403);
    expect((await act(staff, "publish", 0)).statusCode).toBe(403);
    expect((await act(staff, "unpublish", 0)).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/store/menu-campaign" })).statusCode).toBe(401);

    await put(a.cookie, 0, draftOf({ title: "So da loja A" }));
    await act(a.cookie, "publish", 1);
    expect(json(await get(b.cookie))).toEqual({ revision: 0, draft: null, published: null });
    expect((await menu(b.slug)).store.campaign).toBeNull();
    expect(JSON.stringify(await menu(b.slug))).not.toContain("So da loja A");
    // B grava a própria campanha sem tocar a de A
    expect((await put(b.cookie, 0, draftOf({ title: "Loja B" }))).statusCode).toBe(200);
    expect(json(await get(a.cookie)).draft.title).toBe("So da loja A");
    expect(await prisma.menuCampaign.count()).toBe(2);
  });

  it("auditoria sem conteúdo; só publicar/retirar pedem revalidação do cardápio (salvar rascunho não)", async () => {
    const a = await loja("camp-a", "CA1");
    await put(a.cookie, 0, draftOf({ title: "Titulo secreto de campanha" }));
    await act(a.cookie, "publish", 1);
    // auditoria gravada sem bloquear a resposta (logAudit): espera as duas aparecerem
    let rows: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
    await vi.waitFor(async () => {
      rows = await prisma.auditLog.findMany({ where: { storeId: a.storeId, action: { startsWith: "store.campaign_" } } });
      expect(rows.map((r) => r.action).sort()).toEqual(["store.campaign_publish", "store.campaign_save"]);
    }, { timeout: 10_000, interval: 100 });
    expect(JSON.stringify(rows)).not.toContain("Titulo secreto");
    expect(isMenuAffectingRoute("POST", "/api/store/menu-campaign/publish")).toBe(true);
    expect(isMenuAffectingRoute("POST", "/api/store/menu-campaign/unpublish")).toBe(true);
    expect(isMenuAffectingRoute("PUT", "/api/store/menu-campaign")).toBe(false);
  });
});
