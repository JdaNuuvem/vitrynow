import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientIpOf, INTERNAL_AUTH_HEADER, VISITOR_IP_HEADER } from "../src/lib/clientIp";
import { internalServiceSecrets } from "../src/lib/securityConfig";

// SEC-24: o web (SSR) repassa o IP do visitante com um segredo de serviço; a API só acredita nele quando a CONEXÃO é interna
// e o segredo confere. Sem isso, todo o tráfego do SSR dividiria um único limite de 300 req/min (provado pelo Sun Tzu).

const SECRET = "svc-secret-0123456789abcdef0123456789abcdef-A";
const OLD_SECRET = "svc-secret-0123456789abcdef0123456789abcdef-B";
const saved = { ...process.env };
beforeEach(() => {
  process.env.API_INTERNAL_SECRET = SECRET;
  delete process.env.API_INTERNAL_SECRET_PREVIOUS;
});
afterEach(() => {
  process.env = { ...saved };
});

type Fake = Parameters<typeof clientIpOf>[0];
const req = (headers: Record<string, string | string[]>, socketAddress: string | undefined, ip = "172.18.0.9"): Fake =>
  ({ ip, headers, socket: { remoteAddress: socketAddress } }) as unknown as Fake;
const withHeaders = (visitor: string, secret = SECRET) => ({ [INTERNAL_AUTH_HEADER]: secret, [VISITOR_IP_HEADER]: visitor });

describe("clientIpOf (SEC-24)", () => {
  it("sem os cabeçalhos: o IP da conexão", () => {
    expect(clientIpOf(req({}, "172.18.0.5"))).toBe("172.18.0.9");
  });

  it("segredo certo + conexão interna + IP válido ⇒ o IP do visitante (IPv4, IPv6, conexão dual-stack)", () => {
    expect(clientIpOf(req(withHeaders("203.0.113.7"), "172.18.0.5"))).toBe("203.0.113.7");
    expect(clientIpOf(req(withHeaders("2001:db8:1:2::9"), "172.18.0.5"))).toBe("2001:db8:1:2::9");
    expect(clientIpOf(req(withHeaders(" 203.0.113.8 "), "10.0.0.4"))).toBe("203.0.113.8");
    expect(clientIpOf(req(withHeaders("203.0.113.7"), "::ffff:172.18.0.3"))).toBe("203.0.113.7");
    expect(clientIpOf(req(withHeaders("203.0.113.7"), "127.0.0.1"))).toBe("203.0.113.7");
    expect(clientIpOf(req(withHeaders("203.0.113.7"), "::1"))).toBe("203.0.113.7");
  });

  it("segredo errado, parecido, vazio ou de outro tamanho ⇒ ignora o cabeçalho (sem erro)", () => {
    for (const bad of ["", "x", SECRET.slice(0, -1), SECRET + "x", OLD_SECRET, "a".repeat(100000)]) {
      expect(clientIpOf(req(withHeaders("203.0.113.7", bad), "172.18.0.5")), bad.slice(0, 8)).toBe("172.18.0.9");
    }
  });

  it("segredo certo mas conexão de FORA da rede interna ⇒ ignora (o segredo vazado não vale da internet)", () => {
    for (const outside of ["203.0.113.50", "8.8.8.8", "2001:db8::1", "::ffff:8.8.8.8", undefined, "lixo"]) {
      expect(clientIpOf(req(withHeaders("198.51.100.1"), outside)), String(outside)).toBe("172.18.0.9");
    }
  });

  it("IP do visitante inválido, lista ou cabeçalho repetido ⇒ ignora", () => {
    for (const bad of ["lixo", "", "1.2.3.4, 5.6.7.8", "999.1.1.1", "javascript:alert(1)", "a".repeat(5000)]) {
      expect(clientIpOf(req(withHeaders(bad), "172.18.0.5")), bad.slice(0, 12)).toBe("172.18.0.9");
    }
    expect(clientIpOf(req({ [INTERNAL_AUTH_HEADER]: SECRET, [VISITOR_IP_HEADER]: ["1.1.1.1", "2.2.2.2"] }, "172.18.0.5"))).toBe("172.18.0.9");
    expect(clientIpOf(req({ [INTERNAL_AUTH_HEADER]: [SECRET, SECRET], [VISITOR_IP_HEADER]: "1.1.1.1" }, "172.18.0.5"))).toBe("172.18.0.9");
  });

  it("segredo desligado (`none` ou ausente fora de produção) ⇒ cabeçalho nunca vale", () => {
    process.env.API_INTERNAL_SECRET = "none";
    expect(clientIpOf(req(withHeaders("203.0.113.7", "none"), "172.18.0.5"))).toBe("172.18.0.9");
    delete process.env.API_INTERNAL_SECRET;
    expect(clientIpOf(req(withHeaders("203.0.113.7", ""), "172.18.0.5"))).toBe("172.18.0.9");
  });

  it("rotação sem derrubar o site: durante a troca valem o novo e o anterior; depois só o novo", () => {
    process.env.API_INTERNAL_SECRET = SECRET;
    process.env.API_INTERNAL_SECRET_PREVIOUS = OLD_SECRET;
    expect(clientIpOf(req(withHeaders("203.0.113.7", SECRET), "172.18.0.5"))).toBe("203.0.113.7");
    expect(clientIpOf(req(withHeaders("203.0.113.7", OLD_SECRET), "172.18.0.5"))).toBe("203.0.113.7");
    delete process.env.API_INTERNAL_SECRET_PREVIOUS;
    expect(clientIpOf(req(withHeaders("203.0.113.7", OLD_SECRET), "172.18.0.5"))).toBe("172.18.0.9");
    expect(clientIpOf(req(withHeaders("203.0.113.7", SECRET), "172.18.0.5"))).toBe("203.0.113.7");
  });
});

