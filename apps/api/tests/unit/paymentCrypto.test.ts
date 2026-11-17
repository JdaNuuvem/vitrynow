import { createDecipheriv, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { currentKey, decryptSecret, encryptSecret } from "../../src/lib/paymentCrypto";

// AES-256-GCM com AAD por loja/provedor/campo e formato versionado (ADR-0001 §3.3, D-T4; critérios da Nightingale). Sem banco.

const KEY_A = "a".repeat(40);
const KEY_B = "b".repeat(40);
const ctx = { storeId: "loja-1", provider: "mercadopago", field: "accessToken" };
const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ PAYMENT_ENC_KEY: KEY_A, ...extra });
const parts = (stored: string) => stored.split(".");

describe("paymentCrypto", () => {
  it("ida e volta; o registro é versionado e não contém o segredo; IV novo a cada gravação", () => {
    const secret = "APP_USR-0000000000000000-111111-segredo-do-vendedor";
    const a = encryptSecret(secret, ctx, env());
    const b = encryptSecret(secret, ctx, env());
    expect(decryptSecret(a, ctx, env())).toBe(secret);
    expect(a).toMatch(/^v1\.v1\.[\w-]+\.[\w-]+\.[\w-]+$/); // formato.keyId.iv.tag.ct
    expect(a).not.toContain("segredo-do-vendedor");
    expect(Buffer.from(parts(a)[4], "base64url").toString("utf8")).not.toContain("segredo");
    expect(a).not.toBe(b);
    expect(parts(a)[2]).not.toBe(parts(b)[2]); // IV diferente
    expect(Buffer.from(parts(a)[2], "base64url")).toHaveLength(12);
    expect(Buffer.from(parts(a)[3], "base64url")).toHaveLength(16);
  });

  it("recalcula o primitivo POR FORA (node:crypto direto): o formato é AES-256-GCM padrão com AAD loja|provedor|campo", () => {
    const stored = encryptSecret("token-de-verificacao", ctx, env());
    const [, , iv, tag, body] = parts(stored);
    const key = createHash("sha256").update(KEY_A, "utf8").digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), { authTagLength: 16 });
    decipher.setAAD(Buffer.from("loja-1|mercadopago|accessToken"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
    expect(plain).toBe("token-de-verificacao");
  });

  it("AAD: copiar o registro para OUTRA loja, outro provedor ou outro campo não decifra", () => {
    const stored = encryptSecret("token", ctx, env());
    expect(() => decryptSecret(stored, { ...ctx, storeId: "loja-2" }, env())).toThrow();
    expect(() => decryptSecret(stored, { ...ctx, provider: "outro" }, env())).toThrow();
    expect(() => decryptSecret(stored, { ...ctx, field: "refreshToken" }, env())).toThrow();
    expect(decryptSecret(stored, ctx, env())).toBe("token");
  });

  it("adulterar IV, tag ou corpo falha; formato desconhecido ou campos de tamanho errado falham", () => {
    const stored = encryptSecret("token-secreto", ctx, env());
    const flip = (index: number) => {
      const copy = parts(stored);
      const raw = Buffer.from(copy[index], "base64url");
      raw[0] ^= 0xff;
      copy[index] = raw.toString("base64url");
      return copy.join(".");
    };
    for (const index of [2, 3, 4]) expect(() => decryptSecret(flip(index), ctx, env()), `parte ${index}`).toThrow();
    expect(() => decryptSecret("v2." + parts(stored).slice(1).join("."), ctx, env())).toThrow(/formato desconhecido/);
    expect(() => decryptSecret("lixo", ctx, env())).toThrow(/formato desconhecido/);
    expect(() => decryptSecret([...parts(stored).slice(0, 2), "AA", ...parts(stored).slice(3)].join("."), ctx, env())).toThrow(/inválido/);
  });

  it("chave errada falha; keyId desconhecido falha com mensagem que não vaza a chave", () => {
    const stored = encryptSecret("token", ctx, env());
    expect(() => decryptSecret(stored, ctx, { PAYMENT_ENC_KEY: KEY_B })).toThrow();
    let message = "";
    try {
      decryptSecret(stored.replace("v1.v1.", "v1.v9."), ctx, env());
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("v9");
    expect(message).not.toContain(KEY_A);
  });

  it("rotação: com a chave anterior configurada, dados antigos ainda decifram e os novos usam a chave nova", () => {
    const old = encryptSecret("token-antigo", ctx, env({ PAYMENT_ENC_KEY_ID: "v1" }));
    const rotated = { PAYMENT_ENC_KEY: KEY_B, PAYMENT_ENC_KEY_ID: "v2", PAYMENT_ENC_KEY_PREV: KEY_A, PAYMENT_ENC_KEY_PREV_ID: "v1" };
    expect(decryptSecret(old, ctx, rotated)).toBe("token-antigo");
    const fresh = encryptSecret("token-novo", ctx, rotated);
    expect(parts(fresh)[1]).toBe("v2");
    expect(decryptSecret(fresh, ctx, rotated)).toBe("token-novo");
    expect(() => decryptSecret(old, ctx, { PAYMENT_ENC_KEY: KEY_B, PAYMENT_ENC_KEY_ID: "v2" })).toThrow(); // sem a anterior
  });

  it("chave curta é recusada; o valor de teste e a ausência só valem dentro do vitest; chave própria (≠ JWT/MFA)", () => {
    expect(() => currentKey({ PAYMENT_ENC_KEY: "curta" })).toThrow(/fraco/);
    expect(currentKey({}).id).toBe("v1"); // dentro do vitest: cai no valor de teste
    expect(() => currentKey({ PAYMENT_ENC_KEY: KEY_A, PAYMENT_ENC_KEY_ID: "id com espaço" })).toThrow(/id de chave inválido/);
    const saved = process.env.VITEST;
    try {
      delete process.env.VITEST;
      expect(() => currentKey({})).toThrow(/não configurado/);
      expect(() => currentKey({ PAYMENT_ENC_KEY: "test-payment-enc-key-nao-use-em-producao" })).toThrow(/valor de teste/);
      for (const other of ["JWT_SECRET", "MFA_HMAC_KEY", "API_INTERNAL_SECRET"]) {
        expect(() => currentKey({ PAYMENT_ENC_KEY: KEY_A, [other]: KEY_A }), other).toThrow(/diferente de/);
      }
      expect(currentKey({ PAYMENT_ENC_KEY: KEY_A, JWT_SECRET: KEY_B }).id).toBe("v1");
    } finally {
      process.env.VITEST = saved;
    }
  });

  it("aceita segredo com unicode e vazio", () => {
    for (const secret of ["", "çãõ-🔑-token"]) expect(decryptSecret(encryptSecret(secret, ctx, env()), ctx, env())).toBe(secret);
  });
});
