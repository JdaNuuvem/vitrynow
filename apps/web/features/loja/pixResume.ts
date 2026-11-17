import type { PixPayment } from "@/core/domain/storefront";

// WEB-33b (spec 09 §10.6, parecer de segurança da Nightingale): quem recarrega ANTES de pagar o PIX volta ao QR.
// O token do pedido fica só em memória, então aqui só entra o que é seguro mostrar de novo:
//   código do pedido, hora, total, paymentMethod (lista FECHADA), payload do PIX (só se PIX) e prazo de expiração.
// PROIBIDO guardar: token, orderId, nome/telefone/endereço do cliente. Nunca em URL nem em log.
// sessionStorage (por aba, some ao fechar), UMA chave por loja. Ao LER, o objeto inteiro é validado contra o esquema:
// qualquer valor fora dele descarta a chave inteira, e nada que veio do storage é mostrado sem passar por aqui.

export type ResumePaymentMethod = "PIX" | "OUTRO";

export type ResumeRecord = {
  code: string;
  placedAt: number; // ms desde 1970
  totalCents: number;
  paymentMethod: ResumePaymentMethod;
  pix: { pixQrCode: string; pixQrCodeBase64: string | null } | null; // só com PIX
  pixExpiresAt: number | null; // ms desde 1970; só com PIX
  // true = o prazo veio do servidor (pode ser mostrado: "Vale até HH:MM"); false = é só o prazo de reserva local, que
  // serve para ESCONDER o QR e nunca vira hora na tela (hora inventada). Só com PIX.
  pixExpiryKnown: boolean | null;
};

export type ResumeReading = { kind: "valid"; record: ResumeRecord } | { kind: "expired"; code: string };

export const RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Se a API não informar o prazo do PIX (versão antiga ou erro), o QR só some pelo teto de 24 h (Atlas): a tela nunca
// inventa um prazo menor nem mostra hora. O servidor passa a fixar 30 min e a sempre devolver `expiresAt`.
export const RESUME_DEFAULT_PIX_MS = RESUME_MAX_AGE_MS;

const SCHEMA_VERSION = 1;
const ALLOWED_KEYS = ["v", "code", "placedAt", "totalCents", "paymentMethod", "pix", "pixExpiresAt", "pixExpiryKnown"];
const ALLOWED_PIX_KEYS = ["pixQrCode", "pixQrCodeBase64"];
const CODE_PATTERN = /^[0-9A-Za-z-]{1,16}$/;
const PIX_COPY_PATTERN = /^[\x20-\x7E]{1,1024}$/; // texto ASCII imprimível do "copia e cola"
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/; // vira data: URL de imagem; nada além de base64
const MAX_BASE64_LENGTH = 40_000;
const MAX_REASONABLE_CENTS = 100_000_000;

export const resumeKey = (slug: string) => `pix-resume:${slug}`;

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null; // acesso bloqueado
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0 && value < 8.64e15;

/** Valida o objeto INTEIRO. Qualquer desvio (campo a mais, tipo errado, método inventado, payload sem PIX) devolve null. */
export function parseResume(raw: unknown): ResumeRecord | null {
  if (!isPlainObject(raw) || !hasOnly(raw, ALLOWED_KEYS) || raw.v !== SCHEMA_VERSION) return null;
  const { code, placedAt, totalCents, paymentMethod, pix, pixExpiresAt, pixExpiryKnown } = raw;
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) return null;
  if (!isTimestamp(placedAt)) return null;
  if (typeof totalCents !== "number" || !Number.isInteger(totalCents) || totalCents < 0 || totalCents > MAX_REASONABLE_CENTS) return null;
  if (paymentMethod !== "PIX" && paymentMethod !== "OUTRO") return null;

  if (paymentMethod === "OUTRO") {
    // o payload só existe com PIX: qualquer vestígio dele numa chave "OUTRO" é adulteração
    if (pix !== undefined && pix !== null) return null;
    if (pixExpiresAt !== undefined && pixExpiresAt !== null) return null;
    if (pixExpiryKnown !== undefined && pixExpiryKnown !== null) return null;
    return { code, placedAt, totalCents, paymentMethod, pix: null, pixExpiresAt: null, pixExpiryKnown: null };
  }

  if (!isPlainObject(pix) || !hasOnly(pix, ALLOWED_PIX_KEYS)) return null;
  const copy = pix.pixQrCode;
  const image = pix.pixQrCodeBase64;
  if (typeof copy !== "string" || !PIX_COPY_PATTERN.test(copy)) return null;
  if (image !== null && image !== undefined && (typeof image !== "string" || image.length > MAX_BASE64_LENGTH || !BASE64_PATTERN.test(image))) return null;
  if (!isTimestamp(pixExpiresAt)) return null;
  // o prazo vem depois do pedido e no máximo 24 h depois (Nightingale): fora disso é adulteração
  if (pixExpiresAt <= placedAt || pixExpiresAt > placedAt + RESUME_MAX_AGE_MS) return null;
  if (typeof pixExpiryKnown !== "boolean") return null;
  return { code, placedAt, totalCents, paymentMethod, pix: { pixQrCode: copy, pixQrCodeBase64: typeof image === "string" ? image : null }, pixExpiresAt, pixExpiryKnown };
}

