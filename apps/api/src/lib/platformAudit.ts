import { prisma } from "@meucardapio/db";

// Auditoria da equipe da plataforma (RN-BKO-03). SEMPRE estrita: o dado só sai / a ação só vale se o rastro foi gravado.
export type PlatformAuditInput = {
  adminId: string;
  storeId?: string | null;
  action: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

type Writer = Pick<typeof prisma, "platformAuditLog">;

export async function platformAudit(input: PlatformAuditInput, db: Writer = prisma): Promise<void> {
  await db.platformAuditLog.create({
    data: { adminId: input.adminId, storeId: input.storeId ?? null, action: input.action, reason: input.reason ?? null, metadata: (input.metadata ?? {}) as never },
  });
}
