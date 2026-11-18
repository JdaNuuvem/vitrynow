import type { prisma as prismaClient } from "@meucardapio/db";
import type { AuditLogger } from "../../shared/audit";
import { contactAccessFor, type ContactAccess } from "./orders.view";

type Db = Pick<typeof prismaClient, "auditLog">;

export const CONTACT_VIEW_ACTION = "order.view_contact";
export const CONTACT_DEDUPE_MS = 10 * 60 * 1000; // uma linha por usuário+pedido a cada 10 min

export type ContactDecision = {
  access: ContactAccess;
  // Preenchido quando o contato COMPLETO foi negado só porque o rastro não pôde ser gravado (a tela diz
  // "contato indisponível agora, tente de novo", não um erro genérico).
  unavailable: "AUDIT_UNAVAILABLE" | null;
};

// UMA regra para toda divulgação de contato do cliente (detalhe, 2ª via, e depois reveal e CSV da API-54):
//   1) papel e idade decidem se o usuário PODE ver completo (contactAccessFor);
//   2) se pode, o rastro é gravado ANTES de o dado sair (gravação estrita, com dedupe de 10 min);
//   3) se o rastro não puder ser gravado (ou lido), FALHA FECHADO: o contato não sai completo.
// Nunca contato completo sem rastro.
export async function authorizeContactView(
  deps: { db: Db; audit: AuditLogger; now: () => Date; onError?: (error: unknown) => void },
  actor: { storeId: string; userId: string; role: "OWNER" | "STAFF" },
  order: { id: string; status: string; customerPhone: string | null; address: string | null },
  closedAt: Date | null,
): Promise<ContactDecision> {
  const access = contactAccessFor(actor.role, order, closedAt, deps.now());
  if (access === "MASKED") return { access: "MASKED", unavailable: null };
  if (!order.customerPhone && !order.address) return { access: "FULL", unavailable: null }; // não há contato a divulgar

  try {
    const since = new Date(deps.now().getTime() - CONTACT_DEDUPE_MS);
    const recent = await deps.db.auditLog.findFirst({
      where: { storeId: actor.storeId, userId: actor.userId, action: CONTACT_VIEW_ACTION, targetId: order.id, createdAt: { gte: since } },
      select: { id: true },
    });
    if (!recent) {
      await deps.audit.logStrict({ storeId: actor.storeId, userId: actor.userId, action: CONTACT_VIEW_ACTION, targetType: "Order", targetId: order.id });
    }
    return { access: "FULL", unavailable: null };
  } catch (error) {
    (deps.onError ?? ((e) => console.error("[audit] contato NÃO liberado: falha ao registrar o acesso:", e)))(error);
    return { access: "MASKED", unavailable: "AUDIT_UNAVAILABLE" };
  }
}
