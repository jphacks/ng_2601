import { el } from "./dom";
import { icon } from "./icon";

export type StateOptions = {
  kind: "loading" | "empty" | "error";
  title: string;
  description?: string;
  retry?: () => void;
};

/** Shared presentation only; callers own fetching, cancellation and retries. */
export function renderState(options: StateOptions): HTMLElement {
  const state = el("div", { className: `view-state view-state--${options.kind}` });
  state.setAttribute("role", options.kind === "error" ? "alert" : "status");
  state.setAttribute("aria-atomic", "true");
  if (options.kind === "loading") state.setAttribute("aria-busy", "true");
  state.append(
    icon(options.kind === "error" ? "exclamation-triangle-fill" : options.kind === "loading" ? "arrow-clockwise" : "map"),
    el("p", { className: "state-title", text: options.title }),
  );
  if (options.description) state.append(el("p", { className: "muted", text: options.description }));
  if (options.kind === "error" && options.retry) {
    const retry = el("button", { className: "secondary-button", text: "再試行" });
    retry.type = "button";
    retry.addEventListener("click", options.retry);
    state.append(retry);
  }
  return state;
}
