import type { ApiClient } from "./client";
import { ApiError } from "./errors";
import { fromBackendResponse, toBackendRequest } from "./routeAdapter";
import type { ApiErrorBody } from "../types/api";

function isApiErrorBody(v: unknown): v is ApiErrorBody {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.code === "string" && typeof o.message === "string";
}

/** 経路探索は BE 側のタイムアウト(30秒)より少し長く待つ。 */
const ROUTE_TIMEOUT_MS = 40_000;

/** `POST /v1/routes` のエラー（FastAPIの`{detail}`）をFEのエラー形式へ。BEの英語detailは`details`に残す。 */
function routeError(status: number, parsed: unknown): ApiErrorBody {
  const details = typeof parsed === "object" && parsed !== null ? (parsed as { detail?: unknown }).detail : undefined;
  if (status === 409) return { code: "no_route", message: "条件に合うルートが見つかりませんでした。", details };
  if (status === 422) return { code: "invalid_request", message: "検索条件が受け付けられませんでした。", details };
  if (status === 502 || status === 503) {
    return { code: "routing_unavailable", message: "ルート探索サービスを利用できません。時間をおいて再試行してください。", details };
  }
  return { code: "http_error", message: `ルート検索に失敗しました（HTTP ${status}）。`, details };
}

// エンドポイントは暫定。経路検索以外はバックエンド確定後に合わせる。
export function createHttpClient(baseUrl: string): ApiClient {
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { timeoutMs?: number; toError?: (status: number, parsed: unknown) => ApiErrorBody } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined;
    let res: Response;
    try {
      res = await fetch(baseUrl + path, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) {
        throw new ApiError(0, { code: "timeout", message: "ルート探索に時間がかかっています。時間をおいて再試行してください。" });
      }
      throw new ApiError(0, {
        code: "network_error",
        message: e instanceof Error ? e.message : "network error",
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const parsed: unknown = await res.json().catch(() => null);
      if (opts.toError) throw new ApiError(res.status, opts.toError(res.status, parsed));
      const fallback: ApiErrorBody = { code: "http_error", message: res.statusText };
      throw new ApiError(res.status, isApiErrorBody(parsed) ? parsed : fallback);
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
    async searchRoute(req) {
      const body = await request<unknown>("POST", "/v1/routes", toBackendRequest(req), {
        timeoutMs: ROUTE_TIMEOUT_MS,
        toError: routeError,
      });
      return fromBackendResponse(body);
    },
    getRoute: (id) => request("GET", `/routes/${encodeURIComponent(id)}`),
    listHazards: (routeId) => request("GET", `/hazards${qs({ routeId })}`),
    listReviews: (params = {}) => request("GET", `/reviews${qs(params)}`),
    getPreferences: () => request("GET", "/preferences"),
    updatePreferences: (p) => request("PUT", "/preferences", p),
  };
}
