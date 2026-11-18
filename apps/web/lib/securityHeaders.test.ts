import { describe, expect, it } from "vitest";
// @ts-expect-error módulo .mjs sem tipos (compartilhado com o next.config.mjs)
import { buildCsp, securityHeaders } from "./securityHeaders.mjs";

const API = "https://pedidos.exemplo.com.br";
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d === name || d.startsWith(name + " ")) ?? "";

describe("CSP do web (NG-07)", () => {
  const csp: string = buildCsp({ apiUrl: API });

  it("só aceita script do próprio site: sem origem externa e sem eval em produção", () => {
    const script = directive(csp, "script-src");
    expect(script).toBe("script-src 'self' 'unsafe-inline'");
    expect(script).not.toContain("unsafe-eval");
    expect(script).not.toMatch(/https?:/);
  });

  it("fecha os vetores clássicos: object, base, form-action, clickjacking", () => {
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
  });

  it("connect-src: o site, a API e o WebSocket da API — e mais nada", () => {
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' https://pedidos.exemplo.com.br wss://pedidos.exemplo.com.br");
  });

  it("imagens: https livre (URL do lojista), data: do QR do PIX; nada de http puro", () => {
    const img = directive(csp, "img-src");
    expect(img).toContain("data:");
    expect(img).toContain("https:");
    expect(img).not.toMatch(/(^|\s)http:/);
  });

  it("produção força upgrade para https; desenvolvimento libera eval e localhost", () => {
    expect(csp).toContain("upgrade-insecure-requests");
    const dev: string = buildCsp({ apiUrl: "http://localhost:3001", dev: true });
    expect(dev).not.toContain("upgrade-insecure-requests");
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws://localhost:3001");
  });

  it("URL da API inválida ou ausente não quebra a política: cai para o próprio site", () => {
    expect(directive(buildCsp({ apiUrl: "lixo" }), "connect-src")).toBe("connect-src 'self'");
    expect(directive(buildCsp({}), "connect-src")).toBe("connect-src 'self'");
  });

  it("nenhuma diretiva carrega curinga solto de script ou de conexão", () => {
    expect(directive(csp, "script-src")).not.toContain("*");
    expect(directive(csp, "connect-src")).not.toContain("*");
  });
});

describe("cabeçalhos de segurança do web (NG-07)", () => {
  const names = (list: { key: string }[]) => list.map((h) => h.key);

  it("produção: CSP, nosniff, DENY, Referrer, Permissions, COOP e HSTS", () => {
    const h = securityHeaders({ apiUrl: API });
    expect(names(h)).toEqual([
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Cross-Origin-Opener-Policy",
      "Strict-Transport-Security",
    ]);
    expect(h.find((x: { key: string }) => x.key === "X-Frame-Options").value).toBe("DENY");
    expect(h.find((x: { key: string }) => x.key === "Permissions-Policy").value).toContain("camera=()");
  });

  it("desenvolvimento não manda HSTS (não prende o localhost em https)", () => {
    expect(names(securityHeaders({ apiUrl: "http://localhost:3001", dev: true }))).not.toContain("Strict-Transport-Security");
  });
});
