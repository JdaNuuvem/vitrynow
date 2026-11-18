import type { CreateDeviceTokenInput } from "@meucardapio/shared-types";
import type { Actor, AuditLogger } from "../../shared/audit";
import { NotFoundError } from "../../shared/errors";
import { hashToken, tokenPreview } from "../../lib/tokenHash";
import type { DeviceTokensRepository } from "./deviceTokens.repository";

const ONLINE_AFTER_MINUTES = 3;

export type DeviceTokensClock = {
  now(): Date;
  generateToken(): string;
};

// Chamado depois de revogar: fecha os WebSockets abertos daquela chave (NG-06).
export type DeviceRevokedHook = (deviceTokenId: string) => void;

// "Chaves de impressora" do print-client. Relógio e gerador de token vêm de fora pra que o
// teste não dependa de hora real nem de aleatoriedade.
export class DeviceTokensService {
  constructor(
    private readonly repo: DeviceTokensRepository,
    private readonly audit: AuditLogger,
    private readonly clock: DeviceTokensClock,
    private readonly onRevoked: DeviceRevokedHook = () => {},
  ) {}

  // "online" = viu o heartbeat do print-client nos últimos 3 minutos.
  async list(storeId: string) {
    const tokens = await this.repo.list(storeId);
    const cutoff = new Date(this.clock.now().getTime() - ONLINE_AFTER_MINUTES * 60 * 1000);
    return tokens.map((token) => ({ ...token, online: !!token.lastSeenAt && token.lastSeenAt > cutoff }));
  }

  async create(actor: Actor, input: CreateDeviceTokenInput) {
    // O valor em texto só existe aqui e na resposta desta chamada: nunca é gravado nem listado.
    const plain = this.clock.generateToken();
    const record = await this.repo.create({
      storeId: actor.storeId,
      tokenHash: hashToken(plain),
      tokenPreview: tokenPreview(plain),
      label: input.label,
    });
    this.audit.log({ ...actor, action: "device_token.create", targetType: "DeviceToken", targetId: record.id });
    return { ...record, token: plain };
  }

  async revoke(actor: Actor, id: string) {
    const token = await this.repo.find(actor.storeId, id);
    if (!token) throw new NotFoundError("token não encontrado");
    await this.repo.revoke(id, this.clock.now());
    this.onRevoked(id);
    this.audit.log({ ...actor, action: "device_token.revoke", targetType: "DeviceToken", targetId: id });
  }
}
