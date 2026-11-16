import type { ChangePasswordInput, CreateStaffUserInput } from "@meucardapio/shared-types";
import type { Actor, AuditLogger } from "../../shared/audit";
import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from "../../shared/errors";
import type { PasswordHasher } from "../../shared/passwordHasher";
import type { UsersRepository } from "./users.repository";

// Equipe da loja (convidar/remover) e troca de senha do próprio usuário.
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditLogger,
  ) {}

  list(storeId: string) {
    return this.repo.listByStore(storeId);
  }

  async invite(storeId: string, input: CreateStaffUserInput) {
    if (await this.repo.findByEmail(input.email)) {
      throw new ConflictError("já existe um usuário com este e-mail");
    }
    const passwordHash = await this.hasher.hash(input.password);
    return this.repo.create({ storeId, email: input.email, passwordHash, role: input.role ?? "STAFF" });
  }

  async remove(actor: Actor, id: string) {
    if (id === actor.userId) throw new BadRequestError("você não pode remover a si mesmo");

    const target = await this.repo.findInStore(actor.storeId, id);
    if (!target) throw new NotFoundError("usuário não encontrado");

    if (target.role === "OWNER" && (await this.repo.countOwners(actor.storeId)) <= 1) {
      throw new ConflictError("a loja precisa ter pelo menos um dono");
    }

    await this.repo.delete(id);
    this.audit.log({ ...actor, action: "user.delete", targetType: "User", targetId: id, metadata: { email: target.email } });
  }

  // Qualquer usuário troca a própria senha, desde que saiba a atual (não depende de e-mail).
  async changePassword(userId: string, input: ChangePasswordInput) {
    const user = await this.repo.findById(userId);
    if (!user || !(await this.hasher.verify(input.currentPassword, user.passwordHash))) {
      throw new UnauthorizedError("senha atual incorreta");
    }
    return this.repo.updatePasswordHash(userId, await this.hasher.hash(input.newPassword));
  }
}
