import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { loggerOptions, routeLogUrl } from "../src/lib/logging";

// SEC-31 (ST-70, Sun Tzu): o que vai no CAMINHO da URL (o `orderId` do pedido público é a credencial do cliente; o token de acompanhamento e o
// `qrToken` da mesa, pelo desenho) não pode sair nas linhas `incoming request` / `request completed` / de erro. O log leva o MODELO da rota.

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  const app = buildApp({ logger: { ...loggerOptions(), level: "info", stream } as never });
  const parsed = () => lines.flatMap((l) => l.split("\n")).filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
  return { app, lines, parsed };
}

describe("log leva o MODELO da rota, nunca o valor do parâmetro do caminho (SEC-31, ST-70)", () => {
  it("payment-status e cancel: a credencial do pedido no caminho não aparece em NENHUMA linha; CONTROLE POSITIVO: a linha existe e traz o modelo", async () => {
    const { app, lines, parsed } = capture();
    await app.ready();
    const CRED = "CREDENCIAL-UNICA-do-pedido-0123456789";
    const statusRes = await app.inject({ method: "GET", url: `/stores/loja-x/orders/${CRED}/payment-status` });
    const cancelRes = await app.inject({ method: "POST", url: `/stores/loja-x/orders/${CRED}/cancel`, payload: {} });
    await app.close();

    const all = lines.join("\n");
    expect(all).not.toContain(CRED);
    expect(all).not.toContain("loja-x"); // nem o slug: o modelo é constante do código

    // controle positivo: as linhas de log EXISTEM (a requisição é logada) e carregam o modelo da rota
    const incoming = parsed().filter((l) => l.msg === "incoming request");
    const urls = incoming.map((l) => l.req.url);
    expect(urls).toContain("/stores/:slug/orders/:orderId/payment-status");
    expect(urls).toContain("/stores/:slug/orders/:orderId/cancel");
    const completed = parsed().filter((l) => l.msg === "request completed");
    expect(completed.length).toBeGreaterThanOrEqual(2);
    // a requisição de fato foi tratada (a rota existe; o pedido é que não existe), para o teste não passar com rota quebrada
    expect([statusRes.statusCode, cancelRes.statusCode].every((c) => c >= 400 && c < 500)).toBe(true);
    expect(statusRes.statusCode).not.toBe(500);
  }, 60000);

  it("rota com 2 parâmetros dinâmicos e rota de painel: o modelo vem de `routeOptions.url`, com a query ainda redigida", async () => {
    const { app, lines, parsed } = capture();
    app.get("/mesa/:qrToken/itens/:itemId", async () => ({ ok: true })); // forma da API-22 (qrToken no caminho)
    await app.ready();
    const QR = "QR-DA-MESA-segredo-9876543210";
    const res = await app.inject({ method: "GET", url: `/mesa/${QR}/itens/42?token=NA-QUERY-SEGREDO&page=2` });
    expect(res.statusCode).toBe(200);
    await app.close();
    const all = lines.join("\n");
    expect(all).not.toContain(QR);
    expect(all).not.toContain("NA-QUERY-SEGREDO");
    const incoming = parsed().find((l) => l.msg === "incoming request")!;
    expect(incoming.req.url).toBe("/mesa/:qrToken/itens/:itemId?token=[redigido]&page=2");
  }, 60000);

  it("erro 500 (log de erro com `req`): o valor do caminho também não aparece; CONTROLE POSITIVO: a linha de erro existe", async () => {
    const { app, lines, parsed } = capture();
    app.get("/falha/:segredo", async () => {
      throw new Error("falha interna");
    });
    await app.ready();
    const SEG = "SEGREDO-NO-CAMINHO-DA-FALHA-111222333";
    const res = await app.inject({ method: "GET", url: `/falha/${SEG}` });
    expect(res.statusCode).toBe(500);
    await app.close();
    expect(lines.join("\n")).not.toContain(SEG);
    const errorLine = parsed().find((l) => l.level === 50);
    expect(errorLine).toBeDefined();
    expect(errorLine!.req.url).toBe("/falha/:segredo");
  }, 60000);

  it("rota NÃO encontrada (404): o caminho é de quem chamou, então sobra só o 1º segmento; a query segue redigida", async () => {
    const { app, lines, parsed } = capture();
    await app.ready();
    const A = "VALOR-UNICO-no-caminho-2-0123456789";
    await app.inject({ method: "GET", url: `/loja/x/m/${A}` });
    await app.inject({ method: "GET", url: "/nao-existe?token=SEGREDO-404&page=2" });
    await app.inject({ method: "GET", url: "/tok3nCompridoQueParece12345678/segmento" }); // 1º segmento com cara de credencial
    await app.close();
    const all = lines.join("\n");
    expect(all).not.toContain(A);
    expect(all).not.toContain("SEGREDO-404");
    expect(all).not.toContain("tok3nCompridoQueParece12345678");
    const urls = parsed().filter((l) => l.msg === "incoming request").map((l) => l.req.url);
    expect(urls).toEqual(["/loja/[redigido]", "/nao-existe?token=[redigido]&page=2", "/[redigido]/[redigido]"]);
  }, 60000);

  it("routeLogUrl: unidade (modelo, sem rota, query, vazio)", () => {
    expect(routeLogUrl({ url: "/a/b?x=1", routeOptions: { url: "/a/:id" } })).toBe("/a/:id?x=1");
    expect(routeLogUrl({ url: "/a/b", routeOptions: { url: "/a/:id" } })).toBe("/a/:id");
    expect(routeLogUrl({ url: "/a/b/c" })).toBe("/a/[redigido]");
    expect(routeLogUrl({ url: "/a" })).toBe("/a");
    expect(routeLogUrl({ url: "/" })).toBe("/");
    expect(routeLogUrl({ url: "/a/b?senha=zzz&k=1" })).toBe("/a/[redigido]?senha=[redigido]&k=1");
    expect(routeLogUrl({ url: undefined })).toBeUndefined();
  });
});
