import { afterEach, describe, expect, it } from "vitest";
import { clientKey, UNKNOWN_CLIENT } from "../src/lib/clientKey";
import { LoginThrottle } from "../src/lib/loginThrottle";
import { trustProxySetting } from "../src/lib/securityConfig";
import { trustProxyEntryProblem } from "../src/lib/trustProxyPolicy";

// SEC-23 (ST-37, ST-37b): chave do cliente normalizada · SEC-22 (ST-36): TRUST_PROXY_CIDR só privado e estreito.

describe("clientKey (SEC-23)", () => {
  it("IPv4 fica como está", () => {
    expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("10.0.0.2")).toBe("10.0.0.2");
  });

  it("IPv6: a /64 inteira é UM cliente (ST-37)", () => {
    const a = clientKey("2001:db8:abcd:12::1");
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(clientKey("2001:db8:abcd:12::ffff")).toBe(a);
    expect(clientKey("2001:0db8:abcd:0012:dead:beef:0:1")).toBe(a); // forma expandida e maiúsculas
    expect(clientKey("2001:DB8:ABCD:12:1:2:3:4")).toBe(a);
    expect(clientKey("2001:db8:abcd:13::1")).not.toBe(a); // outra /64 é outro cliente
  });

  it("alias IPv4-mapeado vale como o IPv4 (ST-37b), nas formas decimal e hexadecimal", () => {
    expect(clientKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("::FFFF:203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("0:0:0:0:0:ffff:cb00:7107")).toBe("203.0.113.7");
    expect(clientKey("::ffff:cb00:7107")).toBe("203.0.113.7");
  });

  it("loopback e zona IPv6 não quebram; lixo vira o balde único e restritivo", () => {
    expect(clientKey("::1")).toBe("0:0:0:0::/64");
    expect(clientKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    for (const bad of ["", "lixo", "999.1.1.1", "2001:db8::g", "1:2:3:4:5:6:7:8:9", "::ffff:1.2.3", undefined, null]) {
      expect(clientKey(bad as never), String(bad)).toBe(UNKNOWN_CLIENT);
    }
  });
});

describe("limitador de login com a chave normalizada (SEC-23)", () => {
  const LIMITS = { pairAttempts: 5, accountThreshold: 12, delayStepMs: 250, delayMaxMs: 5000 };

  it("30 tentativas de 30 endereços da MESMA /64 ⇒ só 5 testam a senha (ST-37)", () => {
    const throttle = new LoginThrottle(LIMITS);
    let tested = 0;
    for (let i = 0; i < 30; i++) {
      const r = throttle.reserve("alvo@x.com", `2001:db8:1:2:${(i + 1).toString(16)}::1`);
      if (r.allowed) tested += 1;
    }
    expect(tested).toBe(5);
  });

  it("8 tentativas por IPv4 e 8 pelo alias ::ffff: do MESMO IPv4 ⇒ só 5 no total (ST-37b)", () => {
    const throttle = new LoginThrottle(LIMITS);
    let tested = 0;
    for (let i = 0; i < 8; i++) {
      if (throttle.reserve("alvo@x.com", "203.0.113.7").allowed) tested += 1;
      if (throttle.reserve("alvo@x.com", "::ffff:203.0.113.7").allowed) tested += 1;
    }
    expect(tested).toBe(5);
  });

  it("outra /64 e outro IPv4 continuam livres: o dono não é trancado pela faixa do atacante", () => {
    const throttle = new LoginThrottle(LIMITS);
    for (let i = 0; i < 30; i++) throttle.reserve("dono@x.com", `2001:db8:1:2:${i + 1}::1`);
    expect(throttle.reserve("dono@x.com", "2001:db8:9:9::1").allowed).toBe(true);
    expect(throttle.reserve("dono@x.com", "198.51.100.20").allowed).toBe(true);
  });
});

describe("TRUST_PROXY_CIDR em produção (SEC-22, ST-36)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const prod = (value: string) => {
    process.env.NODE_ENV = "production";
    process.env.TRUST_PROXY_CIDR = value;
    return () => trustProxySetting();
  };

  it("recusa faixas públicas largas e as que cobrem a internet", () => {
    for (const bad of ["0.0.0.0/0", "0.0.0.0/1", "128.0.0.0/1", "8.0.0.0/8", "::/0", "2000::/3", "203.0.113.0/24", "1.2.3.4"]) {
      expect(prod(bad), bad).toThrow(/TRUST_PROXY_CIDR recusado/);
    }
  });

  it("recusa a faixa privada LARGA demais (mais larga que o bloco privado) e lixo", () => {
    for (const bad of ["10.0.0.0/7", "172.16.0.0/11", "192.168.0.0/15", "127.0.0.0/7", "fc00::/6", "172.32.0.1", "lixo", "10.0.0.1/33", "10.0.0.1/8/8"]) {
      expect(prod(bad), bad).toThrow(/TRUST_PROXY_CIDR recusado/);
    }
  });

  it("uma entrada ruim derruba a lista inteira, mesmo com outras boas", () => {
    expect(prod("172.29.250.10/32, 8.0.0.0/8")).toThrow(/8\.0\.0\.0\/8/);
  });

  it("aceita o IP fixo do Caddy, as redes privadas e o loopback", () => {
    for (const ok of ["172.29.250.10/32", "172.29.250.10", "10.0.0.0/8", "172.16.0.0/12", "192.168.1.0/24", "127.0.0.1", "::1", "fc00::/7", "fd12:3456:789a::/48"]) {
      expect(prod(ok)(), ok).toEqual([ok]);
    }
    expect(prod("172.29.250.10/32, 10.0.0.5")()).toEqual(["172.29.250.10/32", "10.0.0.5"]);
  });

  it("`none` continua valendo e fora de produção a política não bloqueia o desenvolvimento", () => {
    expect(prod("none")()).toBe(false);
    process.env.NODE_ENV = "development";
    process.env.TRUST_PROXY_CIDR = "8.0.0.0/8";
    expect(trustProxySetting()).toEqual(["8.0.0.0/8"]);
  });

  it("mensagens dizem o que fazer", () => {
    expect(trustProxyEntryProblem("0.0.0.0/1")).toMatch(/rede privada nem loopback/);
    expect(trustProxyEntryProblem("10.0.0.0/7")).toMatch(/larga demais.*mínimo \/8/);
    expect(trustProxyEntryProblem("172.29.250.10/32")).toBeNull();
  });
});