export function clearResume(slug: string, storage: Storage | null = sessionStore()) {
  try {
    storage?.removeItem(resumeKey(slug));
  } catch {
    // sem acesso: nada a apagar
  }
}

/** Guarda a retomada de um pedido PIX recém-criado. Devolve false se não gravou (sem payload, sem storage ou cheio). */
export function saveResume(
  slug: string,
  order: { code: string; totalCents: number; placedAt: number; pix: PixPayment | null | undefined; pixExpiresAt?: number | null },
  storage: Storage | null = sessionStore(),
): boolean {
  if (!storage || !order.pix?.pixQrCode) return false;
  const record = {
    v: SCHEMA_VERSION,
    code: order.code,
    placedAt: order.placedAt,
    totalCents: order.totalCents,
    paymentMethod: "PIX",
    pix: { pixQrCode: order.pix.pixQrCode, pixQrCodeBase64: order.pix.pixQrCodeBase64 ?? null },
    pixExpiresAt: order.pixExpiresAt ?? order.placedAt + RESUME_DEFAULT_PIX_MS,
    pixExpiryKnown: order.pixExpiresAt != null,
  };
  // o que vai para o storage passa pelo MESMO esquema de leitura: o que não valida não é gravado
  if (!parseResume(record)) return false;
  try {
    storage.setItem(resumeKey(slug), JSON.stringify(record));
    return true;
  } catch {
    return false; // storage cheio ou bloqueado: o cliente só perde a retomada
  }
}

/**
 * Lê e valida a retomada. Chave inválida/adulterada ⇒ apagada e `null`. Chave vencida (PIX vencido, ou mais de 24 h) ⇒
 * apagada: PIX vencido devolve `expired` com o código (para a tela "Este PIX venceu"); mais de 24 h devolve `null`.
 */
export function readResume(slug: string, now: number = Date.now(), storage: Storage | null = sessionStore()): ResumeReading | null {
  if (!storage) return null;
  let text: string | null;
  try {
    text = storage.getItem(resumeKey(slug));
  } catch {
    return null;
  }
  if (text === null) return null;

  let record: ResumeRecord | null = null;
  try {
    record = parseResume(JSON.parse(text));
  } catch {
    record = null;
  }
  if (!record) {
    clearResume(slug, storage);
    return null;
  }
  if (now - record.placedAt > RESUME_MAX_AGE_MS || record.placedAt - now > 5 * 60 * 1000) {
    clearResume(slug, storage); // velho demais, ou com a hora no futuro (relógio adulterado)
    return null;
  }
  if (record.paymentMethod !== "PIX" || record.pix === null || record.pixExpiresAt === null) {
    clearResume(slug, storage); // sem QR a mostrar: nada a retomar
    return null;
  }
  if (now >= record.pixExpiresAt) {
    clearResume(slug, storage);
    return { kind: "expired", code: record.code };
  }
  return { kind: "valid", record };
}

/** O pedido com este código tem PIX guardado e ainda válido? (a frase "a loja recebe o pedido" só nasce daqui) */
export function hasValidPixFor(reading: ResumeReading | null, code: string): boolean {
  return reading?.kind === "valid" && reading.record.code === code && reading.record.paymentMethod === "PIX" && reading.record.pix !== null;
}
