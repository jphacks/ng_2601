import type { Hazard, Preferences, Review, Route } from "../types/api";

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

export const defaultPreferences: Preferences = {
  maxGradePercent: 5,
  avoidStairs: true,
  avoidHazardTypes: ["steep_slope", "construction"],
};
