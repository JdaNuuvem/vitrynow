import type { CreateDeviceTokenInput } from "@meucardapio/shared-types";
import type { Actor, AuditLogger } from "../../shared/audit";
import { NotFoundError } from "../../shared/errors";
import type { DeviceTokensRepository } from "./deviceTokens.repository";

const ONLINE_AFTER_MINUTES = 3;

export type DeviceTokensClock = {
  now(): Date;
  generateToken(): string;
};

// "Chaves de impressora" do print-client. Relógio e gerador de token vêm de fora pra que o
// teste não dependa de hora real nem de aleatoriedade.
export class DeviceTokensService {
  constructor(
    private readonly repo: DeviceTokensRepository,
    private readonly audit: AuditLogger,
    private readonly clock: DeviceTokensClock,
  ) {}

  // "online" = viu o heartbeat do print-client nos últimos 3 minutos.
  async list(storeId: string) {
    const tokens = await this.repo.list(storeId);
    const cutoff = new Date(this.clock.now().getTime() - ONLINE_AFTER_MINUTES * 60 * 1000);
    return tokens.map((token) => ({ ...token, online: !!token.lastSeenAt && token.lastSeenAt > cutoff }));
  }

  async create(actor: Actor, input: CreateDeviceTokenInput) {
    const token = await this.repo.create({ storeId: actor.storeId, token: this.clock.generateToken(), label: input.label });
    this.audit.log({ ...actor, action: "device_token.create", targetType: "DeviceToken", targetId: token.id });
    return token;
  }

  async revoke(actor: Actor, id: string) {
    const token = await this.repo.find(actor.storeId, id);
    if (!token) throw new NotFoundError("token não encontrado");
    await this.repo.revoke(id, this.clock.now());
    this.audit.log({ ...actor, action: "device_token.revoke", targetType: "DeviceToken", targetId: id });
  }
}
