import "./shell.css";
import { el } from "../../ui/dom";
import { icon, type IconName } from "../../ui/icon";
import { renderState } from "../../ui/state";
import { api, isMockApi } from "../../api";
import { createHazardsFeature, type HazardsFeature } from "../hazards/hazardsFeature";
import { renderLayerPanel } from "../map/layerPanel";
import { mountMap, type MapController } from "../map/map";
import { ATTRIBUTION } from "../map/style";
import { formatPoint, renderPickBanner, renderRouteView } from "../route/renderRoute";
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

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  // 地点指定モード中の地図タップだけを出発地／目的地として使う。
  // ルート区間のタップは標高グラフの選択位置へ送る（#9）。
  const mapController: MapController = mountMap(map, {
    onPick: (lngLat) => {
      if (routeStore.pick(lngLat)) return true;
      reviews?.openNear(lngLat);
      return true;
    },
    onSelectRoadInfo: (id) => {
      if (id) reviews?.close();
      hazards?.select(id, "map");
    },
    onSelectRouteSegment: (distanceM) => link.select(distanceM),
  });
  const link: RouteLink = createRouteLink(mapController);
  const routeView = renderRouteView(routeStore, prefsStore, link);
  void prefsStore.load();
  hazards = createHazardsFeature({
    map: mapController,
    client: api,
    mock: isMockApi,
    // スマホでは一覧パネルが詳細カードを覆うため、一覧から選んだら閉じて地図と詳細を見せる。
    onSelect: (fromList) => {
      reviews?.close();
      if (fromList && window.matchMedia("(max-width: 767px)").matches) closeSearch(false);
    },
  });
  reviews = createReviewsFeature({
    map: mapController,
    client: api,
    getRoadInfo: () => hazards?.getVisibleItems() ?? [],
    onOpen: () => {
      hazards?.closeDetail();
      closeSearch(false);
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
  for (const id of ["settings", "help", "about"] as const) {
    const def = ALL_VIEWS.find((v) => v.id === id)!;
    const item = el("button", { className: "drawer__item", text: def.label });
    item.type = "button";
    item.addEventListener("click", () => {
      setMenu(false, false);
      openSearch(id);
    });
    drawerItems.append(el("li", {}, [item]));
  }
  drawer.append(el("h2", { className: "drawer__title", text: "Nature Ride" }), drawerItems, drawerClose);

  // --- map controls (right) ---------------------------------------------
  const unavailable = "準備中です";
  const layersButton = button("地図レイヤー", "float-button", "layers");
  layersButton.addEventListener("click", () => openSearch("layers"));
  const compass = button("方位をリセット", "float-button float-button--accent", "compass");
  compass.addEventListener("click", () => mapController.resetNorth());
  const zoomIn = button("ズームイン", "float-button map-controls__zoom", "plus");
  zoomIn.addEventListener("click", () => mapController.zoomIn());
  const zoomOut = button("ズームアウト", "float-button map-controls__zoom", "minus");
  zoomOut.addEventListener("click", () => mapController.zoomOut());
  // 現在地はGPS対応（#14）で接続する。
  const locate = button(`現在地を表示（${unavailable}）`, "float-button", "locate");
  locate.disabled = true;
  locate.title = unavailable;
  const controls = el("div", { className: "map-controls" }, [layersButton, compass, locate, zoomIn, zoomOut]);

  // --- search card: one DOM instance, only its position/size changes ----
  // 住所検索（ジオコーディング）は未対応のため、目的地・出発地は地図で指定した地点を表示するだけの読み取り専用。
  const input = el("input", { className: "bar__input" });
  input.type = "text";
  input.readOnly = true;
  input.placeholder = "どこへ行く？";
  input.setAttribute("aria-label", "目的地");
  input.autocomplete = "off";
  const barClose = button("検索を閉じる", "bar__close", "close");
  barClose.hidden = true;
  const bar = el("div", { className: "bar" }, [
    el("span", { className: "bar__icon" }, [icon("search")]),
    input,
    barClose,
  ]);

  const origin = el("input", { className: "row__input" });
  origin.type = "text";
  origin.readOnly = true;
  origin.placeholder = "出発地（タップして地図で指定）";
  origin.setAttribute("aria-label", "出発地");
  origin.autocomplete = "off";
  origin.addEventListener("click", () => routeStore.startPick("origin"));
  origin.addEventListener("keydown", (e) => {
    if (e.key === "Enter") routeStore.startPick("origin");
  });
  const originRow = el("label", { className: "row" }, [
    el("span", { className: "row__icon" }, [icon("pin")]),
    origin,
  ]);

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
  const panel = el("div", { className: "panel" }, [originRow, tablist, viewBox]);
  panel.inert = true;
  const card = el("div", { className: "search-card" }, [bar, panel]);

  // --- behaviour --------------------------------------------------------
  function syncRoutePanel(state = routeStore.getState()): void {
    const showRouteResults = searchOpen && view === "route" && state.status.kind !== "idle";
    card.classList.toggle("search-card--route-results", showRouteResults);
    bar.hidden = showRouteResults;
    originRow.hidden = view !== "route" || showRouteResults;
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
          ? "Nature Ride — 自然の中を走る自転車ルート。"
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
    card.classList.add("is-open");
    panel.inert = false;
    syncRoutePanel();
    barClose.hidden = false;
    menuButton.hidden = true;
    input.focus({ preventScroll: true });
    revealFocused();
  }

  function closeSearch(blur: boolean): void {
    if (!searchOpen) return;
    searchOpen = false;
    card.classList.remove("is-open");
    syncRoutePanel();
    panel.inert = true;
    barClose.hidden = true;
    menuButton.hidden = false;
    if (blur) input.blur();
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

  input.addEventListener("click", () => openSearch());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "ArrowDown") openSearch();
  });
  barClose.addEventListener("click", () => closeSearch(true));
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
    mapController.setPicking(picking);
    mapController.setEndpoints({ origin: state.origin, destination: state.destination });
    origin.value = state.origin ? formatPoint(state.origin) : "";
    input.value = state.destination ? formatPoint(state.destination) : "";

    // 結果が成功のときだけ経路を描く。検索中・空・失敗で古い経路を残さない。
    const route = state.status.kind === "success" ? state.status.route : null;
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
      else if (searchOpen) closeSearch(false);
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

  root.replaceChildren(map, attribution, hazards.card, menuButton, controls, renderPickBanner(routeStore), reviews.status, reviews.sheet, card, scrim, drawer);
  // MapLibre initializes while the shell is being assembled off-DOM; size it after insertion.
  mapController.resize();
}
