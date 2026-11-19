import type { HttpClient } from "../../http/HttpClient";
import type { DeviceAlerts, PrintConfiguration, PrintJob, PrintMode, PrintModeChange, PrintQueueGateway } from "../PrintQueueGateway";

const base = "/api/print-jobs";
const configurationPath = "/api/store/print-mode";

export class HttpPrintQueueGateway implements PrintQueueGateway {
  constructor(private readonly http: HttpClient) {}
  list() { return this.http.get<{ jobs: PrintJob[] }>(base); }
  summary() { return this.http.get<{ stale: number }>(base + "/summary"); }
  test() { return this.http.post<{ job: PrintJob }>(base + "/test"); }
  printNow(id: string) { return this.http.post<{ job: PrintJob }>(`${base}/${encodeURIComponent(id)}/print-now`); }
  configuration() { return this.http.get<PrintConfiguration>(configurationPath); }
  setMode(mode: PrintMode) { return this.http.put<PrintModeChange>(configurationPath, { mode }); }
  alerts() { return this.http.get<DeviceAlerts>("/api/device-alerts"); }
}
