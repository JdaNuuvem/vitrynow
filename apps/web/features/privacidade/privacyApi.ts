import type { RequestOptions } from "@/core/http/HttpClient";
import { FetchHttpClient } from "@/core/http/FetchHttpClient";

export type PrivacyReauth = "MFA" | "PASSWORD";
export type PrivacyTarget = { phone: string } | { orderCode: string };
export type PrivacyReason = "HOLDER_REQUEST" | "STORE_DECISION" | "ACCOUNT_CLOSURE";
export type PrivacyPreview = {
  orders: number;
  period: { from: string; to: string } | null;
  phoneMasked: string | null;
  phoneMatch: "EXACT_NUMBER" | null;
  otherOrdersSamePhone: number;
  blocked: boolean;
  blockers: { code: string; status: string; reason: "OPEN" | "REFUND_PENDING" }[];
  nothingToRemove: boolean;
  reauth: PrivacyReauth;
};

type ExportedCustomer = { format: "privacy-export-v1"; exportedAt: string; storeId: string; orders: unknown[] };
type AnonymizeResult = { anonymized: number; nothingToRemove: boolean };
const http = new FetchHttpClient();

export const privacyApi = {
  status: () => http.get<{ reauth: PrivacyReauth }>("/api/privacy/status"),
  preview: (target: PrivacyTarget) => http.post<PrivacyPreview>("/api/privacy/anonymize/preview", target),
  export: (target: PrivacyTarget, currentPassword?: string, options?: RequestOptions) =>
    http.post<ExportedCustomer>("/api/privacy/export", { ...target, currentPassword }, options),
  anonymize: (target: PrivacyTarget, expectedOrders: number, reason: PrivacyReason, currentPassword?: string, options?: RequestOptions) =>
    http.post<AnonymizeResult>("/api/privacy/anonymize", { ...target, expectedOrders, reason, currentPassword }, options),
};
