import "./route.css";
import type { LngLat } from "../../types/api";
import { renderAnalysis } from "../elevation/render";
import type { RouteLink } from "../elevation/link";
import { el } from "../../ui/dom";
import { renderState } from "../../ui/state";
import type { PreferencesStore } from "../preferences/preferencesState";
import { renderPreferences } from "../preferences/renderPreferences";
import {
  isStale,
  type PickMode,
  type RouteSearchState,
  type RouteStore,
} from "./routeState";

const POINT_LABEL: Record<PickMode, string> = { origin: "出発地", destination: "目的地" };

export function formatPoint(p: LngLat | null, empty = "未指定"): string {
  return p ? "地図で指定済み" : empty;
}

function textButton(label: string, className = "route__button"): HTMLButtonElement {
  const b = el("button", { className, text: label });
  b.type = "button";
  return b;
}

/** 地図で地点を指定している間、地図上部に出す案内。キャンセルできる。 */
export function renderPickBanner(store: RouteStore): HTMLElement {
  const text = el("span", { className: "pick-banner__text" });
  const cancel = textButton("キャンセル", "pick-banner__cancel");
  cancel.addEventListener("click", () => store.cancelPick());
  const banner = el("div", { className: "pick-banner" }, [text, cancel]);
  banner.setAttribute("role", "status");
  banner.hidden = true;
  store.subscribe((state) => {
    banner.hidden = state.pickMode === null;
    if (state.pickMode) text.textContent = `地図をタップして${POINT_LABEL[state.pickMode]}を指定`;
  });
  return banner;
}

/** 「経路」ビュー本体。ルート結果の下に検索条件を並べる。link は標高グラフと地図の選択位置を共有する。 */
export function renderRouteView(store: RouteStore, prefs: PreferencesStore, link: RouteLink): HTMLElement {
  // --- conditions pane (built once; values are synced in place so focus is kept) ---
  const pointViews = new Map<PickMode, { value: HTMLElement; pick: HTMLButtonElement; clear: HTMLButtonElement }>();
  const pointRows: HTMLElement[] = [];
  for (const mode of ["origin", "destination"] as const) {
    const label = POINT_LABEL[mode];
    const value = el("span", { className: "route__point-value" });
    const pick = textButton("地図で指定");
    pick.setAttribute("aria-label", `${label}を地図で指定`);
    pick.addEventListener("click", () => store.startPick(mode));
    const clear = textButton("クリア");
    clear.setAttribute("aria-label", `${label}をクリア`);
    clear.addEventListener("click", () => store.clearPoint(mode));
    pointViews.set(mode, { value, pick, clear });
    pointRows.push(
      el("div", { className: "route__point" }, [
        el("span", { className: "route__point-label", text: label }),
        value,
        el("span", { className: "route__actions" }, [pick, clear]),
      ]),
    );
  }
  const swap = textButton("出発地と目的地を入れ替え");
  swap.addEventListener("click", () => store.swap());
  const initialPoints = store.getState();
  let pointsWereComplete = initialPoints.origin !== null && initialPoints.destination !== null;
  const pointDetails = el("details", { className: "route__points" }, [
    el("summary", { text: "出発地・目的地" }),
    el("div", { className: "route__point-editor" }, [...pointRows, swap]),
  ]);
  pointDetails.open = !pointsWereComplete;

  const submit = textButton("経路を検索", "route__submit");
  submit.addEventListener("click", () => void store.search());
  const validation = el("p", { className: "route__validation" });
  validation.setAttribute("role", "alert");
  validation.hidden = true;

  // 車種・坂道許容度・詳細パラメータ(#10)。縦に長くなるので、検索ボタンはパネル下部に固定して常に押せるようにする。
  const submitBar = el("div", { className: "route__submit-bar" }, [validation, submit]);
  const conditionsPane = el("section", { className: "route__pane route__pane--conditions" }, [
    pointDetails,
    renderPreferences(store, prefs),
    submitBar,
  ]);

  // --- result pane (re-rendered on every state change) --------------------
  const resultPane = el("section", { className: "route__pane route__pane--result" });
  resultPane.setAttribute("aria-label", "ルート結果");
  resultPane.tabIndex = -1;

  const root = el("div", { className: "route" }, [resultPane, conditionsPane]);

  function renderResult(state: RouteSearchState): void {
    const active = document.activeElement instanceof HTMLElement && resultPane.contains(document.activeElement)
      ? document.activeElement.dataset.resultControl : undefined;
    const { status } = state;
    resultPane.hidden = status.kind === "idle";
    if (status.kind === "idle") {
      resultPane.replaceChildren();
      return;
    }
    if (status.kind === "loading") {
      resultPane.replaceChildren(renderState({ kind: "loading", message: "ルートを検索中…" }));
      return;
    }

    const parts: HTMLElement[] = [];
    if (status.kind === "success") {
      parts.push(renderAnalysis(status.route, state.elevation, { retry: () => store.retryElevation(), link }));
    } else if (status.kind === "empty") {
      parts.push(renderState({ kind: "empty", message: "条件に合うルートが見つかりませんでした。条件を変えて再検索してください。" }));
    } else {
      parts.push(renderState({ kind: "error", message: status.message }));
    }
    if (isStale(state)) {
      const notice = el("p", { className: "route__stale", text: "条件が変わりました。「この条件で再検索」で結果を更新できます。" });
      notice.setAttribute("role", "status");
      parts.push(notice);
    }
    resultPane.replaceChildren(...parts);
    if (active) {
      const target = resultPane.querySelector<HTMLElement>(`[data-result-control="${active}"]`) ?? resultPane;
      target.focus({ preventScroll: true });
    }
  }

  function syncConditions(state: RouteSearchState): void {
    const loading = state.status.kind === "loading";
    const pointsComplete = state.origin !== null && state.destination !== null;
    if (!pointsComplete) pointDetails.open = true;
    else if (!pointsWereComplete) pointDetails.open = false;
    pointsWereComplete = pointsComplete;
    for (const [mode, v] of pointViews) {
      const p = state[mode];
      v.value.textContent = formatPoint(p);
      v.pick.disabled = loading;
      v.clear.disabled = loading || p === null;
    }
    swap.disabled = loading || (!state.origin && !state.destination);
    validation.textContent = state.validationError ?? "";
    validation.hidden = state.validationError === null;
    submit.textContent = state.status.kind === "idle" ? "経路を検索" : "この条件で再検索";
    // 選択肢の取得中は、仮の条件で検索しないよう待たせる。取得に失敗した場合は仮の条件のまま検索できる。
    submit.disabled = loading || prefs.getState().options.kind === "loading";
  }

  let prevKind = store.getState().status.kind;
  prefs.subscribe(() => syncConditions(store.getState()));
  store.subscribe((state) => {
    syncConditions(state);
    renderResult(state);
    const kind = state.status.kind;
    // 検索を始めたとき、成功したときは結果までスクロールする（検索中・空・失敗もそこで伝える）。
    if (kind !== prevKind && (kind === "loading" || kind === "success")) {
      resultPane.focus({ preventScroll: true });
      resultPane.scrollIntoView({ block: "start" });
    }
    prevKind = kind;
  });

  const initial = store.getState();
  syncConditions(initial);
  renderResult(initial);
  return root;
}
