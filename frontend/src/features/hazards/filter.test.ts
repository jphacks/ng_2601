import { describe, expect, it } from "vitest";
import { buildMockMapData } from "../../mocks/mapData";
import { applyFilter, countByCategory, createDefaultFilter } from "./filter";
import { normalizeMapData } from "./normalize";
import { buildRoadInfoCollection } from "./mapCollection";

const NOW = new Date("2026-10-24T12:00:00+09:00");
const { items } = normalizeMapData(buildMockMapData(NOW));

describe("applyFilter", () => {
  it("既定では全件", () => {
    expect(applyFilter(items, createDefaultFilter(), NOW)).toHaveLength(items.length);
  });

  it("カテゴリをOFFにするとそのカテゴリだけ消える", () => {
    const filter = createDefaultFilter();
    filter.categories.delete("danger");
    const result = applyFilter(items, filter, NOW);
    expect(result.length).toBeLessThan(items.length);
    expect(result.some((i) => i.category === "danger")).toBe(false);
    expect(result.some((i) => i.category === "terrain")).toBe(true);
  });

  it("全カテゴリOFFなら0件", () => {
    const filter = createDefaultFilter();
    filter.categories.clear();
    expect(applyFilter(items, filter, NOW)).toEqual([]);
  });

  it("情報区分でユーザー報告と公的情報を分けられる", () => {
    const filter = createDefaultFilter();
    filter.infoClasses = new Set(["community"]);
    const result = applyFilter(items, filter, NOW);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((i) => i.infoClass === "community")).toBe(true);
  });

  it("有効期間: 期間限定のみ／恒常のみ（時間帯限定は恒常側）", () => {
    const temporary = createDefaultFilter();
    temporary.temporality = "temporary";
    expect(applyFilter(items, temporary, NOW).every((i) => i.temporality === "temporary")).toBe(true);

    const permanent = createDefaultFilter();
    permanent.temporality = "permanent";
    const result = applyFilter(items, permanent, NOW);
    expect(result.every((i) => i.temporality !== "temporary")).toBe(true);
    expect(result.some((i) => i.temporality === "scheduled")).toBe(true);
  });

  it("期限切れ・解消済み・未確認を隠せる", () => {
    const filter = createDefaultFilter();
    filter.hideStale = true;
    const ids = applyFilter(items, filter, NOW).map((i) => i.id);
    expect(ids).not.toContain("observation:mock-o2"); // 期限切れ＋未確認
    expect(ids).not.toContain("observation:mock-o5"); // 解消済み
    expect(ids).not.toContain("restriction:mock-r3"); // 未確認(low)
    expect(ids).not.toContain("observation:mock-o7"); // 開始前
    expect(ids).toContain("observation:mock-o1"); // 有効
  });
});

describe("countByCategory", () => {
  it("カテゴリ自体のチェック状態に関係なく、他の条件を満たす件数を数える", () => {
    const filter = createDefaultFilter();
    filter.categories.clear();
    const counts = countByCategory(items, filter, NOW);
    expect(counts.danger + counts.convenience + counts.terrain + counts.facility).toBe(items.length);
    expect(counts.convenience).toBeGreaterThan(0);
  });
});

describe("buildRoadInfoCollection", () => {
  it("地図用に id・カテゴリ・見た目の状態を持たせる", () => {
    const fc = buildRoadInfoCollection(items, NOW);
    const state = (id: string) => fc.features.find((f) => f.properties.id === id)?.properties.state;
    expect(state("observation:mock-o1")).toBe("current");
    expect(state("observation:mock-o2")).toBe("stale");
    expect(state("observation:mock-o5")).toBe("stale");
    expect(state("observation:mock-o7")).toBe("stale"); // 開始前（未確認でもある）
  });
});
