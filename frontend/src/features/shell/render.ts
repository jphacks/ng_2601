import "./shell.css";
import { el } from "../../ui/dom";
import { icon, type IconName } from "../../ui/icon";
import { renderState } from "../../ui/state";
import { api, isMockApi } from "../../api";
import { createHazardsFeature, type HazardsFeature } from "../hazards/hazardsFeature";
import { setupLocate } from "../geolocation/renderLocate";
import { renderLayerPanel } from "../map/layerPanel";
import { mountMap, type MapController } from "../map/map";
import { ATTRIBUTION } from "../map/style";
import { createReviewPostFeature, type ReviewPostFeature } from "../reviews/postForm";
import { formatOrigin, formatPoint, renderPickBanner, renderRouteView } from "../route/renderRoute";
import { createPreferencesStore } from "../preferences/preferencesState";
import { createRouteStore } from "../route/routeState";
import { buildRouteGradientSegments, type RouteGradientSegment } from "../elevation/gradientSegments";
import type { RouteAnalysis } from "../elevation/analyze";
import { createRouteLink, type RouteLink } from "../elevation/link";
import type { Route } from "../../types/api";
import { createReviewsFeature, type ReviewsFeature } from "../reviews/reviewsFeature";

type ViewId = "route" | "settings" | "hazards" | "reviews" | "layers" | "help" | "about";

interface ViewDef {
  id: ViewId;
  label: string;
  /** 準備中表示に添える担当Issue。実装は各Issueで行う。 */
  issue: string;
}

const TAB_VIEWS: ViewDef[] = [
  { id: "route", label: "経路", issue: "#6" },
  { id: "settings", label: "設定", issue: "#10" },
  { id: "hazards", label: "道路情報", issue: "#11" },
  { id: "reviews", label: "口コミ", issue: "#12" },
];
const EXTRA_VIEWS: ViewDef[] = [
  { id: "layers", label: "地図レイヤー", issue: "#5" },
  { id: "help", label: "使い方・ヘルプ", issue: "" },
  { id: "about", label: "アプリ情報", issue: "" },
];
const ALL_VIEWS = [...TAB_VIEWS, ...EXTRA_VIEWS];

const APP_NAME = "CyclerHub";

const FOCUSABLE ='a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function button(label: string, className: string, name: IconName): HTMLButtonElement {
  const b = el("button", { className }, [icon(name)]);
  b.type = "button";
  b.setAttribute("aria-label", label);
  return b;
}

