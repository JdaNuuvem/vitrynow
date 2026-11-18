import { prisma } from "@meucardapio/db";
import { prismaAuditLogger } from "../../shared/audit";
import { bcryptPasswordHasher } from "../../shared/passwordHasher";
import { PrismaUsersRepository } from "./users.repository";
import { buildUserRoutes } from "./users.routes";
import { UsersService } from "./users.service";

export default buildUserRoutes(new UsersService(new PrismaUsersRepository(prisma), bcryptPasswordHasher, prismaAuditLogger));
