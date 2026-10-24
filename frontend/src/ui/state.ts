import { el } from "./dom";

export type ViewState =
  | { kind: "loading"; message?: string }
  | { kind: "empty"; message: string }
  | { kind: "error"; message: string; onRetry?: () => void };

/** ロード中・空・エラーの共通表示。通信と状態の保持は呼び出し側の機能が行う。 */
export function renderState(state: ViewState): HTMLElement {
  const box = el("div", { className: `state state--${state.kind}` });
  if (state.kind === "loading") {
    box.setAttribute("role", "status");
    box.append(
      el("span", { className: "state__spinner" }),
      el("p", { text: state.message ?? "読み込み中…" }),
    );
    return box;
  }
  box.setAttribute("role", state.kind === "error" ? "alert" : "status");
  box.append(el("p", { text: state.message }));
  if (state.kind === "error" && state.onRetry) {
    const retry = el("button", { className: "state__retry", text: "再試行" });
    retry.type = "button";
    retry.addEventListener("click", state.onRetry);
    box.append(retry);
  }
  return box;
}
