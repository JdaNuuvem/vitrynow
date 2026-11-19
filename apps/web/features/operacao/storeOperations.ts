import type { HttpResult } from "@/core/http/HttpClient";
import { extractErrorMessage } from "@/core/http/FetchHttpClient";
import { apiFetch } from "@/lib/api";

export async function operationRequest<T>(path: string, method = "GET", data?: unknown, headers?: Record<string, string>): Promise<HttpResult<T>> {
  const body = method === "POST" || data !== undefined ? JSON.stringify(data ?? {}) : undefined;
  const response = await apiFetch(path, { method, body, headers });
  const payload = await response.json().catch(() => null);
  if (response.ok) return { ok: true, data: payload as T };
  return { ok: false, status: response.status, error: extractErrorMessage(payload), code: payload?.code };
}
