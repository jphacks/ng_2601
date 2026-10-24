import "./shell.css";
import { el } from "../../ui/dom";
import { icon, type IconName } from "../../ui/icon";
import { renderState } from "../../ui/state";
import { renderLayerPanel } from "../map/layerPanel";
import { mountMap, type MapController } from "../map/map";
import { ATTRIBUTION } from "../map/style";
import { mockHazards, mockReviewLocations, mockReviews, mockRoutes } from "../../mocks/data";

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

  // --- map area ---------------------------------------------------------
  const map = el("div", { className: "map" });
  map.setAttribute("role", "region");
  map.setAttribute("aria-label", "地図エリア");
  const mapController: MapController = mountMap(map);
  // 経路・危険情報・口コミのAPI接続（#6/#11/#12）までは、モックを重ねて表示を確認できるようにする。
  mapController.setRoutes(mockRoutes);
  mapController.setHazards(mockHazards);
  mapController.setReviews(
    mockReviews.flatMap((review) => {
      const lngLat = mockReviewLocations[review.id];
      return lngLat ? [{ review, lngLat }] : [];
    }),
  );
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
  const input = el("input", { className: "bar__input" });
  input.type = "text";
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
  origin.placeholder = "出発地（現在地）";
  origin.setAttribute("aria-label", "出発地");
  origin.autocomplete = "off";
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
  function renderView(): void {
    const def = ALL_VIEWS.find((v) => v.id === view)!;
    viewTitle.textContent = def.label;
    originRow.hidden = view !== "route";
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
          : `${def.label}は準備中です（${def.issue}で実装予定）。`;
    viewBody.replaceChildren(view === "layers" ? renderLayerPanel(mapController) : renderState({ kind: "empty", message }));
  }

  function setView(id: ViewId): void {
    view = id;
    renderView();
  }

  function openSearch(id: ViewId = view): void {
    setView(id);
    if (searchOpen) return;
    searchOpen = true;
    card.classList.add("is-open");
    panel.inert = false;
    barClose.hidden = false;
    menuButton.hidden = true;
    input.focus({ preventScroll: true });
    revealFocused();
  }

  function closeSearch(blur: boolean): void {
    if (!searchOpen) return;
    searchOpen = false;
    card.classList.remove("is-open");
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
    if (searchOpen && active instanceof HTMLElement && panel.contains(active)) {
      active.scrollIntoView({ block: "nearest" });
    }
  }

  const syncViewport = (): void => {
    const vv = window.visualViewport;
    document.documentElement.style.setProperty("--vvh", `${vv ? vv.height : window.innerHeight}px`);
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

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (menuOpen) setMenu(false);
      else if (searchOpen) closeSearch(false);
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

  root.replaceChildren(map, attribution, menuButton, controls, card, scrim, drawer);
}
