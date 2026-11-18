import { prisma } from "@meucardapio/db";
import { prismaAuditLogger } from "../../shared/audit";
import { PrismaOptionGroupsRepository } from "./optionGroups.repository";
import { buildOptionGroupRoutes } from "./optionGroups.routes";
import { OptionGroupsService } from "./optionGroups.service";

// Instância única: o painel (rotas) e a vitrine/pedido (groupsForProducts) usam o mesmo serviço.
export const optionGroupsService = new OptionGroupsService(new PrismaOptionGroupsRepository(prisma), prismaAuditLogger);

export default buildOptionGroupRoutes(optionGroupsService);
