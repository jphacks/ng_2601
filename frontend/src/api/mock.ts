import type { ApiClient } from "./client";
import { ApiError } from "./errors";
import { defaultPreferences, mockHazards, mockReviews, mockRoutes } from "../mocks/data";

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms));

export function createMockClient(): ApiClient {
  let prefs = { ...defaultPreferences };

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
    async listHazards() {
      await delay();
      return mockHazards;
    },
    async listReviews({ routeId, hazardId } = {}) {
      await delay();
      return mockReviews.filter(
        (r) => (!routeId || r.routeId === routeId) && (!hazardId || r.hazardId === hazardId),
      );
    },
    async getPreferences() {
      await delay();
      return prefs;
    },
    async updatePreferences(p) {
      await delay();
      prefs = { ...p };
      return prefs;
    },
  };
}
