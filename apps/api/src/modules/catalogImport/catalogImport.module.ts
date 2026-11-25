import { prisma } from "@meucardapio/db";
import { prismaAuditLogger } from "../../shared/audit";
import { CatalogService } from "../catalog/catalog.service";
import { PrismaCatalogRepository } from "../catalog/catalog.repository";
import { PrismaImportRepository } from "./catalogImport.repository";
import { buildCatalogImportRoutes } from "./catalogImport.routes";
import { CatalogImportService } from "./catalogImport.service";

// Composição: a publicação usa o MESMO CatalogService do cadastro manual (nenhuma regra de produto duplicada).
const catalog = new CatalogService(new PrismaCatalogRepository(prisma), prismaAuditLogger);
export default buildCatalogImportRoutes(new CatalogImportService(new PrismaImportRepository(prisma), catalog, prismaAuditLogger));
