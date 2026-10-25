import { toApiError, type ApiClient } from "../../api";
import { haversineM } from "../../lib/geo";
import type { LngLat, Route, RouteConditions } from "../../types/api";
import { analyzeRoute, type ElevationState, type RouteAnalyzer } from "../elevation/analyze";

/** 検索に使う車種と経路条件。 */
export type SearchConditions = RouteConditions;

/** 検索結果に実際に適用された条件。編集中の条件(draft)とは別に保持する。 */
export interface AppliedSearch extends SearchConditions {
  origin: LngLat;
  originSource: OriginSource;
  destination: LngLat;
}

export type SearchStatus =
  | { kind: "idle" }
  | { kind: "loading"; applied: AppliedSearch }
  | { kind: "success"; applied: AppliedSearch; route: Route }
  | { kind: "empty"; applied: AppliedSearch }
  | { kind: "error"; applied: AppliedSearch; message: string };

export type PickMode = "origin" | "destination";

/** 出発地の決め方。current は端末の現在地（表示は「現在地」）。 */
export type OriginSource = "current" | "map";

export interface RouteSearchState {
  origin: LngLat | null;
  /** origin が null の間は null。 */
  originSource: OriginSource | null;
  destination: LngLat | null;
  /** 地図タップで指定中の地点。null は指定モードではない。 */
  pickMode: PickMode | null;
  /** 編集中の条件。検索するまで結果には影響しない。 */
  draft: SearchConditions;
  status: SearchStatus;
  elevation: ElevationState;
  /** 検索前の入力検証エラー。次の操作で消える。 */
  validationError: string | null;
}

/**
 * 選択肢の取得(#10)が終わるまでの仮の条件。BEの車種`city`の初期値（back/config/routing_catalog.json）に合わせてある。
 * 取得後は、保存済みの設定またはその車種の初期値で置き換える。
 */
const FALLBACK_CONDITIONS: SearchConditions = {
  bikeType: "city",
  hillMode: "balanced",
  trafficMode: "balanced",
  surfaceMode: "comfortable",
  walkingMode: "short",
};

export function sameConditions(a: SearchConditions, b: SearchConditions): boolean {
  return (
    a.bikeType === b.bikeType &&
    a.hillMode === b.hillMode &&
    a.trafficMode === b.trafficMode &&
    a.surfaceMode === b.surfaceMode &&
    a.walkingMode === b.walkingMode
  );
}

/** 出発地と目的地がこれ未満しか離れていない場合は検索しない。 */
const MIN_DISTANCE_M = 20;

const sameLngLat = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];

/** 編集中の入力が、表示中の結果に適用された条件と食い違っているか。 */
export function isStale(state: RouteSearchState): boolean {
  const { status } = state;
  if (status.kind === "idle") return false;
  const a = status.applied;
  return (
    !sameConditions(a, state.draft) ||
    !state.origin ||
    !state.destination ||
    !sameLngLat(a.origin, state.origin) ||
    !sameLngLat(a.destination, state.destination)
  );
}

export interface RouteStore {
  getState(): RouteSearchState;
  subscribe(listener: (state: RouteSearchState) => void): () => void;
  startPick(mode: PickMode): void;
  cancelPick(): void;
  /** 地図タップ。指定モード中なら地点として採用して true（他のクリック処理は不要）。 */
  pick(lngLat: LngLat): boolean;
  /** 地点を直接決める（地図の地点シートや現在地から）。指定モードは終わる。 */
  setPoint(which: PickMode, lngLat: LngLat, source?: OriginSource): void;
  clearPoint(which: PickMode): void;
  swap(): void;
  /** 地点と結果をすべて消す。 */
  reset(): void;
  setDraft(patch: Partial<SearchConditions>): void;
  search(): Promise<void>;
  retryElevation(): void;
}

