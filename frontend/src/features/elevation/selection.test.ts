import { describe, expect, it } from "vitest";
import type { LngLat } from "../../types/api";
import { buildRouteGradientSegments, type RouteGradientSegment } from "./gradientSegments";
import { sampleRoutePoints, summarizeProfile, type ProfilePoint } from "./profile";
import type { RouteAnalysis } from "./analyze";
import {
  clampRouteDistance,
  describeSelection,
  distanceOnLine,
  findRouteSelection,
  findSegmentIndex,
  formatSegmentText,
  GRADE_UNKNOWN_TEXT,
  locateRouteCoordinate,
  sliderValueToDistance,
  type SegmentFacts,
} from "./selection";

function makePoints(coordinates: LngLat[], elevationAt: (distance: number) => number | null): ProfilePoint[] {
  return sampleRoutePoints(coordinates).map((point) => ({ ...point, elevation: elevationAt(point.distance) }));
}

function makeAnalysis(coordinates: LngLat[], elevationAt: (distance: number) => number | null): RouteAnalysis {
  const points = makePoints(coordinates, elevationAt);
  return {
    points,
    summary: summarizeProfile(points),
    errorCount: 0,
    levelLabels: ["test DEM"],
    source: "mock",
    spacingM: points[1]!.distance - points[0]!.distance,
  };
}

function makeSegment(overrides: Partial<RouteGradientSegment> = {}): RouteGradientSegment {
  return {
    fromM: 0,
    toM: 100,
    gradePercent: 0,
    direction: "flat",
    windowFromM: 0,
    windowToM: 100,
    coordinates: [[139, 35], [139.001, 35]],
    ...overrides,
  };
}

const facts = (overrides: Partial<SegmentFacts> = {}): SegmentFacts => ({
  fromM: 0,
  toM: 100,
  gradePercent: 5.3,
  windowFromM: 0,
  windowToM: 100,
  ...overrides,
});

describe("route distance helpers", () => {
  it("clamps distances to the measured route and rejects non-finite values", () => {
    expect(clampRouteDistance(-50, 500)).toBe(0);
    expect(clampRouteDistance(700, 500)).toBe(500);
    expect(clampRouteDistance(Number.NaN, 500)).toBe(0);
    expect(clampRouteDistance(120, 0)).toBe(0);
  });

  it("maps the last slider step to the exact route end", () => {
    expect(sliderValueToDistance(1920, 1931, 10)).toBe(1920);
    // max 1931 は10の倍数ではないので、末尾のstep(1930)は終点ちょうどとして扱う。
    expect(sliderValueToDistance(1930, 1931, 10)).toBe(1931);
    expect(sliderValueToDistance(1931, 1931, 10)).toBe(1931);
    expect(sliderValueToDistance(1930, 1930, 10)).toBe(1930);
    expect(sliderValueToDistance(10, 5, 10)).toBe(5);
    expect(sliderValueToDistance(10, 500, 10)).toBe(10);
    expect(sliderValueToDistance(Number.NaN, 1931, 10)).toBe(0);
    expect(sliderValueToDistance(10, 0, 10)).toBe(0);
  });

  it("derives the last step from the rounded slider maximum", () => {
    // slider.max は Math.round(total)。1239.6m の max は 1240 で、末尾の step だけが終点。
    // 1230m は終点へ飛ばさず、そのままの距離として選べる。
    expect(sliderValueToDistance(1230, 1239.6, 10)).toBe(1230);
    expect(sliderValueToDistance(1240, 1239.6, 10)).toBe(1239.6);
    // 1229.6m の max は 1230（10の倍数）になり、末尾の step は終点ちょうど。
    expect(sliderValueToDistance(1230, 1229.6, 10)).toBe(1229.6);
    expect(sliderValueToDistance(1220, 1229.6, 10)).toBe(1220);
  });

  it("maps a distance to an interpolated route coordinate and elevation", () => {
    const route: LngLat[] = [[139, 35], [139.004, 35]];
    const points = makePoints(route, (distance) => 10 + distance * 0.02);
    const total = points.at(-1)!.distance;
    const middle = locateRouteCoordinate(points, total / 2);

    expect(middle).not.toBeNull();
    expect(middle!.lngLat[0]).toBeGreaterThan(139.0005);
    expect(middle!.lngLat[0]).toBeLessThan(139.0035);
    expect(middle!.lngLat[1]).toBeCloseTo(35, 10);
    expect(middle!.elevation).toBeCloseTo(10 + (total / 2) * 0.02, 5);
    expect(locateRouteCoordinate(points, -10)!.elevation).toBeCloseTo(10, 5);
    expect(locateRouteCoordinate(points, total + 100)!.lngLat[0]).toBeCloseTo(139.004, 10);
    expect(locateRouteCoordinate([], 10)).toBeNull();
  });

  it("keeps missing elevations unknown instead of interpolating through them", () => {
    const route: LngLat[] = [[139, 35], [139.004, 35]];
    const points = makePoints(route, (distance) => (distance >= 130 && distance <= 240 ? null : 10 + distance * 0.02));
    const gap = locateRouteCoordinate(points, 180);

    expect(gap).not.toBeNull();
    expect(gap!.lngLat[0]).toBeGreaterThan(139.0005);
    expect(gap!.lngLat[0]).toBeLessThan(139.0035);
    expect(gap!.elevation).toBeNull();
  });

  it("projects a map click back onto the route distance", () => {
    const route: LngLat[] = [[139, 35], [139.004, 35]];
    const length = distanceOnLine(route, [139.002, 35.0002]);
    const full = distanceOnLine(route, [139.004, 35]);

    expect(length).not.toBeNull();
    expect(full).not.toBeNull();
    expect(length!).toBeGreaterThan(full! * 0.45);
    expect(length!).toBeLessThan(full! * 0.55);
    expect(distanceOnLine([[139, 35]], [139, 35])).toBeNull();
  });
});

