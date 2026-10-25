import { afterEach, describe, expect, it, vi } from "vitest";
import { mockRoutes } from "../../mocks/data";
import { createRouteAnalyzer } from "./analyze";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function run(scenario: string) {
  vi.useFakeTimers();
  vi.stubGlobal("location", { search: `?elevation=${scenario}` });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const pending = createRouteAnalyzer("mock")(mockRoutes[0], { signal: new AbortController().signal, onProgress: vi.fn() });
  await vi.runAllTimersAsync();
  const result = await pending;
  expect(fetch).not.toHaveBeenCalled();
  return result!;
}

describe("mock elevation uses the production analysis without DEM requests", () => {
  it("flat samples produce true zero ascent, descent and grade", async () => {
    const result = await run("flat");
    expect(result.summary).toMatchObject({ ascent: 0, descent: 0, netGradePercent: 0, missingCount: 0 });
    expect(result.source).toBe("mock");
  });
  it("hills produce both ascent and descent", async () => {
    const result = await run("hill");
    expect(result.summary.ascent).toBeGreaterThan(20);
    expect(result.summary.descent).toBeGreaterThan(15);
  });
  it("partial gaps are preserved and make net grade unavailable", async () => {
    const result = await run("partial");
    expect(result.points.some((p) => p.elevation === null)).toBe(true);
    expect(result.summary.missingCount).toBeGreaterThan(0);
    expect(result.summary.netGradePercent).toBeNull();
    expect(result.summary.validDistance).toBeLessThan(result.summary.totalDistance);
  });
  it("all missing samples remain unavailable", async () => {
    const result = await run("missing");
    expect(result.summary).toMatchObject({ validCount: 0, validDistance: 0, netGradePercent: null, minElevation: null });
  });
});
