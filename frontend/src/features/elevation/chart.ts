import type { ProfilePoint } from "./profile";
import { formatDistance, formatElevation } from "./format";

const NS = "http://www.w3.org/2000/svg";
function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 累積距離×推定標高。欠測をまたがず、孤立した有効点も丸印で表示する。 */
export function renderProfileChart(points: readonly ProfilePoint[]): SVGSVGElement {
  const svg = svgEl("svg", { viewBox: "0 0 320 195", class: "elevation__chart", role: "img", "aria-label": "標高プロファイル。横軸は経路に沿った距離、縦軸は推定標高。欠測区間では線が途切れます。" });
  const valid = points.filter((p) => p.elevation !== null && Number.isFinite(p.elevation));
  const total = points.at(-1)?.distance ?? 0;
  if (!valid.length || total <= 0) return svg;
  const values = valid.map((p) => p.elevation!);
  let min = Math.min(...values), max = Math.max(...values);
  const range = Math.max(10, max - min);
  const middle = (max + min) / 2;
  min = middle - range / 2; max = middle + range / 2;
  const x = (d: number) => 68 + d / total * 236;
  const y = (e: number) => 27 + (max - e) / range * 120;
  svg.append(svgEl("text", { x: "12", y: "14", class: "elevation__axis-label" }, "標高 (m)"));
  for (let i = 0; i <= 2; i++) {
    const elevation = min + range * i / 2;
    svg.append(
      svgEl("line", { x1: "68", x2: "304", y1: String(y(elevation)), y2: String(y(elevation)), class: "elevation__grid" }),
      svgEl("text", { x: "62", y: String(y(elevation) + 4), "text-anchor": "end", class: "elevation__axis-label" }, formatElevation(elevation).replace(" m", "")),
      svgEl("text", { x: String(x(total * i / 2)), y: "166", "text-anchor": i === 0 ? "start" : i === 2 ? "end" : "middle", class: "elevation__axis-label" }, formatDistance(total * i / 2)),
    );
  }
  svg.append(svgEl("text", { x: "304", y: "188", "text-anchor": "end", class: "elevation__axis-label" }, "経路に沿った距離"));
  let path = "", pen = false;
  for (const p of points) {
    if (p.elevation === null || !Number.isFinite(p.elevation)) { pen = false; continue; }
    path += `${pen ? "L" : "M"}${x(p.distance).toFixed(2)} ${y(p.elevation).toFixed(2)} `;
    pen = true;
    svg.append(svgEl("circle", { cx: String(x(p.distance)), cy: String(y(p.elevation)), r: "1.6", class: "elevation__point" }));
  }
  svg.append(svgEl("path", { d: path.trim(), class: "elevation__line", fill: "none", "stroke-width": "2", "vector-effect": "non-scaling-stroke" }));
  return svg;
}