describe("segment lookup", () => {
  it("finds the non-overlapping segment that contains a distance", () => {
    const segments = [makeSegment({ fromM: 0, toM: 100 }), makeSegment({ fromM: 100, toM: 200 })];
    expect(findSegmentIndex(segments, 0)).toBe(0);
    expect(findSegmentIndex(segments, 100)).toBe(0);
    expect(findSegmentIndex(segments, 150)).toBe(1);
    expect(findSegmentIndex(segments, 200)).toBe(1);
    expect(findSegmentIndex([], 20)).toBe(-1);
  });

  it("returns -1 for a distance that no segment covers instead of assuming a grade", () => {
    const segments = [makeSegment({ fromM: 0, toM: 100 }), makeSegment({ fromM: 150, toM: 250 })];
    expect(findSegmentIndex(segments, 120)).toBe(-1);
  });

  it("returns the first interval when adjacent intervals share a boundary", () => {
    const segments = [
      makeSegment({ fromM: 0, toM: 100 }),
      makeSegment({ fromM: 100, toM: 200 }),
      makeSegment({ fromM: 200, toM: 300 }),
    ];
    // 境界(100m, 200m)は両側の区間に含まれるため、先の区間の勾配・計測窓を選ぶ。
    expect(findSegmentIndex(segments, 100)).toBe(0);
    expect(findSegmentIndex(segments, 200)).toBe(1);
    expect(findSegmentIndex(segments, 250)).toBe(2);
  });
});

