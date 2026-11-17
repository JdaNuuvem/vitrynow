import { describe, expect, it, vi } from "vitest";
import { assertSafeToReset, assertTestDatabaseUrl, describeDb } from "../dbGuard";

// INF-16: o setup dos testes tem de recusar qualquer banco que não seja um Postgres de teste local. Sem banco.
const OK = "postgresql://meucardapio:meucardapio@127.0.0.1:55442/meucardapio_test?schema=public";

describe("assertTestDatabaseUrl: o que a suíte aceita", () => {
  it("vários bancos por agente: _test2, _test8, _test123 são aceitos (/_test\\d*$/)", () => {
    for (const n of ["meucardapio_test2", "meucardapio_test8", "loja_test99", "meucardapio_test123"]) {
      expect(assertTestDatabaseUrl(`postgresql://u:p@127.0.0.1:55442/${n}`)).toContain(n);
    }
  });
  it("aceita 127.0.0.1 na faixa 55440–55459 com banco terminado em _test", () => {
    expect(assertTestDatabaseUrl(OK)).toBe(OK);
    expect(assertTestDatabaseUrl("postgresql://u:p@127.0.0.1:55440/x_test")).toContain("55440");
    expect(assertTestDatabaseUrl("postgresql://u:p@127.0.0.1:55459/x_test")).toContain("55459");
    expect(assertTestDatabaseUrl("postgres://u:p@localhost:55450/loja_test?schema=public")).toContain("localhost");
    expect(assertTestDatabaseUrl("postgresql://u:p@[::1]:55450/loja_test")).toContain("55450");
  });
});

describe("assertTestDatabaseUrl: o que a suíte RECUSA", () => {
  it("sem TEST_DATABASE_URL (sem padrão) e com mensagem que diz como resolver", () => {
    expect(() => assertTestDatabaseUrl(undefined)).toThrow(/TEST_DATABASE_URL não definida/);
    expect(() => assertTestDatabaseUrl("")).toThrow(/test-db\.ps1/);
  });
  it("URL inválida ou protocolo errado", () => {
    expect(() => assertTestDatabaseUrl("isto não é url")).toThrow(/inválida/);
    expect(() => assertTestDatabaseUrl("mysql://u:p@127.0.0.1:55442/x_test")).toThrow(/protocolo/);
  });
  it("host que não é a própria máquina", () => {
    expect(() => assertTestDatabaseUrl("postgresql://u:p@db.exemplo.com:55442/x_test")).toThrow(/host "db\.exemplo\.com"/);
    expect(() => assertTestDatabaseUrl("postgresql://u:p@10.0.0.5:55442/x_test")).toThrow(/host "10\.0\.0\.5"/);
    expect(() => assertTestDatabaseUrl("postgresql://u:p@0.0.0.0:55442/x_test")).toThrow(/host/);
  });
  it("portas fora da faixa de teste, inclusive o dev 55432 e o padrão 5432", () => {
    for (const port of ["55432", "5432", "5433", "55439", "55460", "1"]) {
      expect(() => assertTestDatabaseUrl(`postgresql://u:p@127.0.0.1:${port}/x_test`)).toThrow(/porta/);
    }
    expect(() => assertTestDatabaseUrl("postgresql://u:p@127.0.0.1/x_test")).toThrow(/padrão 5432/);
  });
  it("banco cujo nome não termina em _test", () => {
    expect(() => assertTestDatabaseUrl("postgresql://u:p@127.0.0.1:55442/meucardapio")).toThrow(/terminar em "_test"/);
    expect(() => assertTestDatabaseUrl("postgresql://u:p@127.0.0.1:55442/test_prod")).toThrow(/_test/);
    expect(() => assertTestDatabaseUrl("postgresql://u:p@127.0.0.1:55442/")).toThrow(/_test/);
    for (const n of ["meucardapio_testing", "meucardapio_test_x", "test2", "meucardapio_prod"]) {
      expect(() => assertTestDatabaseUrl(`postgresql://u:p@127.0.0.1:55442/${n}`)).toThrow(/_test/);
    }
  });
});

describe("assertSafeToReset: a trava dentro do resetDb", () => {
  it("só deixa apagar se a URL passa E o servidor confirma um banco _test", async () => {
    const q = vi.fn(async () => "meucardapio_test");
    await expect(assertSafeToReset({ url: OK, currentDatabase: q })).resolves.toBeUndefined();
    expect(q).toHaveBeenCalledTimes(1);
  });
  it("recusa quando o servidor diz que está em outro banco, mesmo com a URL certa (nada é apagado)", async () => {
    await expect(assertSafeToReset({ url: OK, currentDatabase: async () => "meucardapio" })).rejects.toThrow(/Nada foi apagado/);
  });
  it("recusa pela URL ANTES de perguntar ao servidor (não toca no banco errado nem para perguntar)", async () => {
    const q = vi.fn(async () => "meucardapio_test");
    await expect(assertSafeToReset({ url: "postgresql://u:p@127.0.0.1:55432/meucardapio_test", currentDatabase: q })).rejects.toThrow(/porta/);
    expect(q).not.toHaveBeenCalled();
  });
});

// INF-16, caso do Turing: DATABASE_URL apontando para o banco de DESENVOLVIMENTO e TEST_DATABASE_URL ausente.
describe("caso do Turing: DATABASE_URL de dev sem TEST_DATABASE_URL", () => {
  const DEV = "postgresql://meucardapio:meucardapio@localhost:55432/meucardapio?schema=public";
  it("o guard ignora DATABASE_URL: sem TEST_DATABASE_URL a suíte falha, não cai no dev", () => {
    expect(() => assertTestDatabaseUrl(undefined)).toThrow(/TEST_DATABASE_URL não definida/);
  });
  it("resetDb recusa uma DATABASE_URL de dev (porta 55432), sem perguntar ao servidor", async () => {
    const q = vi.fn(async () => "meucardapio");
    await expect(assertSafeToReset({ url: DEV, currentDatabase: q })).rejects.toThrow(/porta/);
    expect(q).not.toHaveBeenCalled();
  });
  it("o vitest.config.ts em si FALHA ao carregar sem TEST_DATABASE_URL (não sobrescreve com padrão)", async () => {
    const saved = process.env.TEST_DATABASE_URL;
    delete process.env.TEST_DATABASE_URL;
    vi.resetModules();
    try {
      await expect(import("../../vitest.config")).rejects.toThrow(/TEST_DATABASE_URL não definida/);
    } finally {
      if (saved !== undefined) process.env.TEST_DATABASE_URL = saved;
      vi.resetModules();
    }
  });
});

describe("describeDb: mensagem sem credenciais", () => {
  it("mostra host:porta/banco e NUNCA usuário ou senha", () => {
    const d = describeDb("postgresql://dono:SENHA-SECRETA@localhost:55432/meucardapio?schema=public");
    expect(d).toBe("localhost:55432/meucardapio");
    expect(d).not.toContain("SENHA-SECRETA");
    expect(d).not.toContain("dono");
    expect(describeDb(undefined)).toBe("(não definida)");
    expect(describeDb("lixo")).toBe("(URL inválida)");
  });
});
