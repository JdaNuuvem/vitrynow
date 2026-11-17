import { prisma } from "@meucardapio/db";
import { prismaAuditLogger } from "../../shared/audit";
import { oauthProvider } from "./oauth";
import { buildStorePaymentRoutes } from "./storePayments.routes";
import { StorePaymentsService } from "./storePayments.service";

// Instância única: as rotas do painel, o portão do cardápio (PIX_UNAVAILABLE) e o job de renovação usam o mesmo serviço.
// O provedor OAuth é resolvido a cada uso (em produção o fake nunca sobe: `oauthProvider` recusa).
export const storePaymentsService = new StorePaymentsService(prisma, () => oauthProvider(), prismaAuditLogger);

export default buildStorePaymentRoutes(storePaymentsService);
