import { createHash } from "node:crypto";
import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import { clientKey } from "./clientKey";
import { clientIpOf } from "./clientIp";

// NG-12: eventos de SEGURANÇA em log estruturado + REGRAS DE ALERTA sobre eles. Todo evento tem o MESMO formato:
//   { securityEvent: "<nome>", ipKey, account?, userId?, reason? }  com a mensagem fixa "security_event".
// Nunca entram: senha, token, cookie, código MFA, e-mail em texto, corpo da requisição. A conta aparece só como HASH curto (permite contar falhas por conta
// sem gravar o e-mail); `ipKey` é o cliente normalizado (IPv6 em /64, como nos limites).
//
// ALERTAS: cada evento alimenta contadores em memória (janela deslizante, por instância). Passou do limiar da regra ⇒ UMA linha `security_alert` (nível error)
// por regra+chave e por janela, no formato { securityAlert: "<REGRA>", scope, key, count, windowSec, distinctIps? } (`key` = a mesma chave do evento: IP já
// normalizado ou conta em hash; nunca o IP cru nem o e-mail). O INF-19 liga o alerta externo na mensagem `security_alert`. Com 2+ instâncias os contadores viram por instância (como os limites).
export const SECURITY_EVENTS = [
  "login_ok",
  "login_failed",
  "login_locked",
  "origin_mismatch",
  "session_rejected",
  "device_token_refused",
  "logout_all",
  "password_reset_requested",
  "password_reset_refused",
  "password_reset_done",
  "platform_login_ok",
  "platform_login_failed",
  "platform_login_locked",
  "platform_mfa_failed",
  "server_busy",
] as const;
export type SecurityEvent = (typeof SECURITY_EVENTS)[number];

const WARN_EVENTS = new Set<SecurityEvent>([
  "login_failed",
  "login_locked",
  "origin_mismatch",
  "session_rejected",
  "device_token_refused",
  "password_reset_refused",
  "platform_login_failed",
  "platform_login_locked",
  "platform_mfa_failed",
  "server_busy",
]);
const REASON = /^[A-Z_]{1,40}$/; // só códigos fixos (SESSION_REVOKED, TOKEN_MISSING...): texto livre nunca vai ao log

/** Hash curto e estável da conta (e-mail normalizado). Não é segredo: serve só para agrupar eventos da mesma conta. */
export const accountTag = (email: string): string => createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 12);

export type SecurityEventFields = { email?: string; userId?: string; reason?: string };

// ───────────── Regras de alerta ─────────────

type Scope = "ip" | "account" | "global";
export type AlertRule = {
  name: string;
  events: readonly SecurityEvent[];
  scope: Scope;
  windowMs: number;
  threshold: number;
  /** Só dispara se os eventos vierem de pelo menos N IPs diferentes (credential stuffing distribuído). */
  minDistinctIps?: number;
};

const MIN = 60_000;
export const ALERT_RULES: readonly AlertRule[] = [
  { name: "LOGIN_FAILURES_PER_IP", events: ["login_failed", "login_locked"], scope: "ip", windowMs: 5 * MIN, threshold: 10 },
  { name: "LOGIN_FAILURES_PER_ACCOUNT_MULTI_IP", events: ["login_failed"], scope: "account", windowMs: 10 * MIN, threshold: 8, minDistinctIps: 3 },
  { name: "ORIGIN_MISMATCH_BURST", events: ["origin_mismatch"], scope: "ip", windowMs: 5 * MIN, threshold: 5 },
  { name: "DEVICE_TOKEN_REFUSED_BURST", events: ["device_token_refused"], scope: "ip", windowMs: 5 * MIN, threshold: 10 },
  { name: "SESSION_REJECTED_SPIKE", events: ["session_rejected"], scope: "global", windowMs: 5 * MIN, threshold: 50 },
  { name: "PASSWORD_RESET_FLOOD_PER_ACCOUNT", events: ["password_reset_requested", "password_reset_refused"], scope: "account", windowMs: 15 * MIN, threshold: 6 },
  // SEC-34b: a faixa de hash (ou de imagem) recusando com 503 em ritmo alto = ataque de login em massa ou capacidade subdimensionada. Global (a faixa é do processo).
  { name: "SERVER_BUSY_RATE", events: ["server_busy"], scope: "global", windowMs: MIN, threshold: 20 },
  { name: "PLATFORM_LOGIN_FAILURES", events: ["platform_login_failed", "platform_login_locked", "platform_mfa_failed"], scope: "ip", windowMs: 10 * MIN, threshold: 3 },
];