// Limite GLOBAL por cliente (300/min) usa a mesma chave normalizada: provado na rota real, sem banco (logout sem cookie).
describe("limite global de requisições usa a chave normalizada (SEC-23)", () => {
  async function hits(addresses: (i: number) => string, total: number) {
    const { buildApp } = await import("../src/app");
    const app = buildApp();
    await app.ready();
    let limited = 0;
    for (let i = 0; i < total; i++) {
      const res = await app.inject({ method: "POST", url: "/auth/logout", remoteAddress: addresses(i) });
      if (res.statusCode === 429) limited += 1;
    }
    await app.close();
    return limited;
  }

  it("320 requisições de 320 endereços da MESMA /64 IPv6 ⇒ as que passam de 300 recebem 429", async () => {
    expect(await hits((i) => `2001:db8:5:6:${(i + 1).toString(16)}::1`, 320)).toBe(20);
  }, 60000);

  it("160 pelo IPv4 + 160 pelo alias ::ffff: do mesmo IPv4 ⇒ contam juntas (20 recebem 429)", async () => {
    expect(await hits((i) => (i % 2 === 0 ? "203.0.113.9" : "::ffff:203.0.113.9"), 320)).toBe(20);
  }, 60000);

  it("clientes de /64 diferentes não se atrapalham: 320 requisições de 320 /64 distintas ⇒ nenhum 429", async () => {
    expect(await hits((i) => `2001:db8:${(i + 1).toString(16)}::1`, 320)).toBe(0);
  }, 60000);
});
