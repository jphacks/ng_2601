import type { Feature, Geometry, Point } from "geojson";
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

// properties.id にしないのは、BE の /v1/map-data が報告の id を Feature.id で返すため。
const observation = (id: string, geometry: Point, properties: ObservationProps): Feature<Point, ObservationProps> => ({
  ...feature(geometry, properties),
  id,
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
          [136.8793, 35.1735],
          [136.8813, 35.1733],
          [136.8834, 35.1731],
        ],
      },
      {
        id: "mock-r1",
        name: "自転車通行止め（平日朝）",
        source: "JARTIC 交通規制情報（モック）",
        authority: "警察庁",
        source_kind: "official",
        enforcement: "block",
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
            [136.8850, 35.1709],
            [136.8867, 35.1709],
            [136.8867, 35.1721],
            [136.8850, 35.1721],
            [136.8850, 35.1709],
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
          [136.8816, 35.1709],
          [136.8824, 35.1718],
          [136.8831, 35.1726],
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
    feature(point(136.8806, 35.1716), { bicycle_involved: true, fatal_or_serious: true }),
    feature(point(136.8839, 35.1738), { bicycle_involved: true, fatal_or_serious: false }),
    feature(point(136.8857, 35.1727), { bicycle_involved: false, fatal_or_serious: false }),
  ];

  const observations: Array<Feature<Point, ObservationProps>> = [
    observation("mock-o1", point(136.8824, 35.1718), {
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
    observation("mock-o2", point(136.8835, 35.1725), {
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
    observation("mock-o3", point(136.8800, 35.1725), {
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
    observation("mock-o4", point(136.8846, 35.1742), {
      category: "bike_lane",
      temporal_kind: "permanent",
      status: "active",
      verification_state: "moderated",
      description: "車道左側に自転車レーンあり。",
    }),
    // 解消済み。
    observation("mock-o5", point(136.8819, 35.1702), {
      category: "dangerous_intersection",
      temporal_kind: "permanent",
      observed_at: at(-24 * 20),
      updated_at: at(-24 * 2),
      status: "resolved",
      verification_state: "corroborated",
      description: "見通しの悪い交差点。信号の設置工事が完了したとの報告。",
    }),
    observation("mock-o6", point(136.8862, 35.1735), {
      category: "bike_parking",
      temporal_kind: "permanent",
      observed_at: at(-24 * 30),
      updated_at: at(-24 * 30),
      status: "active",
      verification_state: "corroborated",
      description: "約30台分の駐輪場。",
    }),
    observation("mock-o7", point(136.8781, 35.1709), {
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
      features: observations,
      source: { source_id: "user_report", authority: "community", routing_effect: "none_until_validated" },
    },
  };
}
