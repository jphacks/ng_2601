import type { ApiClient } from "./client";
import { createHttpClient } from "./http";
import { createMockClient } from "./mock";

/** VITE_API_MODE=http のとき実API、それ以外はモック。 */
export const api: ApiClient =
  import.meta.env.VITE_API_MODE === "http"
    ? createHttpClient(import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000")
    : createMockClient();

export type { ApiClient } from "./client";
export { ApiError, toApiError } from "./errors";
