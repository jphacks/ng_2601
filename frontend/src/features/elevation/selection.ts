import type { LngLat } from "../../types/api";
import { haversineMeters, interpolate } from "./math";
import { formatDistance, formatGrade, formatElevation } from "./format";
import type { ProfilePoint } from "./profile";
import type { GradientDirection, RouteGradientSegment } from "./gradientSegments";

/**
 * グラフと地図で共有する選択位置。
 * 距離は経路に沿った累積距離(m)で、#7の標高解析点・#8の100m勾配区間と同じ基準を使う。
 */
export interface RouteSelection {
  distanceM: number;
  lngLat: [number, number];
  /** 選択位置の推定標高。欠測は null（0mとして扱わない）。 */
  elevation: number | null;
  /** 選択位置を含む勾配区間の添字。連動できる区間がなければ -1。 */
  segmentIndex: number;
}

/** 選択位置を含む勾配区間を探すための最小限の属性。地図フィーチャーのpropertiesからも作れる。 */
export interface SegmentFacts {
  fromM: number;
  toM: number;
  gradePercent: number | null;
  windowFromM: number | null;
  windowToM: number | null;
}

/** 地図へ渡す選択位置。地図はカーソルとハイライト区間だけを描く。 */
export interface RouteSelectionTarget {
  lngLat: [number, number];
  /** 位置を含む勾配区間の添字。連動する区間がなければ null。 */
  segmentIndex: number | null;
  /** 勾配の根拠にした100m計測窓。窓があればその区間全体をハイライトする。 */
  windowFromM: number | null;
  windowToM: number | null;
}

export const GRADE_UNKNOWN_TEXT = "欠測または連続した100mの勾配データなし";

const DIRECTION_LABEL: Record<GradientDirection, string> = {
  uphill: "上り",
  downhill: "下り",
  flat: "平坦",
  unknown: "不明",
};

const toRad = (deg: number) => (deg * Math.PI) / 180;
const EARTH_RADIUS_M = 6371008.8;
const METERS_PER_DEGREE = (EARTH_RADIUS_M * Math.PI) / 180;

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** 経路長の範囲へ丸める。経路長が不明なときは0。 */
export function clampRouteDistance(distanceM: number, totalM: number): number {
  if (!isFiniteNumber(totalM) || totalM <= 0) return 0;
  if (!isFiniteNumber(distanceM)) return 0;
  return Math.min(totalM, Math.max(0, distanceM));
}

interface Bracket { a: ProfilePoint; b: ProfilePoint; t: number }

/** 距離を挟む前後の解析点と、その間の比率 t。点が1つ以下なら null。 */
function bracketAt(points: readonly ProfilePoint[], distanceM: number): Bracket | null {
  if (points.length < 2) return null;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid]!.distance < distanceM) low = mid + 1;
    else high = mid;
  }
  const a = low <= 0 ? points[0]! : points[low - 1]!;
  const b = low <= 0 ? points[1]! : points[low]!;
  const span = b.distance - a.distance;
  const t = span > 0 ? Math.max(0, Math.min(1, (distanceM - a.distance) / span)) : 0;
  return { a, b, t };
}

function interpolateElevation({ a, b, t }: Bracket): number | null {
  const first = isFiniteNumber(a.elevation) ? a.elevation : null;
  const last = isFiniteNumber(b.elevation) ? b.elevation : null;
  if (t <= 0) return first;
  if (t >= 1) return last;
  // 片方でも欠測なら補間しない。欠測を0mに置き換えない。
  if (first === null || last === null) return null;
  return first + (last - first) * t;
}

/** 経路に沿った距離を座標と推定標高へ対応付ける。経路が無効なら null。 */
export function locateRouteCoordinate(
  points: readonly ProfilePoint[],
  distanceM: number,
): { lngLat: [number, number]; elevation: number | null } | null {
  const total = points.at(-1)?.distance ?? 0;
  if (!points.length || !(total > 0) || !isFiniteNumber(distanceM)) return null;
  const distance = clampRouteDistance(distanceM, total);
  const bracket = bracketAt(points, distance);
  if (!bracket) {
    const only = points[0]!;
    return { lngLat: [only.lng, only.lat], elevation: isFiniteNumber(only.elevation) ? only.elevation : null };
  }
  return {
    lngLat: interpolate([bracket.a.lng, bracket.a.lat], [bracket.b.lng, bracket.b.lat], bracket.t),
    elevation: interpolateElevation(bracket),
  };
}

