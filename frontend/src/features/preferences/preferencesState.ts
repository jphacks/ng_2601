import { toApiError, type ApiClient } from "../../api";
import type { PreferenceModes, RouteConditions, RoutingOptions } from "../../types/api";
import { sameConditions, type RouteStore } from "../route/routeState";

export type OptionsStatus =
  | { kind: "loading" }
  | { kind: "ready"; options: RoutingOptions }
  | { kind: "error"; message: string };

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export interface PreferencesState {
  options: OptionsStatus;
  /** サーバーに保存されている値。取得できていなければ null。 */
  saved: RouteConditions | null;
  /** 保存済みの値を取得できなかった理由（未ログイン・通信失敗など）。取得できたら null。 */
  savedNote: string | null;
  save: SaveStatus;
}

export interface PreferencesStore {
  getState(): PreferencesState;
  subscribe(listener: (state: PreferencesState) => void): () => void;
  /** 選択肢と保存済みの設定を取得する。失敗後の再試行にも使う。 */
  load(): Promise<void>;
  /** 車種を変え、その車種の初期値を坂道許容度・詳細パラメータに適用する。 */
  selectBike(bikeType: RouteConditions["bikeType"]): void;
  /** 選択中の車種の初期値へ、坂道許容度と詳細パラメータを戻す（車種は変えない）。 */
  resetToDefaults(): void;
  /** 編集中の条件をサーバーへ保存する。経路検索の結果には影響しない。 */
  save(): Promise<void>;
}

/** 選択中の車種の初期値。選択肢が未取得、または車種が不明なら null。 */
export function defaultsFor(state: PreferencesState, bikeType: RouteConditions["bikeType"]): PreferenceModes | null {
  return state.options.kind === "ready" ? (state.options.options.bikeTypes[bikeType]?.defaults ?? null) : null;
}

/** 編集中の条件が保存済みの値と食い違っているか。保存済みを取得できていなければ null（判定不能）。 */
export function isUnsaved(state: PreferencesState, draft: RouteConditions): boolean | null {
  return state.saved ? !sameConditions(state.saved, draft) : null;
}

/**
 * 車種・坂道許容度・詳細パラメータの編集状態。編集値そのものは routeStore の draft が持ち、
 * ここでは選択肢の取得・保存・初期値リセットだけを扱う。draft を変えても検索結果は更新されない(#6)。
 */
export function createPreferencesStore(api: ApiClient, routeStore: RouteStore): PreferencesStore {
  let state: PreferencesState = { options: { kind: "loading" }, saved: null, savedNote: null, save: { kind: "idle" } };
  const listeners = new Set<(s: PreferencesState) => void>();
  let loadSeq = 0;

  function update(patch: Partial<PreferencesState>): void {
    state = { ...state, ...patch };
    for (const l of listeners) l(state);
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async load() {
      const mine = ++loadSeq;
      const draftAtStart = routeStore.getState().draft;
      update({ options: { kind: "loading" }, savedNote: null });
      const [optionsResult, savedResult] = await Promise.allSettled([api.getRoutingOptions(), api.getPreferences()]);
      if (mine !== loadSeq) return;
      if (optionsResult.status === "rejected") {
        update({ options: { kind: "error", message: toApiError(optionsResult.reason).message } });
        return;
      }
      const options = optionsResult.value;
      const saved = savedResult.status === "fulfilled" ? savedResult.value : null;
      const savedNote = savedResult.status === "rejected" ? toApiError(savedResult.reason).message : null;
      update({ options: { kind: "ready", options }, saved, savedNote });

      // 読み込み中に利用者が触っていなければ、保存済みの値（なければ車種の初期値）を編集値にする。
      if (routeStore.getState().draft !== draftAtStart) return;
      if (saved) routeStore.setDraft(saved);
      else {
        const defaults = options.bikeTypes[draftAtStart.bikeType]?.defaults;
        if (defaults) routeStore.setDraft(defaults);
      }
    },
    selectBike(bikeType) {
      const defaults = defaultsFor(state, bikeType);
      routeStore.setDraft({ bikeType, ...defaults });
    },
    resetToDefaults() {
      const defaults = defaultsFor(state, routeStore.getState().draft.bikeType);
      if (defaults) routeStore.setDraft(defaults);
    },
    async save() {
      if (state.save.kind === "saving") return;
      const draft = routeStore.getState().draft;
      update({ save: { kind: "saving" } });
      try {
        const saved = await api.updatePreferences(draft);
        update({ saved, savedNote: null, save: { kind: "saved" } });
      } catch (e) {
        // 編集中の値は残す。保存済みの値も変えない。
        update({ save: { kind: "error", message: toApiError(e).message } });
      }
    },
  };
}
