import type { AuthStore } from "../features/auth/authState";

/** 期限切れのアクセストークンを取り直す。取り直せなければログアウトして false を返す。 */
export function createSessionRefresher(baseUrl: string, auth: AuthStore): () => Promise<boolean> {
  let pending: Promise<boolean> | null = null;

  async function refresh(): Promise<boolean> {
    const user = auth.getUser();
    if (!user?.refreshToken) return false;
    const res = await fetch(`${baseUrl}/v1/auth/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user.refreshToken}` },
    }).catch(() => null);
    // 通信エラーではログアウトしない。つながらないだけでログインを失わせたくない。
    if (!res) return false;
    if (!res.ok) {
      auth.logout();
      return false;
    }
    const session = (await res.json()) as { access_token: string; refresh_token: string };
    auth.login({ ...user, accessToken: session.access_token, refreshToken: session.refresh_token });
    return true;
  }

  // 同時に 401 になった呼び出しごとに取り直さないのは、BE が refresh トークンを使い捨てにしていて、
  // 2回目以降が古いトークンで失敗しログアウトされてしまうため。
  return () => (pending ??= refresh().finally(() => (pending = null)));
}

export async function revokeSession(baseUrl: string, refreshToken: string): Promise<void> {
  // 失効に失敗してもログアウトは止めない。端末からは消えるので、残ったトークンも期限で使えなくなる。
  await fetch(`${baseUrl}/v1/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${refreshToken}` },
  }).catch(() => undefined);
}
