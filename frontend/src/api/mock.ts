import type { ApiClient } from "./client";
import { ApiError } from "./errors";
import {
  defaultPreferences,
  mockHazardRouteIds,
  mockHazards,
  mockReviews,
  mockRoutes,
} from "../mocks/data";
import { haversineM } from "../lib/geo";
import type { LngLat, Preferences, Route, RouteSearchRequest } from "../types/api";

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/**
 * 開発時の状態確認用。URLの`?mock=empty|error|timeout|slow`で経路検索の結果を切り替える。
 * 未指定は通常の成功。
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

const copyPrefs = (p: Preferences): Preferences => ({
  ...p,
  avoidHazardTypes: [...p.avoidHazardTypes],
});

export function createMockClient(): ApiClient {
  let prefs = copyPrefs(defaultPreferences);

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
    async listReviews({ routeId, hazardId } = {}) {
      await delay();
      return mockReviews.filter(
        (r) => (!routeId || r.routeId === routeId) && (!hazardId || r.hazardId === hazardId),
      );
    },
    async getPreferences() {
      await delay();
      return copyPrefs(prefs);
    },
    async updatePreferences(p) {
      await delay();
      prefs = copyPrefs(p);
      return copyPrefs(prefs);
    },
  };
}
