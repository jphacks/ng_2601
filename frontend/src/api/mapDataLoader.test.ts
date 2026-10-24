import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMockMapData } from "../mocks/mapData";
import type { BBox, MapDataResponse } from "../types/api";
import type { ApiClient, MapDataOptions } from "./client";
import { ApiError } from "./errors";
import { createMapDataLoader, type MapDataState } from "./mapDataLoader";

const VIEW: BBox = [139.76, 35.68, 139.78, 35.69];
const DEBOUNCE = 300;

interface Pending {
  bbox: BBox;
  opts?: MapDataOptions;
  resolve(data: MapDataResponse): void;
  reject(error: unknown): void;
}

function fakeClient() {
  const calls: Pending[] = [];
  const client = {
    getMapData: (bbox: BBox, opts?: MapDataOptions) =>
      new Promise<MapDataResponse>((resolve, reject) => {
        calls.push({ bbox, opts, resolve, reject });
      }),
  } as unknown as ApiClient;
  return { client, calls };
}

const tick = async () => {
  await vi.advanceTimersByTimeAsync(DEBOUNCE + 1);
};

describe("createMapDataLoader", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("デバウンス後に1回だけ、余白つきの範囲で取得する", async () => {
    const { client, calls } = fakeClient();
    const loader = createMapDataLoader(client, { debounceMs: DEBOUNCE });
    loader.request(VIEW, 15);
    loader.request(VIEW, 15);
    expect(calls).toHaveLength(0);
    await tick();
    expect(calls).toHaveLength(1);
    const [w, s, e, n] = calls[0].bbox;
    expect(w).toBeLessThan(VIEW[0]);
    expect(s).toBeLessThan(VIEW[1]);
    expect(e).toBeGreaterThan(VIEW[2]);
    expect(n).toBeGreaterThan(VIEW[3]);
    expect(loader.getState().status).toBe("loading");
  });

  it("取得済みの範囲内の移動では再取得しない", async () => {
    const { client, calls } = fakeClient();
    const loader = createMapDataLoader(client, { debounceMs: DEBOUNCE });
    loader.request(VIEW, 15);
    await tick();
    calls[0].resolve(buildMockMapData());
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.getState().status).toBe("ok");

    loader.request([139.765, 35.682, 139.775, 35.688], 16);
    await tick();
    expect(calls).toHaveLength(1);

    loader.request([139.9, 35.8, 139.92, 35.81], 15);
    await tick();
    expect(calls).toHaveLength(2);
  });

  it("古い要求は中断し、遅れて返った古い応答は捨てる", async () => {
    const { client, calls } = fakeClient();
    const loader = createMapDataLoader(client, { debounceMs: DEBOUNCE });
    const states: MapDataState[] = [];
    loader.subscribe((s) => states.push(s));

    loader.request(VIEW, 15);
    await tick();
    const newer: BBox = [139.9, 35.8, 139.92, 35.81];
    loader.request(newer, 15);
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[0].opts?.signal?.aborted).toBe(true);

    const stale = buildMockMapData();
    const fresh = buildMockMapData();
    calls[1].resolve(fresh);
    await vi.advanceTimersByTimeAsync(0);
    calls[0].resolve(stale);
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.getState().data).toBe(fresh);
  });

  it("取得済みの範囲に戻ったら進行中の別領域の取得を無効化し、表示中のデータを上書きさせない", async () => {
    const { client, calls } = fakeClient();
    const loader = createMapDataLoader(client, { debounceMs: DEBOUNCE });
    loader.request(VIEW, 15);
    await tick();
    const first = buildMockMapData();
    calls[0].resolve(first);
    await vi.advanceTimersByTimeAsync(0);

    loader.request([139.9, 35.8, 139.92, 35.81], 15);
    await tick();
    expect(calls).toHaveLength(2);
    loader.request(VIEW, 15); // 取得済みの範囲に戻る
    await tick();
    expect(calls[1].opts?.signal?.aborted).toBe(true);

    calls[1].resolve(buildMockMapData());
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.getState()).toMatchObject({ status: "ok", data: first });
  });

  it("最小ズーム未満では取得せず、保持していたデータを消す", async () => {
    const { client, calls } = fakeClient();
    const loader = createMapDataLoader(client, { debounceMs: DEBOUNCE, minZoom: 12 });
    loader.request(VIEW, 15);
    await tick();
    calls[0].resolve(buildMockMapData());
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.getState().data).toBeDefined();

    loader.request(VIEW, 9);
    await tick();
    expect(calls).toHaveLength(1);
    expect(loader.getState()).toMatchObject({ status: "idle", reason: "zoom" });
    expect(loader.getState().data).toBeUndefined();
  });

  it("observations が上限に達したら truncated とし、範囲内でも再取得する", async () => {
    const { client, calls } = fakeClient();
    const loader = createMapDataLoader(client, { debounceMs: DEBOUNCE, limit: 2 });
    loader.request(VIEW, 15);
    await tick();
    const data = buildMockMapData();
    data.observations.features = data.observations.features.slice(0, 2);
    calls[0].resolve(data);
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.getState().truncated).toBe(true);
    expect(calls[0].opts?.limit).toBe(2);

    loader.request([139.765, 35.682, 139.775, 35.688], 16);
    await tick();
    expect(calls).toHaveLength(2);
  });

  it("失敗は error にして古いデータを残さず、retry で再取得できる", async () => {
    const { client, calls } = fakeClient();
    const loader = createMapDataLoader(client, { debounceMs: DEBOUNCE });
    loader.request(VIEW, 15);
    await tick();
    calls[0].resolve(buildMockMapData());
    await vi.advanceTimersByTimeAsync(0);

    loader.request([139.9, 35.8, 139.92, 35.81], 15);
    await tick();
    calls[1].reject(new ApiError(500, { code: "http_error", message: "boom" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.getState().status).toBe("error");
    expect(loader.getState().data).toBeUndefined();
    expect(loader.getState().error?.message).toBe("boom");

    loader.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(3);
    expect(loader.getState().status).toBe("loading");
  });

  it("dispose 後は何もしない", async () => {
    const { client, calls } = fakeClient();
    const loader = createMapDataLoader(client, { debounceMs: DEBOUNCE });
    loader.request(VIEW, 15);
    loader.dispose();
    await tick();
    expect(calls).toHaveLength(0);
  });
});
