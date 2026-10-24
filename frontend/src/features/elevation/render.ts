import "./elevation.css";
import type { Route } from "../../types/api";
import { el } from "../../ui/dom";
import type { ElevationState } from "./analyze";
import { GSI_PROVIDER } from "./dem/config";
import { renderProfileChart } from "./chart";
import { formatDistance, formatDuration, formatElevation, formatGrade, UNKNOWN } from "./format";

function metrics(rows: Array<[string, string]>, className: string): HTMLElement {
  const dl = el("dl", { className });
  for (const [label, value] of rows) {
    dl.append(el("div", { className: "route__stat" }, [el("dt", { text: label }), el("dd", { text: value })]));
  }
  return dl;
}

export function renderAnalysis(route: Route, state: ElevationState, retry: () => void, detailsOpen: boolean, onToggle: (open: boolean) => void): HTMLElement {
  const analysis = state.kind === "ready" ? state.analysis : null;
  const summary = analysis?.summary;
  const partial = !!summary?.missingCount;
  const usable = !!summary && summary.validDistance > 0;
  const ascent = state.kind === "loading" ? "取得中" : usable ? formatElevation(summary!.ascent) : UNKNOWN;
  const root = el("section", { className: "elevation" }, [
    metrics([
      ["走行距離", formatDistance(route.distanceM)],
      ["所要時間（目安）", formatDuration(route.durationSec)],
      [partial ? "推定獲得標高※" : "推定獲得標高", ascent],
    ], "route__summary"),
    el("h3", { className: "route__heading", text: "標高プロファイル（推定）" }),
  ]);
  const status = el("p", { className: "elevation__note" });
  status.setAttribute("role", "status");
  if (state.kind === "loading") {
    status.textContent = `標高を取得中…${state.total ? ` ${Math.round(state.done / state.total * 100)}%` : ""}`;
  } else if (state.kind === "error") {
    status.textContent = state.message;
    status.classList.add("elevation__error");
  } else if (summary) {
    status.textContent = summary.validCount === 0 ? "標高データがありません。標高・勾配は不明です。"
      : partial ? `取得不可 ${summary.missingCount} / ${analysis!.points.length} 点。※上下量・極値・区間勾配は取得できた区間のみ。全体平均勾配は不明です。`
      : "標高データから算出した推定値です。";
    if (analysis!.errorCount) status.textContent += ` うち通信・復号エラー ${analysis!.errorCount} 点。`;
    if (summary.validCount > 0 && !usable) status.textContent += " 連続した有効区間がないため、獲得標高・下降量は不明です。";
  } else {
    status.textContent = "標高データは未取得です。";
  }
  root.append(status);
  if (analysis && summary!.validCount > 0) {
    const figure = el("figure", { className: "elevation__figure" });
    figure.append(renderProfileChart(analysis.points), el("figcaption", { className: "elevation__legend", text: "実線・点：推定標高 ／ 線の途切れ：取得不可" }));
    root.append(figure);
  }
  if (state.kind === "error" || (analysis && (analysis.errorCount > 0 || summary!.validCount === 0))) {
    const button = el("button", { className: "route__button", text: "標高解析を再試行" });
    button.type = "button";
    button.dataset.resultControl = "retry";
    button.addEventListener("click", retry);
    root.append(button);
  }
  const details = el("details", { className: "elevation__details" });
  details.open = detailsOpen;
  const toggle = el("summary", { text: "ルート詳細" });
  toggle.dataset.resultControl = "details";
  details.append(toggle, metrics([
    ["推定下降量", usable ? formatElevation(summary!.descent) : UNKNOWN],
    ["全体平均勾配", formatGrade(summary?.netGradePercent ?? null)],
    ["最低標高", formatElevation(summary?.minElevation ?? null)],
    ["最高標高", formatElevation(summary?.maxElevation ?? null)],
    ["最大上り（100m区間）", formatGrade(summary?.steepestUphillPercent ?? null)],
    ["最大下り（100m区間）", formatGrade(summary?.steepestDownhillPercent ?? null)],
  ], "elevation__metrics"));
  details.addEventListener("toggle", () => { if (details.isConnected) onToggle(details.open); });
  root.append(details);
  if (analysis?.source === "mock" || (!analysis && import.meta.env.VITE_API_MODE !== "http")) {
    root.append(el("p", { className: "elevation__note", text: "開発用モックの合成データです。実際の標高・勾配ではありません。" }));
  } else {
    const link = el("a", { text: "出典：国土地理院 標高タイル" });
    link.dataset.resultControl = "source";
    link.href = GSI_PROVIDER.attributionUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    root.append(el("p", { className: "elevation__note" }, [link]), el("p", {
      className: "elevation__note",
      text: "国土地理院の標高タイルを加工して算出した推定値です。地表面の標高であり、橋・トンネル等の路面高と一致しない場合があります。",
    }));
  }
  const spacing = analysis ? `約${Math.round(analysis.spacingM)}m間隔・${analysis.points.length}点（${analysis.levelLabels.join("・") || "標高取得不可"}）。` : "";
  root.append(el("p", {
    className: "elevation__note",
    text: `${spacing}上下量は1m未満の揺れを除外。全体平均勾配は「終点−始点」の標高差÷経路座標から求めた距離（＋上り／−下り）で、途中の上下を表しません。グラフの距離も経路座標から求めるため、走行距離と差が生じる場合があります。`,
  }));
  return root;
}
