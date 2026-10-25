import type { RouteAnalysis } from "./analyze";
import { GRADE_WINDOW_M, createRouteGeometrySlicer, type GradeWindow } from "./profile";

export type GradientDirection = "uphill" | "flat" | "downhill" | "unknown";

export interface RouteGradientSegment {
  fromM: number;
  toM: number;
  gradePercent: number | null;
  direction: GradientDirection;
  windowFromM: number | null;
  windowToM: number | null;
  coordinates: Array<[number, number]>;
}

const DISTANCE_EPSILON_M = 1e-6;

/**
 * Maps the existing 100 m DEM grade windows onto non-overlapping route pieces.
 * Gaps and intervals without a full 100 m grade window stay unknown; they are
 * never represented as flat or as a zero-percent grade.
 */
export function buildRouteGradientSegments(coordinates: unknown, analysis: RouteAnalysis): RouteGradientSegment[] {
  const sliceRoute = createRouteGeometrySlicer(coordinates);
  const points = analysis.points;
  const totalDistance = points.at(-1)?.distance ?? 0;
  if (!sliceRoute || points.length < 2 || !(totalDistance > 0)) return [];

  const windows = (analysis.summary.windows[GRADE_WINDOW_M] ?? []).filter((window) =>
    Number.isFinite(window.from) && Number.isFinite(window.to) && Number.isFinite(window.gradePercent) && window.to > window.from,
  );
  const boundaries = new Set<number>([0, totalDistance]);
  for (const point of points) {
    if (Number.isFinite(point.distance) && point.distance > 0 && point.distance < totalDistance) boundaries.add(point.distance);
  }
  for (const window of windows) {
    if (window.from > 0 && window.from < totalDistance) boundaries.add(window.from);
    if (window.to > 0 && window.to < totalDistance) boundaries.add(window.to);
  }

  const sorted = [...boundaries].sort((a, b) => a - b);
  const result: RouteGradientSegment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const fromM = sorted[i]!;
    const toM = sorted[i + 1]!;
    if (toM - fromM <= DISTANCE_EPSILON_M) continue;

    const midpoint = (fromM + toM) / 2;
    const window = closestContainingWindow(windows, midpoint);
    const gradePercent = window?.gradePercent ?? null;
    const direction: GradientDirection = gradePercent === null
      ? "unknown"
      : gradePercent > 0 ? "uphill" : gradePercent < 0 ? "downhill" : "flat";
    const segmentCoordinates = sliceRoute(fromM, toM);
    if (segmentCoordinates.length < 2) continue;

    result.push({
      fromM,
      toM,
      gradePercent,
      direction,
      windowFromM: window?.from ?? null,
      windowToM: window?.to ?? null,
      coordinates: segmentCoordinates.map(([lng, lat]) => [lng, lat]),
    });
  }
  return result;
}

function closestContainingWindow(windows: readonly GradeWindow[], distance: number): GradeWindow | null {
  let closest: GradeWindow | null = null;
  let closestCenterDistance = Number.POSITIVE_INFINITY;
  for (const window of windows) {
    if (distance < window.from - DISTANCE_EPSILON_M || distance > window.to + DISTANCE_EPSILON_M) continue;
    const centerDistance = Math.abs((window.from + window.to) / 2 - distance);
    if (centerDistance < closestCenterDistance) {
      closest = window;
      closestCenterDistance = centerDistance;
    }
  }
  return closest;
}
