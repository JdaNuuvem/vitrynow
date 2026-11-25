import { panelRoleSchema } from "@meucardapio/shared-types";
import { Prisma, type prisma as prismaClient } from "@meucardapio/db";
import { HISTORY_PERIODS, HISTORY_STATUS_FILTERS, OPEN_ORDER_STATUSES } from "@meucardapio/shared-types";
import { CodedError } from "../../shared/errors";
import { parseLocalDate, safeTimeZone, startOfStoreDay } from "../../lib/storeTime";
import { MAX_REFUND_AUTO_ATTEMPTS } from "../../lib/refundPolicy";
import { maskPhone, recentWindowCutoff } from "./orders.view";
import { utc } from "../../lib/sqlTime";
import type { Role } from "../../lib/orderStateMachine";

type Db = typeof prismaClient;

// Histórico de pedidos (RN-HP-01..08): busca única, filtros, período máximo de 90 dias, cursor por (createdAt, id) e
// contagem total do filtro. Só devolve LINHA de lista (allowlist): telefone mascarado, nunca endereço (PRD-15).

export const HISTORY_PAGE_SIZE = 25;
export const HISTORY_MAX_PAGE_SIZE = 100;
export const HISTORY_MAX_DAYS = 90;
export const HISTORY_PHONE_MIN_DIGITS = 4;
export const HISTORY_STAFF_FULL_PHONE_DIGITS = 10;
/** Status "em andamento" (mesma lista do kanban e do contato completo do STAFF): fonte única em shared-types (SSOT D3). */
export { OPEN_ORDER_STATUSES };
// Literais do enum no SQL (constantes do código, nunca dado do usuário): comparar a coluna com `status::text` desligava o índice (3 ms ⇒ 40 ms com 10 mil abertos).
const OPEN_SQL = Prisma.raw(OPEN_ORDER_STATUSES.map((status) => `'${status}'`).join(", "));

export type HistoryStatusFilter = (typeof HISTORY_STATUS_FILTERS)[number];
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number];

export type HistoryQuery = {
  q?: string;
  period?: HistoryPeriod;
  from?: string; // AAAA-MM-DD no fuso da loja (period=custom)
  to?: string;
  status?: HistoryStatusFilter;
  type?: "MESA" | "DELIVERY" | "BALCAO";
  paymentMethod?: string;
  refundPending?: boolean;
  cursor?: string;
  limit?: number;
};

const bad = (code: string, message: string) => new CodedError(400, code, message);

