import { BUSY_MAX_MINUTES, type BusyRequest, type StoreStatusAction } from "@meucardapio/shared-types";
import type { Actor, AuditLogger } from "../../shared/audit";
import { DomainError } from "../../shared/errors";
import {
  closeTodayUntil,
  computeStoreStatus,
  hoursText,
  isOpenAt,
  nextOpening,
  parseStoredSchedule,
  pruneExceptions,
  validateSchedule,
  type Schedule,
  type StoreStatus,
} from "./storeHours.domain";
import { suggestSchedule, type HoursSuggestion } from "./storeHours.suggest";

export type StoreHoursRow = {
  id: string;
  timezone: string;
  acceptingOrders: boolean;
  schedule: unknown;
  openingHours: string | null; // texto LEGADO (só leitura): vale apenas enquanto a loja não tem grade
  pausedUntil: Date | null;
  closedUntil: Date | null;
  busyUntil: Date | null;
  busyExtraMinutes: number | null;
  busyStartedAt: Date | null;
  prepMinutesDelivery: number | null;
  prepMinutesPickup: number | null;
};

export type PrepMinutes = { delivery: number | null; pickup: number | null };

export interface StoreHoursRepository {
  find(storeId: string): Promise<StoreHoursRow | null>;
  findBySlug(slug: string): Promise<StoreHoursRow | null>;
  saveSchedule(storeId: string, schedule: Schedule | null): Promise<void>;
  saveOverrides(storeId: string, data: { pausedUntil: Date | null; closedUntil: Date | null }): Promise<void>;
  saveBusy(storeId: string, data: { busyUntil: Date | null; busyExtraMinutes: number | null; busyStartedAt: Date | null }): Promise<void>;
  savePrepTimes(storeId: string, data: { prepMinutesDelivery: number | null; prepMinutesPickup: number | null }): Promise<void>;
}

export type Clock = { now(): Date };

export class InvalidScheduleError extends DomainError {
  constructor(public readonly problems: string[]) {
    super(400, problems[0] ?? "Horário inválido.", "SCHEDULE_INVALID", { problems });
  }
}

/** Horário DERIVADO da grade (fonte única `Store.schedule`, SSOT D2). Sem grade: `openNow`/`nextOpensAt` nulos e `hoursText` = texto legado. */
export type DerivedHours = { openNow: boolean | null; nextOpensAt: string | null; hoursText: string | null };

export type StoreHoursView = DerivedHours & {
  configured: boolean;
  schedule: Schedule | null;
  timezone: string;
  pausedUntil: string | null;
  closedUntil: string | null;
  /** Modo ocupado ativo (g1); `null` quando não há ou já venceu. */
  busyUntil: string | null;
  busyExtraMinutes: number | null;
  status: StoreStatus;
  /** Tempo médio de preparo configurado (RN-PZ-01); `null` em cada modalidade sem previsão. */
  prepMinutes: PrepMinutes;
};

