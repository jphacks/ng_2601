import { el } from "../../ui/dom";
import { icon, type IconName } from "../../ui/icon";
import { renderState } from "../../ui/state";
import iconLicense from "../../assets/icons/LICENSE?raw";
import "./shell.css";

export type ViewId = "search" | "preferences" | "hazards" | "reviews" | "layers" | "help" | "about";
export type MapAction = "north" | "locate" | "zoomIn" | "zoomOut";
export type LayerId = "hazards" | "reviews" | "photos";

export interface ShellOptions {
  /** Map owner mounts and disposes its map inside this element. */
  mapContent?: HTMLElement;
  /** Only connected map controls are enabled. GPS belongs to its own feature. */
  mapActions?: Partial<Record<MapAction, () => void>>;
  onLayerChange?: (layer: LayerId, visible: boolean) => void;
}

const views: Record<ViewId, { title: string; icon: IconName }> = {
  search: { title: "ルート検索", icon: "search" },
  preferences: { title: "設定", icon: "sliders" },
  hazards: { title: "道路情報", icon: "exclamation-triangle-fill" },
  reviews: { title: "口コミ", icon: "chat-dots-fill" },
  layers: { title: "地図レイヤー", icon: "layers" },
  help: { title: "使い方・ヘルプ", icon: "question-circle" },
  about: { title: "アプリ情報", icon: "info-circle" },
};

function button(label: string, iconName: IconName, className = "icon-button"): HTMLButtonElement {
  const node = el("button", { className });
  node.type = "button";
  node.setAttribute("aria-label", label);
  node.title = label;
  node.append(icon(iconName));
  return node;
}

function textButton(label: string, iconName: IconName): HTMLButtonElement {
  const node = button(label, iconName, "navigation-button");
  node.append(el("span", { text: label }), icon("arrow-right"));
  return node;
}

