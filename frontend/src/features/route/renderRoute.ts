import "./route.css";
import type { LngLat, Route } from "../../types/api";
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

type SubTab = "conditions" | "result";

const SUB_TABS: ReadonlyArray<{ id: SubTab; label: string }> = [
  { id: "result", label: "ルート結果" },
  { id: "conditions", label: "検索条件" },
];

const POINT_LABEL: Record<PickMode, string> = { origin: "出発地", destination: "目的地" };

export function formatPoint(p: LngLat | null, empty = "未指定"): string {
  return p ? `緯度 ${p[1].toFixed(5)} / 経度 ${p[0].toFixed(5)}` : empty;
}

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function formatDuration(sec: number): string {
  const minutes = Math.max(1, Math.round(sec / 60));
  return minutes < 60 ? `${minutes} 分` : `${Math.floor(minutes / 60)} 時間 ${minutes % 60} 分`;
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

/** 「経路」ビュー本体。検索条件とルート結果の2つのサブタブ。 */
export function renderRouteView(store: RouteStore, prefs: PreferencesStore): HTMLElement {
  let tab: SubTab = "result";

  // --- sub tabs ---------------------------------------------------------
  const tablist = el("div", { className: "route__tabs" });
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "経路の表示切り替え");
  const tabButtons = new Map<SubTab, HTMLButtonElement>();
  for (const def of SUB_TABS) {
    const t = textButton(def.label, "route__tab");
    t.id = `route-tab-${def.id}`;
    t.setAttribute("role", "tab");
    t.setAttribute("aria-controls", `route-pane-${def.id}`);
    t.addEventListener("click", () => showTab(def.id));
    tabButtons.set(def.id, t);
    tablist.append(t);
  }
  tablist.addEventListener("keydown", (e) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const ids = SUB_TABS.map((d) => d.id);
    const current = ids.indexOf(tab);
    let next = current;
    if (e.key === "ArrowRight") next = (current + 1) % ids.length;
    if (e.key === "ArrowLeft") next = (current - 1 + ids.length) % ids.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = ids.length - 1;
    e.preventDefault();
    showTab(ids[next]);
    tabButtons.get(ids[next])!.focus();
  });

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
  const conditionsPane = el("div", { className: "route__pane route__pane--conditions" }, [
    pointDetails,
    renderPreferences(store, prefs),
    submitBar,
  ]);
  conditionsPane.id = "route-pane-conditions";
  conditionsPane.setAttribute("role", "tabpanel");
  conditionsPane.setAttribute("aria-labelledby", "route-tab-conditions");

  // --- result pane (re-rendered on every state change) --------------------
  const resultPane = el("div", { className: "route__pane route__pane--result" });
  resultPane.id = "route-pane-result";
  resultPane.setAttribute("role", "tabpanel");
  resultPane.setAttribute("aria-labelledby", "route-tab-result");
  resultPane.tabIndex = -1;

  const root = el("div", { className: "route" }, [tablist, conditionsPane, resultPane]);

  function showTab(id: SubTab): void {
    tab = id;
    for (const [tid, b] of tabButtons) {
      b.setAttribute("aria-selected", String(tid === id));
      b.tabIndex = tid === id ? 0 : -1;
    }
    conditionsPane.hidden = id !== "conditions";
    resultPane.hidden = id !== "result";
  }

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

  function summary(route: Route): HTMLElement {
    const items: Array<[string, string]> = [
      ["距離", formatDistance(route.distanceM)],
      ["所要時間", formatDuration(route.durationSec)],
      ["獲得標高", "準備中"],
    ];
    const list = el("dl", { className: "route__summary" });
    for (const [k, v] of items) {
      list.append(el("div", { className: "route__stat" }, [el("dt", { text: k }), el("dd", { text: v })]));
    }
    return list;
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

  /** #7 の解析・グラフを後から接続するための、データ未取得時の表示領域。 */
  function elevationProfileSlot(): HTMLElement {
    const placeholder = el("div", {
      className: "route__elevation-placeholder",
      text: "標高データを準備中です。",
    });
    placeholder.setAttribute("role", "status");
    const section = el("section", { className: "route__section route__elevation" }, [
      el("h3", { className: "route__heading", text: "標高プロファイル" }),
      placeholder,
    ]);
    section.setAttribute("data-elevation-slot", "profile");
    return section;
  }

  /** #7 の解析値を表示する場所だけ確保する。標高データはここでは計算しない。 */
  function routeDetails(): HTMLElement {
    const detailRows: Array<[string, string]> = [
      ["平均勾配", "準備中"],
      ["最高標高", "準備中"],
      ["最低標高", "準備中"],
      ["獲得標高", "準備中"],
    ];
    const list = el("dl", { className: "route__detail-list" });
    for (const [label, value] of detailRows) {
      list.append(el("dt", { text: label }), el("dd", { text: value }));
    }
    const details = el("details", { className: "route__details" }, [
      el("summary", { text: "ルート詳細" }),
      el("p", { className: "route__details-note", text: "標高解析の統合後に表示します。" }),
      list,
    ]);
    details.setAttribute("data-elevation-slot", "details");
    return details;
  }

  function renderResult(state: RouteSearchState): void {
    const { status } = state;
    if (status.kind === "idle") {
      resultPane.replaceChildren(
        renderState({ kind: "empty", message: "出発地と目的地を指定して検索すると、ルートがここに表示されます。" }),
      );
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
        summary(status.route),
        elevationProfileSlot(),
        routeDetails(),
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
            ? "検索条件が変更されています。表示中のルートは、上の条件で検索した結果です。"
            : "検索条件が変更されています。",
      });
      notice.setAttribute("role", "status");
      parts.push(notice);
    }
    parts.push(appliedList(status.applied));
    resultPane.replaceChildren(...parts);
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
    // 検索を始めたとき、成功したときは結果タブを見せる（検索中・空・失敗もそこで伝える）。
    if (kind !== prevKind && (kind === "loading" || kind === "success")) {
      showTab("result");
      resultPane.focus({ preventScroll: true });
    }
    prevKind = kind;
  });

  const initial = store.getState();
  syncConditions(initial);
  renderResult(initial);
  showTab("result");
  return root;
}
