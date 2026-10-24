import type { Feature, Geometry } from "geojson";
import type {
  AccidentProps,
  MapDataResponse,
  ObservationProps,
  RestrictionProps,
  TrafficProps,
} from "../types/api";

// GET /v1/map-data のモック（全て暫定。実測値ではなく、安全性を示すものでもない）。
// 日時は呼び出し時刻からの相対で作り、期限切れ／有効中の区別がデモ中に腐らないようにする。
// 状態の見本: 期限切れ(o2) / 更新日時が不明=null(o3, r2) / 欠測=キー欠落(o4, r3) / 解消済み(o5) / 未確認(o2, r3) / 未提供(traffic)

const feature = <G extends Geometry, P>(geometry: G, properties: P): Feature<G, P> => ({
  type: "Feature",
  geometry,
  properties,
});

const point = (lng: number, lat: number) => ({ type: "Point" as const, coordinates: [lng, lat] });

export function buildMockMapData(now: Date = new Date()): MapDataResponse {
  const at = (offsetHours: number): string => new Date(now.getTime() + offsetHours * 3_600_000).toISOString();
  const retrievedAt = at(-6);

  const restrictions: Array<Feature<Geometry, RestrictionProps>> = [
    feature(
      {
        type: "LineString",
        coordinates: [
          [139.7648, 35.6838],
          [139.7668, 35.6836],
          [139.7689, 35.6834],
        ],
      },
      {
        id: "mock-r1",
        name: "自転車通行止め（平日朝）",
        source: "JARTIC 交通規制情報（モック）",
        authority: "警察庁",
        source_kind: "official",
        enforcement: "prohibit",
        observed_at: at(-24),
        retrieved_at: retrievedAt,
        confidence: "high",
        days: [0, 1, 2, 3, 4],
        start_time: "07:00",
        end_time: "09:00",
      },
    ),
    feature(
      {
        type: "Polygon",
        coordinates: [
          [
            [139.7705, 35.6812],
            [139.7722, 35.6812],
            [139.7722, 35.6824],
            [139.7705, 35.6824],
            [139.7705, 35.6812],
          ],
        ],
      },
      {
        id: "mock-r2",
        name: "歩行者専用区域",
        source: "MLIT 道路規制（モック）",
        authority: "国土交通省",
        source_kind: "official",
        enforcement: "warn",
        observed_at: null,
        retrieved_at: retrievedAt,
        confidence: "unknown",
      },
    ),
    // observed_at を持たない（欠測）。confidence が low のため未確認扱い。
    feature(
      {
        type: "LineString",
        coordinates: [
          [139.7671, 35.6812],
          [139.7679, 35.6821],
          [139.7686, 35.6829],
        ],
      },
      {
        id: "mock-r3",
        name: "一方通行（逆走禁止）",
        source: "JARTIC 交通規制情報（モック）",
        authority: "警察庁",
        source_kind: "official",
        enforcement: "warn",
        retrieved_at: retrievedAt,
        confidence: "low",
      },
    ),
  ];

  const accidents: Array<Feature<Geometry, AccidentProps>> = [
    feature(point(139.7661, 35.6819), { bicycle_involved: true, fatal_or_serious: true }),
    feature(point(139.7694, 35.6841), { bicycle_involved: true, fatal_or_serious: false }),
    feature(point(139.7712, 35.683), { bicycle_involved: false, fatal_or_serious: false }),
  ];

  const observations: Array<Feature<Geometry, ObservationProps>> = [
    feature(point(139.7679, 35.6821), {
      id: "mock-o1",
      category: "construction",
      temporal_kind: "temporary",
      observed_at: at(-2),
      updated_at: at(-2),
      expires_at: at(24 * 5),
      status: "active",
      verification_state: "corroborated",
      description: "歩道の一部が工事中。車道側に迂回が必要です。",
    }),
    // 期限切れ＋未確認。
    feature(point(139.769, 35.6828), {
      id: "mock-o2",
      category: "debris_glass",
      temporal_kind: "temporary",
      observed_at: at(-24 * 6),
      updated_at: at(-24 * 6),
      expires_at: at(-24 * 3),
      status: "active",
      verification_state: "unverified",
      description: "ガラス片が散乱していたとの報告。",
    }),
    // 更新日時が不明（null）。
    feature(point(139.7655, 35.6828), {
      id: "mock-o3",
      category: "steep_slope",
      temporal_kind: "permanent",
      observed_at: null,
      updated_at: null,
      expires_at: null,
      status: "active",
      verification_state: "moderated",
      description: "急な上り坂（約8%）。",
    }),
    // 更新日時のキーがない（欠測）。
    feature(point(139.7701, 35.6845), {
      id: "mock-o4",
      category: "bike_lane",
      temporal_kind: "permanent",
      status: "active",
      verification_state: "moderated",
      description: "車道左側に自転車レーンあり。",
    }),
    // 解消済み。
    feature(point(139.7674, 35.6805), {
      id: "mock-o5",
      category: "dangerous_intersection",
      temporal_kind: "permanent",
      observed_at: at(-24 * 20),
      updated_at: at(-24 * 2),
      status: "resolved",
      verification_state: "corroborated",
      description: "見通しの悪い交差点。信号の設置工事が完了したとの報告。",
    }),
    feature(point(139.7717, 35.6838), {
      id: "mock-o6",
      category: "bike_parking",
      temporal_kind: "permanent",
      observed_at: at(-24 * 30),
      updated_at: at(-24 * 30),
      status: "active",
      verification_state: "corroborated",
      description: "約30台分の駐輪場。",
    }),
    feature(point(139.7636, 35.6812), {
      id: "mock-o7",
      category: "traffic_regulation",
      temporal_kind: "date_range",
      observed_at: at(-24),
      updated_at: at(-24),
      starts_at: at(24 * 2),
      ends_at: at(24 * 2 + 8),
      status: "active",
      verification_state: "unverified",
      description: "マラソン大会に伴う通行規制の予定。",
    }),
  ];

  return {
    restrictions: {
      type: "FeatureCollection",
      features: restrictions,
      source_status: {
        enabled: true,
        feature_count: restrictions.length,
        sources: {
          jartic: { enabled: true, feature_count: 2, source_id: "jartic", metadata: { retrieved_at: retrievedAt } },
          // 提供のないソースは「未提供」と表示する。
          mlit: { enabled: false, feature_count: 0, source_id: "mlit" },
        },
      },
    },
    route_context: {
      accidents: {
        type: "FeatureCollection",
        features: accidents,
        source_status: {
          enabled: true,
          feature_count: accidents.length,
          source_id: "npa_accidents",
          metadata: {
            retrieved_at: at(-24 * 30),
            window: "2021-2025",
            coverage: "partial",
            source: "NPA 交通事故オープンデータ（モック）",
            authority: "警察庁",
          },
        },
      },
      traffic: {
        type: "FeatureCollection",
        features: [] as Array<Feature<Geometry, TrafficProps>>,
        source_status: { enabled: false, feature_count: 0, source_id: "jartic_traffic" },
      },
    },
    observations: {
      type: "FeatureCollection",
      features: observations as Array<Feature<ReturnType<typeof point>, ObservationProps>>,
      source: { source_id: "user_report", authority: "community", routing_effect: "none_until_validated" },
    },
  };
}
