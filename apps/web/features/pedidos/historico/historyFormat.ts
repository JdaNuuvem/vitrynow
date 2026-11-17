import { statusLabel, TYPE_LABELS, UNKNOWN_STATUS_LABEL } from "@/core/domain/orderLabels";
import type { HistoryQuery, HistoryRow } from "@/core/domain/orderHistory";
import type { OrderType } from "@/core/domain/orders";

// ---- Período da Fatia 1: "Em aberto" olha 90 dias para trás (API-70), para o dono achar o que o teto do kanban escondeu ----

export const HISTORY_OPEN_DAYS = 90;

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * `period=custom` com 90 dias CRAVADOS (de hoje − 89 até hoje, os dois dias inclusos): é o máximo que a API aceita (`PERIOD_TOO_LONG`
 * acima disso). As datas valem no fuso da LOJA e o web só conhece o do navegador; como as duas pontas andam juntas, o tamanho do
 * período não muda, no máximo a janela desliza algumas horas. O que nasceu hoje já está sempre no kanban.
 */
export function openPeriodQuery(now: Date = new Date()): Pick<HistoryQuery, "period" | "from" | "to"> {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (HISTORY_OPEN_DAYS - 1));
  return { period: "custom", from: isoDay(from), to: isoDay(to) };
}

// ---- Linha da lista ----

/** Situação para a tela: ícone + texto + tom (nunca só cor). Valor que a tela não conhece vira texto neutro, nunca o código cru. */
export type StatusChip = { text: string; icon: string; tone: "info" | "ok" | "danger" | "warn" | "neutral" };

export function statusChip(row: Pick<HistoryRow, "display" | "status">): StatusChip {
  switch (row.display) {
    case "ABERTO":
      return { text: statusLabel(row.status), icon: "●", tone: "info" }; // o estado de verdade do kanban (Pendente, Em preparo...)
    case "CONCLUIDO":
      return { text: "Concluído", icon: "✓", tone: "ok" };
    case "CANCELADO":
      return { text: "Cancelado", icon: "✕", tone: "danger" };
    case "AGUARDANDO_PAGAMENTO":
      return { text: "Aguardando pagamento", icon: "◷", tone: "warn" };
    case "PAGAMENTO_EXPIRADO":
      return { text: "Pagamento expirado", icon: "✕", tone: "warn" };
    default:
      return { text: UNKNOWN_STATUS_LABEL, icon: "?", tone: "neutral" };
  }
}

export type RowBadge = { text: string; tone: "danger" | "warn" };

/** Selos extras da linha: no máximo 2 visíveis e o resto vira "+N" (spec 10 §2.3). */
export function rowBadges(row: Pick<HistoryRow, "refundPending" | "notPrinted">): { shown: RowBadge[]; more: number } {
  const all: RowBadge[] = [];
  if (row.refundPending) all.push({ text: "Estorno pendente", tone: "danger" });
  if (row.notPrinted) all.push({ text: "Não impresso", tone: "warn" });
  return { shown: all.slice(0, 2), more: Math.max(0, all.length - 2) };
}

export function typeLabel(type: string): string {
  return (TYPE_LABELS as Record<string, string>)[type as OrderType] ?? "—";
}

/** "16/11 · 19:02" no fuso da LOJA (o que o servidor devolveu em `timezone`); fuso inválido cai no do navegador, nunca quebra. */
export function formatWhen(iso: string, timeZone: string | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("pt-BR", { ...options, timeZone }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("pt-BR", options).formatToParts(date);
  }
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}/${get("month")} · ${get("hour")}:${get("minute")}`;
}

/** Cliente da linha: nome, senão o telefone JÁ mascarado pelo servidor, senão traço. Nada de montar telefone no navegador. */
export function customerText(row: Pick<HistoryRow, "customerName" | "customerPhone">): string {
  const name = row.customerName?.trim();
  if (name) return name;
  return safePhone(row.customerPhone) ?? "—";
}

/** O telefone que a LISTA mostra nunca é completo (o servidor mascara para qualquer papel); se vier algo sem máscara, não exibe. */
export function safePhone(phone: string | null | undefined): string | null {
  const text = phone?.trim();
  if (!text) return null;
  return /[•*xX]/.test(text) ? text : null;
}
