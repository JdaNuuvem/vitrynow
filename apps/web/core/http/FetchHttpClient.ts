import { apiFetch } from "@/lib/api";
import type { HttpClient, HttpResult, RequestOptions } from "./HttpClient";

const FALLBACK_ERROR = "Não foi possível concluir a ação. Tente de novo.";

// Corpo genérico de erro interno do Fastify ({ statusCode: 5xx, error: "Internal Server Error", message }), que a API passa a mandar em
// TODO 5xx sem texto próprio (SEC-31b). O `error` dele é a frase HTTP em inglês: o usuário não deve vê-la, nem o `message`.
function isGenericServerError(payload: unknown): boolean {
  const body = payload as { statusCode?: unknown; error?: unknown } | null;
  return typeof body?.statusCode === "number" && body.statusCode >= 500 && body.error === "Internal Server Error";
}

// A API devolve `error` como texto ou, nas validações do Zod, como `flatten()`:
// { formErrors: string[], fieldErrors: Record<campo, string[]> }.
export function extractErrorMessage(payload: unknown): string {
  if (isGenericServerError(payload)) return FALLBACK_ERROR;
  const error =(payload as { error?: unknown } | null)?.error;
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
  return { ok: false, status: response.status, error: extractErrorMessage(payload), code, ...(payload?.details != null ? { details: payload.details } : {}) };
}

export class FetchHttpClient implements HttpClient {
  async get<T>(path: string, options?: RequestOptions): Promise<HttpResult<T>> {
    return toResult<T>(await apiFetch(path, options?.headers ? { headers: options.headers } : undefined));
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<HttpResult<T>> {
    const payload = body instanceof FormData ? body : JSON.stringify(body);
    return toResult<T>(
      await apiFetch(path, { method: "POST", body: payload, headers: options?.headers }),
    );
  }

  async put<T>(path: string, body: unknown, options?: RequestOptions): Promise<HttpResult<T>> {
    const payload = body instanceof FormData ? body : JSON.stringify(body);
    return toResult<T>(await apiFetch(path, { method: "PUT", body: payload, headers: options?.headers }));
  }

  async patch<T>(path: string, body: unknown, options?: RequestOptions): Promise<HttpResult<T>> {
    return toResult<T>(await apiFetch(path, { method: "PATCH", body: JSON.stringify(body), headers: options?.headers }));
  }
}
