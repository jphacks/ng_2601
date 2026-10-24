import type { ApiClient } from "./client";
import { ApiError } from "./errors";
import {
  defaultPreferences,
  mockHazardRouteIds,
  mockHazards,
  mockReviews,
  mockRoutes,
} from "../mocks/data";
import type { Preferences } from "../types/api";

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms));

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