/** Para o cardápio público: só existe quando a loja configurou alguma modalidade (nunca um padrão inventado). */
export function publicPrepMinutes(row: Pick<StoreHoursRow, "prepMinutesDelivery" | "prepMinutesPickup">): PrepMinutes | null {
  if (row.prepMinutesDelivery === null && row.prepMinutesPickup === null) return null;
  return { delivery: row.prepMinutesDelivery, pickup: row.prepMinutesPickup };
}

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
      busyUntil: row.busyUntil,
    });
  }

  private busyActive(row: StoreHoursRow): boolean {
    return row.busyUntil !== null && row.busyUntil > this.clock.now();
  }

  /** `openNow` = a grade tem uma janela de aceitar pedido agora (o mesmo cálculo do status); `nextOpensAt` só quando fechado. */
  derive(row: StoreHoursRow): DerivedHours {
    const schedule = parseStoredSchedule(row.schedule);
    if (!schedule) return { openNow: null, nextOpensAt: null, hoursText: row.openingHours?.trim() ? row.openingHours : null };
    const now = this.clock.now();
    const open = isOpenAt(schedule, row.timezone, now);
    return { openNow: open, nextOpensAt: open ? null : (nextOpening(schedule, row.timezone, now)?.toISOString() ?? null), hoursText: hoursText(schedule) };
  }

  /** a2: sugere uma grade a partir do texto enviado ou, sem texto, do texto LEGADO da loja. NÃO grava: o dono confere e salva pelo `POST /api/store/hours`. */
  async suggest(storeId: string, text?: string): Promise<HoursSuggestion & { source: "REQUEST" | "LEGACY"; summary: string | null }> {
    const row = await this.load(storeId);
    const source = text !== undefined && text.trim() !== "" ? "REQUEST" : "LEGACY";
    const result = suggestSchedule(source === "REQUEST" ? (text as string) : (row.openingHours ?? ""));
    return { ...result, source, summary: result.schedule ? hoursText(result.schedule) : null };
  }

  /** Para as telas de configuração da loja (painel). */
  async derivedFor(storeId: string): Promise<DerivedHours> {
    return this.derive(await this.load(storeId));
  }

  private view(row: StoreHoursRow): StoreHoursView {
    const schedule = parseStoredSchedule(row.schedule);
    return {
      ...this.derive(row),
      configured: schedule !== null,
      schedule,
      timezone: row.timezone,
      pausedUntil: row.pausedUntil?.toISOString() ?? null,
      closedUntil: row.closedUntil?.toISOString() ?? null,
      busyUntil: this.busyActive(row) ? row.busyUntil!.toISOString() : null,
      busyExtraMinutes: this.busyActive(row) ? row.busyExtraMinutes : null,
      status: this.statusOf(row),
      prepMinutes: { delivery: row.prepMinutesDelivery, pickup: row.prepMinutesPickup },
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
  async publicStatus(slug: string): Promise<{ storeId: string; status: StoreStatus; prepMinutes: PrepMinutes | null; busyUntil: string | null; derived: DerivedHours } | null> {
    const row = await this.repo.findBySlug(slug);
    if (!row) return null;
    const prep = publicPrepMinutes(row);
    // g1 (RN-OCU-05): durante o modo ocupado o prazo mostrado soma o extra; fora dele, nada muda.
    const extra = this.busyActive(row) ? (row.busyExtraMinutes ?? 0) : 0;
    const prepMinutes = prep && extra > 0 ? { delivery: prep.delivery === null ? null : prep.delivery + extra, pickup: prep.pickup === null ? null : prep.pickup + extra } : prep;
    return { storeId: row.id, status: this.statusOf(row), prepMinutes, busyUntil: this.busyActive(row) ? row.busyUntil!.toISOString() : null, derived: this.derive(row) };
  }

  // "Minha loja → Atendimento" (RN-PZ-01): tempo médio de preparo por modalidade. Mudar não altera previsões já dadas (RN-PZ-07).
  async setPrepTimes(actor: Actor, input: { deliveryMinutes: number | null; pickupMinutes: number | null }): Promise<StoreHoursView> {
    const row = await this.load(actor.storeId);
    const next = { prepMinutesDelivery: input.deliveryMinutes, prepMinutesPickup: input.pickupMinutes };
    await this.repo.savePrepTimes(actor.storeId, next);
    this.audit.log({
      ...actor,
      action: "store.prep_times_update",
      targetType: "Store",
      targetId: actor.storeId,
      metadata: { before: { delivery: row.prepMinutesDelivery, pickup: row.prepMinutesPickup }, after: { delivery: next.prepMinutesDelivery, pickup: next.prepMinutesPickup } },
    });
    return this.view({ ...row, ...next });
  }

  // "Estou lotado" (g1): OWNER e STAFF ligam e desligam. O fim é só `busyUntil` vs relógio do servidor (RN-OCU-02).
  async startBusy(actor: Actor, input: BusyRequest): Promise<StoreHoursView> {
    const row = await this.load(actor.storeId);
    const now = this.clock.now();
    const active = this.busyActive(row);
    // Teto de 4 h CONTÍNUAS (RN-OCU-01): religar não zera; vencido o ocupado, o início recomeça.
    const startedAt = active ? (row.busyStartedAt ?? now) : now;
    const cap = new Date(startedAt.getTime() + BUSY_MAX_MINUTES * 60_000);
    let busyUntil = new Date(now.getTime() + input.minutes * 60_000);
    if (busyUntil > cap) {
      if (active && row.busyUntil! >= cap) throw new DomainError(409, "Limite de 4 horas seguidas atingido. Desligue o modo ocupado ou o recebimento de pedidos.", "BUSY_LIMIT_REACHED");
      busyUntil = cap;
    }
    const next = { busyUntil, busyExtraMinutes: input.extraMinutes ?? null, busyStartedAt: startedAt };
    await this.repo.saveBusy(actor.storeId, next);
    this.audit.log({
      ...actor,
      action: "store.busy_start",
      targetType: "Store",
      targetId: actor.storeId,
      metadata: { minutes: input.minutes, extraMinutes: input.extraMinutes ?? null, busyUntil: busyUntil.toISOString(), startedAt: startedAt.toISOString() },
    });
    return this.view({ ...row, ...next });
  }

  async endBusy(actor: Actor): Promise<StoreHoursView> {
    const row = await this.load(actor.storeId);
    const wasActive = this.busyActive(row);
    const next = { busyUntil: null, busyExtraMinutes: null, busyStartedAt: null };
    await this.repo.saveBusy(actor.storeId, next);
    if (wasActive) {
      this.audit.log({ ...actor, action: "store.busy_end", targetType: "Store", targetId: actor.storeId, metadata: { early: true } });
    }
    return this.view({ ...row, ...next });
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
