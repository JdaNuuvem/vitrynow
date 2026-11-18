import { prisma } from "@meucardapio/db";
import { prismaAuditLogger } from "../../shared/audit";
import { realtimeStoreEvents } from "../../shared/storeEvents";
import { PrismaDeliverersRepository } from "./deliverers.repository";
import { buildDelivererRoutes } from "./deliverers.routes";
import { DeliverersService } from "./deliverers.service";

export default buildDelivererRoutes(
  new DeliverersService(new PrismaDeliverersRepository(prisma), prismaAuditLogger, realtimeStoreEvents),
);
