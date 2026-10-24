import { haversineM } from "../lib/geo";
import type { ElevationPoint, LngLat, Route, RouteSearchRequest } from "../types/api";
import { ApiError } from "./errors";
import { toBackendRoutePreferences } from "./preferencesAdapter";

/** `POST /v1/routes` のリクエストbody（back/backend/app/main.py の RouteRequest）。 */
export interface BackendRouteRequest {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  bike_type: string;
  preferences: Record<string, string>;
}

export function toBackendRequest(req: RouteSearchRequest): BackendRouteRequest {
  const body: BackendRouteRequest = {
    start: { lon: req.origin[0], lat: req.origin[1] },
    end: { lon: req.destination[0], lat: req.destination[1] },
    bike_type: req.bikeType,
    preferences: toBackendRoutePreferences(req),
  };
  return body;
}

function invalid(message: string): ApiError {
  return new ApiError(502, { code: "invalid_response", message: `経路データの形式が不正です（${message}）` });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** BRouterのpropertiesは数値が文字列で入る。数値化できなければ undefined。 */
function numberProp(props: Record<string, unknown>, key: string): number | undefined {
  const raw = props[key];
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * `POST /v1/routes` の応答（`{route: BRouter GeoJSON, ...}`）を FE の Route に変換する。
 * BEが返さない値（下降量・最大勾配）は推測せず null とする。
 */
export function fromBackendResponse(body: unknown): Route {
  if (!isRecord(body) || !isRecord(body.route)) throw invalid("route がありません");
  const features = body.route.features;
  const feature = Array.isArray(features) ? features[0] : undefined;
  if (!isRecord(feature) || !isRecord(feature.geometry) || feature.geometry.type !== "LineString") {
    throw invalid("LineString がありません");
  }
  const raw = feature.geometry.coordinates;
  if (!Array.isArray(raw) || raw.length < 2) throw invalid("座標が不足しています");

  const coordinates: LngLat[] = [];
  const elevations: Array<number | undefined> = [];
  for (const c of raw) {
    if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") {
      throw invalid("座標が数値ではありません");
    }
    coordinates.push([c[0], c[1]]);
    elevations.push(typeof c[2] === "number" ? c[2] : undefined);
  }

  const props = isRecord(feature.properties) ? feature.properties : {};
  const distanceM = numberProp(props, "track-length");
  const durationSec = numberProp(props, "total-time");
  if (distanceM === undefined || durationSec === undefined) throw invalid("距離・所要時間がありません");

  // 標高は全点にある場合だけ点列にする（欠測を0mで埋めない）。距離は座標から累積した値。
  const points: ElevationPoint[] = [];
  if (elevations.every((e) => e !== undefined)) {
    let acc = 0;
    coordinates.forEach((c, i) => {
      if (i > 0) acc += haversineM(coordinates[i - 1], c);
      points.push({ distanceM: acc, elevationM: elevations[i] as number });
    });
  }

  return {
    id: "searched-route",
    name: "検索したルート",
    distanceM,
    durationSec,
    coordinates,
    elevationProfile: {
      points,
      totalAscentM: numberProp(props, "filtered ascend") ?? null,
      totalDescentM: null,
      maxGradePercent: null,
    },
  };
}
