import { randomBytes, timingSafeEqual } from "node:crypto";
import { hashToken } from "./tokenHash";

// NG-16: token de acesso do cliente ao SEU pedido (cardápio público, sem login).
// Antes, o id do pedido bastava para ver o status do pagamento e cancelar (e, depois da API-02, cancelar estorna PIX).
// Agora: 256 bits aleatórios devolvidos UMA vez na criação do pedido; só o SHA-256 fica no banco; vai no cabeçalho
// `x-order-token` (nunca na URL: não cai em log de acesso nem em Referer). Ver ADR-0008/NG-16.

export const ORDER_TOKEN_HEADER = "x-order-token";
const MAX_TOKEN_LENGTH = 200;

export function newOrderToken(): { token: string; hash: string } {
  const token = "mco_" + randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

// Token válido para o pedido? Comparação em tempo constante sobre os dois hashes. Sem token, token malformado ou
// pedido sem hash gravado (anterior ao NG-16) ⇒ false: quem chama responde o MESMO 404 de pedido inexistente.
export function orderTokenMatches(provided: unknown, storedHash: string | null | undefined): boolean {
  const candidate = typeof provided === "string" && provided.length > 0 && provided.length <= MAX_TOKEN_LENGTH ? provided : "";
  // Sempre calcula o hash e compara, mesmo sem token/hash armazenado: o tempo não separa "sem token" de "token errado".
  const providedHash = Buffer.from(hashToken(candidate), "hex");
  const stored = Buffer.from(storedHash && /^[0-9a-f]{64}$/.test(storedHash) ? storedHash : "0".repeat(64), "hex");
  const equal = providedHash.length === stored.length && timingSafeEqual(providedHash, stored);
  return equal && candidate !== "" && !!storedHash;
}