/** 距離を含む勾配区間の添字。区間は始点順に並び、重複しない前提（#8の生成結果）。 */
export function findSegmentIndex(segments: readonly RouteGradientSegment[], distanceM: number): number {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const segment = segments[mid]!;
    if (distanceM < segment.fromM) high = mid - 1;
    else if (distanceM > segment.toM) low = mid + 1;
    else return mid;
  }
  return -1;
}

/** グラフの位置・地図の区間クリックを、経路座標・標高・勾配区間へまとめて対応付ける。 */
export function findRouteSelection(
  points: readonly ProfilePoint[],
  segments: readonly RouteGradientSegment[],
  distanceM: number,
): RouteSelection | null {
  const position = locateRouteCoordinate(points, distanceM);
  const total = points.at(-1)?.distance ?? 0;
  if (!position || !(total > 0)) return null;
  const distance = clampRouteDistance(distanceM, total);
  return { distanceM: distance, ...position, segmentIndex: findSegmentIndex(segments, distance) };
}

/**
 * 折れ線の始点から、指定地点に最も近い位置までの距離(m)。
 * 局所的な平面近似で投影する（地図クリック位置を経路距離へ戻す用途）。
 */
export function distanceOnLine(coordinates: readonly LngLat[], point: LngLat): number | null {
  if (coordinates.length < 2 || !isFiniteNumber(point[0]) || !isFiniteNumber(point[1])) return null;
  const scaleX = Math.cos(toRad(point[1])) * METERS_PER_DEGREE;
  const scaleY = METERS_PER_DEGREE;
  let travelled = 0;
  let bestDistance2 = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const start = coordinates[i - 1]!;
    const end = coordinates[i]!;
    const edgeLength = haversineMeters(start, end);
    const ax = (start[0] - point[0]) * scaleX;
    const ay = (start[1] - point[1]) * scaleY;
    const bx = (end[0] - point[0]) * scaleX;
    const by = (end[1] - point[1]) * scaleY;
    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    const t = length2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0;
    const px = ax + dx * t;
    const py = ay + dy * t;
    const distance2 = px * px + py * py;
    if (distance2 < bestDistance2) {
      bestDistance2 = distance2;
      bestAlong = travelled + t * edgeLength;
    }
    travelled += edgeLength;
  }
  return bestAlong;
}

/** #8の地図クリック表示と同じ文言。区間の距離・勾配・根拠の計測窓を文字と数値で示す。 */
export function formatSegmentText(facts: SegmentFacts): string {
  const interval = `${formatDistance(facts.fromM)}〜${formatDistance(facts.toM)}`;
  if (!isFiniteNumber(facts.gradePercent)) {
    return `選択区間 ${interval}：勾配不明（${GRADE_UNKNOWN_TEXT}）`;
  }
  const direction = facts.gradePercent > 0 ? "上り" : facts.gradePercent < 0 ? "下り" : "平坦";
  const window = isFiniteNumber(facts.windowFromM) && isFiniteNumber(facts.windowToM)
    ? `、計測窓 ${formatDistance(facts.windowFromM)}〜${formatDistance(facts.windowToM)} の100m平均`
    : "、100m平均";
  return `選択区間 ${interval}：${direction} ${formatGrade(facts.gradePercent)}${window}`;
}

export interface SelectionDetails {
  /** 選択位置（文字列）。 */
  distance: string;
  /** 推定標高。欠測は「不明（欠測）」。 */
  elevation: string;
  /** 勾配の符号付き表示。欠測は「不明（…）」で、0%にしない。 */
  grade: string;
  /** 勾配の根拠にした100m計測窓。 */
  window: string | null;
}

/** グラフ横の数値表示。色ではなく文字と数値で選択位置・欠測を伝える。 */
export function describeSelection(selection: RouteSelection, segment: RouteGradientSegment | null): SelectionDetails {
  const distance = formatDistance(selection.distanceM);
  const elevation = selection.elevation === null ? "不明（欠測）" : formatElevation(selection.elevation);
  if (!segment) {
    return { distance, elevation, grade: "不明（連動する勾配区間がありません）", window: null };
  }
  const window = isFiniteNumber(segment.windowFromM) && isFiniteNumber(segment.windowToM)
    ? `${formatDistance(segment.windowFromM)}〜${formatDistance(segment.windowToM)}`
    : null;
  if (!isFiniteNumber(segment.gradePercent)) {
    return { distance, elevation, grade: `不明（${GRADE_UNKNOWN_TEXT}）`, window };
  }
  return {
    distance,
    elevation,
    grade: `${DIRECTION_LABEL[segment.direction]} ${formatGrade(segment.gradePercent)}`,
    window,
  };
}
