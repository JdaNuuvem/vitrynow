import { createHmac } from "node:crypto";
import type { prisma as prismaClient } from "@meucardapio/db";
import { CodedError } from "../../shared/errors";
import { normalizePhone } from "./privacy.service";

type Db = Pick<typeof prismaClient, "doNotContact">;

/** Sal da plataforma (segredo; nunca em log). Sem ele, nada é hasheado nem anonimizado: falha fechada. */
function salt(): string {
  const s = process.env.PRIVACY_HASH_SALT;
  if (!s || s.length < 16) throw new CodedError(503, "PRIVACY_NOT_CONFIGURED", "Privacidade indisponível: configuração incompleta.");
  return s;
}

/** HMAC-SHA256 do telefone normalizado (só dígitos, sem 55). Estável: o mesmo número dá o mesmo hash. */
export function phoneHash(rawPhone: string): string {
  return createHmac("sha256", salt()).update(normalizePhone(rawPhone)).digest("hex");
}
export const assertPrivacySaltConfigured = () => void salt();

/** Registra os telefones (por loja, idempotente). Usado na mesma transação da anonimização. */
export async function addDoNotContact(db: Db, storeId: string, phones: string[], reason: "ANONYMIZED") {
  const hashes = [...new Set(phones.filter((p) => normalizePhone(p).length >= 8).map(phoneHash))];
  if (!hashes.length) return 0;
  const r = await db.doNotContact.createMany({ data: hashes.map((h) => ({ storeId, phoneHash: h, reason })), skipDuplicates: true });
  return r.count;
}

/** Para o envio de WhatsApp (API-41): true = NÃO enviar. Falha fechada: sem sal ⇒ lança (não envia). */
export async function isDoNotContact(db: Db, storeId: string, rawPhone: string): Promise<boolean> {
  const hit = await db.doNotContact.findUnique({ where: { storeId_phoneHash: { storeId, phoneHash: phoneHash(rawPhone) } }, select: { id: true } });
  return hit !== null;
}
