import { prisma } from "@meucardapio/db";
import { prismaAuditLogger } from "../../shared/audit";
import { PrismaCouponsRepository } from "./coupons.repository";
import { buildCouponRoutes } from "./coupons.routes";
import { CouponsService } from "./coupons.service";

export default buildCouponRoutes(new CouponsService(new PrismaCouponsRepository(prisma), prismaAuditLogger));
