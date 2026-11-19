// PR-03 / a2: sugestão de grade a partir do texto livre. O interpretador é PURO e conservador (o que não entende vira dúvida); a rota NÃO grava nada.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { hoursText, validateSchedule } from "../src/modules/storeHours/storeHours.domain";
import { suggestSchedule } from "../src/modules/storeHours/storeHours.suggest";
import { login, makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);
const dia = (s: ReturnType<typeof suggestSchedule>, d: number) => s.schedule?.week[d] ?? [];

describe("suggestSchedule (interpretador puro)", () => {
  it("'Seg a sáb 09–17' e variações de escrita viram a MESMA grade (seg a sáb 09:00–17:00); domingo fechado", () => {
    for (const texto of ["Seg a sáb 09–17", "segunda a sábado das 9h às 17h", "Seg a Sab 9:00 - 17:00", "SEGUNDA-FEIRA a SÁBADO, 09h às 17h"]) {
      const r = suggestSchedule(texto);
      expect(r.complete, texto).toBe(true);
      expect(r.doubts, texto).toEqual([]);
      for (const d of [1, 2, 3, 4, 5, 6]) expect(dia(r, d), `${texto} dia ${d}`).toEqual([{ start: "09:00", end: "17:00" }]);
      expect(dia(r, 0), texto).toEqual([]);
      expect(hoursText(r.schedule!)).toBe("Seg a sáb 09:00–17:00");
    }
  });

  it("dois horários no dia, dias soltos, 'todos os dias', 'fim de semana', 'dias úteis', minutos e fechado", () => {
    expect(dia(suggestSchedule("seg a sex 11h às 15h e 18h às 23h30"), 3)).toEqual([{ start: "11:00", end: "15:00" }, { start: "18:00", end: "23:30" }]);
    const soltos = suggestSchedule("seg, qua e sex 10h às 14h");
    expect([1, 3, 5].map((d) => dia(soltos, d).length)).toEqual([1, 1, 1]);
    expect([2, 4, 6, 0].map((d) => dia(soltos, d).length)).toEqual([0, 0, 0, 0]);
    expect(suggestSchedule("todos os dias 8h às 22h").schedule!.week.every((d) => d.length === 1)).toBe(true);
    const fds = suggestSchedule("dias úteis 9h às 18h; fim de semana 10h às 14h; ");
    expect(fds.complete).toBe(true);
    expect(dia(fds, 6)).toEqual([{ start: "10:00", end: "14:00" }]);
    expect(dia(fds, 0)).toEqual([{ start: "10:00", end: "14:00" }]);
    const fechado = suggestSchedule("seg a sáb 9h às 17h; domingo fechado");
    expect(fechado.complete).toBe(true);
    expect(dia(fechado, 0)).toEqual([]);
  });

  it("virada de dia (22h às 02h) e fim às 24h são aceitos; a grade sugerida SEMPRE passa na validação do servidor", () => {
    const noite = suggestSchedule("sex e sáb 22h às 02h");
    expect(noite.complete).toBe(true);
    expect(dia(noite, 5)).toEqual([{ start: "22:00", end: "02:00" }]);
    expect(validateSchedule(noite.schedule!)).toEqual([]);
    const ate24 = suggestSchedule("seg a dom 18h às 24h");
    expect(dia(ate24, 1)).toEqual([{ start: "18:00", end: "24:00" }]);
    expect(validateSchedule(ate24.schedule!)).toEqual([]);
  });

  it("o que NÃO entende vira DÚVIDA, nunca palpite: o trecho entendido sai, o resto é listado; texto vazio ou sem nada útil não sugere grade", () => {
    const misto = suggestSchedule("seg a sex 9h às 18h; sábado conforme a demanda; feriados fechamos");
    expect(misto.complete).toBe(false);
    expect(dia(misto, 1)).toEqual([{ start: "09:00", end: "18:00" }]);
    expect(dia(misto, 6)).toEqual([]); // sábado NÃO foi inventado
    expect(misto.doubts.map((d) => d.text)).toEqual(["sábado conforme a demanda", "feriados fechamos"]);
    expect(suggestSchedule("a gente abre quando dá").schedule).toBeNull();
    expect(suggestSchedule("a gente abre quando dá").doubts).toHaveLength(1);
    expect(suggestSchedule("").schedule).toBeNull();
    expect(suggestSchedule("   ").doubts[0].reason).toMatch(/Não há texto/);
    const semDia = suggestSchedule("9h às 17h");
    expect(semDia.schedule).toBeNull();
    expect(semDia.doubts[0].reason).toMatch(/dias/);
    const semHora = suggestSchedule("seg a sex abrimos cedo");
    expect(semHora.schedule).toBeNull();
  });

  it("horário impossível, dia repetido, sobreposição e texto com lixo viram dúvida (e nunca uma grade que o dono não conseguiria salvar)", () => {
    expect(suggestSchedule("seg 25h às 30h").schedule).toBeNull();
    expect(suggestSchedule("seg 9h às 9h").doubts[0].reason).toMatch(/mesmo horário/);
    const repetido = suggestSchedule("seg a sex 9h às 17h; seg 10h às 12h");
    expect(repetido.complete).toBe(false);
    expect(repetido.doubts[0].reason).toMatch(/mais de uma vez/);
    expect(suggestSchedule("seg 9h às 17h e 16h às 20h").schedule).toBeNull(); // sobreposição: a validação do servidor recusa
    const lixo = suggestSchedule("seg a sex 9h às 17h =cmd()|DROP TABLE");
    expect(lixo.complete).toBe(false);
    expect(lixo.doubts.length).toBeGreaterThan(0);
  });
});

