import type { MapDataResponse } from "../types/api";
import { ApiError } from "./errors";

const invalid = (message: string) => new ApiError(0, { code: "invalid_response", message });

/**
 * 実行時の最小限の構造検証（HTTP境界）。事故履歴・交通量は `source_status` が無いと
 * 「提供なし」か「欠測」か判別できないため、地物があるのに無い応答は不正として拒否する。
 */
export function assertMapData(data: unknown): MapDataResponse {
  if (typeof data !== "object" || data === null) throw invalid("道路情報の応答が不正です。");
  const ctx = (data as { route_context?: unknown }).route_context;
  if (typeof ctx !== "object" || ctx === null) return data as MapDataResponse;
  for (const key of ["accidents", "traffic"] as const) {
    const collection = (ctx as Record<string, unknown>)[key];
    if (typeof collection !== "object" || collection === null) continue;
    const { features, source_status: status } = collection as { features?: unknown; source_status?: unknown };
    const hasFeatures = Array.isArray(features) && features.length > 0;
    if (hasFeatures && (typeof status !== "object" || status === null)) {
      throw invalid(`道路情報の応答が不正です（${key} に source_status がありません）。`);
    }
  }
  return data as MapDataResponse;
}
