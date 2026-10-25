import "./route.css";
import type { LngLat } from "../../types/api";
import { renderAnalysis } from "../elevation/render";
import type { RouteLink } from "../elevation/link";
import { el } from "../../ui/dom";
import { renderState } from "../../ui/state";
import { MODE_META, bikeTypeLabel, modeLabel } from "../preferences/labels";
import type { PreferencesStore } from "../preferences/preferencesState";
import { renderPreferences } from "../preferences/renderPreferences";
import {
  isStale,
  type AppliedSearch,
  type PickMode,
  type RouteSearchState,
  type RouteStore,
} from "./routeState";

const POINT_LABEL: Record<PickMode, string> = { origin: "出発地", destination: "目的地" };

export function formatPoint(p: LngLat | null, empty = "未指定"): string {
  return p ? `緯度 ${p[1].toFixed(5)} / 経度 ${p[0].toFixed(5)}` : empty;
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
  let detailsOpen = false;

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
    el("h3", { className: "route__result-heading", text: "検索条件" }),
    pointDetails,
    renderPreferences(store, prefs),
    submitBar,
  ]);

  // --- result pane (re-rendered on every state change) --------------------
  const resultPane = el("section", { className: "route__pane route__pane--result" });
  resultPane.setAttribute("aria-label", "ルート結果");
  resultPane.tabIndex = -1;

  const root = el("div", { className: "route" }, [resultPane, conditionsPane]);

  function appliedList(applied: AppliedSearch): HTMLElement {
    const rows: Array<[string, string]> = [
      ["出発地", formatPoint(applied.origin)],
      ["目的地", formatPoint(applied.destination)],
      ["車種", bikeTypeLabel(applied.bikeType)],
      ["坂道許容度", modeLabel("hillMode", applied.hillMode)],
      [MODE_META.trafficMode.title, modeLabel("trafficMode", applied.trafficMode)],
      [MODE_META.surfaceMode.title, modeLabel("surfaceMode", applied.surfaceMode)],
      [MODE_META.walkingMode.title, modeLabel("walkingMode", applied.walkingMode)],
    ];
    const dl = el("dl", { className: "route__applied" });
    for (const [k, v] of rows) dl.append(el("dt", { text: k }), el("dd", { text: v }));
    const details = el("details", { className: "route__applied-details" }, [
      el("summary", { text: "検索に使った条件" }),
      dl,
    ]);
    return details;
  }

  function endpoints(applied: AppliedSearch): HTMLElement {
    const rows = ([
      ["出発地", applied.origin],
      ["目的地", applied.destination],
    ] as const).map(([label, point]) =>
      el("div", { className: "route__endpoint" }, [
        el("span", { className: "route__endpoint-label", text: label }),
        el("span", { className: "route__endpoint-value", text: formatPoint(point) }),
      ]),
    );
    const section = el("section", { className: "route__endpoints" }, rows);
    section.setAttribute("aria-label", "検索した経路");
    return section;
  }

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
      resultPane.replaceChildren(endpoints(status.applied), renderState({ kind: "loading", message: "ルートを検索中…" }));
      return;
    }

    const parts: HTMLElement[] = [];
    if (status.kind === "success") {
      parts.push(
        endpoints(status.applied),
        el("h3", { className: "route__result-heading", text: "検索されたルート" }),
        renderAnalysis(status.route, state.elevation, {
          retry: () => store.retryElevation(),
          detailsOpen,
          onDetailsToggle: (open) => { detailsOpen = open; },
          link,
        }),
      );
    } else if (status.kind === "empty") {
      parts.push(
        endpoints(status.applied),
        renderState({ kind: "empty", message: "条件に合うルートが見つかりませんでした。条件を変えて再検索してください。" }),
      );
    } else {
      parts.push(endpoints(status.applied), renderState({ kind: "error", message: status.message }));
    }
    if (isStale(state)) {
      const notice = el("p", {
        className: "route__stale",
        text:
          status.kind === "success"
            ? "検索条件が変更されています。表示中のルートは、変更前の条件で検索した結果です。"
            : "検索条件が変更されています。",
      });
      notice.setAttribute("role", "status");
      parts.push(notice);
    }
    parts.push(appliedList(status.applied));
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