export function createRouteStore(api: ApiClient, analyzer: RouteAnalyzer = analyzeRoute): RouteStore {
  let state: RouteSearchState = {
    origin: null,
    originSource: null,
    destination: null,
    pickMode: null,
    draft: { ...FALLBACK_CONDITIONS },
    status: { kind: "idle" },
    elevation: { kind: "idle" },
    validationError: null,
  };
  const listeners = new Set<(s: RouteSearchState) => void>();
  /** 古い応答が新しい検索結果を上書きしないための連番。 */
  let seq = 0;
  let elevationController: AbortController | null = null;

  function update(patch: Partial<RouteSearchState>): void {
    state = { ...state, validationError: null, ...patch };
    for (const l of listeners) l(state);
  }

  /** 検索中に地点・結果の前提が変わったら、進行中の応答は捨てる。 */
  const invalidatePending = () => void seq++;

  function cancelElevation(): void {
    elevationController?.abort();
    elevationController = null;
  }

  async function runElevation(route: Route): Promise<void> {
    cancelElevation();
    const controller = new AbortController();
    elevationController = controller;
    const current = () => elevationController === controller && !controller.signal.aborted;
    const setElevation = (elevation: ElevationState) => {
      // 解析の進捗通知で、利用者の入力検証メッセージを消さない。
      if (current()) update({ elevation, validationError: state.validationError });
    };
    setElevation({ kind: "loading", done: 0, total: 0 });
    try {
      const analysis = await analyzer(route, {
        signal: controller.signal,
        onProgress: (done, total) => setElevation({ kind: "loading", done, total }),
      });
      if (analysis) setElevation({ kind: "ready", analysis });
      else setElevation({ kind: "error", message: "標高解析が完了しませんでした。再試行してください。" });
    } catch (error) {
      setElevation({ kind: "error", message: error instanceof Error ? error.message : "標高を取得できませんでした。" });
    } finally {
      if (elevationController === controller) elevationController = null;
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    startPick: (mode) => update({ pickMode: mode }),
    cancelPick: () => update({ pickMode: null }),
    pick(lngLat) {
      const mode = state.pickMode;
      if (!mode) return false;
      if (mode === "origin") {
        // 出発地を決めたら、目的地が未指定なら続けて指定させる。
        update({ origin: lngLat, originSource: "map", pickMode: state.destination ? null : "destination" });
      } else {
        // 出発地が未指定でも続けて指定させない。既定の現在地で埋めるのは呼び出し側。
        update({ destination: lngLat, pickMode: null });
      }
      return true;
    },
    setPoint(which, lngLat, source = "map") {
      update(which === "origin" ? { origin: lngLat, originSource: source, pickMode: null } : { destination: lngLat, pickMode: null });
    },
    clearPoint(which) {
      update(which === "origin" ? { origin: null, originSource: null } : { destination: null });
    },
    swap() {
      update({
        origin: state.destination,
        originSource: state.destination ? "map" : null,
        destination: state.origin,
      });
    },
    reset() {
      invalidatePending();
      cancelElevation();
      update({ origin: null, originSource: null, destination: null, pickMode: null, status: { kind: "idle" }, elevation: { kind: "idle" } });
    },
    setDraft(patch) {
      update({ draft: { ...state.draft, ...patch } });
    },
    retryElevation() {
      if (state.status.kind === "success" && state.elevation.kind !== "loading") void runElevation(state.status.route);
    },
    async search() {
      if (state.status.kind === "loading") return;
      const { origin, originSource, destination, draft } = state;
      if (!destination) {
        update({ validationError: "目的地を地図で指定してください。" });
        return;
      }
      if (!origin) {
        update({ validationError: "出発地が未指定です。現在地を取得するか、地図で指定してください。" });
        return;
      }
      if (haversineM(origin, destination) < MIN_DISTANCE_M) {
        update({ validationError: "出発地と目的地が近すぎます。離れた地点を指定してください。" });
        return;
      }
      const applied: AppliedSearch = { origin, originSource: originSource ?? "map", destination, ...draft };
      const mine = ++seq;
      cancelElevation();
      // 検索を始めた時点で古い経路は表示から外す。失敗しても古いルートが新しい結果に見えない。
      update({ pickMode: null, status: { kind: "loading", applied }, elevation: { kind: "idle" } });
      try {
        const route = await api.searchRoute({ origin, destination, ...draft });
        if (mine !== seq) return;
        update({ status: { kind: "success", applied, route } });
        void runElevation(route);
      } catch (e) {
        if (mine !== seq) return;
        const err = toApiError(e);
        update({
          status: err.code === "no_route" ? { kind: "empty", applied } : { kind: "error", applied, message: err.message },
        });
      }
    },
  };
}
