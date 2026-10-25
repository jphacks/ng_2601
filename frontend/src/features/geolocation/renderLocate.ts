import "./locate.css";
import { el } from "../../ui/dom";
import type { MapController } from "../map/map";
import { getCurrentLocation, type LocateFailure } from "./geolocation";

const FAILURE_MESSAGE: Record<LocateFailure, string> = {
  denied:
    "位置情報の利用が許可されていません。ブラウザーや端末の設定で許可すると現在地を表示できます。許可しなくても、地図の閲覧と地図をタップした地点の指定は使えます。",
  timeout: "現在地を取得できませんでした（時間切れ）。電波の良い場所でもう一度お試しください。地図は引き続き使えます。",
  unavailable:
    "現在地を特定できませんでした。端末の位置情報サービスがオンか確認してください。地図は引き続き使えます。",
  unsupported: "このブラウザーは位置情報に対応していません。地図をタップして地点を指定してください。",
  insecure: "位置情報はHTTPS接続（またはlocalhost）のページでのみ使えます。地図をタップして地点を指定してください。",
};
/** 設定やもう一度の操作で解決しない失敗には再試行を出さない。 */
const RETRYABLE: ReadonlySet<LocateFailure> = new Set(["denied", "timeout", "unavailable"]);

/** 成功メッセージを自動で消すまでの時間。 */
const SUCCESS_DISMISS_MS = 5000;

export interface LocateOptions {
  /** 現在地の取得を始める前。検索パネルが通知と地図を覆わないよう閉じるために使う。 */
  onStart?: () => void;
}

/**
 * 現在地ボタンに「押したときだけ位置を1回取得して地図に表示する」動作を付け、通知欄を返す。
 * 位置は保存・送信・ログ出力しない。失敗しても地図の操作と地点選択は妨げない（通知は地図を覆わない）。
 */
export function setupLocate(button: HTMLButtonElement, map: MapController, options: LocateOptions = {}): HTMLElement {
  const notice = el("div", { className: "locate-notice" });
  notice.hidden = true;
  // 進行中の要求の識別子。キャンセルや再試行で古い応答を捨てる。
  let requestId = 0;
  let dismissTimer: number | undefined;

  function clearNotice(): void {
    window.clearTimeout(dismissTimer);
    notice.hidden = true;
    notice.replaceChildren();
  }

  function setBusy(busy: boolean): void {
    button.setAttribute("aria-busy", String(busy));
    button.classList.toggle("is-busy", busy);
  }

  /** 通知は毎回作り直し、状態ごとの role（alert / status）を読み上げさせる。 */
  function showNotice(message: string, role: "alert" | "status", actions: Array<[string, () => void]> = []): void {
    window.clearTimeout(dismissTimer);
    const box = el("div", { className: `locate-notice__box locate-notice__box--${role}` });
    box.setAttribute("role", role);
    box.append(el("p", { className: "locate-notice__text", text: message }));
    if (actions.length > 0) {
      const row = el("div", { className: "locate-notice__actions" });
      for (const [label, run] of actions) {
        const b = el("button", { className: "locate-notice__button", text: label });
        b.type = "button";
        b.addEventListener("click", run);
        row.append(b);
      }
      box.append(row);
    }
    notice.replaceChildren(box);
    notice.hidden = false;
  }

  function cancel(): void {
    requestId += 1;
    setBusy(false);
    clearNotice();
  }

  async function locate(): Promise<void> {
    // 取得中の連打は無視する（キャンセルは通知欄のボタン）。
    if (button.getAttribute("aria-busy") === "true") return;
    options.onStart?.();
    const id = ++requestId;
    setBusy(true);
    showNotice("現在地を取得しています…ブラウザーの許可確認が表示されたら「許可」を選んでください。", "status", [
      ["キャンセル", cancel],
    ]);
    const result = await getCurrentLocation();
    if (id !== requestId) return;
    setBusy(false);
    if (result.ok) {
      map.setCurrentLocation({ lngLat: result.lngLat, accuracyM: result.accuracyM }, true);
      showNotice(`現在地を表示しました（精度 約${Math.round(result.accuracyM)} m）。`, "status");
      dismissTimer = window.setTimeout(clearNotice, SUCCESS_DISMISS_MS);
      return;
    }
    const actions: Array<[string, () => void]> = [];
    if (RETRYABLE.has(result.reason)) actions.push(["再試行", () => void locate()]);
    actions.push(["閉じる", clearNotice]);
    showNotice(FAILURE_MESSAGE[result.reason], "alert", actions);
  }

  button.addEventListener("click", () => void locate());
  return notice;
}
