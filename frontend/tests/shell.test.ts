import { renderShell, type MapAction } from "../src/features/shell/render";
import { renderState } from "../src/ui/state";

// Real DOM integration checks, run by opening /tests/shell.html on the dev server.
// No test framework/runtime dependencies; layout and keyboard checks remain manual.
const root = document.getElementById("fixture")!;
const report = document.getElementById("results")!;
const passed: string[] = [];
let activeShell: ReturnType<typeof renderShell> | undefined;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  passed.push(message);
}

function find<T extends HTMLElement>(selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Missing: ${selector}`);
  return node;
}

function connectedZoomsAreVisible(): boolean {
  return [".map-control--zoomIn", ".map-control--zoomOut"].every((selector) => {
    const control = find<HTMLButtonElement>(selector);
    const rect = control.getBoundingClientRect();
    return !control.disabled && getComputedStyle(control).display !== "none"
      && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0
      && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
  });
}

function finishAnimations() {
  for (const animation of root.getAnimations({ subtree: true })) animation.finish();
}

try {
  activeShell = renderShell(root);
  assert(find("#feature-panel").hidden, "初期表示ではパネルが閉じている");
  assert(root.querySelectorAll(".map-control:disabled").length === 4, "未接続の地図・GPS操作は無効");
  activeShell.destroy();

  const map = document.createElement("button");
  map.textContent = "地図操作のテスト";
  let mapClicks = 0;
  map.addEventListener("click", () => mapClicks++);
  const actions: MapAction[] = [];
  const layerChanges: string[] = [];
  activeShell = renderShell(root, {
    mapContent: map,
    mapActions: {
      north: () => actions.push("north"),
      locate: () => actions.push("locate"),
      zoomIn: () => actions.push("zoomIn"),
      zoomOut: () => actions.push("zoomOut"),
    },
    onLayerChange: (layer, visible) => layerChanges.push(`${layer}:${visible}`),
  });
  const shell = activeShell;
  assert(connectedZoomsAreVisible(), "接続したズーム操作が閉じた画面でも表示領域内にある");
  for (const control of root.querySelectorAll<HTMLButtonElement>(".map-control")) control.click();
  assert(actions.join() === "north,locate,zoomIn,zoomOut", "接続した地図操作を対応するハンドラへ渡す");
  shell.attribution.textContent = "Test attribution";
  const searchBar = find<HTMLButtonElement>(".search-launcher");
  let launcherEvents = 0;
  searchBar.addEventListener("click", () => launcherEvents++);
  searchBar.click();
  finishAnimations();
  assert(!find("#feature-panel").hidden && document.activeElement === searchBar, "検索を開いて同じ検索バーへフォーカスする");
  assert(getComputedStyle(searchBar).outlineStyle !== "none", "フォーカスした検索バーに視覚的な表示がある");
  const barRect = searchBar.getBoundingClientRect();
  const searchPanelRect = find("#feature-panel").getBoundingClientRect();
  assert(searchBar.parentElement === find(".app-shell") && !find("#feature-panel").contains(searchBar)
    && root.querySelectorAll(".search-launcher").length === 1 && barRect.width > innerWidth * .85
    && barRect.bottom < searchPanelRect.top, "同じ検索バーだけをパネル外の上部全幅で表示する");
  assert(innerWidth < 768
    ? searchPanelRect.width > innerWidth * .85 && searchPanelRect.height <= innerHeight * .7
    : searchPanelRect.width < innerWidth * .6 && searchPanelRect.left < innerWidth * .1,
    "PCは左パネル、スマホは画面幅に合う高さ制限付きパネルを表示する");
  const originInput = find<HTMLInputElement>("#origin");
  const destinationInput = find<HTMLInputElement>("#destination");
  destinationInput.value = "上野公園";
  assert(root.querySelectorAll('input[type="text"]').length === 2, "新しい検索入力欄を増やさない");
  const routeOptions = find<HTMLDetailsElement>(".route-options");
  assert(!routeOptions.open, "経路設定は既存入力の後ろで折りたたむ");
  routeOptions.open = true;
  find<HTMLButtonElement>(".route-options .navigation-button").click();
  const settingsOpened = find("#panel-title").textContent === "設定";
  shell.openView("search");
  assert(settingsOpened && find(".route-options") === routeOptions && routeOptions.open,
    "既存設定への導線と折りたたみ状態をタブ切替後も維持する");
  assert(connectedZoomsAreVisible(), "接続したズーム操作がパネルを開いても表示領域内にある");
  find<HTMLInputElement>("#origin").value = "東京駅";
  shell.openView("reviews");
  shell.openView("search");
  assert(find<HTMLInputElement>("#origin").value === "東京駅", "ビュー切替で入力を保持する");
  assert(find(".search-launcher") === searchBar && find("#origin") === originInput && find("#destination") === destinationInput
    && destinationInput.value === "上野公園", "タブ切替でも検索バーと入力DOM・目的地を保持する");
  shell.closePanel();
  assert(document.activeElement?.classList.contains("search-launcher"), "閉じると起点の検索ボタンへ戻る");
  assert(searchBar.parentElement?.classList.contains("app-shell") && !find("#feature-panel").contains(searchBar)
    && root.querySelectorAll(".search-launcher").length === 1, "閉じると元の検索バーだけが下部へ戻る");
  searchBar.click();
  assert(launcherEvents === 2 && find("#origin") === originInput && originInput.value === "東京駅"
    && find("#destination") === destinationInput && destinationInput.value === "上野公園", "再配置後も既存ハンドラと入力状態を維持する");
  shell.closePanel();
  assert(shell.mapHost.firstElementChild === map && shell.attribution.textContent === "Test attribution", "切替後も同じ地図DOMと帰属表示を保持する");
  map.click();
  assert(mapClicks === 1, "パネル切替後も地図側のイベントを保持する");

  shell.openView("layers");
  const hazardLayer = find<HTMLInputElement>(".layer-option--hazards input");
  hazardLayer.click();
  shell.closePanel();
  shell.openView("layers");
  assert(!find<HTMLInputElement>(".layer-option--hazards input").checked && layerChanges.join() === "hazards:false", "レイヤー選択を保持して変更を通知する");

  shell.openView("hazards");
  shell.setViewContent("hazards", renderState({ kind: "loading", title: "読み込み中" }));
  assert(find(".view-state").getAttribute("role") === "status" && find(".view-state").getAttribute("aria-busy") === "true", "ロード中を支援技術に通知する");
  shell.setViewContent("hazards", renderState({ kind: "empty", title: "情報がありません" }));
  assert(find(".view-state").getAttribute("role") === "status" && !find(".view-state").hasAttribute("aria-busy"), "空状態では読み込み中を解除する");
  let retries = 0;
  shell.setViewContent("hazards", renderState({ kind: "error", title: "読み込めませんでした", retry: () => retries++ }));
  find<HTMLButtonElement>(".secondary-button").click();
  assert(find(".view-state").getAttribute("role") === "alert" && retries === 1, "エラーを通知して再試行を呼び出す");
  find<HTMLButtonElement>(".secondary-button").focus();
  shell.setViewContent("hazards", renderState({ kind: "loading", title: "読み込み中" }));
  assert(document.activeElement?.id === "panel-title", "表示更新で削除したボタンのフォーカスを見出しへ戻す");
  map.focus();
  shell.setViewContent("hazards", renderState({ kind: "empty", title: "情報がありません" }));
  assert(document.activeElement === map, "表示更新時にパネル外のフォーカスを奪わない");
  shell.setViewContent("reviews", renderState({ kind: "empty", title: "口コミがありません" }));
  assert(document.activeElement === map && find("#panel-title").textContent === "道路情報", "非表示ビューの更新で表示とフォーカスを変えない");
  shell.closePanel();

  const attributionLink = document.createElement("a");
  attributionLink.href = "https://example.com/";
  attributionLink.textContent = "Test map attribution. ".repeat(100) + "x".repeat(400);
  shell.attribution.replaceChildren(attributionLink);
  const waitForLayout = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await waitForLayout();
  const attributionRect = shell.attribution.getBoundingClientRect();
  assert(attributionRect.width <= innerWidth && attributionRect.height > 24 && attributionRect.height <= 65
    && shell.attribution.scrollHeight > shell.attribution.clientHeight, "長い帰属表示を折り返し、上限を超えた内容はスクロールできる");
  shell.attribution.focus();
  assert(document.activeElement === shell.attribution, "長い帰属表示のスクロール領域へキーボードでフォーカスできる");
  assert(find(".search-launcher").getBoundingClientRect().bottom <= attributionRect.top
    && find(".map-controls").getBoundingClientRect().bottom <= attributionRect.top, "折り返した帰属表示と検索・地図操作が重ならない");
  shell.openView("search");
  assert(find("#feature-panel").getBoundingClientRect().bottom <= attributionRect.top, "折り返した帰属表示とパネルが重ならない");
  shell.closePanel();
  shell.attribution.replaceChildren();
  await waitForLayout();
  assert(getComputedStyle(find(".app-shell")).getPropertyValue("--attribution-space").trim() === "24px", "帰属表示を空にすると元の余白へ戻る");

  find<HTMLButtonElement>(".floating-header button").click();
  const drawer = find<HTMLDialogElement>("#app-menu");
  const drawerButtons = drawer.querySelectorAll<HTMLButtonElement>("button");
  drawerButtons[0].focus();
  drawerButtons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
  assert(document.activeElement === drawerButtons[drawerButtons.length - 1], "メニューのShift+Tabは末尾へ循環する");
  drawerButtons[drawerButtons.length - 1].dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  assert(document.activeElement === drawerButtons[0], "メニューのTabは先頭へ循環する");
  shell.destroy();
  activeShell = undefined;
  assert(!root.firstChild && !drawer.open, "破棄時にモーダルとシェルを取り除く");
  report.textContent = `PASS (${passed.length})\n\n${passed.join("\n")}`;
} catch (error) {
  activeShell?.destroy();
  report.setAttribute("role", "alert");
  report.textContent = `FAIL after ${passed.length} checks\n${String(error)}`;
  console.error(error);
}
