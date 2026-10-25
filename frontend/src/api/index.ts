import type { ApiClient } from "./client";
import { createHttpClient } from "./http";
import { createMockClient } from "./mock";

const useHttp = import.meta.env.VITE_API_MODE === "http";

/** モックAPIのとき true。モックの危険情報は実データではないので、実API接続時は表示しない。 */
export const isMockApi = !useHttp;

/** VITE_API_MODE=http のとき実API、それ以外はモック。 */
export const api: ApiClient =
  useHttp
    ? createHttpClient(import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080")
    : createMockClient();

export type { ApiClient } from "./client";
export { ApiError, toApiError } from "./errors";
