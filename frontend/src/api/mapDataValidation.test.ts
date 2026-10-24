import { describe, expect, it } from "vitest";
import { buildMockMapData } from "../mocks/mapData";
import { ApiError } from "./errors";
import { assertMapData } from "./mapDataValidation";

describe("assertMapData", () => {
  it("正常な応答はそのまま返す", () => {
    const data = buildMockMapData();
    expect(assertMapData(data)).toBe(data);
  });

  it("事故履歴・交通量に地物があるのに source_status が無い応答は不正として拒否する", () => {
    for (const key of ["accidents", "traffic"] as const) {
      const data = buildMockMapData();
      const target = data.route_context[key] as unknown as Record<string, unknown>;
      if (key === "traffic") target.features = [{ type: "Feature", geometry: { type: "Point", coordinates: [139.7, 35.6] }, properties: {} }];
      delete target.source_status;
      expect(() => assertMapData(data)).toThrowError(ApiError);
      expect(() => assertMapData(data)).toThrowError(/source_status/);
    }
  });

  it("source_status.sources に null の提供元がある応答は不正として拒否する", () => {
    const data = buildMockMapData();
    const status = data.route_context.accidents.source_status as unknown as Record<string, unknown>;
    status.sources = { npa: null };
    expect(() => assertMapData(data)).toThrowError(/source_status\.sources/);
  });

  it("地物が無ければ source_status が無くても拒否しない（提供状況は別途表示）", () => {
    const data = buildMockMapData();
    delete (data.route_context.traffic as unknown as Record<string, unknown>).source_status;
    expect(() => assertMapData(data)).not.toThrow();
  });

  it("必須の提供元が欠けた応答（route_context なしを含む）は拒否する", () => {
    const cases: Array<[string, (d: Record<string, unknown>) => void, RegExp]> = [
      ["route_context", (d) => delete d.route_context, /route_context/],
      ["restrictions", (d) => delete d.restrictions, /restrictions/],
      ["observations", (d) => delete d.observations, /observations/],
      ["accidents", (d) => delete (d.route_context as Record<string, unknown>).accidents, /accidents/],
      ["traffic", (d) => delete (d.route_context as Record<string, unknown>).traffic, /traffic/],
      ["features が配列でない", (d) => ((d.observations as Record<string, unknown>).features = null), /observations/],
    ];
    for (const [, mutate, message] of cases) {
      const data = buildMockMapData() as unknown as Record<string, unknown>;
      mutate(data);
      expect(() => assertMapData(data)).toThrowError(ApiError);
      expect(() => assertMapData(data)).toThrowError(message);
    }
  });

  it("オブジェクトでない応答は拒否する", () => {
    expect(() => assertMapData(null)).toThrowError(ApiError);
    expect(() => assertMapData("x")).toThrowError(ApiError);
  });
});
