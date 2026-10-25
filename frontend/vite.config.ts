import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  server: {
    proxy: { "/v1": loadEnv(mode, ".", "").API_PROXY_TARGET || "http://localhost:8080" },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
}));
