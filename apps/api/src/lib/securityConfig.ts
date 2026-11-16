import { createHmac } from "node:crypto";

// Configuração de segurança lida do ambiente (ADR-0008). Tudo aqui falha ALTO no boot em vez de
// cair em padrão inseguro: segredo conhecido = qualquer um forja sessão de qualquer loja.

const isTest = () => process.env.NODE_ENV === "test";

// Valores que já circularam em .env.example / código — nunca aceitos como segredo real.
const KNOWN_PLACEHOLDERS = new Set(["dev-secret-change-me", "troque-este-segredo-em-producao", "changeme", "secret"]);

const MIN_SECRET_LENGTH = 32;

function requireSecret(name: string, value: string | undefined, testFallback: string): string {
  if (isTest()) return value || testFallback;
  if (!value) {
    throw new Error(`${name} não configurado — obrigatório fora de NODE_ENV=test. Gere um com: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`);
  }
  if (value.length < MIN_SECRET_LENGTH || KNOWN_PLACEHOLDERS.has(value)) {
    throw new Error(`${name} fraco ou de exemplo — use ao menos ${MIN_SECRET_LENGTH} caracteres aleatórios (nunca o valor do .env.example).`);
  }
  return value;
}

export function getJwtSecret(): string {
  return requireSecret("JWT_SECRET", process.env.JWT_SECRET, "test-secret-nao-use-em-producao");
}

// Chave própria do MFA: nunca reaproveita o JWT_SECRET (vazamento de uma não compromete a outra).
export function getMfaKey(): string {
  const key = requireSecret("MFA_HMAC_KEY", process.env.MFA_HMAC_KEY, "test-mfa-key-nao-use-em-producao");
  if (!isTest() && key === process.env.JWT_SECRET) {
    throw new Error("MFA_HMAC_KEY deve ser diferente de JWT_SECRET.");
  }
  return key;
}

export function mfaHmac(data: string): string {
  return createHmac("sha256", getMfaKey()).update(data).digest("hex");
}

// Sessão do painel (ADR-0008 §1.2). Janela deslizante de SESSION_TTL_HOURS, com teto absoluto
// de SESSION_ABSOLUTE_DAYS contado do login (`auth_time`).
function positiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} inválido: ${raw}`);
  return n;
}

export function sessionTtlSeconds(): number {
  return Math.round(positiveNumber("SESSION_TTL_HOURS", 12) * 3600);
}

export function sessionAbsoluteSeconds(): number {
  return Math.round(positiveNumber("SESSION_ABSOLUTE_DAYS", 14) * 86400);
}

// Cookie `Secure` por configuração (não depende de NODE_ENV): só `COOKIE_SECURE=false` explícito
// o desliga (dev local em http).
export function cookieSecure(): boolean {
  return process.env.COOKIE_SECURE !== "false";
}

// Rede(s) do proxy reverso (Caddy) em que se confia para ler X-Forwarded-For. Vazio = ninguém:
// o IP do rate limit é o do socket. Lista separada por vírgula de IPs/CIDRs.
export function trustProxySetting(): string[] | false {
  const raw = process.env.TRUST_PROXY_CIDR?.trim();
  if (!raw) return false;
  const list = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return list.length > 0 ? list : false;
}

export function allowedOrigin(): string {
  return process.env.WEB_ORIGIN ?? "http://localhost:3000";
}
