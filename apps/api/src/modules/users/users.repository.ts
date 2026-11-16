import type { User, UserRole, prisma as prismaClient } from "@meucardapio/db";

type Db = typeof prismaClient;

// O que a API expõe de um usuário (nunca o hash da senha).
export type TeamMember = Pick<User, "id" | "email" | "role" | "createdAt">;

const memberSelect = { id: true, email: true, role: true, createdAt: true } as const;

export interface UsersRepository {
  listByStore(storeId: string): Promise<TeamMember[]>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  findInStore(storeId: string, id: string): Promise<User | null>;
  countOwners(storeId: string): Promise<number>;
  create(data: { storeId: string; email: string; passwordHash: string; role: UserRole }): Promise<TeamMember>;
  delete(id: string): Promise<void>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
}

export class PrismaUsersRepository implements UsersRepository {
  constructor(private readonly db: Db) {}

  listByStore(storeId: string) {
    return this.db.user.findMany({ where: { storeId }, select: memberSelect, orderBy: { createdAt: "asc" } });
  }

  findByEmail(email: string) {
    return this.db.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }

  findInStore(storeId: string, id: string) {
    return this.db.user.findFirst({ where: { id, storeId } });
  }

  countOwners(storeId: string) {
    return this.db.user.count({ where: { storeId, role: "OWNER" } });
  }

  create(data: { storeId: string; email: string; passwordHash: string; role: UserRole }) {
    return this.db.user.create({ data, select: memberSelect });
  }

  async delete(id: string) {
    await this.db.user.delete({ where: { id } });
  }

  async updatePasswordHash(id: string, passwordHash: string) {
    await this.db.user.update({ where: { id }, data: { passwordHash } });
  }
}
