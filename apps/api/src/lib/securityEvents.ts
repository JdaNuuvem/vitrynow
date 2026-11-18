import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { clientKey } from "./clientKey";
import { clientIpOf } from "./clientIp";

// NG-12: eventos de SEGURANÇA em log estruturado, para as regras de alerta do INF-19 (falhas por IP/conta, picos de 401/403/429). Todos têm o MESMO formato:
//   { securityEvent: "<nome>", ipKey, account?, userId?, reason? }  e a mensagem fixa "security_event".
// Nunca entram: senha, token, cookie, código MFA, e-mail em texto, corpo da requisição. A conta aparece só como HASH curto (permite contar falhas por conta
// sem gravar o e-mail); `ipKey` é o cliente normalizado (IPv6 em /64, como nos limites).
export const SECURITY_EVENTS = [
  "login_ok",
  "login_failed",
  "login_locked",
  "origin_mismatch",
  "session_rejected",
  "device_token_refused",
  "logout_all",
] as const;
export type SecurityEvent = (typeof SECURITY_EVENTS)[number];

const WARN_EVENTS = new Set<SecurityEvent>(["login_failed", "login_locked", "origin_mismatch", "session_rejected", "device_token_refused"]);
const REASON = /^[A-Z_]{1,40}$/; // só códigos fixos (SESSION_REVOKED, TOKEN_MISSING...): texto livre nunca vai ao log

/** Hash curto e estável da conta (e-mail normalizado). Não é segredo: serve só para agrupar eventos da mesma conta. */
export const accountTag = (email: string): string => createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 12);

export type SecurityEventFields = { email?: string; userId?: string; reason?: string };

export function securityEvent(request: Pick<FastifyRequest, "log" | "ip" | "headers" | "socket">, event: SecurityEvent, fields: SecurityEventFields = {}): void {
  try {
    const entry: Record<string, string> = { securityEvent: event, ipKey: clientKey(clientIpOf(request)) };
    if (fields.email) entry.account = accountTag(fields.email);
    if (fields.userId) entry.userId = fields.userId;
    if (fields.reason && REASON.test(fields.reason)) entry.reason = fields.reason;
    if (WARN_EVENTS.has(event)) request.log.warn(entry, "security_event");
    else request.log.info(entry, "security_event");
  } catch {
    // o log de segurança NUNCA pode derrubar a requisição
  }
}
