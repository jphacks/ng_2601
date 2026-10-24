import type { ApiClient } from "./client";
import { ApiError } from "./errors";
import {
  defaultPreferences,
  mockHazardRouteIds,
  mockHazards,
  mockReviews,
  mockRoutes,
} from "../mocks/data";
import { bboxIntersects } from "../features/hazards/bbox";
import { geometryBBox } from "../features/hazards/geometry";
import { buildMockMapData } from "../mocks/mapData";
import type { BBox, Preferences } from "../types/api";

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/** 範囲外の feature を除く。BEの bbox 絞り込みに相当。 */
function inBBox<F extends { geometry: Parameters<typeof geometryBBox>[0] }>(features: F[], bbox: BBox): F[] {
  return features.filter((f) => {
    const box = f.geometry && geometryBBox(f.geometry);
    return box !== null && bboxIntersects(bbox, box);
  });
}

const copyPrefs = (p: Preferences): Preferences => ({
  ...p,
  avoidHazardTypes: [...p.avoidHazardTypes],
});

export function createMockClient(): ApiClient {
  let prefs = copyPrefs(defaultPreferences);

  return {
    async searchRoutes() {
      await delay();
      return mockRoutes;
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
