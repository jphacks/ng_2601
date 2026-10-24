import type { ApiClient } from "./client";
import { ApiError } from "./errors";
import { assertMapData } from "./mapDataValidation";
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
    opts: {
      timeoutMs?: number;
      toError?: (status: number, parsed: unknown) => ApiErrorBody;
      /** 呼び出し側が中断できる信号。中断は AbortError として投げ、通信エラー扱いにしない。 */
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const controller = new AbortController();
    // タイムアウトは本文の読み取りが終わるまで有効にする（ヘッダー受信後に本文が止まる場合も打ち切る）。
    const timer = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined;
    const onCallerAbort = () => controller.abort();
    if (opts.signal?.aborted) controller.abort();
    else opts.signal?.addEventListener("abort", onCallerAbort);
    // 中断の理由が呼び出し側ならAbortError、そうでなければタイムアウト。
    const timeoutError = () =>
      opts.signal?.aborted
        ? new DOMException("aborted", "AbortError")
        : new ApiError(0, { code: "timeout", message: "ルート探索に時間がかかっています。時間をおいて再試行してください。" });
    try {
      let res: Response;
      try {
        res = await fetch(baseUrl + path, {
          method,
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        if (controller.signal.aborted) throw timeoutError();
        throw new ApiError(0, {
          code: "network_error",
          message: e instanceof Error ? e.message : "network error",
        });
      }
      if (!res.ok) {
        const parsed: unknown = await res.json().catch(() => null);
        if (controller.signal.aborted) throw timeoutError();
        if (opts.toError) throw new ApiError(res.status, opts.toError(res.status, parsed));
        const fallback: ApiErrorBody = { code: "http_error", message: res.statusText };
        throw new ApiError(res.status, isApiErrorBody(parsed) ? parsed : fallback);
      }
      try {
        return (await res.json()) as T;
      } catch (e) {
        if (controller.signal.aborted) throw timeoutError();
        throw e;
      }
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onCallerAbort);
    }
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
    getMapData: ([minLon, minLat, maxLon, maxLat], { limit, signal } = {}) =>
      request<unknown>(
        "GET",
        `/v1/map-data${qs({
          min_lon: String(minLon),
          min_lat: String(minLat),
          max_lon: String(maxLon),
          max_lat: String(maxLat),
          limit: limit === undefined ? undefined : String(limit),
        })}`,
        undefined,
        { signal },
      ).then(assertMapData),
    getRoute: (id) => request("GET", `/routes/${encodeURIComponent(id)}`),
    listHazards: (routeId) => request("GET", `/hazards${qs({ routeId })}`),
    listReviews: (params = {}) => request("GET", `/reviews${qs(params)}`),
    getPreferences: () => request("GET", "/preferences"),
    updatePreferences: (p) => request("PUT", "/preferences", p),
  };
}
