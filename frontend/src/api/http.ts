import type { ApiClient } from "./client";
import { ApiError } from "./errors";
import type { ApiErrorBody } from "../types/api";

// エンドポイントは暫定。バックエンド確定後に合わせる。
export function createHttpClient(baseUrl: string): ApiClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(baseUrl + path, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError(0, {
        code: "network_error",
        message: e instanceof Error ? e.message : "network error",
      });
    }
    if (!res.ok) {
      const err: ApiErrorBody = await res
        .json()
        .catch(() => ({ code: "http_error", message: res.statusText }));
      throw new ApiError(res.status, err);
    }
    return (await res.json()) as T;
  }

  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return {
    searchRoutes: (req) => request("POST", "/routes/search", req),
    getRoute: (id) => request("GET", `/routes/${encodeURIComponent(id)}`),
    listHazards: (routeId) => request("GET", `/hazards${qs({ routeId })}`),
    listReviews: (params = {}) => request("GET", `/reviews${qs(params)}`),
    getPreferences: () => request("GET", "/preferences"),
    updatePreferences: (p) => request("PUT", "/preferences", p),
  };
}
