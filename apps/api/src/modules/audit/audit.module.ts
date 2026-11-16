import { prisma } from "@meucardapio/db";
import { PrismaAuditLogReader } from "./audit.repository";
import { buildAuditRoutes } from "./audit.routes";

export default buildAuditRoutes(new PrismaAuditLogReader(prisma));
