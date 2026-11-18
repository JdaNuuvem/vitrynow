import { prisma } from "@meucardapio/db";

// Registro de ações sensíveis. Fire-and-forget deliberado: uma falha ao gravar o log não
// pode derrubar a ação de negócio em si (ex. revogar token continua valendo mesmo se o
// INSERT do log falhar) — só logamos o erro.
export type AuditInput = {
  storeId: string;
  userId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

export function toRow(input: AuditInput) {
  return {
    storeId: input.storeId,
    userId: input.userId ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata as never,
  };
}

export function logAudit(input: AuditInput) {
  prisma.auditLog.create({ data: toRow(input) }).catch((error) => console.error("[audit] falha ao gravar log:", error));
}

// Gravação ESTRITA: espera o INSERT e PROPAGA o erro. Para toda divulgação de dado pessoal (contato completo do cliente,
// exportação, 2ª via de STAFF): o rastro tem que existir ANTES de o dado sair; se não puder gravar, o dado não sai
// (API-54b, parecer da Nightingale). Mudança de estado da loja continua no `logAudit` fire-and-forget.
export async function logAuditStrict(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({ data: toRow(input) });
}