describe("selection readout", () => {
  it("uses the same wording as the map segment display (#8)", () => {
    expect(formatSegmentText(facts())).toBe("選択区間 0 m〜100 m：上り +5.3 %、計測窓 0 m〜100 m の100m平均");
    expect(formatSegmentText(facts({ gradePercent: -2.1 }))).toBe("選択区間 0 m〜100 m：下り −2.1 %、計測窓 0 m〜100 m の100m平均");
    expect(formatSegmentText(facts({ gradePercent: 0 }))).toBe("選択区間 0 m〜100 m：平坦 0.0 %、計測窓 0 m〜100 m の100m平均");
    expect(formatSegmentText(facts({ gradePercent: null, windowFromM: null, windowToM: null }))).toBe(
      `選択区間 0 m〜100 m：勾配不明（${GRADE_UNKNOWN_TEXT}）`,
    );
    expect(formatSegmentText(facts({ windowFromM: null, windowToM: null }))).toBe(
      "選択区間 0 m〜100 m：上り +5.3 %、100m平均",
    );
  });

  it("describes a selected position with mileage, interval, elevation and grade", () => {
    const details = describeSelection(
      { distanceM: 1200, lngLat: [139, 35], elevation: 42.14, segmentIndex: 0 },
      makeSegment({ fromM: 1200, toM: 1300, gradePercent: 5.25, direction: "uphill", windowFromM: 1200, windowToM: 1300 }),
    );
    expect(details).toEqual({
      distance: "1.20 km",
      elevation: "42.1 m",
      grade: "上り +5.3 %",
      window: "1.20 km〜1.30 km",
    });
  });

  it("shows missing elevation and missing grade as unknown, never as zero", () => {
    const details = describeSelection(
      { distanceM: 180, lngLat: [139, 35], elevation: null, segmentIndex: 0 },
      makeSegment({ fromM: 130, toM: 200, gradePercent: null, windowFromM: null, windowToM: null, direction: "unknown" }),
    );
    expect(details.elevation).toBe("不明（欠測）");
    expect(details.grade).toBe(`不明（${GRADE_UNKNOWN_TEXT}）`);
    expect(details.window).toBeNull();
    expect(`${details.elevation}${details.grade}`).not.toContain("0.0 %");
    expect(`${details.elevation}${details.grade}`).not.toContain("0.0 m");
  });

  it("keeps a position without a matching interval as unknown", () => {
    const details = describeSelection({ distanceM: 120, lngLat: [139, 35], elevation: 10, segmentIndex: -1 }, null);
    expect(details.window).toBeNull();
    expect(details.grade).toBe("不明（連動する勾配区間がありません）");
  });
});

describe("findRouteSelection", () => {
  it("links a chart position to a route coordinate and the existing 100 m grade window", () => {
    const route: LngLat[] = [[139, 35], [139.004, 35]];
    const analysis = makeAnalysis(route, (distance) => 10 + distance * 0.02);
    const segments = buildRouteGradientSegments(route, analysis);
    const selection = findRouteSelection(analysis.points, segments, 180);

    expect(selection).not.toBeNull();
    expect(selection!.distanceM).toBe(180);
    expect(selection!.lngLat[0]).toBeGreaterThan(139.0005);
    expect(selection!.lngLat[0]).toBeLessThan(139.0035);
    expect(selection!.segmentIndex).toBeGreaterThanOrEqual(0);
    expect(segments[selection!.segmentIndex]!.toM).toBeGreaterThanOrEqual(180);
    expect(segments[selection!.segmentIndex]!.fromM).toBeLessThanOrEqual(180);
  });

  it("keeps a selected position inside a DEM gap linked but with an unknown grade", () => {
    const route: LngLat[] = [[139, 35], [139.004, 35]];
    const analysis = makeAnalysis(route, (distance) => (distance >= 130 && distance <= 240 ? null : 10 + distance * 0.02));
    const segments = buildRouteGradientSegments(route, analysis);
    const selection = findRouteSelection(analysis.points, segments, 180);

    expect(selection).not.toBeNull();
    expect(selection!.elevation).toBeNull();
    expect(selection!.segmentIndex).toBeGreaterThanOrEqual(0);
    const segment = segments[selection!.segmentIndex]!;
    expect(segment.gradePercent).toBeNull();
    const details = describeSelection(selection!, segment);
    expect(details.grade).toBe(`不明（${GRADE_UNKNOWN_TEXT}）`);
  });
});
