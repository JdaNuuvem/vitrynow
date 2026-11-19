// Erros transitórios do banco viram resposta determinística no tratador raiz (nunca 500 mudo): P2034 ⇒ 409, P2024/P2028 ⇒ 503 SERVER_BUSY com Retry-After;
// outros erros do Prisma e erros comuns continuam 500 sem vazar a mensagem.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Prisma, prisma } from "@meucardapio/db";
import { buildApp } from "../src/app";

describe("erros transitórios do banco no tratador raiz", () => {
  let app: ReturnType<typeof buildApp>;
  const erro = (code: string) => new Prisma.PrismaClientKnownRequestError("segredo-interno do banco com e-mail@x.com", { code, clientVersion: "5.22.0" });
  beforeEach(async () => {
    app = buildApp();
    for (const code of ["P2034", "P2024", "P2028", "P2002"]) app.get(`/__prisma/${code}`, async () => { throw erro(code); });
    app.get("/__comum", async () => { throw new Error("falha comum com segredo-interno"); });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  const get = (url: string) => app.inject({ method: "GET", url });

  it("P2034 (conflito de escrita/deadlock) ⇒ 409 WRITE_CONFLICT", async () => {
    const r = await get("/__prisma/P2034");
    expect([r.statusCode, JSON.parse(r.body).code]).toEqual([409, "WRITE_CONFLICT"]);
  });

  it("P2024 (fila de conexões) e P2028 (transação não abriu) ⇒ 503 SERVER_BUSY com Retry-After fixo", async () => {
    for (const code of ["P2024", "P2028"]) {
      const r = await get(`/__prisma/${code}`);
      expect([r.statusCode, JSON.parse(r.body).code, r.headers["retry-after"]], code).toEqual([503, "SERVER_BUSY", "2"]);
    }
  });

  it("outros erros do Prisma (P2002 inesperado) e erros comuns seguem 500 e NUNCA vazam a mensagem", async () => {
    for (const url of ["/__prisma/P2002", "/__comum"]) {
      const r = await get(url);
      expect(r.statusCode, url).toBe(500);
      expect(r.body, url).not.toContain("segredo-interno");
      expect(r.body, url).not.toContain("e-mail@x.com");
    }
  });
});
