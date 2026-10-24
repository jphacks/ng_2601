import { describe, expect, it } from "vitest";
import { evaluateItem, formatStamp } from "./freshness";
import type { RoadInfoItem } from "./types";

const NOW = new Date("2026-10-24T12:00:00Z");

function item(overrides: Partial<RoadInfoItem> = {}): RoadInfoItem {
  return {
    id: "observation:x",
    origin: "observation",
    infoClass: "community",
    category: "danger",
    kindLabel: "工事",
    title: "工事",
    geometry: { type: "Point", coordinates: [139.7, 35.6] },
    position: [139.7, 35.6],
    temporality: "temporary",
    updatedAt: { state: "known", value: "2026-10-24T00:00:00Z" },
    retrievedAt: { state: "missing" },
    expiresAt: { state: "known", value: "2026-10-25T00:00:00Z" },
    source: {},
    verification: "verified",
    notes: [],
    ...overrides,
  };
}

describe("evaluateItem", () => {
  it("期限内は current で、注意文なし", () => {
    const f = evaluateItem(item(), NOW);
    expect(f).toMatchObject({ validity: "current", stale: false, unverified: false, updated: "known" });
    expect(f.cautions).toEqual([]);
  });

  it("期限の境界: ちょうどの時刻は期限内、1ms 過ぎたら期限切れ", () => {
    const expiresAt = { state: "known" as const, value: NOW.toISOString() };
    expect(evaluateItem(item({ expiresAt }), NOW).validity).toBe("current");
    expect(evaluateItem(item({ expiresAt }), new Date(NOW.getTime() + 1)).validity).toBe("expired");
  });

  it("期限切れは断定せず「解消している可能性」と伝える", () => {
    const f = evaluateItem(item({ expiresAt: { state: "known", value: "2026-10-20T00:00:00Z" } }), NOW);
    expect(f).toMatchObject({ validity: "expired", stale: true });
    expect(f.cautions.join("")).toContain("可能性");
  });

  it("解消済み・取り下げ・提供元で期限切れは inactive（期限内でも）", () => {
    for (const status of ["resolved", "withdrawn", "expired"] as const) {
      const f = evaluateItem(item({ status }), NOW);
      expect(f).toMatchObject({ validity: "inactive", stale: true });
      expect(f.cautions.length).toBeGreaterThan(0);
    }
  });

  it("更新日時の不明(null)と欠測(欠落)を別の状態・別の注意文にする", () => {
    const unknown = evaluateItem(item({ updatedAt: { state: "unknown" } }), NOW);
    const missing = evaluateItem(item({ updatedAt: { state: "missing" } }), NOW);
    expect(unknown.updated).toBe("unknown");
    expect(missing.updated).toBe("missing");
    expect(unknown.cautions.join("")).toContain("不明");
    expect(missing.cautions.join("")).toContain("欠測");
    expect(unknown.cautions).not.toEqual(missing.cautions);
  });

  it("未確認は stale ではないが unverified として扱う", () => {
    const f = evaluateItem(item({ verification: "unverified" }), NOW);
    expect(f).toMatchObject({ unverified: true, stale: false });
  });

  it("期限のない恒常情報は no-expiry。期間限定で期限が不明なら注意文を出す", () => {
    const permanent = evaluateItem(item({ temporality: "permanent", expiresAt: { state: "missing" } }), NOW);
    expect(permanent.validity).toBe("no-expiry");
    expect(permanent.cautions).toEqual([]);
    const temporary = evaluateItem(item({ expiresAt: { state: "unknown" } }), NOW);
    expect(temporary.validity).toBe("no-expiry");
    expect(temporary.cautions.join("")).toContain("有効期限");
  });
});

describe("formatStamp", () => {
  it("known は日本時間で表示し、unknown と missing は別の言葉にする", () => {
    expect(formatStamp({ state: "known", value: "2026-10-24T03:30:00Z" })).toContain("12:30");
    expect(formatStamp({ state: "unknown" })).toBe("不明");
    expect(formatStamp({ state: "missing" })).toBe("データなし（欠測）");
  });
});