describe("API_INTERNAL_SECRET na configuração (SEC-24)", () => {
  it("produção sem o segredo: não sobe; `none` declara que não há; fora de produção ausente = desligado", () => {
    process.env.NODE_ENV = "production";
    delete process.env.API_INTERNAL_SECRET;
    expect(() => internalServiceSecrets()).toThrow(/não configurado em produção/);
    process.env.API_INTERNAL_SECRET = "none";
    expect(internalServiceSecrets()).toEqual([]);
    process.env.NODE_ENV = "development";
    delete process.env.API_INTERNAL_SECRET;
    expect(internalServiceSecrets()).toEqual([]);
  });

  it("recusa segredo curto, de exemplo, de teste do repositório e igual ao JWT_SECRET/MFA_HMAC_KEY", () => {
    for (const bad of ["curto", "changeme", "dev-secret-change-me", "test-secret-nao-use-em-producao", "x".repeat(31)]) {
      process.env.API_INTERNAL_SECRET = bad;
      expect(() => internalServiceSecrets(), bad).toThrow(/fraco ou de exemplo/);
    }
    process.env.API_INTERNAL_SECRET = SECRET;
    process.env.JWT_SECRET = SECRET;
    expect(() => internalServiceSecrets()).toThrow(/diferente do JWT_SECRET/);
    delete process.env.JWT_SECRET;
    process.env.MFA_HMAC_KEY = SECRET;
    expect(() => internalServiceSecrets()).toThrow(/diferente do JWT_SECRET e do MFA_HMAC_KEY/);
  });

  it("o valor anterior segue as mesmas regras e a mensagem de erro nunca traz o valor do segredo", () => {
    process.env.API_INTERNAL_SECRET_PREVIOUS = "SEGREDO-NAO-VAZAR";
    try {
      internalServiceSecrets();
      throw new Error("deveria ter recusado");
    } catch (error) {
      expect(String((error as Error).message)).toMatch(/API_INTERNAL_SECRET_PREVIOUS fraco/);
      expect(String((error as Error).message)).not.toContain("SEGREDO-NAO-VAZAR");
    }
    process.env.API_INTERNAL_SECRET_PREVIOUS = OLD_SECRET;
    expect(internalServiceSecrets()).toEqual([SECRET, OLD_SECRET]);
  });
});

