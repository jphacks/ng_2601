import { apiBaseUrl } from "../../api";
import type { User } from "./authState";

export const GOOGLE_CALLBACK_PATH = "/auth/google/callback";

export async function startGoogleLogin(): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/v1/auth/google`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { authorization_url } = (await res.json()) as { authorization_url: string };
  location.assign(authorization_url);
}

/** search は Google から戻ってきた URL の `?code=…&state=…`。 */
export async function finishGoogleLogin(search: string): Promise<User> {
  // Google の戻り先を BE の callback に直接しないのは、JSON を返すだけでアプリに戻れないため。
  // BE を別オリジンのまま呼ばないのは、state の Cookie が送られないため（Vite のプロキシで同じオリジンにする）。
  const res = await fetch(`${apiBaseUrl}/v1/auth/google/callback${search}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { session, picture } = (await res.json()) as {
    session: { access_token: string; refresh_token: string };
    picture?: string | null;
  };
  return {
    name: "Google アカウント",
    picture: picture ?? undefined,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  };
}
