import type { HttpResult } from "../http/HttpClient";

export type PrintJob = {
  id: string; kind: "ORDER_KITCHEN" | "ORDER_REPRINT" | "ORDER_CANCEL_NOTICE" | "TEST";
  status: "PENDING" | "CLAIMED" | "PRINTED" | "FAILED" | "CANCELED" | "STALE";
  orderId: string | null; attempts: number; maxAttempts: number; createdAt: string;
  failure: { message: string; code: string } | null;
};

export type PrintMode = "LEGACY" | "QUEUE";
export type PrintConfiguration = {
  mode: PrintMode;
  conference: {
    pendingJobOfPrintedOrder: number;
    printableOrderWithoutJob: number;
    printedJobOfUnprintedOrder: number;
  };
};
export type PrintModeChange = PrintConfiguration & {
  changed: boolean;
  reconciled: { closedPendingJobs: number; createdJobs: number; markedOrdersPrinted: number };
};
export type DeviceAlertCode = "NOTHING_TO_CHARGE_CONFLICT" | "NOTHING_TO_CHARGE_INVALID" | "EMPTY_ZERO_TICKET"
  | "MODE_UNCONFIRMED" | "MODE_RECOVERED" | "QUEUE_WITHOUT_PRINTER";
export type DeviceAlerts = {
  alerts: {
    id: string;
    code: DeviceAlertCode;
    orderCode: string | null;
    clientVersion: string | null;
    count: number;
    firstAt: string;
    lastAt: string;
  }[];
  banner: { needsAttention: { queueWithoutPrinter: boolean; modeUnconfirmed: boolean; moneyAlert: boolean } };
};

export interface PrintQueueGateway {
  list(): Promise<HttpResult<{ jobs: PrintJob[] }>>;
  summary(): Promise<HttpResult<{ stale: number }>>;
  printNow(id: string): Promise<HttpResult<{ job: PrintJob }>>;
  test(): Promise<HttpResult<{ job: PrintJob }>>;
  configuration(): Promise<HttpResult<PrintConfiguration>>;
  setMode(mode: PrintMode): Promise<HttpResult<PrintModeChange>>;
  alerts(): Promise<HttpResult<DeviceAlerts>>;
}
