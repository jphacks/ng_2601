import type { ApiClient } from "./client";
import { createHttpClient } from "./http";
import { createMockClient } from "./mock";
import { auth } from "../features/auth";

const useHttp = import.meta.env.VITE_API_MODE === "http";

/** モックAPIのとき true。モックの危険情報は実データではないので、実API接続時は表示しない。 */
export const isMockApi = !useHttp;

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

/** VITE_API_MODE=http のとき実API、それ以外はモック。 */
export const api: ApiClient = useHttp
  ? createHttpClient(apiBaseUrl, () => auth.getUser()?.accessToken ?? null)
  : createMockClient();

export type { ApiClient } from "./client";
export { ApiError, toApiError } from "./errors";