/** Período [início, fim) em UTC, calculado no fuso da loja. Padrão: últimos 7 dias (RN-HP-02). */
export function resolvePeriod(query: Pick<HistoryQuery, "period" | "from" | "to">, now: Date, timeZone: string): { start: Date; end: Date } {
  const tomorrow = startOfStoreDay(now, timeZone, 1);
  switch (query.period ?? "7d") {
    case "today":
      return { start: startOfStoreDay(now, timeZone, 0), end: tomorrow };
    case "yesterday":
      return { start: startOfStoreDay(now, timeZone, -1), end: startOfStoreDay(now, timeZone, 0) };
    case "7d":
      return { start: startOfStoreDay(now, timeZone, -6), end: tomorrow };
    case "30d":
      return { start: startOfStoreDay(now, timeZone, -29), end: tomorrow };
    case "custom": {
      if (!query.from || !query.to) throw bad("PERIOD_INVALID", "Informe a data inicial e a final.");
      const start = parseLocalDate(query.from, timeZone);
      const lastDay = parseLocalDate(query.to, timeZone);
      if (!start || !lastDay) throw bad("PERIOD_INVALID", "Data inválida.");
      // fim inclusivo: o dia final entra inteiro
      const [y, m, d] = query.to.split("-").map(Number);
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      const end = parseLocalDate(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`, timeZone)!;
      if (end <= start) throw bad("PERIOD_INVALID", "A data final não pode ser anterior à inicial.");
      if ((end.getTime() - start.getTime()) / 86_400_000 > HISTORY_MAX_DAYS + 0.05) throw bad("PERIOD_TOO_LONG", `O período máximo é de ${HISTORY_MAX_DAYS} dias.`);
      return { start, end };
    }
  }
}

// Remove acento e caixa no SQL e no termo: "Conceição" = "conceicao". (Sem a extensão `unaccent`, que nem todo banco libera.)
const ACCENT_FROM = "áàâãäåéèêëíìîïóòôõöúùûüçñýÿÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ";
const ACCENT_TO = "aaaaaaeeeeiiiiooooouuuucnyyAAAAAAEEEEIIIIOOOOOUUUUCNY";
export const foldText = (text: string) =>
  [...text.normalize("NFC")].map((ch) => { const i = ACCENT_FROM.indexOf(ch); return i >= 0 ? ACCENT_TO[i] : ch; }).join("").toLowerCase();
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * O que a busca única vai procurar (RN-HP-01, RN-HP-08): código, nome e telefone; mínimo 2 caracteres, 4 dígitos para telefone.
 * Telefone por TRECHO só para o OWNER. O STAFF só casa o FINAL do número (os 4 dígitos que a máscara já mostra, ou o número
 * completo, 10+ dígitos): busca por trecho deixaria reconstruir o telefone dígito a dígito sem passar pela máscara (Nightingale).
 */
export function parseSearch(raw: string | undefined, role: Role = panelRoleSchema.enum.OWNER): { code: string | null; name: string | null; phone: string | null; phoneMatch: "contains" | "suffix" } | null {
  const q = (raw ?? "").trim();
  if (!q) return null;
  if (q.length < 2) throw bad("SEARCH_TOO_SHORT", "Digite ao menos 2 caracteres para buscar.");
  const digits = q.replace(/\D/g, "");
  const codeLike = /^#?\d+$/.test(q);
  const phoneLike = digits.length >= HISTORY_PHONE_MIN_DIGITS && /^[\d\s()+\-#.]+$/.test(q);
  // Código do país (RN-HP-01): termo de 12 ou 13 dígitos que começa em "55" perde o "55" (só do lado do termo; a busca é por
  // trecho). Até 11 dígitos não mudam: "55991234567" é DDD 55. A regra do STAFF abaixo vale para o termo JÁ normalizado.
  const phoneDigits = (digits.length === 12 || digits.length === 13) && digits.startsWith("55") ? digits.slice(2) : digits;
  const staffAllowed = phoneDigits.length === HISTORY_PHONE_MIN_DIGITS || phoneDigits.length >= HISTORY_STAFF_FULL_PHONE_DIGITS;
  return {
    code: codeLike ? digits : null,
    name: /\p{L}/u.test(q) ? foldText(q) : null,
    phone: phoneLike && (role === panelRoleSchema.enum.OWNER || staffAllowed) ? phoneDigits : null,
    phoneMatch: role === panelRoleSchema.enum.OWNER ? "contains" : "suffix",
  };
}

type Cursor = { t: string; id: string };
export const encodeCursor = (row: { createdAt: Date; id: string }) => Buffer.from(JSON.stringify({ t: row.createdAt.toISOString(), id: row.id } satisfies Cursor)).toString("base64url");
export function decodeCursor(raw: string): Cursor {
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof value.t === "string" && typeof value.id === "string" && !Number.isNaN(Date.parse(value.t))) return { t: value.t, id: value.id };
  } catch {
    /* cai no erro abaixo */
  }
  throw bad("CURSOR_INVALID", "Cursor inválido.");
}

export type HistoryRow = {
  id: string;
  code: string;
  createdAt: string;
  customerName: string | null;
  customerPhone: string | null;
  hasPhone: boolean;
  /** LGPD: o dado pessoal deste pedido foi removido a pedido do titular. */
  anonymized: boolean;
  type: string;
  totalCents: number;
  status: string;
  /** Rótulo para a tela: o PIX que ninguém pagou aparece como aguardando/expirado (RN-HP-05). */
  display: "ABERTO" | "CONCLUIDO" | "CANCELADO" | "AGUARDANDO_PAGAMENTO" | "PAGAMENTO_EXPIRADO";
  paymentMethod: string | null;
  paymentStatus: string | null;
  refundPending: boolean;
  refundAbandoned: boolean;
  refundStuck: boolean;
  notPrinted: boolean;
};

export async function searchOrderHistory(
  db: Db,
  storeId: string,
  timeZone: string,
  now: Date,
  query: HistoryQuery,
  role: Role = panelRoleSchema.enum.OWNER,
  opts: { skipPhone?: boolean } = {},
): Promise<{ rows: HistoryRow[]; total: number; nextCursor: string | null; period: { from: string; to: string } | null; timezone: string }> {
  const tz = safeTimeZone(timeZone);
  const status = query.status ?? "ALL";
  if (!HISTORY_STATUS_FILTERS.includes(status)) throw bad("FILTER_INVALID", "Filtro de status inválido.");
  // "Em aberto" NÃO tem janela (API-72): é a lista de TUDO que está aberto na loja, inclusive o pedido esquecido há meses, que é
  // justamente o que o aviso do kanban manda resolver. `period`, `from` e `to` são IGNORADOS nesse filtro (os valores de `from`/`to` nem são lidos). Só a FORMA dos parâmetros é validada na rota: `period` fora do enum (ex. `banana`) segue dando 400 FILTER_INVALID, para um erro do cliente aparecer.
  const period = status === "ABERTO" ? null : resolvePeriod(query, now, tz);
  const search = parseSearch(query.q, role);
  if (opts.skipPhone && search) search.phone = null; // cota do telefone esgotada: só código e nome (o serviço decide)
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? HISTORY_PAGE_SIZE) || HISTORY_PAGE_SIZE, 1), HISTORY_MAX_PAGE_SIZE);

  const where: Prisma.Sql[] = [Prisma.sql`o."storeId" = ${storeId}`];
  if (period) where.push(Prisma.sql`o."createdAt" >= ${utc(period.start)}`, Prisma.sql`o."createdAt" < ${utc(period.end)}`);
  // ABERTO = o que o kanban considera em andamento (fora o PIX não pago): é por onde o dono acha os pedidos antigos escondidos pelo teto.
  if (status === "ABERTO") where.push(Prisma.sql`o."awaitingPayment" = false AND o."held" = false AND o."status" IN (${OPEN_SQL})`);
  if (status === "CONCLUIDO") where.push(Prisma.sql`o."status" = 'CONCLUIDO'`);
  if (status === "CANCELADO") where.push(Prisma.sql`o."status" = 'CANCELADO' AND COALESCE(p."status"::text, '') <> 'EXPIRADO'`);
  if (status === "AGUARDANDO_PAGAMENTO") where.push(Prisma.sql`o."awaitingPayment" = true AND o."status" <> 'CANCELADO'`);
  if (status === "PAGAMENTO_EXPIRADO") where.push(Prisma.sql`p."status"::text = 'EXPIRADO'`);
  if (query.type) where.push(Prisma.sql`o."type"::text = ${query.type}`);
  if (query.paymentMethod) where.push(Prisma.sql`o."paymentMethod"::text = ${query.paymentMethod}`);
  if (query.refundPending) where.push(Prisma.sql`p."status"::text = 'ESTORNO_PENDENTE' AND p."refundAbandonedAt" IS NULL`);

  if (search) {
    const any: Prisma.Sql[] = [];
    if (search.code !== null) {
      any.push(Prisma.sql`o."code" LIKE ${`%${search.code}%`}`);
      const trimmed = search.code.replace(/^0+/, "");
      if (trimmed) any.push(Prisma.sql`ltrim(o."code", '0') LIKE ${`%${trimmed}%`}`);
    }
    if (search.name) {
      any.push(Prisma.sql`lower(translate(normalize(coalesce(o."customerName", ''), NFC), ${ACCENT_FROM}, ${ACCENT_TO})) LIKE ${`%${escapeLike(search.name)}%`} ESCAPE '\\'`);
    }
    if (search.phone) {
      const phoneLike = Prisma.sql`regexp_replace(coalesce(o."customerPhone", ''), '\\D', '', 'g') LIKE ${search.phoneMatch === "suffix" ? `%${search.phone}` : `%${search.phone}%`}`;
      if (role === panelRoleSchema.enum.OWNER) any.push(phoneLike);
      else {
        // STAFF: mesma janela do contato completo (aberto, ou última mudança de estado há menos de 24 h). Pedido antigo não é achado por telefone.
        // Mesma fronteira do detalhe (`isWithinRecentWindow`): idade < 24 h, ou seja, ESTRITAMENTE depois do corte. Ver a regra de revisão em orders.view.ts.
        const cutoff = recentWindowCutoff(now);
        any.push(Prisma.sql`(${phoneLike} AND (o."status" IN (${OPEN_SQL}) OR (SELECT max(h."createdAt") FROM "OrderStatusHistory" h WHERE h."orderId" = o."id") > ${utc(cutoff)}))`);
      }
    }
    where.push(any.length ? Prisma.sql`(${Prisma.join(any, " OR ")})` : Prisma.sql`false`);
  }

  const base = Prisma.sql`FROM "Order" o LEFT JOIN "Payment" p ON p."orderId" = o."id" WHERE ${Prisma.join(where, " AND ")}`;
  const keyset = query.cursor
    ? (() => {
        const c = decodeCursor(query.cursor);
        return Prisma.sql` AND (o."createdAt", o."id") < (${utc(new Date(c.t))}, ${c.id})`;
      })()
    : Prisma.empty;

  const [{ n: total }] = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n ${base}`);
  const ids = await db.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT o."id" ${base}${keyset} ORDER BY o."createdAt" DESC, o."id" DESC LIMIT ${limit + 1}`,
  );
  const pageIds = ids.slice(0, limit).map((r) => r.id);
  const found = await db.order.findMany({
    where: { id: { in: pageIds }, storeId },
    select: {
      id: true, code: true, createdAt: true, customerName: true, customerPhone: true, type: true, totalCents: true, status: true,
      awaitingPayment: true, paymentMethod: true, printedAt: true, anonymizedAt: true, payment: { select: { status: true, refundAbandonedAt: true, refundAttempts: true } },
    },
  });
  const byId = new Map(found.map((o) => [o.id, o]));
  const rows = pageIds.map((id) => byId.get(id)).filter((o): o is NonNullable<typeof o> => !!o).map((o): HistoryRow => {
    const paymentStatus = o.payment?.status ?? null;
    const display: HistoryRow["display"] =
      paymentStatus === "EXPIRADO" ? "PAGAMENTO_EXPIRADO"
      : o.awaitingPayment && o.status !== "CANCELADO" ? "AGUARDANDO_PAGAMENTO"
      : o.status === "CONCLUIDO" ? "CONCLUIDO"
      : o.status === "CANCELADO" ? "CANCELADO"
      : "ABERTO";
    return {
      id: o.id,
      code: o.code,
      createdAt: o.createdAt.toISOString(),
      customerName: o.customerName,
      customerPhone: maskPhone(o.customerPhone), // lista: SEMPRE mascarado, qualquer papel; sem endereço
      hasPhone: !!o.customerPhone,
      anonymized: o.anonymizedAt !== null,
      type: o.type,
      totalCents: o.totalCents,
      status: o.status,
      display,
      paymentMethod: o.paymentMethod,
      paymentStatus,
      refundPending: paymentStatus === "ESTORNO_PENDENTE" && !o.payment?.refundAbandonedAt,
      refundAbandoned: !!o.payment?.refundAbandonedAt, // marca "Estorno não concluído" (RN-ABD-04)
      refundStuck: paymentStatus === "ESTORNO_PENDENTE" && !o.payment?.refundAbandonedAt && (o.payment?.refundAttempts ?? 0) >= MAX_REFUND_AUTO_ATTEMPTS,
      notPrinted: o.printedAt === null && !o.awaitingPayment && o.status !== "CANCELADO",
    };
  });
  const last = ids.length > limit ? found.find((o) => o.id === pageIds[pageIds.length - 1]) : undefined;
  return {
    rows,
    total: Number(total),
    nextCursor: last ? encodeCursor(last) : null,
    period: period ? { from: period.start.toISOString(), to: period.end.toISOString() } : null,
    timezone: tz,
  };
}

// ───────────── Limite de buscas por usuário (RN-HP-07) ─────────────
// Em memória (uma instância): suficiente para o MVP; com várias instâncias o limite vira por instância (aceito).
const WINDOW_MS = 60_000;
export const HISTORY_RATE_LIMIT = 60;
const hits = new Map<string, number[]>();

export function assertHistoryRate(userId: string, now: number = Date.now(), limit = HISTORY_RATE_LIMIT): void {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(userId, recent);
    throw new CodedError(429, "RATE_LIMITED", "Muitas buscas. Aguarde um minuto e tente de novo.");
  }
  recent.push(now);
  hits.set(userId, recent);
  if (hits.size > 5000) for (const [key, list] of hits) if (list.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
}
export const resetHistoryRate = () => {
  hits.clear();
  phoneHits.clear();
  phoneRefusals.clear();
};

// Recusas por limite: a auditoria grava a 1ª de cada janela de 1 h por usuário e depois só nas marcas 10, 100 e 1000, com a
// contagem (no máximo 4 linhas por hora em vez de até 3.600). Em memória por instância, como os limites acima.
const phoneRefusals = new Map<string, { since: number; count: number }>();
/** Registra uma recusa e devolve a contagem a gravar na auditoria, ou null quando esta recusa não gera linha. */
export function recordPhoneRefusal(userId: string, now: number = Date.now()): number | null {
  const current = phoneRefusals.get(userId);
  const entry = current && now - current.since < PHONE_WINDOW_MS ? current : { since: now, count: 0 };
  entry.count += 1;
  phoneRefusals.set(userId, entry);
  if (phoneRefusals.size > 5000) for (const [key, value] of phoneRefusals) if (now - value.since >= PHONE_WINDOW_MS) phoneRefusals.delete(key);
  return entry.count === 1 || entry.count === 10 || entry.count === 100 || entry.count === 1000 ? entry.count : null;
}

// Busca por telefone do STAFF: 10 por hora por usuário (H6, decisão do Atlas): o telefone completo é o dado mais sensível da lista.
export const HISTORY_PHONE_RATE_LIMIT = 10;
const PHONE_WINDOW_MS = 60 * 60_000;
const phoneHits = new Map<string, number[]>();
export function assertPhoneSearchRate(userId: string, now: number = Date.now(), limit = HISTORY_PHONE_RATE_LIMIT): void {
  const recent = (phoneHits.get(userId) ?? []).filter((t) => now - t < PHONE_WINDOW_MS);
  if (recent.length >= limit) {
    phoneHits.set(userId, recent);
    throw new CodedError(429, "RATE_LIMITED", "Muitas buscas por telefone. Tente de novo em alguns minutos ou busque pelo código ou pelo nome.");
  }
  recent.push(now);
  phoneHits.set(userId, recent);
  if (phoneHits.size > 5000) for (const [key, list] of phoneHits) if (list.every((t) => now - t >= PHONE_WINDOW_MS)) phoneHits.delete(key);
}
