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
  type OriginSource,
  type RouteSearchState,
  type RouteStore,
} from "./routeState";

export function formatPoint(p: LngLat | null, empty = "未指定"): string {
  return p ? "地図で指定済み" : empty;
}

/** 出発地の表示。現在地から決めたときは「現在地」と出す。 */
export function formatOrigin(p: LngLat | null, source: OriginSource | null, empty = "未指定"): string {
  return p && source === "current" ? "現在地" : formatPoint(p, empty);
}

function textButton(label: string, className = "route__button"): HTMLButtonElement {
  const b = el("button", { className, text: label });
  b.type = "button";
  return b;
}

export interface RouteViewOptions {
  /** 「経路を検索」「この条件で再検索」。現在地の取り直しなどを挟むため、検索の実行は呼び出し側に任せる。 */
  onSearch?: () => void;
}

/** 「経路」ビュー本体。ルート結果の下に検索条件を並べる。link は標高グラフと地図の選択位置を共有する。 */
export function renderRouteView(
  store: RouteStore,
  prefs: PreferencesStore,
  link: RouteLink,
  { onSearch = () => void store.search() }: RouteViewOptions = {},
): HTMLElement {
  // --- conditions pane (built once; values are synced in place so focus is kept) ---
  // 出発地・目的地は検索パネル上部の行と地図で決める。ここには車種と走り方の条件だけを置く。
  const submit = textButton("経路を検索", "route__submit");
  submit.addEventListener("click", onSearch);
  const validation = el("p", { className: "route__validation" });
  validation.setAttribute("role", "alert");
  validation.hidden = true;

  // 車種・坂道許容度・詳細パラメータ(#10)。縦に長くなるので、検索ボタンはパネル下部に固定して常に押せるようにする。
  const submitBar = el("div", { className: "route__submit-bar" }, [validation, submit]);
  const conditionsPane = el("section", { className: "route__pane route__pane--conditions" }, [
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
    // 目的地を決め直した直後など、検索の準備（現在地の取り直し）中も探索中として見せる。古い結果は出さない。
    if (state.preparing) {
      resultPane.hidden = false;
      resultPane.replaceChildren(
        renderState({
          kind: "loading",
          message: state.originSource === "current" ? "現在地を確認して、ルートを検索中…" : "ルートを検索中…",
        }),
      );
      return;
    }
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
    // 検索の準備・検索を始めたとき、成功したときは結果までスクロールする（検索中・空・失敗もそこで伝える）。
    const started = state.preparing && !prevPreparing;
    if (started || (kind !== prevKind && (kind === "loading" || kind === "success"))) {
      resultPane.focus({ preventScroll: true });
      resultPane.scrollIntoView({ block: "start" });
    }
    prevKind = kind;
    prevPreparing = state.preparing;
  });

  const initial = store.getState();
  syncConditions(initial);
  renderResult(initial);
  return root;
}
