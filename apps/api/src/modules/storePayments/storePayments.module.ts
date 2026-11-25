import { panelRoleSchema } from "@meucardapio/shared-types";
import { prisma } from "@meucardapio/db";
import { sendPaymentReconnectEmail } from "../../lib/email";
import { prismaAuditLogger } from "../../shared/audit";
import { oauthProvider } from "./oauth";
import { buildStorePaymentRoutes } from "./storePayments.routes";
import { StorePaymentsService } from "./storePayments.service";

// Instância única: as rotas do painel, o portão do cardápio (PIX_UNAVAILABLE) e o job de renovação usam o mesmo serviço.
// O provedor OAuth é resolvido a cada uso (em produção o fake nunca sobe: `oauthProvider` recusa).
async function notifyOwner(storeId: string) {
  const owners = await prisma.user.findMany({ where: { storeId, role: panelRoleSchema.enum.OWNER }, select: { email: true } });
  for (const owner of owners) await sendPaymentReconnectEmail({ to: owner.email });
}

export const storePaymentsService = new StorePaymentsService(prisma, () => oauthProvider(), prismaAuditLogger, { now: () => new Date() }, notifyOwner);

export default buildStorePaymentRoutes(storePaymentsService);
