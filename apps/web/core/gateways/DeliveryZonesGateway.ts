import type { HttpResult } from "../http/HttpClient";

export type ZoneFields = {
  name: string;
  feeCents: number;
  etaMinMinutes: number | null;
  etaMaxMinutes: number | null;
  freeFromCents: number | null;
  active: boolean;
};
export type DeliveryZone = ZoneFields & { id: string };
export type ZoneConfig = { outsideMode: "REFUSE" | "DEFAULT_FEE"; freeShippingFromCents: number | null; defaultFeeCents: number };
export type ZoneList = { zones: DeliveryZone[]; config: ZoneConfig };
export type ZoneImport = {
  dryRun: boolean;
  accepted: { line: number; name: string; feeCents: number }[];
  errors: { line: number; text: string; reason: string }[];
};

export interface DeliveryZonesGateway {
  list(): Promise<HttpResult<ZoneList>>;
  save(zone: ZoneFields, id?: string): Promise<HttpResult<{ zone: DeliveryZone }>>;
  remove(id: string): Promise<HttpResult<{ ok: boolean }>>;
  configure(config: Omit<ZoneConfig, "defaultFeeCents">): Promise<HttpResult<{ config: ZoneConfig }>>;
  importText(text: string, dryRun: boolean): Promise<HttpResult<ZoneImport>>;
}
