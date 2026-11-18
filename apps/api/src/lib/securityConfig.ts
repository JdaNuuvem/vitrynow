import { createHmac } from "node:crypto";
import { assertTrustProxyList } from "./trustProxyPolicy";

// Configuração de segurança lida do ambiente (ADR-0008). Tudo aqui falha ALTO no boot em vez de
// cair em padrão inseguro: segredo conhecido = qualquer um forja sessão de qualquer loja.

// O segredo público de teste só vale DENTRO do vitest (ST-04b): um NODE_ENV=test esquecido num servidor
// real não pode cair no valor que está no repositório.
const inVitest = () => process.env.VITEST !== undefined && process.env.VITEST !== "";
const TEST_JWT_SECRET = "test-secret-nao-use-em-producao";
const TEST_MFA_KEY = "test-mfa-key-nao-use-em-producao";
const REPO_TEST_VALUES = new Set([TEST_JWT_SECRET, TEST_MFA_KEY]);

// Valores que já circularam em .env.example / código — nunca aceitos como segredo real.
const KNOWN_PLACEHOLDERS = new Set(["dev-secret-change-me", "troque-este-segredo-em-producao", "changeme", "secret"]);

const MIN_SECRET_LENGTH = 32;

function requireSecret(name: string, value: string | undefined, testFallback: string): string {
  if (inVitest()) return value || testFallback;
  if (!value) {
    throw new Error(`${name} não configurado. Gere um com: pnpm --filter @meucardapio/api gen:secrets (ou node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")`);
  }
  if (REPO_TEST_VALUES.has(value)) {
    throw new Error(`${name} é o valor de teste do repositório: não pode ser usado fora dos testes (mesmo com NODE_ENV=test).`);
  }
  if (value.length < MIN_SECRET_LENGTH || KNOWN_PLACEHOLDERS.has(value)) {
    throw new Error(`${name} fraco ou de exemplo — use ao menos ${MIN_SECRET_LENGTH} caracteres aleatórios (nunca o valor do .env.example).`);
  }
  return value;
}

export function getJwtSecret(): string {
  return requireSecret("JWT_SECRET", process.env.JWT_SECRET, TEST_JWT_SECRET);
}

// Chave própria do MFA: nunca reaproveita o JWT_SECRET (vazamento de uma não compromete a outra).
export function getMfaKey(): string {
  const key = requireSecret("MFA_HMAC_KEY", process.env.MFA_HMAC_KEY, TEST_MFA_KEY);
  if (!inVitest() && key === process.env.JWT_SECRET) {
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
//  - Em produção a variável é OBRIGATÓRIA (ST-02c): sem ela todos os clientes atrás do Caddy dividiriam
//    um único limite de login. `none` declara, de propósito, "sem proxy" (fica false).
export function trustProxySetting(): string[] | false {
  const raw = process.env.TRUST_PROXY_CIDR?.trim();
  if (process.env.NODE_ENV === "production" && !raw) {
    throw new Error('TRUST_PROXY_CIDR não configurado em produção: informe a rede do Caddy (ex.: "172.18.0.0/16") ou "none" se não há proxy.');
  }
  if (!raw || raw.toLowerCase() === "none") return false;
  const list = raw.split(",").map((item) => item.trim()).filter(Boolean);
  // SEC-22 (ST-36): só rede privada/loopback e faixa estreita (nada de 0.0.0.0/1, 8.0.0.0/8…). A política vale em TODO
  // ambiente que não seja explicitamente `test` ou `development` (NODE_ENV=prod, staging, vazio…): um NODE_ENV escrito
  // diferente de "production" não pode desligar a defesa. (A OBRIGATORIEDADE da variável continua só em production.)
  const relaxed = process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development";
  if (!relaxed && list.length > 0) assertTrustProxyList(list);
  return list.length > 0 ? list : false;
}

export function allowedOrigin(): string {
  return process.env.WEB_ORIGIN ?? "http://localhost:3000";
}
