import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Cifra dos tokens de pagamento das lojas (ADR-0001 §3.3, D-T4): AES-256-GCM, IV aleatório de 96 bits NOVO a cada gravação e
// AAD = `storeId|provider|campo`, de modo que um texto cifrado copiado para OUTRA loja (ou outro campo) não decifra.
// Formato gravado (texto, versionado): `v1.<keyId>.<iv>.<tag>.<texto cifrado>`, as três últimas partes em base64url.
// A chave fica FORA do banco (PAYMENT_ENC_KEY); backup do banco só leva texto cifrado. Modelo de ameaça honesto: com a chave
// no mesmo host do banco, ela protege backup e dump, não invasão do host.

const inVitest = () => process.env.VITEST !== undefined && process.env.VITEST !== "";
const TEST_KEY = "test-payment-enc-key-nao-use-em-producao";
const MIN_SECRET_LENGTH = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT = "v1";

export type EncKey = { id: string; key: Buffer };
export type CryptoContext = { storeId: string; provider: string; field: string };

// Qualquer segredo de >= 32 caracteres vira uma chave de 32 bytes por SHA-256 (a derivação só uniformiza o tamanho).
const toKey = (secret: string): Buffer => createHash("sha256").update(secret, "utf8").digest();

function load(id: string, secret: string | undefined, label: string, env: NodeJS.ProcessEnv, testFallback?: string): EncKey | null {
  const value = secret || (inVitest() ? testFallback : undefined);
  if (!value) return null;
  if (!inVitest() && value === TEST_KEY) throw new Error(`${label} é o valor de teste do repositório: não pode ser usado fora dos testes.`);
  if (value.length < MIN_SECRET_LENGTH) throw new Error(`${label} fraco: use ao menos ${MIN_SECRET_LENGTH} caracteres aleatórios.`);
  // Chave PRÓPRIA: vazar o JWT ou a chave do MFA não pode abrir os tokens de pagamento (nem o contrário).
  if (!inVitest()) {
    for (const other of ["JWT_SECRET", "MFA_HMAC_KEY", "API_INTERNAL_SECRET"]) {
      if (env[other] && env[other] === value) throw new Error(`${label} deve ser diferente de ${other}.`);
    }
  }
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(id)) throw new Error(`id de chave inválido para ${label} (use até 16 letras, números, _ ou -).`);
  return { id, key: toKey(value) };
}

/** Chave atual (grava) — obrigatória fora dos testes: perdê-la obriga todas as lojas a reconectar o Mercado Pago. */
export function currentKey(env: NodeJS.ProcessEnv = process.env): EncKey {
  const key = load(env.PAYMENT_ENC_KEY_ID?.trim() || "v1", env.PAYMENT_ENC_KEY, "PAYMENT_ENC_KEY", env, TEST_KEY);
  if (!key) {
    throw new Error('PAYMENT_ENC_KEY não configurado. Gere um com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"');
  }
  return key;
}

/** Chave anterior (só decifra, para a janela de rotação). Opcional. */
function previousKey(env: NodeJS.ProcessEnv): EncKey | null {
  return load(env.PAYMENT_ENC_KEY_PREV_ID?.trim() || "prev", env.PAYMENT_ENC_KEY_PREV, "PAYMENT_ENC_KEY_PREV", env);
}

const aad = (ctx: CryptoContext) => Buffer.from(`${ctx.storeId}|${ctx.provider}|${ctx.field}`, "utf8");
const b64 = (buffer: Buffer) => buffer.toString("base64url");

/** Cifra um segredo para uma loja/provedor/campo. O id da chave usada vai dentro do próprio registro. */
export function encryptSecret(plain: string, ctx: CryptoContext, env: NodeJS.ProcessEnv = process.env): string {
  const { id, key } = currentKey(env);
  const iv = randomBytes(IV_BYTES); // novo a cada gravação; nunca reaproveitado
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(ctx));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [FORMAT, id, b64(iv), b64(cipher.getAuthTag()), b64(body)].join(".");
}

/** Decifra; lança se a chave, a loja, o provedor ou o campo não conferem ou se o dado foi alterado. */
export function decryptSecret(stored: string, ctx: CryptoContext, env: NodeJS.ProcessEnv = process.env): string {
  const parts = stored.split(".");
  if (parts.length !== 5 || parts[0] !== FORMAT) throw new Error("dado cifrado em formato desconhecido");
  const [, keyId, ivText, tagText, bodyText] = parts;
  const current = currentKey(env);
  const key = keyId === current.id ? current : (() => {
    const prev = previousKey(env);
    return prev && prev.id === keyId ? prev : null;
  })();
  if (!key) throw new Error(`chave de cifra "${keyId}" não disponível`);
  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("dado cifrado inválido");
  const decipher = createDecipheriv("aes-256-gcm", key.key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad(ctx));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(bodyText, "base64url")), decipher.final()]).toString("utf8");
}