/** 地図中心の共通画面。地図・GPS・検索実行・APIは別Issueで接続する。 */
export function renderShell(root: HTMLElement): void {
  let searchOpen = false;
  let menuOpen = false;
  let view: ViewId = "route";
  // レイヤーパネルと経路ビューは1つだけ作って使い回す（再訪のたびにリスナーを増やさない）。
  let layerPanel: HTMLElement | undefined;
  const routeStore = createRouteStore(api);
  const prefsStore = createPreferencesStore(api, routeStore);

  // --- map area ---------------------------------------------------------
  const map = el("div", { className: "map" });
  map.setAttribute("role", "region");
  map.setAttribute("aria-label", "地図エリア");
  // 道路・危険情報は FE-09 で実APIクライアント（モック切替可）に接続済み。詳細カードは地図クリックで開く。
  let hazards: HazardsFeature | undefined;
  let reviews: ReviewsFeature | undefined;
  let reviewPost: ReviewPostFeature | undefined;
  // 地点指定モード中の地図タップだけを出発地／目的地として使う。
  // ルート区間のタップは標高グラフの選択位置へ送る（#9）。
  const mapController: MapController = mountMap(map, {
    onPick: (lngLat) => {
      if (routeStore.pick(lngLat)) {
        void searchRoute();
        return true;
      }
      if (reviewPost?.pick(lngLat)) return true;
      reviews?.openNear(lngLat);
      return true;
    },
    onSelectRoadInfo: (id) => {
      if (id) {
        reviews?.close();
        reviewPost?.hide();
      }
      hazards?.select(id, "map");
    },
    onSelectRouteSegment: (distanceM) => link.select(distanceM),
  });
  const link: RouteLink = createRouteLink(mapController);
  const routeView = renderRouteView(routeStore, prefsStore, link, { onSearch: () => void searchRoute() });
  void prefsStore.load();
  hazards = createHazardsFeature({
    map: mapController,
    client: api,
    mock: isMockApi,
    // スマホでは一覧パネルが詳細カードを覆うため、一覧から選んだら閉じて地図と詳細を見せる。
    onSelect: (fromList) => {
      reviews?.close();
      reviewPost?.hide();
      if (fromList && window.matchMedia("(max-width: 767px)").matches) closeSearch(false);
    },
  });
  // 道路情報のカテゴリは地図画面に常に出す（「道路情報」タブのチェックと連動）。
  const mapFilter = hazards.mapFilter;
  reviews = createReviewsFeature({
    map: mapController,
    client: api,
    getRoadInfo: () => hazards?.getVisibleItems() ?? [],
    onOpen: () => {
      hazards?.closeDetail();
      closeSearch(false);
      reviewPost?.hide();
    },
    onPost: (at) => reviewPost?.start(at),
    onSetDestination: (at) => {
      reviews?.close();
      routeStore.setPoint("destination", at);
      void searchRoute();
    },
    onSetOrigin: (at) => {
      reviews?.close();
      routeStore.setPoint("origin", at, "map");
      if (routeStore.getState().destination) void searchRoute();
      else routeStore.startPick("destination");
    },
  });
  reviewPost = createReviewPostFeature({
    map: mapController,
    client: api,
    onPosted: (review) => reviews?.showPosted(review),
    onOpen: () => {
      if (routeStore.getState().pickMode) routeStore.cancelPick();
      hazards?.closeDetail();
      closeSearch(false);
      reviews?.close();
    },
  });
  const attributionLink = el("a", { text: ATTRIBUTION.label });
  attributionLink.href = ATTRIBUTION.url;
  attributionLink.target = "_blank";
  attributionLink.rel = "noopener noreferrer";
  const attribution = el("div", { className: "attribution" }, [attributionLink]);

  // --- hamburger + drawer -----------------------------------------------
  const menuButton = button("メニューを開く", "float-button menu-button", "menu");
  menuButton.setAttribute("aria-haspopup", "dialog");
  menuButton.setAttribute("aria-expanded", "false");
  const scrim = el("div", { className: "scrim" });
  const drawer = el("nav", { className: "drawer" });
  drawer.setAttribute("aria-label", "メニュー");
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.inert = true;
  const drawerClose = button("メニューを閉じる", "float-button drawer__close", "close");
  const drawerItems = el("ul", { className: "drawer__list" });
  function drawerItem(label: string, run: () => void): void {
    const item = el("button", { className: "drawer__item", text: label });
    item.type = "button";
    item.addEventListener("click", () => {
      setMenu(false, false);
      run();
    });
    drawerItems.append(el("li", {}, [item]));
  }
  // 口コミの投稿はよく使うので、設定を経由せずメニューから直接始められるようにする。
  drawerItem("口コミを投稿", () => reviewPost?.start(null));
  for (const id of ["settings", "help", "about"] as const) {
    drawerItem(ALL_VIEWS.find((v) => v.id === id)!.label, () => openSearch(id));
  }
  drawer.append(el("h2", { className: "drawer__title", text: APP_NAME }), drawerItems, drawerClose);

  // --- map controls (right) ---------------------------------------------
  const layersButton = button("地図レイヤー", "float-button", "layers");
  layersButton.addEventListener("click", () => openSearch("layers"));
  const compass = button("方位をリセット", "float-button float-button--accent", "compass");
  compass.addEventListener("click", () => mapController.resetNorth());
  const zoomIn = button("ズームイン", "float-button map-controls__zoom", "plus");
  zoomIn.addEventListener("click", () => mapController.zoomIn());
  const zoomOut = button("ズームアウト", "float-button map-controls__zoom", "minus");
  zoomOut.addEventListener("click", () => mapController.zoomOut());
  // 現在地は押したときだけ取得する（features/geolocation）。検索パネルが通知と地図を覆わないよう閉じる。
  const locate = button("現在地を表示", "float-button", "locate");
  const locator = setupLocate(locate, mapController, { onStart: () => closeSearch(false) });
  const controls = el("div", { className: "map-controls" }, [layersButton, compass, locate, zoomIn, zoomOut]);

  // --- route button (bottom right): opens the search card -------------------
  // 住所検索（ジオコーディング）は未対応なので検索バーは置かず、目立つ「経路」ボタンからパネルを開く。
  // 出発地は既定で現在地。利用者は地図をタップして目的地だけ決めればよい。
  const routeButton = el("button", { className: "route-fab" }, [icon("route"), el("span", { text: "経路" })]);
  routeButton.type = "button";
  routeButton.setAttribute("aria-label", "経路を開く");
  routeButton.setAttribute("aria-expanded", "false");
  routeButton.setAttribute("aria-controls", "search-panel");
  routeButton.addEventListener("click", () => openSearch("route"));

  // --- search card: one DOM instance, only its position/size changes ----
  const panelClose = button("パネルを閉じる", "panel__close", "close");

  function pointRow(
    mode: "origin" | "destination",
    label: string,
    placeholder: string,
    name: IconName,
  ): { row: HTMLElement; input: HTMLInputElement } {
    const input = el("input", { className: "row__input" });
    input.type = "text";
    input.readOnly = true;
    input.placeholder = placeholder;
    input.setAttribute("aria-label", `${label}（タップして地図で指定）`);
    input.autocomplete = "off";
    input.addEventListener("click", () => routeStore.startPick(mode));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") routeStore.startPick(mode);
    });
    const row = el("label", { className: "row" }, [
      el("span", { className: "row__icon" }, [icon(name)]),
      el("span", { className: "row__label", text: label }),
      input,
    ]);
    return { row, input };
  }
  const { row: originField, input: origin } = pointRow("origin", "出発地", "現在地", "locate");
  // 地図で指定した出発地を、既定の現在地へ戻す。
  const useCurrent = el("button", { className: "row__action", text: "現在地" });
  useCurrent.type = "button";
  useCurrent.addEventListener("click", async () => {
    const here = await locator.locate({ recenter: false });
    if (!here) return;
    routeStore.setPoint("origin", here, "current");
    if (routeStore.getState().destination) void searchRoute();
  });
  originField.append(useCurrent);
  const { row: destinationField, input: destination } = pointRow("destination", "目的地", "地図で指定", "pin");
  const originRow = el("div", { className: "points" }, [originField, destinationField]);

  const tablist = el("div", { className: "tabs" });
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "表示の切り替え");
  const tabs = new Map<ViewId, HTMLButtonElement>();
  for (const def of TAB_VIEWS) {
    const t = el("button", { className: "tabs__tab", text: def.label });
    t.type = "button";
    t.id = `tab-${def.id}`;
    t.setAttribute("role", "tab");
    t.setAttribute("aria-controls", "view");
    t.addEventListener("click", () => setView(def.id));
    tabs.set(def.id, t);
    tablist.append(t);
  }
  tablist.addEventListener("keydown", (e) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const ids = TAB_VIEWS.map((v) => v.id);
    const current = Math.max(0, ids.indexOf(view));
    let next = current;
    if (e.key === "ArrowRight") next = (current + 1) % ids.length;
    if (e.key === "ArrowLeft") next = (current - 1 + ids.length) % ids.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = ids.length - 1;
    e.preventDefault();
    setView(ids[next]);
    tabs.get(ids[next])!.focus();
  });

  const viewTitle = el("h2", { className: "view__title" });
  const viewBody = el("div", { className: "view__body" });
  const viewBox = el("div", { className: "view" }, [viewTitle, viewBody]);
  viewBox.id = "view";
  viewBox.setAttribute("role", "tabpanel");
  viewBox.tabIndex = -1;
  // 出発地は経路ビューだけで使う。DOMは保持し、切り替えても入力値を失わない。
  const panelHeader = el("div", { className: "panel__header" }, [tablist, panelClose]);
  const panel = el("div", { className: "panel" }, [panelHeader, originRow, viewBox]);
  panel.id = "search-panel";
  panel.inert = true;
  const card = el("div", { className: "search-card" }, [panel]);

  // --- behaviour --------------------------------------------------------
  function syncRoutePanel(state = routeStore.getState()): void {
    const showRouteResults = searchOpen && view === "route" && state.status.kind !== "idle";
    card.classList.toggle("search-card--route-results", showRouteResults);
    // 結果表示中も出発地・目的地を出し、そこから変更・現在地への戻し・再検索ができるようにする。
    originRow.hidden = view !== "route";
  }

  function renderView(): void {
    const def = ALL_VIEWS.find((v) => v.id === view)!;
    viewTitle.textContent = def.label;
    for (const [id, t] of tabs) {
      const selected = id === view;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
    }
    if (tabs.has(view)) viewBox.setAttribute("aria-labelledby", `tab-${view}`);
    else viewBox.removeAttribute("aria-labelledby");
    tablist.hidden = !tabs.has(view);
    const message =
      view === "help"
        ? "使い方は準備中です。"
        : view === "about"
          ? `${APP_NAME} — 自転車のためのルート検索と、道路情報・口コミの共有。`
          : view === "settings"
          ? "車種と坂道許容度は、「経路」タブの「検索条件」で設定できます。"
          : `${def.label}は準備中です（${def.issue}で実装予定）。`;
    if (view === "route") {
      viewBody.replaceChildren(routeView);
    } else if (view === "layers") {
      layerPanel ??= renderLayerPanel(mapController);
      viewBody.replaceChildren(layerPanel);
    } else if (view === "hazards") {
      viewBody.replaceChildren(hazards!.panel);
    } else if (view === "reviews") {
      viewBody.replaceChildren(reviews!.listPanel);
    } else {
      viewBody.replaceChildren(renderState({ kind: "empty", message }));
    }
    syncRoutePanel();
  }

  /**
   * 出発地が現在地（または未指定）なら、検索の直前に現在地を取り直す。移動しながら使っても前の位置で検索しない。
   * 取得中の案内は初回（未指定）だけ出す。取得できなければ false（失敗の通知は locator が出す）。
   */
  /** searchRoute の呼び出しごとの連番。現在地を待つ間に次の検索が始まったら、古い呼び出しは何もしない。 */
  let searchGeneration = 0;

  async function refreshCurrentOrigin(): Promise<boolean> {
    const { origin, originSource } = routeStore.getState();
    if (origin && originSource !== "current") return true;
    const here = await locator.locate({ recenter: false, quiet: origin !== null, onRetry: () => void searchRoute() });
    if (!here) return false;
    // 取得を待つ間に地図で出発地を選んでいたら、そちらを優先する。
    const now = routeStore.getState();
    if (now.origin && now.originSource !== "current") return true;
    routeStore.setPoint("origin", here, "current");
    return true;
  }

  /**
   * 経路を検索する。目的地の決定・出発地の変更・「この条件で再検索」はすべてここを通る。
   * 出発地が現在地なら取り直してから検索する。初回で現在地を使えないときは、出発地を地図で指定してもらう
   * （指定後にもう一度ここへ来る）。再検索で取り直せないときは、古い位置で検索せず失敗の通知だけ出す。
   */
  async function searchRoute(): Promise<void> {
    const mine = ++searchGeneration;
    const before = routeStore.getState();
    if (before.pickMode) return;
    if (!before.destination) {
      void routeStore.search(); // 「目的地を地図で指定してください」を出す
      return;
    }
    // 現在地を取り直す間も、探索中と分かるようにパネルを開いて見せる（初回は取得中の案内を出すので開かない）。
    if (before.origin && before.originSource === "current") {
      routeStore.setPreparing(true);
      openSearch("route");
    }
    const ok = await refreshCurrentOrigin();
    // 待つ間に次の検索が始まっていたら、そちらに任せる。
    if (mine !== searchGeneration) return;
    const now = routeStore.getState();
    // 取得を待つ間に利用者が別の操作をしていたら、それを優先する。
    if (now.pickMode || now.destination !== before.destination || !ok) {
      routeStore.setPreparing(false);
      if (!ok && !now.pickMode && !now.origin) routeStore.startPick("origin");
      return;
    }
    openSearch("route");
    // 別の検索の応答待ちで search() が何もしない場合に備えて、準備中は先に解除する（同じ処理の中なので画面はちらつかない）。
    routeStore.setPreparing(false);
    void routeStore.search();
  }

  function setView(id: ViewId): void {
    view = id;
    renderView();
  }

  function openSearch(id: ViewId = view): void {
    // 指定中は何もしないようにするとメニューやレイヤーのボタンが効かなくなるので、指定をやめてから開く。
    if (routeStore.getState().pickMode) routeStore.cancelPick();
    setView(id);
    if (searchOpen) {
      syncRoutePanel();
      return;
    }
    searchOpen = true;
    // 検索カードと口コミシートは同時に開かない。
    reviews?.close();
    reviewPost?.hide();
    card.classList.add("is-open");
    panel.inert = false;
    syncRoutePanel();
    syncRouteButton();
    menuButton.hidden = true;
    (tabs.get(view) ?? viewBox).focus({ preventScroll: true });
    revealFocused();
  }

  /** restoreFocus は閉じるボタンなどキーボードで閉じたとき。地図タップで閉じたときはフォーカスを外すだけ。 */
  function closeSearch(blur: boolean, restoreFocus = false): void {
    if (!searchOpen) return;
    searchOpen = false;
    card.classList.remove("is-open");
    syncRoutePanel();
    panel.inert = true;
    syncRouteButton();
    menuButton.hidden = false;
    const active = document.activeElement;
    if (restoreFocus && !routeButton.hidden) routeButton.focus();
    else if (blur && active instanceof HTMLElement && panel.contains(active)) active.blur();
  }

  /** 経路ボタンは、パネルを開いている間と地点指定中は隠す。 */
  function syncRouteButton(): void {
    routeButton.hidden = searchOpen || routeStore.getState().pickMode !== null;
    routeButton.setAttribute("aria-expanded", String(searchOpen));
  }

  function setMenu(open: boolean, restoreFocus = true): void {
    menuOpen = open;
    drawer.classList.toggle("is-open", open);
    scrim.classList.toggle("is-open", open);
    drawer.inert = !open;
    menuButton.setAttribute("aria-expanded", String(open));
    if (open) drawerClose.focus();
    else if (restoreFocus) menuButton.focus();
  }

  /** キーボード表示で隠れないよう、フォーカス中の入力を内容領域内に収める。 */
  function revealFocused(): void {
    const active = document.activeElement;
    if (
      searchOpen &&
      active instanceof HTMLElement &&
      panel.contains(active) &&
      active.matches("input:not([readonly]), textarea, select, [contenteditable='true']")
    ) {
      active.scrollIntoView({ block: "nearest" });
    }
  }

  const syncViewport = (): void => {
    const vv = window.visualViewport;
    document.documentElement.style.setProperty("--vvh", `${vv ? vv.height : window.innerHeight}px`);
    mapController.resize();
    revealFocused();
  };

  panelClose.addEventListener("click", () => closeSearch(true, true));
  map.addEventListener("pointerdown", () => closeSearch(true));
  menuButton.addEventListener("click", () => setMenu(true));
  drawerClose.addEventListener("click", () => setMenu(false));
  scrim.addEventListener("click", () => setMenu(false));
  panel.addEventListener("focusin", revealFocused);

  // --- route search state -> map / search card ------------------------------
  let wasPicking = false;
  let shownRoute: Route | null = null;
  let shownAnalysis: RouteAnalysis | null | undefined;
  let shownSegments: readonly RouteGradientSegment[] | null = null;
  routeStore.subscribe((state) => {
    syncRoutePanel(state);
    const picking = state.pickMode !== null;
    if (picking) reviewPost?.hide();
    mapController.setPicking(picking);
    mapController.setEndpoints({ origin: state.origin, destination: state.destination });
    origin.value = state.origin ? formatOrigin(state.origin, state.originSource) : "";
    // 未指定のときは既定の「現在地」が表示されているので、地図で指定したときだけ戻すボタンを出す。
    useCurrent.hidden = state.originSource !== "map";
    destination.value = state.destination ? formatPoint(state.destination) : "";
    mapFilter.hidden = picking;
    syncRouteButton();

    // 結果が成功のときだけ経路を描く。検索中・空・失敗で古い経路を残さない。
    // 検索の準備中（目的地を決め直して現在地を取り直している間）も、古い経路は新しい経路に見えないよう外す。
    const route = state.status.kind === "success" && !state.preparing ? state.status.route : null;
    if (route !== shownRoute) {
      mapController.setRoutes(route ? [route] : []);
      if (route) mapController.fitToRoute(route);
      shownRoute = route;
      shownAnalysis = undefined;
      shownSegments = null;
    }
    const analysis = route && state.elevation.kind === "ready" ? state.elevation.analysis : null;
    if (analysis !== shownAnalysis) {
      // 区間の生成は解析が変わったときだけ行い、選択位置の更新では作り直さない。
      shownSegments = route && analysis ? buildRouteGradientSegments(route.coordinates, analysis) : null;
      if (route) mapController.setRouteGradientSegments(route.id, shownSegments);
      shownAnalysis = analysis;
    }
    link.setRoute(route, analysis, shownSegments);

    // 指定中は地図を見せるためカードを閉じ、指定が終わったら経路ビューに戻す。
    // 閉じるだけだと下へ移動するアニメーション中に案内バナーと重なるので、指定中は隠す。
    card.hidden = picking;
    if (picking) {
      reviews?.close();
      closeSearch(true);
    } else if (wasPicking) openSearch("route");
    wasPicking = picking;
  });

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (menuOpen) setMenu(false);
      else if (routeStore.getState().pickMode) routeStore.cancelPick();
      else if (reviewPost?.handleEscape()) return;
      else if (searchOpen) closeSearch(false, true);
      else if (!hazards?.closeDetail()) reviews?.handleEscape();
      return;
    }
    if (e.key === "Tab" && menuOpen) {
      const items = [...drawer.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  window.visualViewport?.addEventListener("resize", syncViewport);
  window.addEventListener("resize", syncViewport);
  syncViewport();
  renderView();

  root.replaceChildren(
    map,
    attribution,
    hazards.card,
    mapFilter,
    menuButton,
    controls,
    routeButton,
    reviews.status,
    reviews.sheet,
    reviewPost.sheet,
    reviewPost.banner,
    reviewPost.status,
    renderPickBanner(routeStore),
    locator.notice,
    card,
    scrim,
    drawer,
  );
  // MapLibre initializes while the shell is being assembled off-DOM; size it after insertion.
  mapController.resize();
}
