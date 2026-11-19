import type { HttpClient } from "../../http/HttpClient";
import type { DeliveryZone, DeliveryZonesGateway, ZoneConfig, ZoneFields, ZoneImport, ZoneList } from "../DeliveryZonesGateway";

const base = "/api/delivery-zones";

export class HttpDeliveryZonesGateway implements DeliveryZonesGateway {
  constructor(private readonly http: HttpClient) {}
  list() { return this.http.get<ZoneList>(base); }
  save(zone: ZoneFields, id?: string) {
    return this.http.post<{ zone: DeliveryZone }>(id ? `${base}/${encodeURIComponent(id)}` : base, zone);
  }
  remove(id: string) { return this.http.post<{ ok: boolean }>(`${base}/${encodeURIComponent(id)}/delete`); }
  configure(config: Omit<ZoneConfig, "defaultFeeCents">) { return this.http.post<{ config: ZoneConfig }>(base + "/config", config); }
  importText(text: string, dryRun: boolean) { return this.http.post<ZoneImport>(base + "/import", { text, dryRun }); }
}
