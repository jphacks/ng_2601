import type { FeatureCollection, Geometry, Point } from "geojson";

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

/** [minLon, minLat, maxLon, maxLat] */
export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

// --- GET /v1/map-data（BE担当共有のスニペット。リポジトリ未取り込みのため全て @provisional） ---------
// キー欠落（undefined）は「欠測」、null は「提供元が不明と明示」として区別して扱う。

/** @provisional 提供元ごとの状態。enabled=false はデータ提供なし（0件＝安全ではない）。 */
export interface SourceStatus {
  enabled: boolean;
  feature_count?: number;
  source_id?: string;
  metadata?: {
    retrieved_at?: string | null;
    generated_at?: string | null;
    window?: unknown;
    coverage?: string | null;
    source?: string;
    authority?: string;
    [key: string]: unknown;
  };
  /** restrictions のみ。提供元（jartic / mlit 等）ごとの状態。 */
  sources?: Record<string, SourceStatus>;
}

/** @provisional back/backend/app/restrictions.py が読むキー。全て欠落し得る。 */
export interface RestrictionProps {
  id?: string;
  name?: string | null;
  source?: string | null;
  enforcement?: string | null;
  authority?: string | null;
  source_kind?: string | null;
  observed_at?: string | null;
  retrieved_at?: string | null;
  confidence?: string | null;
  vehicle_classes?: string[];
  /** 0=月 … 6=日 (Python weekday) */
  days?: number[];
  /** "HH:MM" */
  start_time?: string | null;
  end_time?: string | null;
}

/** @provisional */
export interface AccidentProps {
  bicycle_involved?: boolean;
  fatal_or_serious?: boolean;
  [key: string]: unknown;
}

/** @provisional */
export interface TrafficProps {
  vehicle_count?: number;
  [key: string]: unknown;
}

export type ObservationTemporalKind = "permanent" | "time_of_day" | "date_range" | "temporary" | "trend";
export type ObservationStatus = "active" | "resolved" | "withdrawn" | "expired";
export type ObservationVerification = "unverified" | "corroborated" | "moderated";

/**
 * @provisional `_observation_features` の実装は未確認。observations テーブル
 * (back/docs/database-schema.mmd) の列名と同名と仮定している。実レスポンス確認後に差し替える。
 */
export interface ObservationProps {
  id: string;
  /** 値の一覧は未確認。未知の値は「その他」として扱う。 */
  category?: string | null;
  temporal_kind?: ObservationTemporalKind | null;
  observed_at?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  expires_at?: string | null;
  status?: ObservationStatus | null;
  verification_state?: ObservationVerification | null;
  description?: string | null;
  updated_at?: string | null;
}

type Collection<G extends Geometry, P> = FeatureCollection<G, P>;

/** @provisional */
export interface MapDataResponse {
  restrictions: Collection<Geometry, RestrictionProps> & { source_status: SourceStatus };
  route_context: {
    accidents: Collection<Geometry, AccidentProps> & { source_status: SourceStatus };
    traffic: Collection<Geometry, TrafficProps> & { source_status: SourceStatus };
  };
  observations: Collection<Point, ObservationProps> & {
    source: { source_id: string; authority: string; routing_effect: string };
  };
}
