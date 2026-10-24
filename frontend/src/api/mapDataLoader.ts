import { bboxContains, padBBox } from "../features/hazards/bbox";
import type { BBox, MapDataResponse } from "../types/api";
import type { ApiClient } from "./client";
import { toApiError, type ApiError } from "./errors";

export interface MapDataState {
  /** idle: 取得していない（ズーム不足など）。 */
  status: "idle" | "loading" | "ok" | "error";
  data?: MapDataResponse;
  /** observations が limit に達した。一部しか取得できていない可能性がある。 */
  truncated: boolean;
  /** idle の理由。 */
  reason?: "zoom";
  error?: ApiError;
}

export interface MapDataLoaderOptions {
  limit?: number;
  debounceMs?: number;
  /** これ未満のズームでは取得しない（広域の一括取得を避ける）。 */
  minZoom?: number;
  /** 取得範囲を表示範囲の何倍広げるか（各辺）。 */
  padding?: number;
}

export interface MapDataLoader {
  /** 表示領域が変わったとき。デバウンス後に必要なら取得する。 */
  request(bbox: BBox, zoom: number): void;
  /** 直近の領域を強制的に再取得する（エラーからの再試行）。 */
  retry(): void;
  subscribe(listener: (state: MapDataState) => void): () => void;
  getState(): MapDataState;
  dispose(): void;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** 表示領域に応じた道路・危険情報の取得責務。画面は bbox を渡すだけでよい。 */
export function createMapDataLoader(client: ApiClient, options: MapDataLoaderOptions = {}): MapDataLoader {
  const { limit = 200, debounceMs = 300, minZoom = 12, padding = 0.5 } = options;

  let state: MapDataState = { status: "idle", truncated: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let sequence = 0;
  let loaded: { box: BBox; truncated: boolean } | undefined;
  let last: { bbox: BBox; zoom: number } | undefined;
  let disposed = false;
  const listeners = new Set<(s: MapDataState) => void>();

  function setState(next: MapDataState): void {
    state = next;
    for (const l of [...listeners]) l(state);
  }

  function cancel(): void {
    clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
    sequence += 1;
  }

  async function fetchFor(bbox: BBox): Promise<void> {
    const mine = ++sequence;
    controller?.abort();
    const ctrl = new AbortController();
    controller = ctrl;
    const box = padBBox(bbox, padding);
    setState({ ...state, status: "loading", error: undefined, reason: undefined });
    try {
      const data = await client.getMapData(box, { limit, signal: ctrl.signal });
      if (mine !== sequence || disposed) return;
      const truncated = (data.observations?.features?.length ?? 0) >= limit;
      loaded = { box, truncated };
      setState({ status: "ok", data, truncated });
    } catch (e) {
      if (mine !== sequence || disposed || isAbort(e)) return;
      loaded = undefined;
      // 取得に失敗した領域の古い結果を「現在の情報」として残さない。
      setState({ status: "error", truncated: false, error: toApiError(e) });
    }
  }

  return {
    request(bbox, zoom) {
      if (disposed) return;
      last = { bbox, zoom };
      clearTimeout(timer);
      if (zoom < minZoom) {
        cancel();
        loaded = undefined;
        setState({ status: "idle", truncated: false, reason: "zoom" });
        return;
      }
      // 取得済みの範囲に収まり、件数上限で欠けていなければ再取得しない。
      if (loaded && !loaded.truncated && bboxContains(loaded.box, bbox)) {
        if (state.status !== "ok") setState({ ...state, status: "ok", reason: undefined });
        return;
      }
      timer = setTimeout(() => void fetchFor(bbox), debounceMs);
    },
    retry() {
      if (disposed || !last || last.zoom < minZoom) return;
      cancel();
      loaded = undefined;
      void fetchFor(last.bbox);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getState: () => state,
    dispose() {
      disposed = true;
      cancel();
      listeners.clear();
    },
  };
}
