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
  find<HTMLButtonElement>(".search-launcher").click();
  assert(!find("#feature-panel").hidden && document.activeElement?.id === "panel-title", "検索を開いて見出しへフォーカスする");
  assert(getComputedStyle(find("#panel-title")).outlineStyle !== "none", "フォーカスした見出しに視覚的な表示がある");
  assert(connectedZoomsAreVisible(), "接続したズーム操作がパネルを開いても表示領域内にある");
  find<HTMLInputElement>("#origin").value = "東京駅";
  shell.openView("reviews");
  shell.openView("search");
  assert(find<HTMLInputElement>("#origin").value === "東京駅", "ビュー切替で入力を保持する");
  shell.closePanel();
  assert(document.activeElement?.classList.contains("search-launcher"), "閉じると起点の検索ボタンへ戻る");
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
