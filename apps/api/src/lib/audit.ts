import { prisma } from "@meucardapio/db";

// Registro de ações sensíveis. Fire-and-forget deliberado: uma falha ao gravar o log não
// pode derrubar a ação de negócio em si (ex. revogar token continua valendo mesmo se o
// INSERT do log falhar) — só logamos o erro.
export function logAudit(input: {
  storeId: string;
  userId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) {
  prisma.auditLog
    .create({
      data: {
        storeId: input.storeId,
        userId: input.userId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata as never,
      },
    })
    .catch((error) => console.error("[audit] falha ao gravar log:", error));
}
