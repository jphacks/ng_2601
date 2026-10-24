import { describe, expect, it } from "vitest";
import type { LngLat, Route } from "../../types/api";
import { buildRouteGradientSegments, type RouteGradientSegment } from "./gradientSegments";
import { sampleRoutePoints, summarizeProfile, type ProfilePoint } from "./profile";
import type { RouteAnalysis } from "./analyze";
import { createRouteLink, type RouteSelectionSink } from "./link";
import type { RouteSelection, RouteSelectionTarget } from "./selection";

const ROUTE: LngLat[] = [[139, 35], [139.004, 35]];

function makeAnalysis(elevationAt: (distance: number) => number | null): RouteAnalysis {
  const points: ProfilePoint[] = sampleRoutePoints(ROUTE).map((point) => ({ ...point, elevation: elevationAt(point.distance) }));
  return {
    points,
    summary: summarizeProfile(points),
    errorCount: 0,
    levelLabels: ["test DEM"],
    source: "mock",
    spacingM: points[1]!.distance - points[0]!.distance,
  };
}

function makeRoute(): Route {
  const points = sampleRoutePoints(ROUTE);
  return {
    id: "route-1",
    name: "test route",
    distanceM: Math.round(points.at(-1)!.distance),
    durationSec: 120,
    coordinates: ROUTE.map(([lng, lat]) => [lng, lat] as LngLat),
    elevationProfile: { points: [], totalAscentM: null, totalDescentM: null, maxGradePercent: null },
  };
}

function setup(): {
  link: ReturnType<typeof createRouteLink>;
  selectionTargets: Array<RouteSelectionTarget | null>;
  chartCalls: Array<[RouteSelection | null, RouteGradientSegment | null]>;
} {
  const selectionTargets: Array<RouteSelectionTarget | null> = [];
  const chartCalls: Array<[RouteSelection | null, RouteGradientSegment | null]> = [];
  const link = createRouteLink({ setRouteSelection: (selection) => selectionTargets.push(selection) });
  link.attachChart({ apply: (selection, segment) => chartCalls.push([selection, segment]) });
  return { link, selectionTargets, chartCalls };
}

describe("route link", () => {
  it("publishes one selection to both the map surface and the chart", () => {
    const { link, selectionTargets, chartCalls } = setup();
    const analysis = makeAnalysis((distance) => 10 + distance * 0.02);
    const segments = buildRouteGradientSegments(ROUTE, analysis);
    link.setRoute(makeRoute(), analysis, segments);
    link.select(180);

    const target = selectionTargets.at(-1);
    expect(target).not.toBeNull();
    expect(target!.lngLat[0]).toBeGreaterThan(139.0005);
    expect(target!.lngLat[0]).toBeLessThan(139.0035);
    expect(target!.segmentIndex).toBeGreaterThanOrEqual(0);
    expect(target!.windowFromM).not.toBeNull();
    expect(target!.windowToM).not.toBeNull();

    const [selection, segment] = chartCalls.at(-1)!;
    expect(selection!.distanceM).toBeCloseTo(180, 6);
    expect(segment).not.toBeNull();
    expect(selection!.segmentIndex).toBe(target!.segmentIndex);
  });

  it("clears the selection when the displayed route changes", () => {
    const { link, selectionTargets, chartCalls } = setup();
    const analysis = makeAnalysis((distance) => 10 + distance * 0.02);
    const segments = buildRouteGradientSegments(ROUTE, analysis);
    link.setRoute(makeRoute(), analysis, segments);
    link.select(180);
    expect(selectionTargets.at(-1)).not.toBeNull();

    link.setRoute(makeRoute(), analysis, segments);
    expect(selectionTargets.at(-1)).toBeNull();
    expect(chartCalls.at(-1)![0]).toBeNull();
  });

  it("keeps the distance when the same route's analysis is replaced", () => {
    const { link, selectionTargets, chartCalls } = setup();
    const analysis = makeAnalysis((distance) => 10 + distance * 0.02);
    const route = makeRoute();
    link.setRoute(route, analysis, buildRouteGradientSegments(ROUTE, analysis));
    link.select(180);

    const replaced = { ...analysis };
    link.setRoute(route, replaced, buildRouteGradientSegments(ROUTE, replaced));
    expect(selectionTargets.at(-1)).not.toBeNull();
    expect(chartCalls.at(-1)![0]!.distanceM).toBeCloseTo(180, 6);
  });

  it("restores the selected distance after the same route's analysis is reloaded", () => {
    const { link, selectionTargets, chartCalls } = setup();
    const route = makeRoute();
    const analysis = makeAnalysis((distance) => 10 + distance * 0.02);
    link.setRoute(route, analysis, buildRouteGradientSegments(ROUTE, analysis));
    link.select(180);

    // 再解析中は解析がないため表示は解除するが、距離は保持する。
    link.setRoute(route, null, null);
    expect(selectionTargets.at(-1)).toBeNull();
    expect(chartCalls.at(-1)![0]).toBeNull();

    const reloaded = makeAnalysis((distance) => 10 + distance * 0.02);
    link.setRoute(route, reloaded, buildRouteGradientSegments(ROUTE, reloaded));
    expect(selectionTargets.at(-1)).not.toBeNull();
    expect(chartCalls.at(-1)![0]!.distanceM).toBeCloseTo(180, 6);
  });

  it("keeps a position inside a DEM gap linked, without inventing an elevation or grade", () => {
    const { link, chartCalls } = setup();
    const analysis = makeAnalysis((distance) => (distance >= 130 && distance <= 240 ? null : 10 + distance * 0.02));
    link.setRoute(makeRoute(), analysis, buildRouteGradientSegments(ROUTE, analysis));
    link.select(180);

    const [selection, segment] = chartCalls.at(-1)!;
    expect(selection).not.toBeNull();
    expect(selection!.elevation).toBeNull();
    expect(segment).not.toBeNull();
    expect(segment!.gradePercent).toBeNull();
  });

  it("applies the current selection to a chart that is rendered later", () => {
    const { link } = setup();
    const analysis = makeAnalysis((distance) => 10 + distance * 0.02);
    link.setRoute(makeRoute(), analysis, buildRouteGradientSegments(ROUTE, analysis));
    link.select(120);

    const lateCalls: Array<[RouteSelection | null, RouteGradientSegment | null]> = [];
    const chart: RouteSelectionSink = { apply: (selection, segment) => lateCalls.push([selection, segment]) };
    link.attachChart(chart);
    expect(lateCalls).toHaveLength(1);
    expect(lateCalls[0]![0]!.distanceM).toBeCloseTo(120, 6);
    expect(lateCalls[0]![1]).not.toBeNull();
  });

  it("ignores selection while no route is displayed", () => {
    const { link, selectionTargets, chartCalls } = setup();
    link.setRoute(null, null, null);
    link.select(100);
    link.select(Number.NaN);
    expect(selectionTargets).toHaveLength(0);
    // グラフ登録時の空状態の反映だけ。選択は一度も作られない。
    expect(chartCalls).toEqual([[null, null]]);
  });
});
