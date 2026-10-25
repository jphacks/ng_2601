import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import { mockRoutes } from "../../mocks/data";
import type { RouteAnalyzer, RouteAnalysis, AnalyzeOptions } from "../elevation/analyze";
import { summarizeProfile } from "../elevation/profile";
import { createRouteStore, isStale } from "./routeState";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const analysis = (): RouteAnalysis => ({
  points: [], summary: summarizeProfile([]), errorCount: 0, levelLabels: [], source: "mock", spacingM: 20,
});
function setup() {
  const searchRoute = vi.fn(async () => mockRoutes[0]);
  const calls: Array<{ options: AnalyzeOptions; result: ReturnType<typeof deferred<RouteAnalysis | null>> }> = [];
  const analyzer: RouteAnalyzer = vi.fn((_route, options) => {
    const result = deferred<RouteAnalysis | null>();
    calls.push({ options, result });
    return result.promise;
  });
  const store = createRouteStore({ searchRoute } as unknown as ApiClient, analyzer);
  store.startPick("origin"); store.pick([139.76, 35.68]); store.pick([139.77, 35.69]);
  return { store, calls, searchRoute, analyzer };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("route and elevation lifecycle", () => {
  it("shows the route before elevation, then publishes progress and results", async () => {
    const { store, calls } = setup();
    await store.search();
    expect(store.getState().status.kind).toBe("success");
    expect(store.getState().elevation.kind).toBe("loading");
    calls[0].options.onProgress(8, 20);
    expect(store.getState().elevation).toEqual({ kind: "loading", done: 8, total: 20 });
    const result = analysis();
    calls[0].result.resolve(result); await flush();
    expect(store.getState().elevation).toEqual({ kind: "ready", analysis: result });
  });
  it("draft changes keep the applied route and do not launch another analysis", async () => {
    const { store, analyzer, calls } = setup();
    await store.search();
    const routeStatus = store.getState().status;
    store.setDraft({ hillMode: "avoid" });
    expect(isStale(store.getState())).toBe(true);
    calls[0].options.onProgress(10, 20);
    expect(store.getState().status).toBe(routeStatus);
    expect(analyzer).toHaveBeenCalledTimes(1);
  });
  it("a new search cancels and discards old progress, results and errors", async () => {
    for (const reject of [false, true]) {
      const { store, calls } = setup();
      await store.search();
      store.setDraft({ hillMode: "avoid" });
      await store.search();
      expect(calls[0].options.signal.aborted).toBe(true);
      const current = store.getState().elevation;
      calls[0].options.onProgress(20, 20);
      if (reject) calls[0].result.reject(new Error("old failure"));
      else calls[0].result.resolve(analysis());
      await flush();
      expect(store.getState().elevation).toBe(current);
      const result = analysis();
      calls[1].result.resolve(result); await flush();
      expect(store.getState().elevation).toEqual({ kind: "ready", analysis: result });
    }
  });
  it("reset cancels elevation and ignores a late completion", async () => {
    const { store, calls } = setup();
    await store.search(); store.reset();
    expect(calls[0].options.signal.aborted).toBe(true);
    calls[0].result.resolve(analysis()); await flush();
    expect(store.getState().status.kind).toBe("idle");
    expect(store.getState().elevation.kind).toBe("idle");
  });
  it("retries only elevation after failure and keeps the route", async () => {
    const { store, calls, searchRoute } = setup();
    await store.search();
    const status = store.getState().status;
    calls[0].result.reject(new Error("offline")); await flush();
    expect(store.getState().elevation).toEqual({ kind: "error", message: "offline" });
    expect(store.getState().status).toBe(status);
    store.retryElevation(); store.retryElevation();
    expect(calls).toHaveLength(2);
    expect(searchRoute).toHaveBeenCalledTimes(1);
    calls[1].result.resolve(analysis()); await flush();
    expect(store.getState().elevation.kind).toBe("ready");
  });
  it("an invalid new search does not lose its validation error on elevation progress", async () => {
    const { store, calls } = setup();
    await store.search(); store.clearPoint("origin"); await store.search();
    const error = store.getState().validationError;
    expect(error).toBeTruthy();
    calls[0].options.onProgress(10, 20);
    expect(store.getState().validationError).toBe(error);
  });
});

describe("origin defaults", () => {
  const store = () => createRouteStore({ searchRoute: vi.fn(async () => mockRoutes[0]) } as unknown as ApiClient);
  it("picking only a destination ends picking and leaves the origin to the caller", () => {
    const s = store();
    s.startPick("destination"); s.pick([139.77, 35.69]);
    expect(s.getState()).toMatchObject({ destination: [139.77, 35.69], origin: null, pickMode: null });
  });
  it("records whether the origin is the current location", () => {
    const s = store();
    s.setPoint("origin", [139.76, 35.68], "current");
    expect(s.getState().originSource).toBe("current");
    s.startPick("origin"); s.pick([139.75, 35.67]);
    expect(s.getState()).toMatchObject({ originSource: "map", pickMode: "destination" });
    s.clearPoint("origin");
    expect(s.getState().originSource).toBeNull();
  });
  it("preparing lasts until the search starts or fails validation", async () => {
    const s = store();
    s.setPoint("origin", [139.76, 35.68], "current");
    s.setPoint("destination", [139.77, 35.69]);
    s.setPreparing(true);
    expect(s.getState().preparing).toBe(true);
    const searching = s.search();
    expect(s.getState()).toMatchObject({ preparing: false, status: { kind: "loading" } });
    await searching;
    s.setPoint("destination", [139.76001, 35.68001]);
    s.setPreparing(true);
    await s.search();
    expect(s.getState()).toMatchObject({ preparing: false, validationError: expect.stringContaining("近すぎ") });
  });
  it("asks for the destination first when nothing is set", async () => {
    const s = store();
    await s.search();
    expect(s.getState().validationError).toContain("目的地");
  });
});
