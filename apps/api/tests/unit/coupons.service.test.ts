import { describe, expect, it } from "vitest";
import type { Coupon } from "@meucardapio/db";
import type { CouponsRepository } from "../../src/modules/coupons/coupons.repository";
import { CouponsService } from "../../src/modules/coupons/coupons.service";
import { ConflictError, NotFoundError } from "../../src/shared/errors";
import { FakeAudit, actor, rec } from "./fakes";

function setup(existing: Coupon[] = []) {
  const created: unknown[] = [];
  const updated: unknown[] = [];
  const deleted: string[] = [];
  const repo = {
    findByCode: async (storeId: string, code: string) => existing.find((c) => c.storeId === storeId && c.code === code) ?? null,
    find: async (storeId: string, id: string) => existing.find((c) => c.storeId === storeId && c.id === id) ?? null,
    create: async (_s: string, data: unknown) => (created.push(data), rec<Coupon>({})),
    update: async (_id: string, data: unknown) => (updated.push(data), rec<Coupon>({})),
    delete: async (id: string) => void deleted.push(id),
  } as unknown as CouponsRepository;
  const audit = new FakeAudit();
  return { service: new CouponsService(repo, audit), audit, created, updated, deleted };
}

const coupon = rec<Coupon>({ id: "c-1", storeId: "store-1", code: "PROMO10" });
const input = { code: "PROMO10", discountType: "PERCENT" as const, discountValue: 10 };

describe("CouponsService", () => {
  it("rejeita código duplicado na mesma loja (409)", async () => {
    const { service, created } = setup([coupon]);
    await expect(service.create("store-1", input)).rejects.toThrow(ConflictError);
    expect(created).toEqual([]);
  });

  it("mesmo código em outra loja é permitido", async () => {
    const { service, created } = setup([coupon]);
    await service.create("store-2", input);
    expect(created).toHaveLength(1);
  });

  it("converte expiresAt (texto ISO) em Date", async () => {
    const { service, created } = setup();
    await service.create("store-1", { ...input, expiresAt: "2030-01-01T00:00:00.000Z" });
    expect((created[0] as { expiresAt: Date }).expiresAt).toEqual(new Date("2030-01-01T00:00:00.000Z"));
  });

  it("atualizar ou excluir cupom inexistente é 404", async () => {
    const { service, deleted } = setup([coupon]);
    await expect(service.update("store-1", "nada", { active: false })).rejects.toThrow(NotFoundError);
    await expect(service.delete(actor, "nada")).rejects.toThrow("cupom não encontrado");
    expect(deleted).toEqual([]);
  });

  it("excluir audita com o código do cupom", async () => {
    const { service, audit, deleted } = setup([coupon]);
    await service.delete(actor, "c-1");
    expect(deleted).toEqual(["c-1"]);
    expect(audit.entries[0]).toMatchObject({ action: "coupon.delete", metadata: { code: "PROMO10" } });
  });
});
