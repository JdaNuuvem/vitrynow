// QA — limites de plano sob concorrência (ST-35 da Sun Tzu; critério da API-08). Convenção: bug() = it.fails;
// com QA_STRICT=1 roda como teste normal. Só faz sentido depois do API-08 (limite de 1 impressora no BASICO);
// em `main` sem o API-08 não há limite, então o teste também falha (e fica verde como bug()).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "../helpers";

const bug = process.env.QA_STRICT ? it : it.fails;

describe("QA limites de plano sob concorrência", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { app = makeApp(); await app.ready(); });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("D33 (ST-35 / SEC-21) 8 criações paralelas de chave de impressora no BASICO (limite 1) criam EXATAMENTE 1", async () => {
    const { cookie, response } = await registerStore(app);
    const storeId = JSON.parse(response.body).store.id as string;
    const resultados = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        app.inject({ method: "POST", url: "/api/device-tokens", remoteAddress: `10.8.0.${i + 1}`, headers: { cookie: cookie! }, payload: { label: `impressora ${i}` } }),
      ),
    );
    const criadas = await prisma.deviceToken.count({ where: { storeId, revokedAt: null } });
    const codigos = resultados.map((r) => r.statusCode).sort().join(",");
    expect(criadas, `status: ${codigos}`).toBe(1);
    // a criação responde 200 hoje (contrato atual de /api/device-tokens); aceita 201 se um dia mudar
    expect(resultados.filter((r) => r.statusCode === 200 || r.statusCode === 201).length).toBe(1);
    expect(resultados.filter((r) => r.statusCode === 402).length).toBe(7);
  });
});
