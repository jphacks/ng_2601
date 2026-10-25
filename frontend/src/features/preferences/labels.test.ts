import { describe, expect, it } from "vitest";
import { MODE_META, DETAIL_MODE_KEYS } from "./labels";

// BEの routing_catalog.json と同じ段階の並び。
const DETAIL_VALUES = {
  trafficMode: ["avoid", "balanced", "direct"],
  surfaceMode: ["paved", "comfortable", "rough_ok"],
  walkingMode: ["never", "short", "long"],
} as const;

describe("detail preference labels", () => {
  it("lists each detail mode exactly once, apart from the hill slider", () => {
    expect([...DETAIL_MODE_KEYS].sort()).toEqual(Object.keys(DETAIL_VALUES).sort());
  });

  it("gives every value a distinct label", () => {
    for (const [key, values] of Object.entries(DETAIL_VALUES) as [keyof typeof DETAIL_VALUES, readonly string[]][]) {
      const meta = MODE_META[key];
      const labels = values.map((v) => (meta.labels as Record<string, string>)[v]);
      expect(labels.every((l) => typeof l === "string" && l.length > 0)).toBe(true);
      expect(new Set(labels).size).toBe(values.length);
    }
  });

  it("does not promise distance limits or complete avoidance the router cannot guarantee", () => {
    const texts = Object.keys(DETAIL_VALUES).flatMap((k) =>
      Object.values(MODE_META[k as keyof typeof DETAIL_VALUES].labels as Record<string, string>),
    );
    for (const t of texts) expect(t).not.toMatch(/\d|m以内|km|通らない|使わない|のみ|必ず|完全/);
  });
});
