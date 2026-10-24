import type { ApiClient } from "./client";
import { ApiError } from "./errors";
import {
  mockHazardRouteIds,
  mockHazards,
  mockReviews,
  mockRoutes,
  mockRoutingOptions,
  mockSavedConditions,
} from "../mocks/data";
import { bboxIntersects } from "../features/hazards/bbox";
import { geometryBBox } from "../features/hazards/geometry";
import { haversineM } from "../lib/geo";
import { buildMockMapData } from "../mocks/mapData";
import type { BBox, LngLat, Route, RouteConditions, RouteSearchRequest } from "../types/api";

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/**
 * 開発時の状態確認用。URLの`?mock=`で結果を切り替える。未指定は通常の成功。
 * 経路検索: empty | error | timeout | slow
 * 設定: options-error（選択肢の取得失敗） | prefs-unauthorized（未ログイン） | prefs-error（取得失敗） | save-error（保存失敗）
 */
function mockScenario(): string | null {
  return new URLSearchParams(location.search).get("mock");
}

/**
 * 出発地・目的地を結ぶモック経路。坂道許容度で経路形状・標高が変わる（再検索で結果が更新されることの確認用）。
 * avoid: 遠回りだが平坦 / それ以外: ほぼ直線で上り下りあり。値はすべてモックで実測ではない。
 */
function mockRouteFor(req: RouteSearchRequest): Route {
  const [a, b] = [req.origin, req.destination];
  const detour = req.hillMode === "avoid" ? 0.2 : 0.05;
  const mid: LngLat = [
    (a[0] + b[0]) / 2 - (b[1] - a[1]) * detour,
    (a[1] + b[1]) / 2 + (b[0] - a[0]) * detour,
  ];
  const coordinates: LngLat[] = [a, mid, b];
  const first = haversineM(a, mid);
  const total = first + haversineM(mid, b);
  const flat = req.hillMode === "avoid";
  return {
    id: "mock-route",
    name: flat ? "モックルート（なだらか）" : "モックルート（坂あり）",
    distanceM: Math.round(total),
    durationSec: Math.round(total / (flat ? 4 : 4.5)),
    coordinates,
    elevationProfile: {
      points: [
        { distanceM: 0, elevationM: 3 },
        { distanceM: first, elevationM: flat ? 5 : 18 },
        { distanceM: total, elevationM: 9 },
      ],
      totalAscentM: flat ? 6 : 15,
      totalDescentM: flat ? 0 : 9,
      maxGradePercent: flat ? 0.5 : 8.5,
    },
  };
}

/** 範囲外の feature を除く。BEの bbox 絞り込みに相当。 */
function inBBox<F extends { geometry: Parameters<typeof geometryBBox>[0] }>(features: F[], bbox: BBox): F[] {
  return features.filter((f) => {
    const box = f.geometry && geometryBBox(f.geometry);
    return box !== null && bboxIntersects(bbox, box);
  });
}

export function createMockClient(): ApiClient {
  // 保存した設定は、ページを読み込み直すまでメモリ上に保持する（再取得して同じ値を確認できる）。
  let prefs: RouteConditions = { ...mockSavedConditions };

  return {
    async searchRoute(req) {
      const scenario = mockScenario();
      await delay(scenario === "slow" ? 3000 : 400);
      if (scenario === "empty") {
        throw new ApiError(409, { code: "no_route", message: "条件に合うルートが見つかりませんでした。" });
      }
      if (scenario === "error") {
        throw new ApiError(503, {
          code: "routing_unavailable",
          message: "ルート探索サービスを利用できません。時間をおいて再試行してください。",
        });
      }
      if (scenario === "timeout") {
        throw new ApiError(0, { code: "timeout", message: "ルート探索に時間がかかっています。時間をおいて再試行してください。" });
      }
      return mockRouteFor(req);
    },
    async getRoute(id) {
      await delay();
      const r = mockRoutes.find((x) => x.id === id);
      if (!r) throw new ApiError(404, { code: "not_found", message: `route ${id} not found` });
      return r;
    },
    async listHazards(routeId) {
      await delay();
      if (!routeId) return mockHazards;
      return mockHazards.filter((h) => mockHazardRouteIds[h.id]?.includes(routeId));
    },
    async getMapData(bbox, { limit = 200, signal } = {}) {
      await delay();
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const data = buildMockMapData();
      return {
        restrictions: { ...data.restrictions, features: inBBox(data.restrictions.features, bbox) },
        route_context: {
          accidents: {
            ...data.route_context.accidents,
            features: inBBox(data.route_context.accidents.features, bbox),
          },
          traffic: { ...data.route_context.traffic, features: inBBox(data.route_context.traffic.features, bbox) },
        },
        observations: {
          ...data.observations,
          features: inBBox(data.observations.features, bbox).slice(0, limit),
        },
      };
    },
    async listReviews({ bbox } = {}) {
      // 受入条件（0件・取得失敗・読込中）を手元で確認するため、URLの ?mock=empty|error|slow で再現する。
      const scenario = new URLSearchParams(globalThis.location?.search).get("mock");
      await delay(scenario === "slow" ? 2500 : 150);
      if (scenario === "error") throw new ApiError(503, { code: "unavailable", message: "mock: 口コミを取得できません" });
      if (scenario === "empty") return [];
      return mockReviews.filter(
        ({ location: [lng, lat] }) =>
          !bbox || (lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]),
      );
    },
    async getRoutingOptions() {
      await delay();
      if (mockScenario() === "options-error") {
        throw new ApiError(503, { code: "http_error", message: "選択肢の取得に失敗しました（HTTP 503）。" });
      }
      return structuredClone(mockRoutingOptions);
    },
    async getPreferences() {
      await delay();
      const scenario = mockScenario();
      if (scenario === "prefs-unauthorized") {
        throw new ApiError(401, { code: "unauthorized", message: "設定の保存・取得にはログインが必要です。" });
      }
      if (scenario === "prefs-error") {
        throw new ApiError(503, { code: "http_error", message: "設定の通信に失敗しました（HTTP 503）。" });
      }
      return { ...prefs };
    },
    async updatePreferences(p) {
      await delay(600);
      if (mockScenario() === "save-error") {
        throw new ApiError(503, { code: "http_error", message: "設定の通信に失敗しました（HTTP 503）。" });
      }
      prefs = { ...p };
      return { ...prefs };
    },
  };
}
