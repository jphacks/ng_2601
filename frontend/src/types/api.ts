// 暫定API型。バックエンドのAPI確定後にここを差し替える（各型に @provisional を付与）。

/** [経度, 緯度] (GeoJSON順) */
export type LngLat = [lng: number, lat: number];

/** @provisional */
export interface ElevationPoint {
  /** 経路始点からの距離 (m) */
  distanceM: number;
  /** 標高 (m) */
  elevationM: number;
}

/**
 * BEが返さない値は null（0や推測値にしない）。表示側（#7）が欠測として扱う。
 * @provisional
 */
export interface ElevationProfile {
  points: ElevationPoint[];
  totalAscentM: number | null;
  totalDescentM: number | null;
  maxGradePercent: number | null;
}

/** @provisional */
export interface Route {
  id: string;
  name: string;
  distanceM: number;
  durationSec: number;
  coordinates: LngLat[];
  elevationProfile: ElevationProfile;
}

/** @provisional */
export type HazardType = "steep_slope" | "stairs" | "construction" | "narrow_road" | "other";

/** @provisional */
export interface Hazard {
  id: string;
  type: HazardType;
  /** 1 (低) - 3 (高) */
  severity: 1 | 2 | 3;
  location: LngLat;
  description: string;
}

/** @provisional */
export interface Review {
  id: string;
  routeId?: string;
  hazardId?: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string;
  createdAt: string; // ISO 8601
}

/** @provisional */
export interface Preferences {
  /** 許容する最大勾配 (%) */
  maxGradePercent: number;
  avoidStairs: boolean;
  avoidHazardTypes: HazardType[];
}

/** 車種。BEの`bike_type`（back/config/routing_catalog.json）に対応。 */
export type BikeType = "city" | "electric_assist" | "road" | "gravel" | "mamachari";

/** 坂道許容度。BEの`preferences.hill_mode`に対応（avoid=避ける / balanced=ふつう / accept=許容）。 */
export type HillMode = "avoid" | "balanced" | "accept";

/** 経路検索リクエスト。未指定の条件はBEの既定値（車種ごとのdefaults）が使われる。 */
export interface RouteSearchRequest {
  origin: LngLat;
  destination: LngLat;
  bikeType?: BikeType;
  hillMode?: HillMode;
}

/** 共通APIエラー形式 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}
