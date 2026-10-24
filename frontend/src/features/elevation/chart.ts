import type { ProfilePoint } from "./profile";
import type { RouteGradientSegment } from "./gradientSegments";
import { describeSelection, type RouteSelection } from "./selection";
import { formatDistance, formatElevation } from "./format";
import { el } from "../../ui/dom";

const NS = "http://www.w3.org/2000/svg";
function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** viewBox は固定。横幅に合わせて等倍で拡大し、縦は自動で比率を保つ。 */
const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 195;
const PLOT = { left: 68, right: 304, top: 27, bottom: 147 } as const;
const CURSOR_MARK_SIZE = 9;
/** スライダーのキーボード操作（←→）の移動量。DEMの5m・10mメッシュより粗くしない。 */
const SLIDER_STEP_M = 10;

interface ChartScale {
  svg: SVGSVGElement;
  x(distanceM: number): number;
  y(elevationM: number): number;
  total: number;
}

/** 標高プロファイルのSVG。累積距離×推定標高。欠測をまたがず、孤立した有効点も丸印で表示する。 */
function buildChart(points: readonly ProfilePoint[]): ChartScale | null {
  const svg = svgEl("svg", {
    viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`,
    class: "elevation__chart",
    role: "img",
    "aria-label": "標高プロファイル。横軸は経路に沿った距離、縦軸は推定標高。欠測区間では線が途切れます。",
  });
  const valid = points.filter((p) => p.elevation !== null && Number.isFinite(p.elevation));
  const total = points.at(-1)?.distance ?? 0;
  if (!valid.length || total <= 0) return null;
  const values = valid.map((p) => p.elevation!);
  let min = Math.min(...values), max = Math.max(...values);
  const range = Math.max(10, max - min);
  const middle = (max + min) / 2;
  min = middle - range / 2; max = middle + range / 2;
  const plotWidth = PLOT.right - PLOT.left;
  const plotHeight = PLOT.bottom - PLOT.top;
  const x = (d: number) => PLOT.left + d / total * plotWidth;
  const y = (e: number) => PLOT.top + (max - e) / range * plotHeight;
  svg.append(svgEl("text", { x: "12", y: "14", class: "elevation__axis-label" }, "標高 (m)"));
  for (let i = 0; i <= 2; i++) {
    const elevation = min + range * i / 2;
    svg.append(
      svgEl("line", { x1: String(PLOT.left), x2: String(PLOT.right), y1: String(y(elevation)), y2: String(y(elevation)), class: "elevation__grid" }),
      svgEl("text", { x: "62", y: String(y(elevation) + 4), "text-anchor": "end", class: "elevation__axis-label" }, formatElevation(elevation).replace(" m", "")),
      svgEl("text", { x: String(x(total * i / 2)), y: "166", "text-anchor": i === 0 ? "start" : i === 2 ? "end" : "middle", class: "elevation__axis-label" }, formatDistance(total * i / 2)),
    );
  }
  svg.append(svgEl("text", { x: String(PLOT.right), y: "188", "text-anchor": "end", class: "elevation__axis-label" }, "経路に沿った距離"));
  let path = "", pen = false;
  for (const p of points) {
    if (p.elevation === null || !Number.isFinite(p.elevation)) { pen = false; continue; }
    path += `${pen ? "L" : "M"}${x(p.distance).toFixed(2)} ${y(p.elevation).toFixed(2)} `;
    pen = true;
    svg.append(svgEl("circle", { cx: String(x(p.distance)), cy: String(y(p.elevation)), r: "1.6", class: "elevation__point" }));
  }
  svg.append(svgEl("path", { d: path.trim(), class: "elevation__line", fill: "none", "stroke-width": "2", "vector-effect": "non-scaling-stroke" }));
  return { svg, x, y, total };
}

export interface ProfileChartHandlers {
  /** 利用者がグラフ上で位置を選んだとき。distanceM は経路に沿った距離(m)。 */
  onSelect(distanceM: number): void;
}

export interface ProfileChart {
  /** グラフ・スライダー・数値表示をまとめた要素。 */
  element: HTMLElement;
  /** 外部（地図の区間選択など）で決まった選択位置を反映する。null は未選択。 */
  apply(selection: RouteSelection | null, segment: RouteGradientSegment | null): void;
}

let chartSequence = 0;

/**
 * 標高プロファイルと選択位置の表示。
 * ポインタ操作は requestAnimationFrame で1フレーム1回にまとめ、低頻度の描画だけを行う。
 * キーボードはスライダー、タッチはタップした位置で選ぶ。地図側からも同じ apply() で位置を反映する。
 */
export function createProfileChart(points: readonly ProfilePoint[], handlers: ProfileChartHandlers): ProfileChart {
  const element = el("div", { className: "elevation__chart-block" });
  const scale = buildChart(points);
  if (!scale) {
    element.append(svgEl("svg", {
      viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`,
      class: "elevation__chart",
      role: "img",
      "aria-label": "標高プロファイル。表示できる推定標高がありません。",
    }));
    return { element, apply: () => undefined };
  }
  const { svg, x, y, total } = scale;
  chartSequence += 1;
  const sliderId = `elevation-position-${chartSequence}`;
  const hintId = `elevation-position-hint-${chartSequence}`;

  // --- 選択位置の描画（縦の破線＋標高の点。欠測時は軸上の四角） ---------
  const cursor = svgEl("g", { class: "elevation__cursor" });
  const cursorLine = svgEl("line", {
    class: "elevation__cursor-line",
    x1: String(PLOT.left), x2: String(PLOT.left), y1: String(PLOT.top), y2: String(PLOT.bottom),
  });
  const cursorDot = svgEl("circle", { class: "elevation__cursor-dot", cx: String(PLOT.left), cy: String(PLOT.bottom), r: "4" });
  const cursorGap = svgEl("rect", {
    class: "elevation__cursor-gap",
    x: String(PLOT.left - CURSOR_MARK_SIZE / 2), y: String(PLOT.bottom - CURSOR_MARK_SIZE / 2),
    width: String(CURSOR_MARK_SIZE), height: String(CURSOR_MARK_SIZE),
  });
  cursor.append(cursorLine, cursorDot, cursorGap);
  cursor.setAttribute("hidden", "");

  // グラフ全体でポインタを受け取る透明な矩形。カーソルは pointer-events: none で下へ通す。
  const hit = svgEl("rect", {
    class: "elevation__hit",
    x: String(PLOT.left - 6),
    y: String(PLOT.top - 8),
    width: String(PLOT.right - PLOT.left + 12),
    height: String(PLOT.bottom - PLOT.top + 16),
    fill: "transparent",
    "pointer-events": "all",
  });
  svg.append(hit, cursor);

  // 1フレーム1回だけ選択位置を反映する。pointermove の高頻度イベントで再描画しない。
  let frameId = 0;
  let pendingClientX: number | null = null;
  function distanceFromClientX(clientX: number): number {
    const rect = svg.getBoundingClientRect();
    if (!(rect.width > 0)) return 0;
    const viewX = ((clientX - rect.left) / rect.width) * VIEW_WIDTH;
    const clamped = Math.min(PLOT.right, Math.max(PLOT.left, viewX));
    return (clamped - PLOT.left) / (PLOT.right - PLOT.left) * total;
  }
  function flush(): void {
    frameId = 0;
    if (pendingClientX === null) return;
    const clientX = pendingClientX;
    pendingClientX = null;
    handlers.onSelect(distanceFromClientX(clientX));
  }
  function schedule(clientX: number): void {
    pendingClientX = clientX;
    if (!frameId) frameId = requestAnimationFrame(flush);
  }

  let touchStart: { x: number; y: number } | null = null;
  hit.addEventListener("pointermove", (event) => {
    // タッチのpointermoveはスクロール中の移動も含むため、タップ判定(pointerup)だけで選ぶ。
    if (event.pointerType === "touch") return;
    schedule(event.clientX);
  });
  hit.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") {
      touchStart = { x: event.clientX, y: event.clientY };
      return;
    }
    schedule(event.clientX);
  });
  hit.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "touch") return;
    const start = touchStart;
    touchStart = null;
    if (!start) return;
    // 指が動いていたらスクロール操作として扱い、位置を変えない。
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
    schedule(event.clientX);
  });
  hit.addEventListener("pointercancel", () => { touchStart = null; });

  // --- キーボード・タッチ用のスライダー ---------------------------------
  const slider = el("input", { className: "elevation__slider-input" });
  slider.type = "range";
  slider.min = "0";
  slider.max = String(Math.max(SLIDER_STEP_M, Math.round(total)));
  slider.step = String(SLIDER_STEP_M);
  slider.value = "0";
  slider.id = sliderId;
  slider.setAttribute("aria-describedby", hintId);
  slider.setAttribute("aria-label", "標高グラフの選択位置（経路に沿った距離）");
  slider.setAttribute("aria-valuetext", "未選択");
  slider.addEventListener("input", () => handlers.onSelect(Number(slider.value)));
  const sliderLabel = el("label", { className: "elevation__slider-label", text: "グラフ位置（←→キー・10m単位）" });
  sliderLabel.htmlFor = sliderId;

  const hint = el("p", {
    className: "elevation__hint",
    text: "グラフ上を移動するか、スライダー（←→キー）で位置を選べます。欠測区間は「不明」と表示し、0m・0%としては扱いません。地図のルート区間をタップしても同じ位置を選べます。",
  });
  hint.id = hintId;
  svg.setAttribute("aria-describedby", hintId);

  // --- 数値表示（色だけに依存しない） -----------------------------------
  const emptyText = "位置を選ぶと、対応するルート位置・推定標高・100m平均勾配を表示します。";
  const readout = el("p", { className: "elevation__readout", text: emptyText });
  readout.setAttribute("role", "status");
  readout.setAttribute("aria-live", "polite");
  readout.setAttribute("aria-atomic", "true");

  element.append(svg, el("div", { className: "elevation__slider" }, [sliderLabel, slider]), readout, hint);

  function apply(selection: RouteSelection | null, segment: RouteGradientSegment | null): void {
    if (!selection) {
      cursor.setAttribute("hidden", "");
      readout.textContent = emptyText;
      slider.setAttribute("aria-valuetext", "未選択");
      return;
    }
    cursor.removeAttribute("hidden");
    const cursorX = x(selection.distanceM);
    cursorLine.setAttribute("x1", String(cursorX));
    cursorLine.setAttribute("x2", String(cursorX));
    if (selection.elevation === null) {
      cursorDot.setAttribute("hidden", "");
      cursorGap.removeAttribute("hidden");
      cursorGap.setAttribute("x", String(cursorX - CURSOR_MARK_SIZE / 2));
    } else {
      cursorGap.setAttribute("hidden", "");
      cursorDot.removeAttribute("hidden");
      cursorDot.setAttribute("cx", String(cursorX));
      cursorDot.setAttribute("cy", String(y(selection.elevation)));
    }
    slider.value = String(Math.round(selection.distanceM));
    const details = describeSelection(selection, segment);
    const grade = details.window ? `${details.grade}（100m窓 ${details.window}）` : details.grade;
    readout.textContent = `${details.distance} ／ 標高 ${details.elevation} ／ ${grade}`;
    slider.setAttribute("aria-valuetext", `${details.distance}、標高 ${details.elevation}、${grade}`);
  }

  return { element, apply };
}
