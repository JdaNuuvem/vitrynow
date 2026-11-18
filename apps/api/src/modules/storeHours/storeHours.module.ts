import { prisma } from "@meucardapio/db";
import { prismaAuditLogger } from "../../shared/audit";
import { PrismaStoreHoursRepository } from "./storeHours.repository";
import { buildStoreHoursRoutes } from "./storeHours.routes";
import { StoreHoursService } from "./storeHours.service";

// Instância única: as rotas do painel e o portão público do cardápio usam o mesmo serviço.
export const storeHoursService = new StoreHoursService(new PrismaStoreHoursRepository(prisma), prismaAuditLogger, {
  now: () => new Date(),
});

export default buildStoreHoursRoutes(storeHoursService);
