import type { Route } from "../../types/api";
import type { RouteAnalysis } from "./analyze";
import type { RouteGradientSegment } from "./gradientSegments";
import { findRouteSelection, type RouteSelection, type RouteSelectionTarget } from "./selection";

/** 地図側で必要な選択位置の反映口。 */
export interface RouteSelectionSurface {
  setRouteSelection(selection: RouteSelectionTarget | null): void;
}

/** グラフ側で必要な選択位置の反映口。 */
export interface RouteSelectionSink {
  apply(selection: RouteSelection | null, segment: RouteGradientSegment | null): void;
}

export interface RouteLink {
  /**
   * 表示中ルートと標高解析・勾配区間を差し替える。
   * 同じルートの再描画では選択位置を維持し、別ルートになったら解除する。
   */
  setRoute(route: Route | null, analysis: RouteAnalysis | null, segments: readonly RouteGradientSegment[] | null): void;
  /** グラフ・地図のどちらからでも呼ぶ。経路に沿った距離(m)で選択する。 */
  select(distanceM: number): void;
  /** 描画し直されたグラフを登録すると、現在の選択位置が即座に反映される。 */
  attachChart(chart: RouteSelectionSink | null): void;
}

/** 区間なしを表す共有の空配列。setRoute の同一性比較で毎回新規配列を作らない。 */
const EMPTY_SEGMENTS: readonly RouteGradientSegment[] = [];

/**
 * 標高グラフと地図の選択位置を一か所で管理する（#9）。
 * どちらの操作も select(distanceM) に集約し、欠測は null のまま扱って0に置き換えない。
 */
export function createRouteLink(surface: RouteSelectionSurface): RouteLink {
  let route: Route | null = null;
  let analysis: RouteAnalysis | null = null;
  let segments: readonly RouteGradientSegment[] = EMPTY_SEGMENTS;
  let selection: RouteSelection | null = null;
  let chart: RouteSelectionSink | null = null;

  function segmentOf(value: RouteSelection | null): RouteGradientSegment | null {
    if (!value || value.segmentIndex < 0) return null;
    return segments[value.segmentIndex] ?? null;
  }

  function publish(): void {
    chart?.apply(selection, segmentOf(selection));
    const segment = segmentOf(selection);
    surface.setRouteSelection(selection
      ? {
        lngLat: [selection.lngLat[0], selection.lngLat[1]],
        segmentIndex: selection.segmentIndex < 0 ? null : selection.segmentIndex,
        windowFromM: segment?.windowFromM ?? null,
        windowToM: segment?.windowToM ?? null,
      }
      : null);
  }

  /** 解析・区間が変わったとき、同じ距離のまま座標と勾配区間を対応付け直す。 */
  function recompute(): void {
    if (!selection || !analysis) return;
    selection = findRouteSelection(analysis.points, segments, selection.distanceM);
  }

  return {
    setRoute(nextRoute, nextAnalysis, nextSegments) {
      const nextList = nextSegments ?? EMPTY_SEGMENTS;
      if (nextRoute === route && nextAnalysis === analysis && nextList === segments) return;
      const routeChanged = nextRoute !== route;
      route = nextRoute;
      analysis = nextAnalysis;
      segments = nextList;
      // 別ルート・解析解除（再取得中など）では前の位置を引き継がない。
      if (routeChanged || !analysis) selection = null;
      else recompute();
      publish();
    },
    select(distanceM) {
      if (!analysis || !Number.isFinite(distanceM)) return;
      selection = findRouteSelection(analysis.points, segments, distanceM);
      publish();
    },
    attachChart(next) {
      chart = next;
      chart?.apply(selection, segmentOf(selection));
    },
  };
}
