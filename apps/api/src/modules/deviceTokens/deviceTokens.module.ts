import { nanoid } from "nanoid";
import { prisma } from "@meucardapio/db";
import { prismaAuditLogger } from "../../shared/audit";
import { PrismaDeviceTokensRepository } from "./deviceTokens.repository";
import { buildDeviceTokenRoutes } from "./deviceTokens.routes";
import { DeviceTokensService } from "./deviceTokens.service";

export default buildDeviceTokenRoutes(
  new DeviceTokensService(new PrismaDeviceTokensRepository(prisma), prismaAuditLogger, {
    now: () => new Date(),
    generateToken: () => nanoid(32),
  }),
);
