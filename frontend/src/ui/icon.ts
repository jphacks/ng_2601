/** Bootstrap Icons v1.13.1 (MIT). Original SVGs and license: ../assets/icons/. */
export type IconName =
  | "list" | "search" | "layers" | "cursor-fill" | "crosshair"
  | "plus" | "dash" | "x-lg" | "chevron-up" | "chevron-down"
  | "sliders" | "exclamation-triangle-fill" | "chat-dots-fill" | "camera-fill"
  | "map" | "info-circle" | "question-circle" | "arrow-right" | "arrow-clockwise";

export function icon(name: IconName): HTMLElement {
  const node = document.createElement("span");
  node.className = "icon";
  node.setAttribute("aria-hidden", "true");
  node.style.setProperty("--icon-url", `url("${new URL(`../assets/icons/${name}.svg`, import.meta.url).href}")`);
  return node;
}
