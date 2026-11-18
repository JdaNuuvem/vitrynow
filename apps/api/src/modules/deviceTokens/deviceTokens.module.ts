import { prisma } from "@meucardapio/db";
import { newSecretToken } from "../../lib/tokenHash";
import { disconnectDevice } from "../../realtime/hub";
import { prismaAuditLogger } from "../../shared/audit";
import { PrismaDeviceTokensRepository } from "./deviceTokens.repository";
import { buildDeviceTokenRoutes } from "./deviceTokens.routes";
import { DeviceTokensService } from "./deviceTokens.service";

export default buildDeviceTokenRoutes(
  new DeviceTokensService(
    new PrismaDeviceTokensRepository(prisma),
    prismaAuditLogger,
    {
      now: () => new Date(),
      generateToken: () => newSecretToken("mcd_"), // 256 bits; prefixo facilita varredura de segredos
    },
    disconnectDevice,
  ),
);
