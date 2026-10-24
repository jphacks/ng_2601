import type { Hazard, LngLat, Review, Route, RouteConditions, RoutingOptions } from "../types/api";

export const mockRoutes: Route[] = [
  {
    id: "route-1",
    name: "サンプルルート（なだらか）",
    distanceM: 1200,
    durationSec: 900,
    coordinates: [
      [139.7671, 35.6812],
      [139.7685, 35.6825],
      [139.7702, 35.6838],
    ],
    elevationProfile: {
      points: [
        { distanceM: 0, elevationM: 3 },
        { distanceM: 600, elevationM: 6 },
        { distanceM: 1200, elevationM: 9 },
      ],
      totalAscentM: 6,
      totalDescentM: 0,
      maxGradePercent: 0.5,
    },
  },
  {
    id: "route-2",
    name: "サンプルルート（坂あり・近道）",
    distanceM: 950,
    durationSec: 780,
    coordinates: [
      [139.7671, 35.6812],
      [139.7679, 35.6821],
      [139.7702, 35.6838],
    ],
    elevationProfile: {
      points: [
        { distanceM: 0, elevationM: 3 },
        { distanceM: 400, elevationM: 18 },
        { distanceM: 950, elevationM: 9 },
      ],
      totalAscentM: 15,
      totalDescentM: 9,
      maxGradePercent: 8.5,
    },
  },
];

export const mockHazards: Hazard[] = [
  {
    id: "hazard-1",
    type: "steep_slope",
    severity: 3,
    location: [139.7679, 35.6821],
    description: "急な上り坂（約8%）",
  },
  {
    id: "hazard-2",
    type: "construction",
    severity: 2,
    location: [139.769, 35.6828],
    description: "歩道の一部が工事中",
  },
];

/** 危険情報が影響する経路ID */
export const mockHazardRouteIds: Record<string, string[]> = {
  "hazard-1": ["route-2"],
  "hazard-2": ["route-1"],
};

export const mockReviews: Review[] = [
  {
    id: "review-1",
    routeId: "route-1",
    rating: 5,
    comment: "ほぼ平坦で歩きやすかった。",
    createdAt: "2026-10-01T09:00:00+09:00",
  },
  {
    id: "review-2",
    hazardId: "hazard-1",
    routeId: "route-2",
    rating: 2,
    comment: "坂がきつくベビーカーには厳しい。",
    createdAt: "2026-10-02T18:30:00+09:00",
  },
];

/** 口コミは座標を持たないため、地図表示用に位置を添える（地図レイヤー確認用のモック）。 */
export const mockReviewLocations: Record<string, LngLat> = {
  "review-1": [139.7685, 35.6825],
  "review-2": [139.7679, 35.6821],
};

/** 選択肢と初期値のモック。back/config/routing_catalog.json の車種・初期値に合わせている。 */
export const mockRoutingOptions: RoutingOptions = {
  bikeTypes: {
    city: { defaults: { hillMode: "balanced", trafficMode: "balanced", surfaceMode: "comfortable", walkingMode: "short" } },
    electric_assist: { defaults: { hillMode: "balanced", trafficMode: "balanced", surfaceMode: "comfortable", walkingMode: "short" } },
    road: { defaults: { hillMode: "accept", trafficMode: "balanced", surfaceMode: "paved", walkingMode: "never" } },
    gravel: { defaults: { hillMode: "balanced", trafficMode: "balanced", surfaceMode: "rough_ok", walkingMode: "short" } },
    mamachari: { defaults: { hillMode: "avoid", trafficMode: "avoid", surfaceMode: "comfortable", walkingMode: "short" } },
  },
  modes: {
    hillMode: ["avoid", "balanced", "accept"],
    trafficMode: ["avoid", "balanced", "direct"],
    surfaceMode: ["paved", "comfortable", "rough_ok"],
    walkingMode: ["never", "short", "long"],
  },
};

/** モックに最初から保存されている設定（BEの新規ユーザーの既定と同じ city の初期値）。 */
export const mockSavedConditions: RouteConditions = {
  bikeType: "city",
  ...mockRoutingOptions.bikeTypes.city!.defaults,
};
