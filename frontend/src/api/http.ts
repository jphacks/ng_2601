import type { ApiClient } from "./client";
import { ApiError } from "./errors";
import { assertMapData } from "./mapDataValidation";
import { fromBackendMe, fromBackendOptions, toBackendPreferences } from "./preferencesAdapter";
import { fromBackendResponse, toBackendRequest } from "./routeAdapter";
import { observationsToReviews, reviewFromCreated, toObservationRequest } from "./reviewAdapter";
import type { ApiErrorBody, BBox } from "../types/api";

const WORLD: BBox = [-180, -90, 180, 90];

function isApiErrorBody(v: unknown): v is ApiErrorBody {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.code === "string" && typeof o.message === "string";
}

/** 経路探索は BE 側のタイムアウト(30秒)より少し長く待つ。 */
const ROUTE_TIMEOUT_MS = 40_000;
const MAP_DATA_TIMEOUT_MS = 15_000;

/** 口コミ取得が止まったままにならないよう打ち切るまでの時間。 */
const REVIEWS_TIMEOUT_MS = 15_000;

/** 口コミ投稿は応答が返らないまま待ち続けないよう打ち切る。 */
const POST_TIMEOUT_MS = 15_000;

/** `POST /v1/observations` のエラー。BEの英語detailは`details`に残し、表示文はFEで決める。 */
function postError(status: number, parsed: unknown): ApiErrorBody {
  const details = typeof parsed === "object" && parsed !== null ? (parsed as { detail?: unknown }).detail : undefined;
  if (status === 401 || status === 403) return { code: "unauthorized", message: "口コミの投稿にはログインが必要です。", details };
  if (status === 422) return { code: "invalid_request", message: "入力内容が受け付けられませんでした。", details };
  if (status === 429) return { code: "rate_limited", message: "短時間に投稿できる件数を超えました。", details };
  return { code: "http_error", message: `口コミを投稿できませんでした（HTTP ${status}）。`, details };
}

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

/** 設定の取得・保存（`/v1/auth/me*`）のエラー。FastAPIの`{detail}`を`details`に残す。 */
function preferencesError(status: number, parsed: unknown): ApiErrorBody {
  const details = typeof parsed === "object" && parsed !== null ? (parsed as { detail?: unknown }).detail : undefined;
  if (status === 401 || status === 403) {
    return { code: "unauthorized", message: "設定の保存・取得にはログインが必要です。", details };
  }
  if (status === 422) return { code: "invalid_request", message: "設定の内容が受け付けられませんでした。", details };
  return { code: "http_error", message: `設定の通信に失敗しました（HTTP ${status}）。`, details };
}

function mapDataError(status: number, parsed: unknown): ApiErrorBody {
  const details = typeof parsed === "object" && parsed !== null ? (parsed as { detail?: unknown }).detail : undefined;
  if (status === 422) return { code: "invalid_request", message: "表示範囲が受け付けられませんでした。", details };
  if (status === 503) return { code: "map_data_unavailable", message: "道路情報サービスを利用できません。時間をおいて再試行してください。", details };
  return { code: "http_error", message: `HTTP ${status}`, details };
}

// エンドポイントは暫定。経路検索・設定以外はバックエンド確定後に合わせる。
// getAccessToken: ログイン済みのときアクセストークンを返す。
// refreshSession: 401 のときトークンを取り直す。取り直せたら同じ呼び出しを1回だけやり直す。
export function createHttpClient(
  baseUrl: string,
  getAccessToken?: () => string | null,
  refreshSession?: () => Promise<boolean>,
): ApiClient {
  async function request<T>(...args: Parameters<typeof send>): Promise<T> {
    try {
      return await send<T>(...args);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401 && getAccessToken?.() && refreshSession)) throw e;
      if (!(await refreshSession())) throw e;
      return send<T>(...args);
    }
  }

  async function send<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: {
      timeoutMs?: number;
      timeoutMessage?: string;
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
        : new ApiError(0, { code: "timeout", message: opts.timeoutMessage ?? "ルート探索に時間がかかっています。時間をおいて再試行してください。" });
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = getAccessToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      let res: Response;
      try {
        res = await fetch(baseUrl + path, {
          method,
          headers: Object.keys(headers).length > 0 ? headers : undefined,
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
        { signal, toError: mapDataError, timeoutMs: MAP_DATA_TIMEOUT_MS, timeoutMessage: "道路情報の取得に時間がかかっています。時間をおいて再試行してください。" },
      ).then(assertMapData),
    getRoute: (id) => request("GET", `/routes/${encodeURIComponent(id)}`),
    listHazards: (routeId) => request("GET", `/hazards${qs({ routeId })}`),
    // 口コミは main に取り込み済みの observations（bbox必須）。未指定なら全域。
    listReviews: async ({ bbox: [minLon, minLat, maxLon, maxLat] = WORLD } = {}) => {
      const query = new URLSearchParams({
        min_lon: String(minLon),
        min_lat: String(minLat),
        max_lon: String(maxLon),
        max_lat: String(maxLat),
      });
      try {
        const response = await request<unknown>("GET", `/v1/observations?${query}`, undefined, {
          timeoutMs: REVIEWS_TIMEOUT_MS,
          timeoutMessage: "口コミの取得に時間がかかっています。時間をおいて再試行してください。",
        });
        return observationsToReviews(response);
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError(502, { code: "invalid_response", message: "口コミの応答形式が不正です" });
      }
    },
    // 投稿はBE PR #26 の POST /v1/observations（要Bearer認証。FEのログインは未実装のため実BEでは401になり得る）。
    createReview: async (draft) => {
      const body = await request<unknown>("POST", "/v1/observations", toObservationRequest(draft), {
        timeoutMs: POST_TIMEOUT_MS,
        timeoutMessage: "口コミの投稿に時間がかかっています。",
        toError: postError,
      }).catch((e: unknown) => {
        if (e instanceof ApiError) throw e;
        throw new ApiError(502, { code: "invalid_response", message: "投稿の応答形式が不正です" });
      });
      try {
        return reviewFromCreated(draft, body, new Date().toISOString());
      } catch {
        throw new ApiError(502, { code: "invalid_response", message: "投稿の応答形式が不正です" });
      }
    },
    async getRoutingOptions() {
      return fromBackendOptions(await request<unknown>("GET", "/v1/routing-options"));
    },
    async getPreferences() {
      return fromBackendMe(await request<unknown>("GET", "/v1/auth/me", undefined, { toError: preferencesError }));
    },
    async updatePreferences(p) {
      await request<unknown>("PUT", "/v1/auth/me/preferences", toBackendPreferences(p), { toError: preferencesError });
      // PUTの応答は`{status}`だけなので、保存された値を再取得して返す。
      return fromBackendMe(await request<unknown>("GET", "/v1/auth/me", undefined, { toError: preferencesError }));
    },
  };
}
