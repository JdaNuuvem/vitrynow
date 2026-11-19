import { FetchHttpClient } from "@/core/http/FetchHttpClient";

export type PlatformRole = "ADMIN" | "SUPPORT";
export type PlatformSession = { email: string; role: PlatformRole };
export type PlatformChallenge = { challengeId: string; maskedEmail: string };
export type PlatformPage<T> = { page: number; pageSize: number; total: number } & T;
export type Availability = "" | "available" | "suspended";

export type PlatformSubscription = {
  state: "trial" | "active" | "canceled" | "past_due" | "expired";
  phase: "TRIAL" | "ACTIVE" | "READ_ONLY" | "SUSPENDED";
  planCode: string | null;
  planName: string | null;
  trialEndsAt: string;
  currentPeriodEnd: string | null;
};

export type PlatformStore = {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string | null;
  createdAt: string;
  suspended: boolean;
};

export type PlatformStoreSummary = PlatformStore & {
  subscription: PlatformSubscription | null;
  paymentConnected: boolean;
  printerOnline: boolean;
  lastOrderAt: string | null;
};

export type PlatformStoreDetails = {
  store: PlatformStore & { code: string; acceptingOrders: boolean; suspendedAt: string | null; suspendedReason: string | null; paymentStatus: string };
  subscription: (PlatformSubscription & { status: string }) | null;
  subscriptionPayments: { id: string; planCode: string; status: string; amountCents: number; createdAt: string }[];
  creditBalance: number;
};

export type NoticeInput = { title: string; body: string; imageUrl?: string; expiresAt?: string };
export type PlatformNotice = {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  publishedAt: string;
  expiresAt: string | null;
};

export type CreditReason = "PURCHASE" | "GRANT" | "ADJUST";
export type CreditInput = {
  reason: CreditReason;
  credits: number;
  note: string;
  externalRef?: string;
  priceCents?: number;
  expiresAt?: string;
};
export type CreditEntry = {
  id: string;
  delta: number;
  reason: string;
  note: string | null;
  externalRef: string | null;
  priceCents: number | null;
  expiresAt: string | null;
  createdAt: string;
};
export type CreditLedger = { balance: number; entries: CreditEntry[] };
export type StoreAction = "suspend" | "reactivate" | "extend-trial";

const http = new FetchHttpClient();
const api = "/api/platform";
const storePath = (id: string) => `${api}/stores/${encodeURIComponent(id)}`;

export const platformApi = {
  me: () => http.get<PlatformSession>(`${api}/me`),
  login: (email: string, password: string) => http.post<PlatformChallenge>(`${api}/auth/login`, { email, password }),
  verifyLogin: (challengeId: string, code: string) => http.post<{ role: PlatformRole }>(`${api}/auth/verify`, { challengeId, code }),
  logout: () => http.post(`${api}/auth/logout`),
  stores: (query: string, availability: Availability, page: number) => {
    const parameters = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (query) parameters.set("q", query);
    if (availability) parameters.set("availability", availability);
    return http.get<PlatformPage<{ stores: PlatformStoreSummary[] }>>(`${api}/stores?${parameters}`);
  },
  store: (id: string) => http.get<PlatformStoreDetails>(storePath(id)),
  changeStore: (id: string, action: StoreAction, reason: string, days?: number) =>
    http.post(`${storePath(id)}/${action}`, action === "extend-trial" ? { reason, days } : { reason }),
  notices: (page: number) => http.get<PlatformPage<{ notices: PlatformNotice[] }>>(`${api}/notices?page=${page}&pageSize=20`),
  publishNotice: (notice: NoticeInput) => http.post<{ notice: PlatformNotice }>(`${api}/notices`, notice),
  deleteNotice: (id: string) => http.post(`${api}/notices/${encodeURIComponent(id)}/delete`),
  credits: (id: string) => http.get<CreditLedger>(`${storePath(id)}/credits`),
  creditChallenge: () => http.post<PlatformChallenge>(`${api}/mfa/challenge`, { purpose: "platform_credit_grant" }),
  verifyCreditChallenge: (challengeId: string, code: string) => http.post(`${api}/mfa/verify`, { challengeId, code }),
  grantCredits: (id: string, entry: CreditInput, idempotencyKey: string, password: string, challengeId: string) =>
    http.post<{ entry: CreditEntry; balance: number; idempotent?: boolean }>(`${storePath(id)}/credits`, { ...entry, idempotencyKey, password },
      { headers: { "x-mfa-challenge": challengeId } }),
};