/** FE-02: navigation and layout. No map, GPS, search or Preferences API calls. */
export function renderShell(root: HTMLElement, options: ShellOptions = {}) {
  const shell = el("div", { className: "app-shell" });
  const map = el("main", { className: "map-surface" });
  map.id = "map-region";
  map.tabIndex = -1;
  map.setAttribute("aria-label", "地図");
  const mapHost = el("div", { className: "map-host" });
  mapHost.id = "map-host";
  mapHost.append(options.mapContent ?? renderState({
    kind: "empty", title: "地図は準備中です", description: "検索や設定はメニューから開けます。",
  }));
  // The map feature owns attribution content; this slot stays clear of floating UI.
  const attribution = el("div", { className: "map-attribution" });
  attribution.id = "map-attribution";
  map.append(mapHost, attribution);

  const skip = el("a", { className: "skip-link", text: "地図へ移動" });
  skip.href = "#map-region";
  const header = el("header", { className: "floating-header" }, [el("h1", { className: "sr-only", text: "自転車MAP" })]);
  const menuButton = button("メニューを開く", "list");
  menuButton.setAttribute("aria-haspopup", "dialog");
  menuButton.setAttribute("aria-controls", "app-menu");
  menuButton.setAttribute("aria-expanded", "false");
  header.append(menuButton);

  const searchButton = button("どこへ行く？", "search", "search-launcher");
  searchButton.append(el("span", { text: "どこへ行く？" }));
  searchButton.setAttribute("aria-controls", "feature-panel");
  searchButton.setAttribute("aria-expanded", "false");

  const controls = el("div", { className: "map-controls" });
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "地図操作");
  const layersButton = button("地図レイヤーを開く", "layers");
  layersButton.setAttribute("aria-controls", "feature-panel");
  layersButton.setAttribute("aria-expanded", "false");
  controls.append(layersButton);
  for (const [action, label, iconName] of [
    ["north", "北向きに戻す", "cursor-fill"],
    ["locate", "現在地を表示", "crosshair"],
    ["zoomIn", "拡大", "plus"],
    ["zoomOut", "縮小", "dash"],
  ] as const) {
    const control = button(label, iconName, `icon-button map-control map-control--${action}`);
    const handler = options.mapActions?.[action];
    control.disabled = !handler;
    if (handler) control.addEventListener("click", handler);
    else {
      control.title = `${label}（準備中）`;
      control.setAttribute("aria-label", control.title);
    }
    controls.append(control);
  }

  const panel = el("section", { className: "feature-panel" });
  panel.id = "feature-panel";
  panel.hidden = true;
  panel.setAttribute("aria-labelledby", "panel-title");
  const panelHeader = el("div", { className: "panel-header" });
  const panelTitle = el("h2");
  panelTitle.id = "panel-title";
  panelTitle.tabIndex = -1;
  const resizeButton = button("シートを広げる", "chevron-up", "icon-button sheet-resize");
  resizeButton.setAttribute("aria-expanded", "false");
  resizeButton.setAttribute("aria-controls", "panel-body");
  const closeButton = button("パネルを閉じる", "x-lg", "icon-button close-button");
  panelHeader.append(panelTitle, resizeButton, closeButton);
  const panelBody = el("div", { className: "panel-body" });
  panelBody.id = "panel-body";
  const panelNavigation = el("nav", { className: "panel-navigation" });
  panelNavigation.setAttribute("aria-label", "機能の切替");
  const navButtons = new Map<ViewId, HTMLButtonElement>();
  for (const view of ["search", "preferences", "hazards", "reviews"] as const) {
    const nav = button(views[view].title, views[view].icon, "panel-nav-button");
    nav.append(el("span", { text: views[view].title }));
    nav.addEventListener("click", () => openView(view, nav));
    navButtons.set(view, nav);
    panelNavigation.append(nav);
  }
  panel.append(panelHeader, panelNavigation, panelBody);

  const drawer = el("dialog", { className: "menu-drawer" });
  drawer.id = "app-menu";
  drawer.setAttribute("aria-labelledby", "menu-title");
  const drawerTitle = el("h2", { text: "自転車MAP" });
  drawerTitle.id = "menu-title";
  const closeMenu = button("メニューを閉じる", "x-lg", "icon-button close-button");
  const drawerHeader = el("div", { className: "drawer-header" }, [drawerTitle, closeMenu]);
  const drawerNav = el("nav");
  drawerNav.setAttribute("aria-label", "メインメニュー");
  for (const view of ["search", "preferences", "hazards", "reviews", "help", "about"] as const) {
    const nav = textButton(views[view].title, views[view].icon);
    nav.addEventListener("click", () => {
      drawer.close();
      openView(view, menuButton);
    });
    drawerNav.append(nav);
  }
  drawer.append(drawerHeader, drawerNav, el("p", { className: "drawer-caption", text: "いつもの道を、もっと走りやすく。" }));

  const contents = new Map<ViewId, HTMLElement>();
  const routeForm = el("div", { className: "route-fields" });
  routeForm.append(el("p", { className: "intro", text: "次は、どこへ行こう。" }));
  for (const [id, label, placeholder] of [
    ["origin", "出発地", "出発地を入力"],
    ["destination", "目的地", "目的地を入力"],
  ]) {
    const input = el("input");
    input.type = "text";
    input.id = id;
    input.name = id;
    input.placeholder = placeholder;
    input.autocomplete = "off";
    const inputLabel = el("label", { text: label });
    inputLabel.htmlFor = id;
    routeForm.append(el("div", { className: "field" }, [inputLabel, input]));
  }
  const preferencesLink = textButton("経路の設定", "sliders");
  preferencesLink.addEventListener("click", () => openView("preferences", preferencesLink));
  routeForm.append(preferencesLink, renderState({
    kind: "empty", title: "ルート検索は準備中です", description: "目的地までのルートを、ここから探せるようになります。",
  }));
  contents.set("search", routeForm);
  for (const [view, title, description] of [
    ["preferences", "設定は準備中です", "車種や坂道の走りやすさを設定できるようになります。"],
    ["hazards", "道路情報は準備中です", "坂道や工事など、走行時に気をつけたい情報をここに表示します。"],
    ["reviews", "口コミは準備中です", "自転車で走った人の声をここに表示します。"],
  ] as const) contents.set(view, renderState({ kind: "empty", title, description }));

  const layerContent = el("div");
  layerContent.append(el("p", { className: "muted", text: "地図に表示する情報を選べます。地図の表示は準備中です。" }));
  for (const [id, label, iconName] of [
    ["hazards", "危険情報", "exclamation-triangle-fill"],
    ["reviews", "口コミ", "chat-dots-fill"],
    ["photos", "写真スポット", "camera-fill"],
  ] as const) {
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.addEventListener("change", () => options.onLayerChange?.(id, checkbox.checked));
    layerContent.append(el("label", { className: `layer-option layer-option--${id}` }, [
      icon(iconName), el("span", { text: label }), checkbox,
    ]));
  }
  contents.set("layers", layerContent);
  contents.set("help", el("div", { className: "prose" }, [
    el("h3", { text: "地図から、行きたい場所へ" }),
    el("p", { text: "画面下の「どこへ行く？」を押すと、出発地・目的地の入力欄が開きます。" }),
    el("h3", { text: "自分に合った走り方" }),
    el("p", { text: "左上のメニューから設定・道路情報・口コミへ移動できます。" }),
    el("h3", { text: "地図を広く見る" }),
    el("p", { text: "閉じるボタンかEscキーでパネルを閉じられます。スマホでは上向き・下向きのボタンでシートの高さを切り替えられます。" }),
    el("h3", { text: "準備中の機能" }),
    el("p", { text: "地図・経路検索・設定の保存・現在地の表示は準備中です。利用できるようになるまでお待ちください。" }),
  ]));
  const iconLink = el("a", { text: "Bootstrap Icons v1.13.1（MIT）" });
  iconLink.href = "https://icons.getbootstrap.com/";
  contents.set("about", el("div", { className: "prose" }, [
    el("h3", { text: "自転車MAP" }), el("p", { text: "自転車で走る道を探すための地図アプリです。" }),
    el("h3", { text: "アイコン" }), iconLink,
    el("details", {}, [
      el("summary", { text: "ライセンス全文" }),
      el("pre", { className: "license-text", text: iconLicense }),
    ]),
  ]));

  let currentView: ViewId | null = null;
  let returnFocus: HTMLElement = searchButton;
  let expanded = false;

  function updateExpanded() {
    shell.dataset.expanded = String(expanded);
    resizeButton.replaceChildren(icon(expanded ? "chevron-down" : "chevron-up"));
    resizeButton.setAttribute("aria-label", expanded ? "シートを小さくする" : "シートを広げる");
    resizeButton.title = expanded ? "シートを小さくする" : "シートを広げる";
    resizeButton.setAttribute("aria-expanded", String(expanded));
  }

  function openView(view: ViewId, trigger?: HTMLElement) {
    if (drawer.open) drawer.close();
    if (!currentView) {
      returnFocus = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : searchButton);
      expanded = false;
    }
    currentView = view;
    shell.dataset.panelOpen = "true";
    panel.hidden = false;
    panelTitle.textContent = views[view].title;
    panelBody.replaceChildren(contents.get(view)!);
    panelBody.scrollTop = 0;
    for (const [id, nav] of navButtons) {
      if (id === view) nav.setAttribute("aria-current", "page");
      else nav.removeAttribute("aria-current");
    }
    searchButton.setAttribute("aria-expanded", String(view === "search"));
    layersButton.setAttribute("aria-expanded", String(view === "layers"));
    updateExpanded();
    panelTitle.focus({ preventScroll: true });
  }

  function closePanel() {
    if (!currentView) return;
    currentView = null;
    panel.hidden = true;
    shell.dataset.panelOpen = "false";
    searchButton.setAttribute("aria-expanded", "false");
    layersButton.setAttribute("aria-expanded", "false");
    if (returnFocus.isConnected && !panel.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
    else searchButton.focus({ preventScroll: true });
  }

  searchButton.addEventListener("click", () => openView("search", searchButton));
  layersButton.addEventListener("click", () => openView("layers", layersButton));
  closeButton.addEventListener("click", closePanel);
  resizeButton.addEventListener("click", () => { expanded = !expanded; updateExpanded(); });
  menuButton.addEventListener("click", () => {
    drawer.showModal();
    menuButton.setAttribute("aria-expanded", "true");
    closeMenu.focus();
  });
  closeMenu.addEventListener("click", () => drawer.close());
  drawer.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const buttons = drawer.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  drawer.addEventListener("close", () => menuButton.setAttribute("aria-expanded", "false"));
  drawer.addEventListener("click", (event) => {
    if (event.target !== drawer) return;
    const rect = drawer.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) drawer.close();
  });
  shell.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !drawer.open && currentView) {
      event.preventDefault();
      closePanel();
    }
  });

  // Use the visible viewport so a virtual keyboard cannot cover sheet controls.
  const viewport = window.visualViewport;
  const syncViewport = () => {
    shell.style.setProperty("--viewport-height", `${viewport?.height ?? window.innerHeight}px`);
    shell.style.setProperty("--viewport-top", `${viewport?.offsetTop ?? 0}px`);
  };
  viewport?.addEventListener("resize", syncViewport);
  viewport?.addEventListener("scroll", syncViewport);
  window.addEventListener("resize", syncViewport);
  syncViewport();
  shell.append(skip, map, header, controls, searchButton, panel, drawer);
  root.replaceChildren(shell);

  return {
    mapHost,
    attribution,
    openView,
    closePanel,
    /** Feature owners supply their own content/state without changing the shell. */
    setViewContent(view: ViewId, content: HTMLElement) {
      contents.set(view, content);
      if (currentView === view) panelBody.replaceChildren(content);
    },
    destroy() {
      if (drawer.open) drawer.close();
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
      shell.remove();
    },
  };
}
