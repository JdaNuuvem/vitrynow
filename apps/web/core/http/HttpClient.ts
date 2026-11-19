export type HttpResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code?: string; details?: unknown };

export type RequestOptions = { headers?: Record<string, string> };

export interface HttpClient {
  get<T>(path: string, options?: RequestOptions): Promise<HttpResult<T>>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<HttpResult<T>>;
  put<T>(path: string, body: unknown, options?: RequestOptions): Promise<HttpResult<T>>;
}
