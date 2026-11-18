import type { StoreStatusAction } from "@meucardapio/shared-types";
import type { Actor, AuditLogger } from "../../shared/audit";
import { DomainError } from "../../shared/errors";
import {
  closeTodayUntil,
  computeStoreStatus,
  parseStoredSchedule,
  pruneExceptions,
  validateSchedule,
  type Schedule,
  type StoreStatus,
} from "./storeHours.domain";

export type StoreHoursRow = {
  id: string;
  timezone: string;
  acceptingOrders: boolean;
  schedule: unknown;
  pausedUntil: Date | null;
  closedUntil: Date | null;
};

export interface StoreHoursRepository {
  find(storeId: string): Promise<StoreHoursRow | null>;
  findBySlug(slug: string): Promise<StoreHoursRow | null>;
  saveSchedule(storeId: string, schedule: Schedule | null): Promise<void>;
  saveOverrides(storeId: string, data: { pausedUntil: Date | null; closedUntil: Date | null }): Promise<void>;
}

export type Clock = { now(): Date };

export class InvalidScheduleError extends DomainError {
  constructor(public readonly problems: string[]) {
    super(400, problems[0] ?? "Horário inválido.", "SCHEDULE_INVALID", { problems });
  }
}

export type StoreHoursView = {
  configured: boolean;
  schedule: Schedule | null;
  timezone: string;
  pausedUntil: string | null;
  closedUntil: string | null;
  status: StoreStatus;
};

// Horário de funcionamento (B5): configura a grade e os controles do dia a dia, e responde "a loja
// recebe pedido agora?" para o cardápio público e o painel (RN-B5-02: uma só fonte, no servidor).
export class StoreHoursService {
  constructor(
    private readonly repo: StoreHoursRepository,
    private readonly audit: AuditLogger,
    private readonly clock: Clock,
  ) {}

  private statusOf(row: StoreHoursRow): StoreStatus {
    return computeStoreStatus({
      schedule: parseStoredSchedule(row.schedule),
      timezone: row.timezone,
      now: this.clock.now(),
      acceptingOrders: row.acceptingOrders,
      pausedUntil: row.pausedUntil,
      closedUntil: row.closedUntil,
    });
  }

  private view(row: StoreHoursRow): StoreHoursView {
    const schedule = parseStoredSchedule(row.schedule);
    return {
      configured: schedule !== null,
      schedule,
      timezone: row.timezone,
      pausedUntil: row.pausedUntil?.toISOString() ?? null,
      closedUntil: row.closedUntil?.toISOString() ?? null,
      status: this.statusOf(row),
    };
  }

  private async load(storeId: string) {
    const row = await this.repo.find(storeId);
    if (!row) throw new DomainError(404, "loja não encontrada", "STORE_NOT_FOUND");
    return row;
  }

  async get(storeId: string): Promise<StoreHoursView> {
    return this.view(await this.load(storeId));
  }

  /** Estado público pelo slug (cardápio); `null` se a loja não existe. */
  async publicStatus(slug: string): Promise<{ storeId: string; status: StoreStatus } | null> {
    const row = await this.repo.findBySlug(slug);
    return row ? { storeId: row.id, status: this.statusOf(row) } : null;
  }

  async saveSchedule(actor: Actor, input: Schedule | null): Promise<StoreHoursView> {
    const row = await this.load(actor.storeId);
    let schedule: Schedule | null = null;
    if (input) {
      const problems = validateSchedule(input);
      if (problems.length > 0) throw new InvalidScheduleError(problems);
      schedule = pruneExceptions(input, this.clock.now(), row.timezone);
    }
    await this.repo.saveSchedule(actor.storeId, schedule);
    // RN-B5-12: quem, antes e depois
    this.audit.log({
      ...actor,
      action: "store.hours_update",
      targetType: "Store",
      targetId: actor.storeId,
      metadata: { before: parseStoredSchedule(row.schedule), after: schedule },
    });
    return this.view({ ...row, schedule });
  }

  async setStatus(actor: Actor, action: StoreStatusAction): Promise<StoreHoursView> {
    const row = await this.load(actor.storeId);
    const now = this.clock.now();
    let overrides = { pausedUntil: null as Date | null, closedUntil: null as Date | null };
    if (action.action === "PAUSE") overrides.pausedUntil = new Date(now.getTime() + action.minutes * 60_000);
    else if (action.action === "CLOSE_TODAY") overrides.closedUntil = closeTodayUntil(parseStoredSchedule(row.schedule), row.timezone, now);
    await this.repo.saveOverrides(actor.storeId, overrides);
    this.audit.log({
      ...actor,
      action: `store.status_${action.action.toLowerCase()}`,
      targetType: "Store",
      targetId: actor.storeId,
      metadata: { pausedUntil: overrides.pausedUntil?.toISOString() ?? null, closedUntil: overrides.closedUntil?.toISOString() ?? null },
    });
    return this.view({ ...row, ...overrides });
  }
}
