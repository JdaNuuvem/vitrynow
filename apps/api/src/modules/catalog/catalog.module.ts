import { prisma } from "@meucardapio/db";
import { prismaAuditLogger } from "../../shared/audit";
import { PrismaCatalogRepository } from "./catalog.repository";
import { buildCatalogRoutes } from "./catalog.routes";
import { CatalogService } from "./catalog.service";

// Raiz de composição do módulo: escolhe as implementações concretas (Prisma, auditoria).
export default buildCatalogRoutes(new CatalogService(new PrismaCatalogRepository(prisma), prismaAuditLogger));
