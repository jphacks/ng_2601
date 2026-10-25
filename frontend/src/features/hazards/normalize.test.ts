import { describe, expect, it } from "vitest";
import { buildMockMapData } from "../../mocks/mapData";
import type { MapDataResponse } from "../../types/api";
import { firstStamp, normalizeMapData, stampOf } from "./normalize";

const NOW = new Date("2026-10-24T12:00:00+09:00");

describe("stampOf / firstStamp", () => {
  it("undefined は欠測、null・空・不正値は不明、値ありは known", () => {
    expect(stampOf(undefined)).toEqual({ state: "missing" });
    expect(stampOf(null)).toEqual({ state: "unknown" });
    expect(stampOf("")).toEqual({ state: "unknown" });
    expect(stampOf("not-a-date")).toEqual({ state: "unknown" });
    expect(stampOf("2026-10-24T00:00:00Z")).toEqual({ state: "known", value: "2026-10-24T00:00:00Z" });
  });

  it("オフセットの無い日時・暦として不正な日付・範囲外の時刻は不明にする", () => {
    expect(stampOf("2026-10-24T09:00:00+09:00")).toEqual({ state: "known", value: "2026-10-24T09:00:00+09:00" });
    expect(stampOf("2026-10-24")).toEqual({ state: "known", value: "2026-10-24" });
    expect(stampOf("2026-10-24T09:00:00")).toEqual({ state: "unknown" });
    expect(stampOf("2026-02-30T00:00:00Z")).toEqual({ state: "unknown" });
    expect(stampOf("2026-10-24T25:00:00Z")).toEqual({ state: "unknown" });
    expect(stampOf("2026-10-24T09:00:00+25:00")).toEqual({ state: "unknown" });
  });

  it("最初に値のあるものを採用し、なければ null があれば不明、全て欠落なら欠測", () => {
    expect(firstStamp(null, "2026-10-24T00:00:00Z").state).toBe("known");
    expect(firstStamp(undefined, null).state).toBe("unknown");
    expect(firstStamp(undefined, undefined).state).toBe("missing");
  });
});

describe("normalizeMapData (モック)", () => {
  const { items, sources } = normalizeMapData(buildMockMapData(NOW));
  const byId = (id: string) => items.find((i) => i.id === id)!;

  it("全4カテゴリ・3情報区分を含み、IDが重複しない", () => {
    expect(new Set(items.map((i) => i.category))).toEqual(new Set(["danger", "convenience", "terrain", "facility"]));
    expect(new Set(items.map((i) => i.infoClass))).toEqual(new Set(["official", "statistics", "community"]));
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("区間（線・面）と点の両方を持つ", () => {
    const types = new Set(items.map((i) => i.geometry.type));
    expect(types.has("Point")).toBe(true);
    expect(types.has("LineString")).toBe(true);
    expect(types.has("Polygon")).toBe(true);
  });

  it("更新日時の null=不明 と キー欠落=欠測 を区別する", () => {
    expect(byId("observation:mock-o3").updatedAt.state).toBe("unknown");
    expect(byId("observation:mock-o4").updatedAt.state).toBe("missing");
    expect(byId("restriction:mock-r2").updatedAt.state).toBe("unknown");
    expect(byId("restriction:mock-r3").updatedAt.state).toBe("missing");
  });

  it("時間帯のある規制は scheduled、期間の報告は temporary", () => {
    expect(byId("restriction:mock-r1").temporality).toBe("scheduled");
    expect(byId("restriction:mock-r1").schedule).toMatchObject({ start: "07:00", end: "09:00" });
    expect(byId("observation:mock-o1").temporality).toBe("temporary");
    expect(byId("observation:mock-o7").temporality).toBe("temporary");
    expect(byId("observation:mock-o3").temporality).toBe("permanent");
  });

  it("starts_at を開始日時として保持し、無ければ欠測", () => {
    expect(byId("observation:mock-o7").startsAt.state).toBe("known");
    expect(byId("observation:mock-o1").startsAt.state).toBe("missing");
  });

  it("事故履歴は過去の記録である注記を必ず持つ", () => {
    const accidents = items.filter((i) => i.origin === "accident");
    expect(accidents.length).toBeGreaterThan(0);
    for (const a of accidents) expect(a.notes.join("")).toContain("現在の危険を示すものではありません");
  });

  it("未知のカテゴリは「危険／その他」に落とす", () => {
    const data = buildMockMapData(NOW);
    data.observations.features[0].properties.category = "totally_new_value";
    const first = normalizeMapData(data).items.find((i) => i.id === "observation:mock-o1")!;
    expect(first).toMatchObject({ category: "danger", kindLabel: "その他" });
  });

  it("提供元ごとの提供状況を返し、無効な提供元は enabled=false", () => {
    const off = sources.filter((s) => !s.enabled).map((s) => s.key);
    expect(off).toContain("restriction:mlit");
    expect(off).toContain("traffic");
    expect(sources.find((s) => s.key === "accident")?.enabled).toBe(true);
  });

  it("CoreS3 計測をユーザー報告と区別して未確認の点として表示する", () => {
    const data = buildMockMapData(NOW);
    data.route_context.surface = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [136.88, 35.17] },
        properties: { id: "measured-1", kind: "bump", observed_at: "2026-10-24T03:00:00Z", peak_delta_g: 0.8 },
      }],
      source_status: { enabled: true, source_id: "cores3_surface_v1" },
    };
    const result = normalizeMapData(data);
    expect(result.items.find((i) => i.id === "surface:measured-1")).toMatchObject({
      origin: "surface", infoClass: "measurement", category: "danger", verification: "unverified",
    });
    expect(result.sources.find((s) => s.key === "surface")?.enabled).toBe(true);
  });

  it("id が無い・重複する feature でも ID が衝突しない", () => {
    const data = buildMockMapData(NOW);
    const dup = structuredClone(data.route_context.accidents.features[0]);
    data.route_context.accidents.features.push(dup);
    const ids = normalizeMapData(data).items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("geometry が無い feature は除外し、欠けたレイヤーでも落ちない", () => {
    const partial = {
      restrictions: { type: "FeatureCollection", features: [{ type: "Feature", geometry: null, properties: {} }], source_status: { enabled: true } },
    } as unknown as MapDataResponse;
    expect(normalizeMapData(partial)).toEqual({
      items: [],
      sources: [{ key: "restriction", origin: "restriction", label: "交通規制", enabled: true, featureCount: undefined, retrievedAt: { state: "missing" } }],
    });
  });
});

