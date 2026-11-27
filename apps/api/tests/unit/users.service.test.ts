import { describe, expect, it } from "vitest";
import type { User } from "@meucardapio/db";
import type { UsersRepository } from "../../src/modules/users/users.repository";
import { UsersService } from "../../src/modules/users/users.service";
import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from "../../src/shared/errors";
import type { PasswordHasher } from "../../src/shared/passwordHasher";
import { FakeAudit, rec } from "./fakes";

// Hasher de mentira, previsível e instantâneo (nada de bcrypt nos testes unitários).
const fakeHasher: PasswordHasher = {
  hash: async (plain) => `hash(${plain})`,
  verify: async (plain, hash) => hash === `hash(${plain})`,
};

const owner = rec<User>({ id: "owner-1", storeId: "store-1", email: "dono@x.com", role: "OWNER", passwordHash: "hash(senha-atual)" });
const owner2 = rec<User>({ id: "owner-2", storeId: "store-1", email: "dono2@x.com", role: "OWNER", passwordHash: "x" });
const staff = rec<User>({ id: "staff-1", storeId: "store-1", email: "func@x.com", role: "STAFF", passwordHash: "x" });

function setup(users: User[]) {
  const created: unknown[] = [];
  const deleted: string[] = [];
  const passwordUpdates: { id: string; hash: string }[] = [];
  const repo = {
    findByEmail: async (email: string) => users.find((u) => u.email === email) ?? null,
    findById: async (id: string) => users.find((u) => u.id === id) ?? null,
    findInStore: async (storeId: string, id: string) => users.find((u) => u.id === id && u.storeId === storeId) ?? null,
    countOwners: async (storeId: string) => users.filter((u) => u.storeId === storeId && u.role === "OWNER").length,
    create: async (data: unknown) => (created.push(data), rec({ id: "new" })),
    delete: async (id: string) => void deleted.push(id),
    updatePasswordHash: async (id: string, hash: string) => void passwordUpdates.push({ id, hash }),
  } as unknown as UsersRepository;
  const audit = new FakeAudit();
  return { service: new UsersService(repo, fakeHasher, audit), audit, created, deleted, passwordUpdates };
}

const as = (userId: string) => ({ storeId: "store-1", userId });

describe("UsersService — equipe", () => {
  it("convida STAFF por padrão e guarda só o hash da senha", async () => {
    const { service, created } = setup([owner]);
    await service.invite("store-1", { email: "novo@x.com", password: "provisoria1" });
    expect(created[0]).toEqual({ storeId: "store-1", email: "novo@x.com", passwordHash: "hash(provisoria1)", role: "STAFF" });
  });

  it("e-mail já cadastrado é 409 e nada é criado", async () => {
    const { service, created } = setup([owner]);
    await expect(service.invite("store-1", { email: "dono@x.com", password: "provisoria1" })).rejects.toThrow(ConflictError);
    expect(created).toEqual([]);
  });

  it("não deixa o usuário remover a si mesmo (400)", async () => {
    const { service, deleted } = setup([owner, staff]);
    await expect(service.remove(as("owner-1"), "owner-1")).rejects.toThrow(BadRequestError);
    expect(deleted).toEqual([]);
  });

  it("usuário de outra loja ou inexistente é 404", async () => {
    const { service, deleted } = setup([owner, rec<User>({ id: "x", storeId: "store-2", role: "STAFF" })]);
    await expect(service.remove(as("owner-1"), "x")).rejects.toThrow(NotFoundError);
    await expect(service.remove(as("owner-1"), "nada")).rejects.toThrow("Pessoa da equipe não encontrada.");
    expect(deleted).toEqual([]);
  });

  it("não remove o último dono (409)", async () => {
    const { service, deleted } = setup([owner, rec<User>({ ...owner, id: "owner-x" })].slice(0, 1));
    // só um dono na loja; quem executa é outro papel/usuário qualquer
    await expect(service.remove(as("staff-1"), "owner-1")).rejects.toThrow("A loja precisa ter pelo menos um dono.");
    expect(deleted).toEqual([]);
  });

  it("com dois donos, um pode ser removido e a ação é auditada com o e-mail", async () => {
    const { service, deleted, audit } = setup([owner, owner2]);
    await service.remove(as("owner-1"), "owner-2");
    expect(deleted).toEqual(["owner-2"]);
    expect(audit.entries[0]).toMatchObject({ action: "user.delete", targetId: "owner-2", metadata: { email: "dono2@x.com" } });
  });

  it("remove funcionário normalmente", async () => {
    const { service, deleted } = setup([owner, staff]);
    await service.remove(as("owner-1"), "staff-1");
    expect(deleted).toEqual(["staff-1"]);
  });
});

describe("UsersService — troca de senha", () => {
  it("senha atual errada é 401 e a senha não muda", async () => {
    const { service, passwordUpdates } = setup([owner]);
    await expect(service.changePassword("owner-1", { currentPassword: "errada", newPassword: "nova-senha1" })).rejects.toThrow(
      UnauthorizedError,
    );
    expect(passwordUpdates).toEqual([]);
  });

  it("usuário inexistente também é 401 (não revela se existe)", async () => {
    const { service } = setup([]);
    await expect(service.changePassword("fantasma", { currentPassword: "x", newPassword: "nova-senha1" })).rejects.toThrow(
      "senha atual incorreta",
    );
  });

  it("senha atual certa grava o hash da nova", async () => {
    const { service, passwordUpdates } = setup([owner]);
    await service.changePassword("owner-1", { currentPassword: "senha-atual", newPassword: "nova-senha1" });
    expect(passwordUpdates).toEqual([{ id: "owner-1", hash: "hash(nova-senha1)" }]);
  });
});