describe("limite global com o IP do visitante (SEC-24), na rota real", () => {
  async function run(total: number, headersFor: (i: number) => Record<string, string>, remoteAddress: string) {
    const { buildApp } = await import("../src/app");
    const app = buildApp();
    await app.ready();
    let limited = 0;
    for (let i = 0; i < total; i++) {
      const res = await app.inject({ method: "POST", url: "/auth/logout", remoteAddress, headers: headersFor(i) });
      if (res.statusCode === 429) limited += 1;
    }
    await app.close();
    return limited;
  }
  const visitor = (i: number) => `198.51.${Math.floor(i / 250)}.${(i % 250) + 1}`;

  it("PROBLEMA ORIGINAL: sem o segredo, 320 visitantes pelo mesmo web ⇒ 20 legítimos recebem 429", async () => {
    expect(await run(320, (i) => ({ [VISITOR_IP_HEADER]: visitor(i) }), "172.18.0.5")).toBe(20);
  }, 60000);

  it("CORREÇÃO: com o segredo, 320 visitantes distintos pelo mesmo web ⇒ nenhum 429", async () => {
    expect(await run(320, (i) => withHeaders(visitor(i)), "172.18.0.5")).toBe(0);
  }, 60000);

  it("com o segredo, o MESMO visitante insistindo continua limitado (320 ⇒ 20 recebem 429)", async () => {
    expect(await run(320, () => withHeaders("203.0.113.77"), "172.18.0.5")).toBe(20);
  }, 60000);

  it("atacante de fora com segredo errado e IPs forjados não escapa do próprio limite (320 ⇒ 20 recebem 429)", async () => {
    expect(await run(320, (i) => withHeaders(visitor(i), OLD_SECRET), "203.0.113.200")).toBe(20);
  }, 60000);

  it("atacante forjando o IP da vítima não esgota o balde dela (a vítima, com segredo certo, segue sem 429)", async () => {
    const { buildApp } = await import("../src/app");
    const app = buildApp();
    await app.ready();
    for (let i = 0; i < 320; i++) {
      await app.inject({ method: "POST", url: "/auth/logout", remoteAddress: "203.0.113.200", headers: withHeaders("203.0.113.77", OLD_SECRET) });
    }
    const victim = await app.inject({ method: "POST", url: "/auth/logout", remoteAddress: "172.18.0.5", headers: withHeaders("203.0.113.77") });
    await app.close();
    expect(victim.statusCode).not.toBe(429);
  }, 60000);

  it("SERVIÇO sem visitante (revalidação do cardápio): balde próprio com teto de 3000/min — 3010 ⇒ 10 recebem 429", async () => {
    expect(await run(3010, () => ({ [INTERNAL_AUTH_HEADER]: SECRET }), "172.18.0.5")).toBe(10);
  }, 120000);

  it("o balde de serviço não toca o limite do IP do contêiner nem o de outros clientes", async () => {
    const { buildApp } = await import("../src/app");
    const app = buildApp();
    await app.ready();
    for (let i = 0; i < 320; i++) {
      await app.inject({ method: "POST", url: "/auth/logout", remoteAddress: "172.18.0.5", headers: { [INTERNAL_AUTH_HEADER]: SECRET } });
    }
    const sameContainerNoSecret = await app.inject({ method: "POST", url: "/auth/logout", remoteAddress: "172.18.0.5" });
    const otherClient = await app.inject({ method: "POST", url: "/auth/logout", remoteAddress: "203.0.113.5" });
    await app.close();
    expect(sameContainerNoSecret.statusCode).not.toBe(429);
    expect(otherClient.statusCode).not.toBe(429);
  }, 60000);

  it("com o segredo certo mas vindo de FORA da rede interna: não ganha o teto de serviço (320 ⇒ 20 recebem 429)", async () => {
    expect(await run(320, () => ({ [INTERNAL_AUTH_HEADER]: SECRET }), "203.0.113.200")).toBe(20);
  }, 60000);

  it("segredo errado, mesmo de dentro: limite normal do IP da conexão (320 ⇒ 20 recebem 429)", async () => {
    expect(await run(320, () => ({ [INTERNAL_AUTH_HEADER]: OLD_SECRET }), "172.18.0.5")).toBe(20);
  }, 60000);

  it("o segredo nunca volta na resposta", async () => {
    const { buildApp } = await import("../src/app");
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/auth/logout", remoteAddress: "172.18.0.5", headers: withHeaders("203.0.113.9") });
    await app.close();
    expect(JSON.stringify(res.headers) + res.body).not.toContain(SECRET);
  });
});

describe("ninguém lê o IP cru fora de clientIp.ts (SEC-24)", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
    });
  }
  it("nenhum arquivo de src/ usa request.ip / req.ip / remoteAddress além do módulo (e do clientKey)", () => {
    const offenders = walk(join(__dirname, "..", "src"))
      .filter((file) => !/[\\/]lib[\\/](clientIp|clientKey|trustProxyPolicy)\.ts$/.test(file))
      .filter((file) => /\b(request|req)\.ip\b|remoteAddress|x-forwarded-for/i.test(readFileSync(file, "utf8").replace(/\/\/.*$/gm, "")));
    expect(offenders).toEqual([]);
  });
});
