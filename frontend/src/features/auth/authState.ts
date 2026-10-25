export interface User {
  name: string;
  picture?: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface AuthStore {
  getUser(): User | null;
  subscribe(listener: (user: User | null) => void): () => void;
  login(user: User): void;
  logout(): void;
}

type UserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "nature-ride.user";

export function createAuthStore(storage: UserStorage): AuthStore {
  let user = read(storage);
  const listeners = new Set<(user: User | null) => void>();

  function set(next: User | null): void {
    user = next;
    // トークンを HttpOnly Cookie に置かないのは、BE がトークンを JSON で返し、refresh も Bearer で受けるため。
    // Cookie にするなら BE と合わせて変える必要がある。
    try {
      if (next) storage.setItem(KEY, JSON.stringify(next));
      else storage.removeItem(KEY);
    } catch {
      // 保存できなくても（プライベートブラウズなど）この画面を開いている間はログイン状態を保つ。
    }
    for (const l of listeners) l(user);
  }

  return {
    getUser: () => user,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    login: (next) => set(next),
    logout: () => set(null),
  };
}

function read(storage: UserStorage): User | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "null");
    if (parsed && typeof parsed === "object" && typeof (parsed as User).name === "string") return parsed as User;
  } catch {
    // 壊れた値は未ログインとして扱う。
  }
  return null;
}
