import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { prisma } from "@meucardapio/db";
import { allowedOrigin } from "../src/lib/securityConfig";
import { WS_CLOSE_SESSION_REVOKED } from "../src/realtime/hub";
import { makeApp, registerStore, resetDb } from "./helpers";

// NG-04 (ST-07): WebSocket do painel e da impressora. (1) o handshake confere o Origin (o WebSocket não passa pelo CORS); (2) revogar a sessão ou a chave FECHA o socket
// aberto na hora, com o código 4401 que o painel e o print-client entendem como "entre de novo".

describe("NG-04: WebSocket — Origin e revogação", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    await resetDb();
    app = makeApp();
    await app.ready();
  });
  afterAll(async () => {
    await resetDb(); // não deixa loja/usuário para o próximo arquivo (o mfa-notices só limpa DEPOIS de cada teste)
    await prisma.$disconnect();
  });
  const json = (r: { body: string }) => JSON.parse(r.body);
  const closed = (ws: WebSocket) => new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));

  it("Origin: o do painel conecta; outro Origin é recusado no handshake (403); sem Origin (cliente não-navegador) segue pelo cookie; sem sessão = 401", async () => {
    const { cookie } = await registerStore(app);
    const ok = await app.injectWS("/ws/panel", { headers: { cookie: cookie!, origin: allowedOrigin() } });
    ok.close();
    await expect(app.injectWS("/ws/panel", { headers: { cookie: cookie!, origin: "https://atacante.example" } })).rejects.toThrow(/403/);
    const semOrigin = await app.injectWS("/ws/panel", { headers: { cookie: cookie! } });
    semOrigin.close();
    await expect(app.injectWS("/ws/panel", { headers: { origin: allowedOrigin() } })).rejects.toThrow(/401/);
  });

  it("sair de todos os aparelhos FECHA o socket do painel aberto, com o código 4401", async () => {
    const { cookie } = await registerStore(app);
    const ws = await app.injectWS("/ws/panel", { headers: { cookie: cookie!, origin: allowedOrigin() } });
    const fechou = closed(ws);
    const res = await app.inject({ method: "POST", url: "/auth/logout-all", headers: { cookie: cookie!, origin: allowedOrigin() } });
    expect(res.statusCode).toBe(200);
    expect(await fechou).toBe(WS_CLOSE_SESSION_REVOKED);
  });

  it("revogar a chave da impressora FECHA o socket dela (4401) e a chave revogada não conecta de novo", async () => {
    const { cookie } = await registerStore(app);
    const created = json(await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: cookie! }, payload: { label: "Balcão" } })).token as { id: string; token: string };
    const ws = await app.injectWS("/ws/device", { headers: { authorization: `Bearer ${created.token}` } });
    const fechou = closed(ws);
    const revoked = await app.inject({ method: "POST", url: `/api/device-tokens/${created.id}/revoke`, headers: { cookie: cookie! } });
    expect(revoked.statusCode).toBe(200);
    expect(await fechou).toBe(WS_CLOSE_SESSION_REVOKED);
    await expect(app.injectWS("/ws/device", { headers: { authorization: `Bearer ${created.token}` } })).rejects.toThrow(/401/);
  });
});
