import "./styles/tokens.css";
import { renderOverview } from "./features/overview/render";
import { renderShell } from "./features/shell/render";

const root = document.getElementById("app")!;

// FE-01の疎通確認画面は開発時のみ /dev/overview に残す。
if (import.meta.env.DEV && location.pathname.startsWith("/dev/overview")) {
  void renderOverview(root);
} else {
  renderShell(root);
}
