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
  type OriginSource,
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

/** 出発地の表示。現在地から決めたときは座標ではなく「現在地」と出す。 */
export function formatOrigin(p: LngLat | null, source: OriginSource | null, empty = "未指定"): string {
  return p && source === "current" ? "現在地" : formatPoint(p, empty);
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

export interface RouteViewOptions {
  /** 「経路を検索」「この条件で再検索」。現在地の取り直しなどを挟むため、検索の実行は呼び出し側に任せる。 */
  onSearch?: () => void;
}

/** 「経路」ビュー本体。検索条件とルート結果の2つのサブタブ。link は標高グラフと地図の選択位置を共有する。 */
export function renderRouteView(
  store: RouteStore,
  prefs: PreferencesStore,
  link: RouteLink,
  { onSearch = () => void store.search() }: RouteViewOptions = {},
): HTMLElement {
  let tab: SubTab = "result";
  let detailsOpen = false;

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
  // 出発地・目的地は検索カード上部と地図で決める。ここには車種と走り方の条件だけを置く。
  const submit = textButton("経路を検索", "route__submit");
  submit.addEventListener("click", onSearch);
  const validation = el("p", { className: "route__validation" });
  validation.setAttribute("role", "alert");
  validation.hidden = true;

  // 車種・坂道許容度・詳細パラメータ(#10)。縦に長くなるので、検索ボタンはパネル下部に固定して常に押せるようにする。
  const submitBar = el("div", { className: "route__submit-bar" }, [validation, submit]);
  const conditionsPane = el("div", { className: "route__pane route__pane--conditions" }, [
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
      ["出発地", formatOrigin(applied.origin, applied.originSource)],
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

  function endpoints(p: Pick<RouteSearchState, "origin" | "originSource" | "destination">): HTMLElement {
    const rows = ([
      ["出発地", formatOrigin(p.origin, p.originSource)],
      ["目的地", formatPoint(p.destination)],
    ] as const).map(([label, value]) =>
      el("div", { className: "route__endpoint" }, [
        el("span", { className: "route__endpoint-label", text: label }),
        el("span", { className: "route__endpoint-value", text: value }),
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
    // 目的地を決め直した直後など、検索の準備（現在地の取り直し）中も探索中として見せる。古い結果は出さない。
    if (state.preparing) {
      resultPane.replaceChildren(
        endpoints(state),
        renderState({
          kind: "loading",
          message: state.originSource === "current" ? "現在地を確認して、ルートを検索中…" : "ルートを検索中…",
        }),
      );
      return;
    }
    if (status.kind === "idle") {
      resultPane.replaceChildren(
        renderState({ kind: "empty", message: "地図をタップして「ここを目的地にする」を選ぶと、現在地からのルートがここに表示されます。" }),
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
            ? "検索条件が変更されています。表示中のルートは、上の条件で検索した結果です。"
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
    const loading = state.status.kind === "loading" || state.preparing;
    validation.textContent = state.validationError ?? "";
    validation.hidden = state.validationError === null;
    submit.textContent = state.status.kind === "idle" ? "経路を検索" : "この条件で再検索";
    // 選択肢の取得中は、仮の条件で検索しないよう待たせる。取得に失敗した場合は仮の条件のまま検索できる。
    submit.disabled = loading || prefs.getState().options.kind === "loading";
  }

  let prevKind = store.getState().status.kind;
  let prevPreparing = store.getState().preparing;
  prefs.subscribe(() => syncConditions(store.getState()));
  store.subscribe((state) => {
    syncConditions(state);
    renderResult(state);
    const kind = state.status.kind;
    // 検索の準備・検索を始めたとき、成功したときは結果タブを見せる（検索中・空・失敗もそこで伝える）。
    const started = state.preparing && !prevPreparing;
    if (started || (kind !== prevKind && (kind === "loading" || kind === "success"))) {
      showTab("result");
      resultPane.focus({ preventScroll: true });
    }
    prevKind = kind;
    prevPreparing = state.preparing;
  });

  const initial = store.getState();
  syncConditions(initial);
  renderResult(initial);
  showTab("result");
  return root;
}
