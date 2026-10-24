import type { MapDataResponse } from "../types/api";
import { ApiError } from "./errors";

const invalid = (message: string) => new ApiError(0, { code: "invalid_response", message });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** GeoJSON の FeatureCollection として最低限必要な形（features が配列）であること。 */
function requireCollection(value: unknown, name: string): Record<string, unknown> {
  if (!isObject(value) || !Array.isArray(value.features)) {
    throw invalid(`道路情報の応答が不正です（${name} がありません）。`);
  }
  return value;
}

/**
 * 実行時の最小限の構造検証（HTTP境界）。取得したデータが欠けているのに「該当なし」と見えないよう、
 * 全ての提供元（restrictions / route_context.accidents・traffic / observations）が揃っていない応答は拒否する。
 * 事故履歴・交通量は `source_status` が無いと「提供なし」か「欠測」か判別できないため、地物があるのに無い応答も拒否する。
 */
export function assertMapData(data: unknown): MapDataResponse {
  if (!isObject(data)) throw invalid("道路情報の応答が不正です。");
  requireCollection(data.restrictions, "restrictions");
  requireCollection(data.observations, "observations");
  if (!isObject(data.route_context)) throw invalid("道路情報の応答が不正です（route_context がありません）。");
  for (const key of ["accidents", "traffic"] as const) {
    const collection = requireCollection(data.route_context[key], `route_context.${key}`);
    if ((collection.features as unknown[]).length > 0 && !isObject(collection.source_status)) {
      throw invalid(`道路情報の応答が不正です（${key} に source_status がありません）。`);
    }
  }
  return data as unknown as MapDataResponse;
}
