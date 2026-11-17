// Regras puras da fila de impressão (ADR-0004 §2, §5 e §8). Sem banco, sem relógio implícito.

export const DEFAULT_LEASE_SECONDS = 120; // lease relativa, pelo relógio do BANCO (ADR-0004 §8.1)
export const DEFAULT_MAX_ATTEMPTS = 3; // por job; configurável por loja numa evolução (ADR-0004 §8.6)
export const BACKOFF_SECONDS = [15, 60, 300] as const; // recuo depois de FAILED: 15 s, 60 s, 5 min (§8.3)
export const MAX_REPRINTS_PER_ORDER = 10; // limite por pedido (D4-5)

export function leaseSeconds(): number {
  const configured = Number(process.env.PRINT_LEASE_SECONDS);
  return Number.isFinite(configured) && configured >= 1 && configured <= 900 ? Math.floor(configured) : DEFAULT_LEASE_SECONDS;
}

// Recuo antes de o job voltar a ser entregue, dado quantas tentativas já foram gastas (1ª falha ⇒ 15 s…).
export function backoffSeconds(attemptsSpent: number): number {
  const index = Math.min(Math.max(attemptsSpent, 1), BACKOFF_SECONDS.length) - 1;
  return BACKOFF_SECONDS[index];
}

// Códigos de falha que o cliente pode mandar (ADR-0004 §8.8). O cliente NUNCA manda ex.Message de terceiros.
export const FAILURE_CODES = ["PRINTER_OFFLINE", "NO_PAPER", "DRIVER_ERROR", "PRINTER_NOT_FOUND", "OTHER"] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

// Frase mostrada ao DONO (nunca o texto recebido do cliente). Português, sem detalhe técnico.
export const FAILURE_MESSAGES: Record<FailureCode, string> = {
  PRINTER_OFFLINE: "A impressora está desligada ou sem conexão.",
  NO_PAPER: "A impressora está sem papel.",
  DRIVER_ERROR: "Erro no driver da impressora.",
  PRINTER_NOT_FOUND: "Impressora não encontrada no computador.",
  OTHER: "Não foi possível imprimir.",
};

// Fora da lista vira OTHER (cliente antigo, bug ou adulteração não escolhe a frase mostrada ao dono).
export function normalizeFailureCode(code: unknown): FailureCode {
  return typeof code === "string" && (FAILURE_CODES as readonly string[]).includes(code) ? (code as FailureCode) : "OTHER";
}

// `error` do ack é dado NÃO CONFIÁVEL: remove controles C0 e C1, separadores de linha/parágrafo e marcas bidi
// (inclusive o BOM), colapsa espaços e trunca em 200. Resultado só para auditoria interna; nunca em log, HTML ou WhatsApp.
const CONTROL_AND_BIDI = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g;
export function sanitizeDeviceText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(CONTROL_AND_BIDI, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return cleaned.length > 0 ? cleaned : null;
}

// Chave de deduplicação: 1 job por (pedido, tipo) para o tíquete original e o aviso de cancelamento.
export function dedupeKeyFor(orderId: string, kind: "ORDER_KITCHEN" | "ORDER_CANCEL_NOTICE"): string {
  return `${orderId}:${kind}`;
}
