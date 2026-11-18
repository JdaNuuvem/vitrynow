import { createHash, randomBytes } from "node:crypto";

// Tokens de alta entropia (>= 256 bits): SHA-256 puro basta (nao e senha de humano) e permite
// busca por indice unico sem expor o valor. O valor original so existe na resposta de criacao
// e no e-mail/dispositivo que o recebeu (NG-06).
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newSecretToken(prefix = ""): string {
  return prefix + randomBytes(32).toString("base64url");
}

export function tokenPreview(token: string): string {
  return token.slice(-4);
}
