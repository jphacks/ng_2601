import "./elevation.css";
import type { Route } from "../../types/api";
import { el } from "../../ui/dom";
import type { ElevationState } from "./analyze";
import { GSI_PROVIDER } from "./dem/config";
import { createProfileChart } from "./chart";
import type { RouteLink } from "./link";
import { formatDistance, formatDuration, formatElevation, formatGrade, UNKNOWN } from "./format";

function metrics(rows: Array<[string, string]>, className: string): HTMLElement {
  const dl = el("dl", { className });
  for (const [label, value] of rows) {
    dl.append(el("div", { className: "route__stat" }, [el("dt", { text: label }), el("dd", { text: value })]));
  }
  return dl;
}

export interface AnalysisViewOptions {
  retry: () => void;
  /** グラフと地図の選択位置を共有する（#9）。 */
  link: RouteLink;
}

export function renderAnalysis(route: Route, state: ElevationState, options: AnalysisViewOptions): HTMLElement {
  const analysis = state.kind === "ready" ? state.analysis : null;
  const summary = analysis?.summary;
  const usable = !!summary && summary.validDistance > 0;
  const loadingText = "取得中";
  const ascent = state.kind === "loading" ? loadingText : usable ? formatElevation(summary!.ascent) : UNKNOWN;
  const steepest = state.kind === "loading" ? loadingText : formatGrade(summary?.steepestUphillPercent ?? null);
  const root = el("section", { className: "elevation" }, [
    metrics([
      ["距離", formatDistance(route.distanceM)],
      ["時間", formatDuration(route.durationSec)],
      ["獲得標高", ascent],
      ["最大上り", steepest],
    ], "route__summary"),
  ]);

  // 正常に取れたときは何も言わず、取得中・失敗・欠測のときだけ伝える。
  let message = "";
  if (state.kind === "loading") {
    message = `標高を取得中…${state.total ? ` ${Math.round(state.done / state.total * 100)}%` : ""}`;
  } else if (state.kind === "error") {
    message = state.message;
  } else if (summary?.validCount === 0) {
    message = "標高データがありません。";
  } else if (summary?.missingCount) {
    message = "一部の地点で標高を取得できませんでした。";
  }
  if (message) {
    const status = el("p", { className: "elevation__note", text: message });
    status.setAttribute("role", "status");
    if (state.kind === "error") status.classList.add("elevation__error");
    root.append(status);
  }

  if (analysis && summary!.validCount > 0) {
    const chart = createProfileChart(analysis.points, { onSelect: (distanceM) => options.link.select(distanceM) });
    root.append(chart.element);
    options.link.attachChart(chart);
  } else {
    options.link.attachChart(null);
  }
  if (state.kind === "error" || (analysis && (analysis.errorCount > 0 || summary!.validCount === 0))) {
    const button = el("button", { className: "route__button", text: "標高解析を再試行" });
    button.type = "button";
    button.dataset.resultControl = "retry";
    button.addEventListener("click", options.retry);
    root.append(button);
  }

  // 国土地理院の利用規約で、出典と「加工して作成」の明示が要る。
  const note = el("p", { className: "elevation__source", text: "標高・勾配は推定値" });
  if (analysis?.source === "mock" || (!analysis && import.meta.env.VITE_API_MODE !== "http")) {
    note.append("（開発用モックの合成データ）");
  } else {
    const link = el("a", { text: "国土地理院 標高タイル" });
    link.dataset.resultControl = "source";
    link.href = GSI_PROVIDER.attributionUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    note.append("（出典：", link, "を加工して作成）");
  }
  root.append(note);
  return root;
}
