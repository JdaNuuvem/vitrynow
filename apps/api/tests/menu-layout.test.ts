// Modelo do cardápio (CLASSIC | REELS): o dono escolhe nas configurações e o cardápio público informa.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { resetLimits } from "../src/lib/slidingLimit";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("modelo do cardápio", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    resetLimits();
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

  it("padrão CLASSIC; dono troca para REELS; valor fora da lista é recusado", async () => {
    const { cookie, response } = await registerStore(app);
    const slug = (JSON.parse(response.body) as { store: { slug: string } }).store.slug;
    const menu = async () => JSON.parse((await app.inject({ method: "GET", url: `/stores/${slug}/menu` })).body).store.menuLayout;
    expect(await menu()).toBe("CLASSIC");
    const save = (menuLayout: string) => app.inject({ method: "POST", url: "/api/store/settings", headers: { cookie: cookie! }, payload: { menuLayout } });
    const ok = await save("REELS");
    expect(ok.statusCode).toBe(200);
    expect(await menu()).toBe("REELS");
    const settings = JSON.parse((await app.inject({ method: "GET", url: "/api/store/settings", headers: { cookie: cookie! } })).body);
    expect(JSON.stringify(settings)).toContain('"menuLayout":"REELS"');
    expect((await save("TIKTOK")).statusCode).toBe(400);
  });
});
