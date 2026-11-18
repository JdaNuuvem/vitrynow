// QA-24 — SEC-22/SEC-23 (ST-37, ST-37b): a chave do cliente no limite de login. Mesma /64 IPv6 = um cliente; o alias
// IPv4-mapeado (::ffff:a.b.c.d) vale como o IPv4; um endereço ilegível não vira bypass. Só passa depois do merge da SEC-23.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "../helpers";

describe("QA chave do cliente no login (SEC-23)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { app = makeApp(); await app.ready(); });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await prisma.$disconnect(); });

  const login = (email: string, password: string, ip: string) => app.inject({ method: "POST", url: "/auth/login", remoteAddress: ip, payload: { email, password } });

  it("V1 (ST-37) 30 tentativas de 30 endereços da MESMA /64: no máximo o limite do par chega a testar a senha", async () => {
    const { credentials } = await registerStore(app, { email: "v6@teste.com", password: "senha-certa-123" });
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => login(credentials.email, `errada-${i}`, `2001:db8:abcd:12:${(i + 1).toString(16)}::${(i * 7 + 1).toString(16)}`)));
    const testaram = rs.filter((r) => r.statusCode === 401).length;
    expect(testaram, rs.map((r) => r.statusCode).join(",")).toBeLessThanOrEqual(5);
    expect(rs.filter((r) => r.statusCode === 429).length).toBeGreaterThanOrEqual(25);
  }, 60_000);

  it("V2 (ST-37) /64 DIFERENTES são clientes diferentes: o dono de outra rede ainda entra", async () => {
    const { credentials } = await registerStore(app, { email: "v6b@teste.com", password: "senha-certa-123" });
    for (let i = 0; i < 6; i++) await login(credentials.email, `errada-${i}`, `2001:db8:aaaa:1::${i + 1}`);
    const dono = await login(credentials.email, "senha-certa-123", "2001:db8:bbbb:2::1");
    expect(dono.statusCode).toBe(200);
  }, 60_000);

  it("V3 (ST-37b) o alias ::ffff:a.b.c.d e o IPv4 puro dividem o MESMO limite (não dobra)", async () => {
    const { credentials } = await registerStore(app, { email: "mapeado@teste.com", password: "senha-certa-123" });
    const ips = ["10.9.9.9", "::ffff:10.9.9.9", "::ffff:0a09:0909", "0:0:0:0:0:ffff:10.9.9.9"];
    const rs: number[] = [];
    for (let i = 0; i < 12; i++) rs.push((await login(credentials.email, `errada-${i}`, ips[i % ips.length])).statusCode);
    expect(rs.filter((s) => s === 401).length, rs.join(",")).toBeLessThanOrEqual(5);
  }, 60_000);

  it("V4 entrada de IP hostil não é bypass: tentativas de endereços ilegíveis dividem UM balde", async () => {
    const { credentials } = await registerStore(app, { email: "hostil@teste.com", password: "senha-certa-123" });
    const rs: number[] = [];
    for (let i = 0; i < 12; i++) rs.push((await login(credentials.email, `errada-${i}`, i % 2 ? ":::" : "999.1.1.1")).statusCode);
    expect(rs.filter((s) => s === 401).length, rs.join(",")).toBeLessThanOrEqual(5);
  }, 60_000);
});
