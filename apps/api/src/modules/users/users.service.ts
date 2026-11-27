import { panelRoleSchema } from "@meucardapio/shared-types";
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

  // `laneKey`: a origem do pedido (`clientKey(ip)`), para a faixa de hash (SEC-34). O hash vem ANTES de qualquer escrita: 503 não deixa nada pela metade.
  async invite(storeId: string, input: CreateStaffUserInput, laneKey: string) {
    if (await this.repo.findByEmail(input.email)) {
      throw new ConflictError("Já existe alguém da equipe com este e-mail.");
    }
    const passwordHash = await this.hasher.hash(input.password, laneKey);
    return this.repo.create({ storeId, email: input.email, passwordHash, role: input.role ?? panelRoleSchema.enum.STAFF });
  }

  async remove(actor: Actor, id: string) {
    if (id === actor.userId) throw new BadRequestError("Você não pode remover o seu próprio acesso.");

    const target = await this.repo.findInStore(actor.storeId, id);
    if (!target) throw new NotFoundError("Pessoa da equipe não encontrada.");

    if (target.role === panelRoleSchema.enum.OWNER && (await this.repo.countOwners(actor.storeId)) <= 1) {
      throw new ConflictError("A loja precisa ter pelo menos um dono.");
    }

    await this.repo.delete(id);
    this.audit.log({ ...actor, action: "user.delete", targetType: "User", targetId: id, metadata: { email: target.email } });
  }

  // Qualquer usuário troca a própria senha, desde que saiba a atual (não depende de e-mail).
  async changePassword(userId: string, input: ChangePasswordInput, laneKey: string) {
    const user = await this.repo.findById(userId);
    if (!user || !(await this.hasher.verify(input.currentPassword, user.passwordHash, laneKey))) {
      throw new UnauthorizedError("senha atual incorreta");
    }
    return this.repo.updatePasswordHash(userId, await this.hasher.hash(input.newPassword, laneKey));
  }
}