describe("normalizeMapData (main.py の `_observation_features` に合わせた応答)", () => {
  const disabled = { enabled: false, feature_count: 0, source_id: "npa_accident_history", path: null, metadata: {} };
  const response = {
    restrictions: { type: "FeatureCollection", features: [], truncated: false, source_status: { enabled: false, feature_count: 0, sources: { jartic: { enabled: false, feature_count: 0 } } } },
    route_context: {
      accidents: { type: "FeatureCollection", features: [], truncated: false, source_status: disabled },
      traffic: { type: "FeatureCollection", features: [], truncated: false, source_status: disabled },
    },
    observations: {
      type: "FeatureCollection",
      truncated: false,
      source: { source_id: "user_report", authority: "community", routing_effect: "none_until_validated" },
      features: [
        {
          type: "Feature",
          id: "00000000-0000-4000-8000-000000000001",
          geometry: { type: "Point", coordinates: [136.881, 35.171] },
          properties: {
            source_id: "user_report",
            authority: "community",
            category: "obstruction",
            temporal_kind: "temporary",
            observed_at: "2026-10-25T01:53:55.045807+00:00",
            starts_at: null,
            ends_at: null,
            expires_at: "2026-11-01T01:53:55.045807+00:00",
            status: "active",
            verification_state: "unverified",
            description: "Development seed: temporary obstruction example",
            created_at: "2026-10-25T01:53:55.045807+00:00",
            updated_at: "2026-10-25T01:53:55.045807+00:00",
          },
        },
        {
          type: "Feature",
          id: "00000000-0000-4000-8000-000000000002",
          geometry: { type: "Point", coordinates: [136.895, 35.178] },
          properties: {
            source_id: "user_report",
            authority: "community",
            category: "surface",
            temporal_kind: "permanent",
            observed_at: "2026-10-25T01:53:55.189607+00:00",
            starts_at: null,
            ends_at: null,
            expires_at: null,
            status: "active",
            verification_state: "unverified",
            description: "Development seed: difficult surface example",
            created_at: "2026-10-25T01:53:55.189607+00:00",
            updated_at: "2026-10-25T01:53:55.189607+00:00",
          },
        },
      ],
    },
  } as unknown as MapDataResponse;
  const { items } = normalizeMapData(response);

  it("報告の ID には Feature.id を使う", () => {
    expect(items.map((i) => i.id)).toEqual([
      "observation:00000000-0000-4000-8000-000000000001",
      "observation:00000000-0000-4000-8000-000000000002",
    ]);
  });

  it("マイクロ秒・オフセット付きの日時を値ありとして扱う", () => {
    expect(items[0].updatedAt.state).toBe("known");
    expect(items[0].expiresAt.state).toBe("known");
  });

  it("obstruction は「障害物」、surface は「路面」に分類する", () => {
    expect(items[0]).toMatchObject({ category: "danger", kindLabel: "障害物" });
    expect(items[1]).toMatchObject({ category: "terrain", kindLabel: "路面" });
  });
});