type Hit = { at: number; ip: string };
const hits = new Map<string, Hit[]>(); // `${rule}|${chave}` -> ocorrências na janela
const alerted = new Map<string, number>(); // `${rule}|${chave}` -> instante do último alerta
const MAX_KEYS = 20_000;

function prune(now: number) {
  if (hits.size < MAX_KEYS && alerted.size < MAX_KEYS) return;
  const longest = Math.max(...ALERT_RULES.map((r) => r.windowMs));
  for (const [key, list] of hits) if (list.length === 0 || now - list[list.length - 1].at > longest) hits.delete(key);
  for (const [key, at] of alerted) if (now - at > longest) alerted.delete(key);
}

/** Alimenta as regras com um evento e devolve os alertas que ELE disparou (normalmente nenhum). Exportada para teste. */
export function observeSecurityEvent(event: SecurityEvent, subject: { ipKey: string; account?: string }, now: number = Date.now()): { rule: string; scope: Scope; key: string; count: number; windowSec: number; distinctIps?: number }[] {
  prune(now);
  const fired: ReturnType<typeof observeSecurityEvent> = [];
  for (const rule of ALERT_RULES) {
    if (!rule.events.includes(event)) continue;
    const subjectKey = rule.scope === "ip" ? subject.ipKey : rule.scope === "account" ? subject.account : "*";
    if (!subjectKey) continue; // regra por conta e evento sem conta: não conta
    const key = `${rule.name}|${subjectKey}`;
    const list = (hits.get(key) ?? []).filter((h) => now - h.at < rule.windowMs);
    list.push({ at: now, ip: subject.ipKey });
    hits.set(key, list);
    if (list.length < rule.threshold) continue;
    const distinctIps = new Set(list.map((h) => h.ip)).size;
    if (rule.minDistinctIps && distinctIps < rule.minDistinctIps) continue;
    const last = alerted.get(key);
    if (last !== undefined && now - last < rule.windowMs) continue; // um alerta por regra+chave e por janela
    alerted.set(key, now);
    fired.push({ rule: rule.name, scope: rule.scope, key: subjectKey, count: list.length, windowSec: rule.windowMs / 1000, ...(rule.minDistinctIps ? { distinctIps } : {}) });
  }
  return fired;
}

/** Só para teste: zera contadores e alertas já emitidos. */
export function resetSecurityAlerts() {
  hits.clear();
  alerted.clear();
}

export function securityEvent(request: Pick<FastifyRequest, "log" | "ip" | "headers" | "socket">, event: SecurityEvent, fields: SecurityEventFields = {}): void {
  try {
    const ipKey = clientKey(clientIpOf(request));
    const entry: Record<string, string> = { securityEvent: event, ipKey };
    if (fields.email) entry.account = accountTag(fields.email);
    if (fields.userId) entry.userId = fields.userId;
    if (fields.reason && REASON.test(fields.reason)) entry.reason = fields.reason;
    if (WARN_EVENTS.has(event)) request.log.warn(entry, "security_event");
    else request.log.info(entry, "security_event");
    emitAlerts(request.log, event, { ipKey, account: entry.account });
  } catch {
    // o log de segurança NUNCA pode derrubar a requisição
  }
}

function emitAlerts(log: FastifyBaseLogger, event: SecurityEvent, subject: { ipKey: string; account?: string }) {
  for (const alert of observeSecurityEvent(event, subject)) {
    const { rule, ...rest } = alert;
    log.error({ securityAlert: rule, ...rest }, "security_alert");
  }
}
