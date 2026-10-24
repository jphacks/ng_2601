import { renderOverview } from "./features/overview/render";
import { renderShell } from "./features/shell/render";

const root = document.getElementById("app")!;
if (import.meta.env.DEV && location.pathname === "/dev/overview") {
  void renderOverview(root);
} else {
  renderShell(root);
}
