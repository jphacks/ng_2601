import type { Geometry, Position } from "geojson";
import type { BBox, LngLat } from "../../types/api";

function visit(coordinates: unknown, out: Position[]): void {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return;
  if (typeof coordinates[0] === "number") {
    // 位置（[経度, 緯度, …]）。有限の数値でなければ捨てる。
    if (coordinates.length >= 2 && Number.isFinite(coordinates[0]) && Number.isFinite(coordinates[1])) {
      out.push(coordinates as Position);
    }
    return;
  }
  for (const child of coordinates) visit(child, out);
}

export function positionsOf(geometry: Geometry): Position[] {
  const out: Position[] = [];
  if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries) out.push(...positionsOf(g));
  } else {
    visit(geometry.coordinates, out);
  }
  return out;
}

export function geometryBBox(geometry: Geometry): BBox | null {
  const points = positionsOf(geometry);
  if (points.length === 0) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of points) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  return [minLon, minLat, maxLon, maxLat];
}

/** 一覧移動・ラベル用の代表点。点はそのまま、線・面は外接矩形の中心。 */
export function representativePoint(geometry: Geometry): LngLat | null {
  if (geometry.type === "Point") {
    const c: unknown = geometry.coordinates;
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
    return [c[0], c[1]];
  }
  const box = geometryBBox(geometry);
  return box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : null;
}
