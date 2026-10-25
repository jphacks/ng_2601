import { describe, expect, it } from "vitest";
import { buildRouteGradientSegments } from "./gradientSegments";
import { createRouteGeometrySlicer, sampleRoutePoints, summarizeProfile, type ProfilePoint } from "./profile";
import type { RouteAnalysis } from "./analyze";
import type { LngLat } from "./math";

function makeAnalysis(coordinates: LngLat[], elevationAt: (distance: number) => number | null): RouteAnalysis {
  const points: ProfilePoint[] = sampleRoutePoints(coordinates).map((point) => ({
    ...point,
    elevation: elevationAt(point.distance),
  }));
  return {
    points,
    summary: summarizeProfile(points),
    errorCount: 0,
    levelLabels: ["test DEM"],
    source: "mock",
    spacingM: points[1]!.distance - points[0]!.distance,
  };
}

describe("route gradient segments", () => {
  it("uses existing 100 m grades for flat, uphill, and downhill pieces", () => {
    const route: LngLat[] = [[139, 35], [139.004, 35]];
    const flat = buildRouteGradientSegments(route, makeAnalysis(route, () => 10));
    const uphill = buildRouteGradientSegments(route, makeAnalysis(route, (distance) => 10 + distance * 0.05));
    const downhill = buildRouteGradientSegments(route, makeAnalysis(route, (distance) => 100 - distance * 0.03));

    expect(flat.some((segment) => segment.direction === "flat" && segment.gradePercent === 0)).toBe(true);
    expect(uphill.some((segment) => segment.direction === "uphill" && segment.gradePercent! > 0)).toBe(true);
    expect(downhill.some((segment) => segment.direction === "downhill" && segment.gradePercent! < 0)).toBe(true);
    expect(flat.every((segment) => segment.direction !== "unknown" || segment.gradePercent === null)).toBe(true);
  });

  it("keeps missing and sub-100 m intervals neutral instead of treating them as flat", () => {
    const route: LngLat[] = [[139, 35], [139.004, 35]];
    const partial = buildRouteGradientSegments(route, makeAnalysis(route, (distance) =>
      distance >= 130 && distance <= 240 ? null : 10 + distance * 0.02,
    ));
    const shortRoute: LngLat[] = [[139, 35], [139.0005, 35]];
    const short = buildRouteGradientSegments(shortRoute, makeAnalysis(shortRoute, () => 10));

    expect(partial.some((segment) => segment.direction === "unknown" && segment.gradePercent === null)).toBe(true);
    expect(partial.every((segment) => segment.direction !== "unknown" || segment.gradePercent === null)).toBe(true);
    expect(short.length).toBeGreaterThan(0);
    expect(short.every((segment) => segment.direction === "unknown" && segment.gradePercent === null)).toBe(true);
  });

  it("keeps segment geometry on the original route through bends", () => {
    const route: LngLat[] = [[139, 35], [139.001, 35], [139.001, 35.001]];
    const sliceRoute = createRouteGeometrySlicer(route);
    const firstLegM = sampleRoutePoints([route[0]!, route[1]!]).at(-1)!.distance;
    const crossing = sliceRoute!(firstLegM - 10, firstLegM + 10);

    expect(crossing).toContainEqual(route[1]);
  });
});
