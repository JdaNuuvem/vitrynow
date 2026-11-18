import { describe, expect, it, vi } from "vitest";
import { acceptLegacyQueryNow, clearResetTokenFromUrl, LEGACY_QUERY_ACCEPTED_UNTIL, readResetToken } from "./resetToken";

const at = (hash: string, search = "") => ({ hash, search });

describe("readResetToken (ST-56)", () => {
  it("lê o token do fragmento", () => {
    expect(readResetToken(at("#token=abc123_-XYZ"))).toBe("abc123_-XYZ");
  });

  it("ignora outros parâmetros do fragmento e acha o token no meio", () => {
    expect(readResetToken(at("#x=1&token=abc&y=2"))).toBe("abc");
  });

  it("aceita a query legada (e-mails já enviados) na transição", () => {
    expect(readResetToken(at("", "?token=velho456"), true)).toBe("velho456");
  });

  it("o fragmento vale mais que a query quando vêm os dois", () => {
    expect(readResetToken(at("#token=novo", "?token=velho"))).toBe("novo");
  });

  it("com a transição desligada a query legada deixa de valer, o fragmento continua", () => {
    expect(readResetToken(at("", "?token=velho"), false)).toBe("");
    expect(readResetToken(at("#token=novo", "?token=velho"), false)).toBe("novo");
  });

  it("ST-60: a leitura da query legada TEM FIM em código: antes da data vale, depois não", () => {
    expect(acceptLegacyQueryNow(LEGACY_QUERY_ACCEPTED_UNTIL - 1)).toBe(true);
    expect(acceptLegacyQueryNow(LEGACY_QUERY_ACCEPTED_UNTIL)).toBe(false);
    expect(acceptLegacyQueryNow(LEGACY_QUERY_ACCEPTED_UNTIL + 24 * 3_600_000)).toBe(false);
    expect(LEGACY_QUERY_ACCEPTED_UNTIL).toBeGreaterThan(Date.parse("2026-11-17T00:00:00Z")); // não vencida desde o nascimento
  });

  it("sem token, com token vazio ou outro nome de parâmetro: vazio", () => {
    expect(readResetToken(at(""))).toBe("");
    expect(readResetToken(at("#token="))).toBe("");
    expect(readResetToken(at("#tokens=abc"))).toBe("");
    expect(readResetToken(at("#abc"))).toBe("");
  });

  it("o '+' fica como está (token base64 comum não vira espaço) e %XX é decodificado", () => {
    expect(readResetToken(at("#token=ab+cd/ef=="))).toBe("ab+cd/ef==");
    expect(readResetToken(at("#token=ab%2Bcd"))).toBe("ab+cd");
  });

  it("DOM-XSS: valor com cara de HTML ou script é recusado (nunca vira token)", () => {
    expect(readResetToken(at("#token=<script>alert(1)</script>"))).toBe("");
    expect(readResetToken(at("#token=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E"))).toBe("");
    expect(readResetToken(at('#token="><svg/onload=alert(1)>'))).toBe("");
    expect(readResetToken(at("#token=javascript:alert(1)"))).toBe("");
    expect(readResetToken(at("", "?token=%3Cscript%3E"), true)).toBe("");
  });

  it("recusa espaço, caractere de controle e token gigante (a API só recebe o que parece token)", () => {
    expect(readResetToken(at("#token=ab%20cd"))).toBe("");
    expect(readResetToken(at("#token=ab%00cd"))).toBe("");
    expect(readResetToken(at("#token=" + "a".repeat(513)))).toBe("");
    expect(readResetToken(at("#token=" + "a".repeat(512)))).toBe("a".repeat(512));
  });

  it("percentual inválido não quebra: o texto cru tem '%', fora do alfabeto de um token, e é recusado", () => {
    expect(() => readResetToken(at("#token=abc%ZZ"))).not.toThrow();
    expect(readResetToken(at("#token=abc%ZZ"))).toBe("");
  });
});

describe("clearResetTokenFromUrl", () => {
  it("troca a URL pelo caminho puro, sem criar entrada no histórico", () => {
    const replaceState = vi.fn();
    clearResetTokenFromUrl({ history: { replaceState } as unknown as History, location: { pathname: "/reset-senha" } as Location });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/reset-senha");
  });

  it("não quebra se a History API falhar", () => {
    const history = { replaceState: () => { throw new Error("bloqueado"); } } as unknown as History;
    expect(() => clearResetTokenFromUrl({ history, location: { pathname: "/x" } as Location })).not.toThrow();
  });
});
