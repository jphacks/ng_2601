import { describe, expect, it, vi } from "vitest";
import { createAuthStore } from "./authState";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("auth store", () => {
  it("starts logged out when nothing is saved", () => {
    expect(createAuthStore(memoryStorage()).getUser()).toBeNull();
  });

  it("keeps the user across reloads after login", () => {
    const storage = memoryStorage();
    createAuthStore(storage).login({ name: "rider@example.com" });
    expect(createAuthStore(storage).getUser()).toEqual({ name: "rider@example.com" });
  });

  it("forgets the user after logout", () => {
    const storage = memoryStorage();
    const store = createAuthStore(storage);
    store.login({ name: "rider" });
    store.logout();
    expect(store.getUser()).toBeNull();
    expect(createAuthStore(storage).getUser()).toBeNull();
  });

  it("notifies subscribers on login and logout", () => {
    const store = createAuthStore(memoryStorage());
    const listener = vi.fn();
    store.subscribe(listener);
    store.login({ name: "rider" });
    store.logout();
    expect(listener.mock.calls).toEqual([[{ name: "rider" }], [null]]);
  });

  it("treats a broken saved value as logged out", () => {
    expect(createAuthStore(memoryStorage({ "nature-ride.user": "{oops" })).getUser()).toBeNull();
  });

  it("stays logged in for the session when storage refuses writes", () => {
    const storage = { ...memoryStorage(), setItem: () => { throw new Error("quota"); } };
    const store = createAuthStore(storage);
    store.login({ name: "rider" });
    expect(store.getUser()).toEqual({ name: "rider" });
  });
});
