import { describe, expect, it } from "vitest";
import type { DeviceToken } from "@meucardapio/db";
import type { DeviceTokensRepository } from "../../src/modules/deviceTokens/deviceTokens.repository";
import { DeviceTokensService } from "../../src/modules/deviceTokens/deviceTokens.service";
import { NotFoundError } from "../../src/shared/errors";
import { FakeAudit, actor, rec } from "./fakes";

const NOW = new Date("2026-11-16T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000);

function setup(tokens: DeviceToken[] = []) {
  const revoked: { id: string; at: Date }[] = [];
  const created: unknown[] = [];
  const repo = {
    list: async () => tokens,
    find: async (storeId: string, id: string) => tokens.find((t) => t.id === id && t.storeId === storeId) ?? null,
    create: async (data: { storeId: string; token: string; label?: string }) => (created.push(data), rec<DeviceToken>({ id: "t-new", ...data })),
    revoke: async (id: string, at: Date) => void revoked.push({ id, at }),
  } as unknown as DeviceTokensRepository;
  const audit = new FakeAudit();
  const service = new DeviceTokensService(repo, audit, { now: () => NOW, generateToken: () => "token-fixo" });
  return { service, audit, revoked, created };
}

describe("DeviceTokensService", () => {
  it("online = heartbeat nos últimos 3 minutos", async () => {
    const { service } = setup([
      rec<DeviceToken>({ id: "a", lastSeenAt: minutesAgo(2) }),
      rec<DeviceToken>({ id: "b", lastSeenAt: minutesAgo(5) }),
      rec<DeviceToken>({ id: "c", lastSeenAt: null }),
    ]);
    const result = await service.list("store-1");
    expect(result.map((t) => [t.id, t.online])).toEqual([["a", true], ["b", false], ["c", false]]);
  });

  it("cria usando o gerador injetado e audita", async () => {
    const { service, audit, created } = setup();
    const token = await service.create(actor, { label: "PC do balcão" });
    expect(created[0]).toEqual({ storeId: "store-1", token: "token-fixo", label: "PC do balcão" });
    expect(token.id).toBe("t-new");
    expect(audit.entries[0]).toMatchObject({ action: "device_token.create", targetId: "t-new" });
  });

  it("revoga com a hora do relógio injetado e audita", async () => {
    const { service, audit, revoked } = setup([rec<DeviceToken>({ id: "t-1", storeId: "store-1" })]);
    await service.revoke(actor, "t-1");
    expect(revoked).toEqual([{ id: "t-1", at: NOW }]);
    expect(audit.entries[0]).toMatchObject({ action: "device_token.revoke", targetId: "t-1" });
  });

  it("revogar chave inexistente ou de outra loja é 404", async () => {
    const { service, revoked } = setup([rec<DeviceToken>({ id: "t-1", storeId: "store-2" })]);
    await expect(service.revoke(actor, "t-1")).rejects.toThrow(NotFoundError);
    expect(revoked).toEqual([]);
  });
});
