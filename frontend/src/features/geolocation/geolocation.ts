import type { LngLat } from "../../types/api";

export type LocateFailure = "denied" | "timeout" | "unavailable" | "unsupported" | "insecure";

export type LocateResult =
  | { ok: true; lngLat: LngLat; accuracyM: number }
  | { ok: false; reason: LocateFailure };

/** 位置は1回だけ取得する（走行中の追跡は将来機能）。保存・送信はせず、呼び出し側が画面表示にだけ使う。 */
const OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 };

/** 失敗は reject せず理由で返す。 */
export function getCurrentLocation(): Promise<LocateResult> {
  // HTTP（localhost以外）ではブラウザーが位置情報を拒否するため、許可確認を出す前に理由を伝える。
  if (!window.isSecureContext) return Promise.resolve({ ok: false, reason: "insecure" });
  if (!("geolocation" in navigator)) return Promise.resolve({ ok: false, reason: "unsupported" });
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => resolve({ ok: true, lngLat: [coords.longitude, coords.latitude], accuracyM: coords.accuracy }),
        (error) => resolve({ ok: false, reason: classify(error) }),
        OPTIONS,
      );
    } catch {
      // Permissions-Policyで無効化された埋め込みなど、呼び出し自体が例外になる場合。
      resolve({ ok: false, reason: "unavailable" });
    }
  });
}

function classify(error: GeolocationPositionError): LocateFailure {
  if (error.code === error.PERMISSION_DENIED) return "denied";
  if (error.code === error.TIMEOUT) return "timeout";
  return "unavailable";
}
