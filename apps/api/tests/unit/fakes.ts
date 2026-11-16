import type { AuditEntry, AuditLogger } from "../../src/shared/audit";
import type { StoreEvents } from "../../src/shared/storeEvents";

// Tipos de registro do Prisma têm vários campos; nos testes só importam os que a regra usa.
export function rec<T>(partial: Record<string, unknown>): T {
  return partial as T;
}

export class FakeAudit implements AuditLogger {
  entries: AuditEntry[] = [];
  log(entry: AuditEntry) {
    this.entries.push(entry);
  }
}

export class FakeStoreEvents implements StoreEvents {
  updated: { storeId: string; orderId: string }[] = [];
  orderUpdated(storeId: string, orderId: string) {
    this.updated.push({ storeId, orderId });
  }
}

export const actor = { storeId: "store-1", userId: "user-1" };