describe("POST /api/store/hours/suggest", { timeout: 90_000 }, () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;
  let storeId: string;
  let credentials: { password: string };
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    const r = await registerStore(app, { slug: "loja-sg", code: "SG1", plan: "BASICO" });
    cookie = r.cookie!;
    storeId = json(r.response).store.id;
    credentials = r.credentials;
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });
  const suggest = (payload: unknown, c = cookie) => app.inject({ method: "POST", url: "/api/store/hours/suggest", headers: { cookie: c }, payload: payload as never });

  it("sem corpo usa o texto LEGADO da loja; com texto usa o enviado; NÃO grava grade nem mexe no texto; só OWNER; sem login 401", async () => {
    await prisma.store.update({ where: { id: storeId }, data: { openingHours: "Seg a sáb 09–17" } });
    const legado = await suggest({});
    expect(legado.statusCode, legado.body).toBe(200);
    expect(json(legado).suggestion).toMatchObject({ source: "LEGACY", complete: true, doubts: [], summary: "Seg a sáb 09:00–17:00" });
    const enviado = await suggest({ text: "Dom 10h às 14h" });
    expect(json(enviado).suggestion).toMatchObject({ source: "REQUEST", complete: true, summary: "Dom 10:00–14:00" });
    const duvida = await suggest({ text: "quando dá" });
    expect(json(duvida).suggestion).toMatchObject({ schedule: null, complete: false });
    const loja = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(loja.schedule).toBeNull(); // nada foi gravado
    expect(loja.openingHours).toBe("Seg a sáb 09–17");
    expect((await suggest({ text: "x".repeat(501) })).statusCode).toBe(400);
    expect((await suggest({ outro: 1 })).statusCode).toBe(400); // corpo estrito
    expect((await app.inject({ method: "POST", url: "/api/store/hours/suggest", payload: {} })).statusCode).toBe(401);
    const bcrypt = await import("bcryptjs");
    await prisma.user.create({ data: { storeId, email: "staff-sg@teste.com", passwordHash: await bcrypt.hash(credentials.password, 10), role: "STAFF" } });
    const staff = (await login(app, "staff-sg@teste.com", credentials.password)).cookie!;
    expect((await suggest({}, staff)).statusCode).toBe(403);
  });

  it("isolamento: usa SEMPRE o texto da loja da sessão (outra loja com outro texto não aparece)", async () => {
    await prisma.store.update({ where: { id: storeId }, data: { openingHours: "Seg 9h às 12h" } });
    const outra = await registerStore(app, { slug: "loja-sg-b", code: "SG2", plan: "BASICO" });
    await prisma.store.updateMany({ where: { slug: "loja-sg-b" }, data: { openingHours: "Ter 14h às 18h" } });
    expect(json(await suggest({})).suggestion.summary).toBe("Seg 09:00–12:00");
    expect(json(await suggest({}, outra.cookie!)).suggestion.summary).toBe("Ter 14:00–18:00");
  });
});
