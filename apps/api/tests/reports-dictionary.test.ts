// DADOS i1: dicionário de métricas. Cada indicador definido UMA vez; todo campo do resumo remete a uma métrica que existe.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { metricDictionarySchema } from "@meucardapio/shared-types";
import { METRIC_IDS, METRICS, SUMMARY_FIELD_METRIC } from "../src/lib/metricDictionary";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("dicionário de métricas (i1)", () => {
  it("M01..M27, sem repetição, cada uma com definição, 'não significa' e fuso da loja", () => {
    expect(METRICS.map((m) => m.id)).toEqual(Array.from({ length: 27 }, (_, i) => `M${String(i + 1).padStart(2, "0")}`));
    for (const m of METRICS) {
      expect(m.definition.length, m.id).toBeGreaterThan(5);
      expect(m.notMeaning.length, m.id).toBeGreaterThan(5);
      expect(m.timezone).toBe("STORE");
    }
  });
  it("decisão do Claudio: pico por hora e por dia da semana no BASICO; lucro só depois", () => {
    const plan = (id: string) => METRICS.find((m) => m.id === id)!.plan;
    expect([plan("M11"), plan("M12"), plan("M27")]).toEqual(["BASICO", "BASICO", "DEPOIS"]);
    expect([plan("M10"), plan("M20"), plan("M25")]).toEqual(["PRO", "PRO", "PRO"]);
  });
  it("todo campo do resumo aponta para uma métrica que existe", () => {
    for (const [field, id] of Object.entries(SUMMARY_FIELD_METRIC)) expect(METRIC_IDS.has(id), `${field} → ${id}`).toBe(true);
  });
});

describe("GET /api/reports/dictionary", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { app = makeApp(); await app.ready(); });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("OWNER lê; sem sessão 401; o corpo obedece ao schema; e todo campo do resumo real está mapeado no dicionário", async () => {
    const { cookie } = await registerStore(app);
    expect((await app.inject({ method: "GET", url: "/api/reports/dictionary" })).statusCode).toBe(401);
    const r = await app.inject({ method: "GET", url: "/api/reports/dictionary", headers: { cookie: cookie! } });
    expect(r.statusCode).toBe(200);
    const body = metricDictionarySchema.parse(JSON.parse(r.body));
    expect(body.metrics).toHaveLength(27);
    const resumo = JSON.parse((await app.inject({ method: "GET", url: "/api/reports/summary?compare=prev", headers: { cookie: cookie! } })).body);
    const semMetrica = ["from", "to", "fromDate", "toDate", "timeZone", "partial", "ruleChangedAt"]; // metadados do período, não indicadores
    const faltando = Object.keys(resumo).filter((k) => !semMetrica.includes(k) && !(k in body.summaryFields));
    expect(faltando, "campo novo no resumo sem métrica no dicionário").toEqual([]);
  });
});
