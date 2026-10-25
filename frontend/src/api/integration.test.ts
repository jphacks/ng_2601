import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMockMapData } from "../mocks/mapData";
import { mockReviews } from "../mocks/data";
import type { BBox } from "../types/api";
import { createHttpClient } from "./http";
import { createMockClient } from "./mock";

const BOUNDS: BBox = [139.767, 35.682, 139.769, 35.683];
const MOCK_BOUNDS: BBox = [136.8815, 35.1717, 136.8835, 35.1727];
const observation = {
  type: "Feature",
  id: "observation-1",
  geometry: { type: "Point", coordinates: [139.768, 35.6825] },
  properties: { category: "road_surface", description: "段差あり", created_at: "2026-10-25T00:00:00Z" },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("main の経路・道路情報と口コミのAPI統合", () => {
  it("同じタプルbboxをmap-dataとobservationsのqueryへ変換する", async () => {
    const data = buildMockMapData();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(data))
      .mockResolvedValueOnce(Response.json({ type: "FeatureCollection", features: [observation] }));
    vi.stubGlobal("fetch", fetcher);
    const client = createHttpClient("https://example.test");
    expect(await client.getMapData(BOUNDS, { limit: 23 })).toEqual(data);
    expect(await client.listReviews({ bbox: BOUNDS })).toMatchObject([
      { id: "observation-1", location: [139.768, 35.6825], category: "surface", comment: "段差あり" },
    ]);
    for (const [path] of fetcher.mock.calls) {
      const url = new URL(path);
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        min_lon: "139.767", min_lat: "35.682", max_lon: "139.769", max_lat: "35.683",
      });
    }
    expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe("/v1/map-data");
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("limit")).toBe("23");
    expect(new URL(fetcher.mock.calls[1][0]).pathname).toBe("/v1/observations");
  });

  it("main の単一経路検索・BEへの条件変換を維持する", async () => {
    const coordinates = [[139.76, 35.68], [139.77, 35.69]];
    const fetcher = vi.fn().mockResolvedValue(Response.json({ route: {
      type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates },
        properties: { "track-length": "1500", "total-time": "300" } }],
    } }));
    vi.stubGlobal("fetch", fetcher);
    const route = await createHttpClient("https://example.test").searchRoute({
      origin: [139.76, 35.68], destination: [139.77, 35.69], bikeType: "road", hillMode: "avoid",
      trafficMode: "balanced", surfaceMode: "paved", walkingMode: "never",
    });
    expect(route).toMatchObject({ distanceM: 1500, durationSec: 300, coordinates });
    expect(fetcher.mock.calls[0][0]).toBe("https://example.test/v1/routes");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      start: { lon: 139.76, lat: 35.68 }, end: { lon: 139.77, lat: 35.69 },
      bike_type: "road", preferences: {
        hill_mode: "avoid", traffic_mode: "balanced", surface_mode: "paved", walking_mode: "never",
      },
    });
  });

  it("map-dataの呼出元による中断を通信エラーへ変換しない", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const controller = new AbortController();
    const pending = createHttpClient("https://example.test").getMapData(BOUNDS, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("不正な口コミの応答を空の正常応答として扱わない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ unexpected: [] })));
    await expect(createHttpClient("https://example.test").listReviews({ bbox: BOUNDS }))
      .rejects.toMatchObject({ status: 502, code: "invalid_response" });
  });

  it("モックもタプルbboxで口コミを絞り込み、map-dataを提供する", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { search: "" });
    const client = createMockClient();
    const pending = Promise.all([client.listReviews({ bbox: MOCK_BOUNDS }), client.getMapData(MOCK_BOUNDS)]);
    await vi.runAllTimersAsync();
    const [reviews, mapData] = await pending;
    expect(reviews.map((review) => review.id)).toEqual(mockReviews.slice(0, 3).map((review) => review.id));
    expect(mapData).toHaveProperty("restrictions.features");
    expect(mapData).toHaveProperty("observations.features");
  });

  it.each(["empty", "error"])("口コミのモック状態 %s を維持する", async (scenario) => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { search: `?mock=${scenario}` });
    const pending = createMockClient().listReviews({ bbox: BOUNDS });
    const check = scenario === "empty" ? expect(pending).resolves.toEqual([])
      : expect(pending).rejects.toMatchObject({ status: 503 });
    await vi.runAllTimersAsync();
    await check;
  });

  it("口コミの通信タイムアウトに専用メッセージを返す", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const pending = createHttpClient("https://example.test").listReviews({ bbox: BOUNDS });
    const check = expect(pending).rejects.toMatchObject({
      code: "timeout", message: "口コミの取得に時間がかかっています。時間をおいて再試行してください。",
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await check;
  });

  it("範囲外座標の口コミを除き、有効な口コミは表示用に返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      type: "FeatureCollection",
      features: [observation, ...[[181, 35], [139, 91], [-181, 35], [139, -91]].map((coordinates) => ({
        ...observation, id: `invalid-${coordinates}`, geometry: { type: "Point", coordinates },
      }))],
    })));
    const reviews = await createHttpClient("https://example.test").listReviews({ bbox: BOUNDS });
    expect(reviews.map((review) => review.id)).toEqual(["observation-1"]);
  });

  it("投稿をmainのBE形式へ変換し、作成応答から一覧用の口コミを作る", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: "created-1", verification_state: "unverified" }, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    const draft = { location: [139.768, 35.6825] as [number, number], category: "surface" as const, comment: "段差あり" };
    const review = await createHttpClient("https://example.test").createReview(draft);
    expect(review).toMatchObject({ id: "created-1", ...draft, verification: "unverified" });
    expect(fetcher.mock.calls[0][0]).toBe("https://example.test/v1/observations");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      category: "surface", location: { lon: 139.768, lat: 35.6825 }, temporal_kind: "permanent", description: "段差あり",
    });
  });

  it.each([[401, "unauthorized"], [429, "rate_limited"]])("投稿のHTTP %sを正規化する", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ detail: "backend message" }, { status: Number(status) })));
    await expect(createHttpClient("https://example.test").createReview({
      location: [139.768, 35.6825], category: "surface", comment: "段差あり",
    })).rejects.toMatchObject({ status: Number(status), code, details: "backend message" });
  });

  it("投稿の不正な作成応答はinvalid_responseとして扱う", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ unexpected: true })));
    await expect(createHttpClient("https://example.test").createReview({
      location: [139.768, 35.6825], category: "surface", comment: "段差あり",
    })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("モック投稿後も同じbboxで投稿済みの口コミを取得できる", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { search: "" });
    const client = createMockClient();
    const creating = client.createReview({ location: [139.768, 35.6825], category: "surface", comment: "段差あり" });
    await vi.runAllTimersAsync();
    const created = await creating;
    const listing = client.listReviews({ bbox: BOUNDS });
    await vi.runAllTimersAsync();
    expect(await listing).toContainEqual(created);
    const outside = client.listReviews({ bbox: [140, 36, 141, 37] });
    await vi.runAllTimersAsync();
    expect(await outside).toEqual([]);
  });
});
