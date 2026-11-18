import { apiFetch } from "@/lib/api";
import type { HttpClient, HttpResult, RequestOptions } from "./HttpClient";

const FALLBACK_ERROR = "Não foi possível concluir a ação. Tente de novo.";

// A API devolve `error` como texto ou, nas validações do Zod, como `flatten()`:
// { formErrors: string[], fieldErrors: Record<campo, string[]> }.
export function extractErrorMessage(payload: unknown): string {
  const error = (payload as { error?: unknown } | null)?.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const { formErrors, fieldErrors } = error as { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> };
    const formMessage = formErrors?.[0];
    if (formMessage) return formMessage;
    const [field, messages] = Object.entries(fieldErrors ?? {}).find(([, list]) => list && list.length > 0) ?? [];
    if (field && messages) return `${field}: ${messages[0]}`;
  }
  return FALLBACK_ERROR;
}

async function toResult<T>(response: Response): Promise<HttpResult<T>> {
  const payload = await response.json().catch(() => null);
  if (response.ok) return { ok: true, data: payload as T };
  const code = typeof payload?.code === "string" ? payload.code : undefined;
  return { ok: false, status: response.status, error: extractErrorMessage(payload), code };
}

export class FetchHttpClient implements HttpClient {
  async get<T>(path: string, options?: RequestOptions): Promise<HttpResult<T>> {
    return toResult<T>(await apiFetch(path, options?.headers ? { headers: options.headers } : undefined));
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<HttpResult<T>> {
    return toResult<T>(
      await apiFetch(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: options?.headers }),
    );
  }
}
