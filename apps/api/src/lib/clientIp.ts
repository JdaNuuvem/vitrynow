import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";
import { clientKey } from "./clientKey";
import { internalServiceSecrets } from "./securityConfig";
import { isPrivateAddress } from "./trustProxyPolicy";

// SEC-24: UMA função decide "quem é o cliente" para limite de requisições, limite de login e auditoria.
// O web (SSR) chama a API pelo servidor com o segredo de serviço em `x-internal-service-secret`. A API só reconhece essa
// identidade quando (1) a CONEXÃO vem de rede interna e (2) o segredo confere (tempo constante, valor atual ou anterior).
// Em qualquer outro caso usa o IP da conexão (já tratado por trustProxy). Nunca responde 401 por causa disso: o mecanismo
// não se revela a quem não o conhece.
//  - Chamada de serviço SEM `x-visitor-ip`: balde próprio (`servico-interno`) com teto maior, para as revalidações do cardápio
//    de muitas lojas não esgotarem o limite de um único IP (o do contêiner do web).
//  - Chamada de serviço COM `x-visitor-ip` válido (rota dinâmica que repassa o visitante): conta como esse visitante.
export const INTERNAL_AUTH_HEADER = "x-internal-service-secret";
export const VISITOR_IP_HEADER = "x-visitor-ip";
export const SERVICE_BUCKET = "servico-interno";
export const CLIENT_RATE_MAX = 300; // req/min por cliente
export const SERVICE_RATE_MAX = 3000; // req/min do balde de serviço

const digest = (value: string) => createHash("sha256").update(value).digest();

let cachedRaw: string | undefined;
let cachedDigests: Buffer[] = [];
function secretDigests(): Buffer[] {
  const raw = `${process.env.API_INTERNAL_SECRET ?? ""}\u0000${process.env.API_INTERNAL_SECRET_PREVIOUS ?? ""}\u0000${process.env.NODE_ENV ?? ""}`;
  if (raw !== cachedRaw) {
    cachedDigests = internalServiceSecrets().map(digest);
    cachedRaw = raw;
  }
  return cachedDigests;
}

// Compara em tempo constante e sem atalho entre os valores aceitos (atual e anterior).
function secretMatches(provided: string): boolean {
  const candidate = digest(provided);
  let ok = false;
  for (const known of secretDigests()) ok = timingSafeEqual(candidate, known) || ok;
  return ok;
}

type Req = Pick<FastifyRequest, "ip" | "headers" | "socket">;

// A chamada vem do serviço interno (web)? Conexão interna E segredo certo.
export function isInternalService(request: Req): boolean {
  const auth = request.headers[INTERNAL_AUTH_HEADER];
  if (typeof auth !== "string") return false;
  if (!isPrivateAddress(request.socket?.remoteAddress)) return false; // de fora da rede interna: cabeçalho ignorado
  return secretMatches(auth);
}

// IP do visitante repassado pelo serviço; null se não houver, for inválido ou a chamada não for do serviço.
function forwardedVisitorIp(request: Req): string | null {
  const visitor = request.headers[VISITOR_IP_HEADER];
  if (typeof visitor !== "string" || !isInternalService(request)) return null;
  const ip = visitor.trim();
  return isIP(ip.split("%")[0]) !== 0 ? ip : null;
}

// IP bruto (ainda NÃO normalizado): quem o usa como chave passa por `clientKey()` (SEC-23).
export function clientIpOf(request: Req): string {
  return forwardedVisitorIp(request) ?? request.ip;
}

// Chave do limite global: o cliente normalizado, ou o balde de serviço (chamada interna sem visitante).
export function rateLimitKey(request: Req): string {
  const visitor = forwardedVisitorIp(request);
  if (visitor) return clientKey(visitor);
  return isInternalService(request) ? SERVICE_BUCKET : clientKey(request.ip);
}

export function rateLimitMax(key: string): number {
  return key === SERVICE_BUCKET ? SERVICE_RATE_MAX : CLIENT_RATE_MAX;
}
