import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthStore } from "../features/auth/authState";
import { createHttpClient } from "./http";
import { createSessionRefresher, revokeSession } from "./session";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function loggedIn() {
  const auth = createAuthStore(memoryStorage());
  auth.login({ name: "rider", accessToken: "old-access", refreshToken: "old-refresh" });
  return auth;
}

const rotated = { access_token: "new-access", refresh_token: "new-refresh" };

afterEach(() => vi.unstubAllGlobals());

describe("ログインの期限切れとログアウト", () => {
  it("401 になったらトークンを取り直し、新しいトークンで同じ呼び出しをやり直す", async () => {
    const auth = loggedIn();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json(rotated))
      .mockResolvedValueOnce(Response.json({ bike_type: "city", preferences: {} }));
    vi.stubGlobal("fetch", fetcher);
    const client = createHttpClient(
      "https://example.test",
      () => auth.getUser()?.accessToken ?? null,
      createSessionRefresher("https://example.test", auth),
    );
    await client.getPreferences().catch(() => undefined);
    expect(fetcher.mock.calls[1][0]).toBe("https://example.test/v1/auth/refresh");
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe("Bearer old-refresh");
    expect(fetcher.mock.calls[2][1].headers.Authorization).toBe("Bearer new-access");
    expect(auth.getUser()).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh" });
  });

  it("取り直しを断られたらログアウトする", async () => {
    const auth = loggedIn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    expect(await createSessionRefresher("https://example.test", auth)()).toBe(false);
    expect(auth.getUser()).toBeNull();
  });

  it("つながらないだけならログアウトしない", async () => {
    const auth = loggedIn();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await createSessionRefresher("https://example.test", auth)()).toBe(false);
    expect(auth.getUser()).not.toBeNull();
  });

  it("同時に取り直しを頼まれても refresh は1回だけ呼ぶ", async () => {
    const auth = loggedIn();
    const fetcher = vi.fn().mockResolvedValue(Response.json(rotated));
    vi.stubGlobal("fetch", fetcher);
    const refresh = createSessionRefresher("https://example.test", auth);
    expect(await Promise.all([refresh(), refresh()])).toEqual([true, true]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("ログアウトでは refresh トークンを BE に送って失効させる", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "signed_out" }));
    vi.stubGlobal("fetch", fetcher);
    await revokeSession("https://example.test", "old-refresh");
    expect(fetcher).toHaveBeenCalledWith("https://example.test/v1/auth/logout", {
      method: "POST",
      headers: { Authorization: "Bearer old-refresh" },
    });
  });

  it("失効に失敗しても例外にしない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(revokeSession("https://example.test", "old-refresh")).resolves.toBeUndefined();
  });
});
