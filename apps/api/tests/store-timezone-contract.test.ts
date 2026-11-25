import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { OPEN_ORDER_STATUSES, QUEUED_ORDER_STATUSES, STORE_TIMEZONES, isStoreTimezone, updateStoreSettingsSchema } from "@meucardapio/shared-types";
import { makeApp, registerStore, resetDb } from "./helpers";

// SSOT D1 (herdado do PR #165) e D3 (herdado do PR #158), refeitos em cima do main de 25/11.
describe("status do pedido: listas derivadas da fonte única", () => {
  it("em andamento = todo status não final; fila da cozinha ⊂ em andamento", () => {
    expect([...OPEN_ORDER_STATUSES]).toEqual(["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA"]);
    for (const s of QUEUED_ORDER_STATUSES) expect(OPEN_ORDER_STATUSES).toContain(s);
  });
});

describe("fuso da loja: lista fechada", () => {
  it("só os fusos do Brasil; texto qualquer é recusado pelo schema", () => {
    expect(STORE_TIMEZONES).toContain("America/Sao_Paulo");
    expect(isStoreTimezone("America/Manaus")).toBe(true);
    for (const bad of ["Europe/Lisbon", "UTC", "America/Sao_Paulo ", "x".repeat(64), 3]) {
      expect(isStoreTimezone(bad)).toBe(false);
    }
    expect(updateStoreSettingsSchema.safeParse({ timezone: "Europe/Lisbon" }).success).toBe(false);
    for (const tz of STORE_TIMEZONES) expect(() => new Intl.DateTimeFormat("pt-BR", { timeZone: tz })).not.toThrow();
  });
});

describe("POST /api/store/settings com fuso", () => {
  let app: ReturnType<typeof makeApp>;
  // Mesmo padrão dos outros arquivos: limpa DEPOIS (o próximo arquivo reaproveita os e-mails de teste do helper).
  beforeEach(async () => { app = makeApp(); await app.ready(); });
  afterEach(async () => { await app.close(); await resetDb(); });

  it("fora da lista: 400 TIMEZONE_INVALID e nada muda; da lista: grava e audita antes/depois", async () => {
    const owner = await registerStore(app);
    const storeId = (owner.response.json() as { store: { id: string } }).store.id;
    const headers = { cookie: owner.cookie! };
    const bad = await app.inject({ method: "POST", url: "/api/store/settings", headers, payload: { timezone: "Europe/Lisbon" } });
    expect([bad.statusCode, bad.json().code]).toEqual([400, "TIMEZONE_INVALID"]);
    const before = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { timezone: true } });

    const ok = await app.inject({ method: "POST", url: "/api/store/settings", headers, payload: { timezone: "America/Manaus" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().store.timezone).toBe("America/Manaus");

    const audit = await prisma.auditLog.findFirst({ where: { storeId, action: "store.settings_update" }, orderBy: { createdAt: "desc" } });
    expect((audit?.metadata as { timezone?: unknown })?.timezone).toEqual({ from: before.timezone, to: "America/Manaus" });
  });
});
