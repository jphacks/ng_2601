import { api, toApiError } from "../../api";
import { el } from "../../ui/dom";

/** モック／実API疎通確認用の一覧画面。 */
export async function renderOverview(root: HTMLElement): Promise<void> {
  root.replaceChildren(el("p", { text: "読み込み中…" }));
  try {
    const [route, hazards, reviews, prefs] = await Promise.all([
      api.searchRoute({
        origin: [136.8816, 35.1709],
        destination: [136.8847, 35.1735],
        bikeType: "city",
        hillMode: "balanced",
        trafficMode: "balanced",
        surfaceMode: "comfortable",
        walkingMode: "short",
      }),
      api.listHazards(),
      api.listReviews(),
      // 設定の取得にはログインが必要なため、失敗しても疎通確認の一覧は表示する。
      api.getPreferences().catch(() => null),
    ]);
    const list = (title: string, items: string[]) =>
      el("section", {}, [
        el("h2", { text: title }),
        el("ul", {}, items.map((t) => el("li", { text: t }))),
      ]);
    root.replaceChildren(
      el("h1", { text: "ng_2601 開発基盤" }),
      list(
        "経路",
        [route].map(
          (r) =>
            `${r.name} / ${r.distanceM}m / 最大勾配 ${r.elevationProfile.maxGradePercent ?? "不明"}${r.elevationProfile.maxGradePercent === null ? "" : "%"}`,
        ),
      ),
      list("危険情報", hazards.map((h) => `[${h.type}] ${h.description}`)),
      list("口コミ", reviews.map((r) => `[${r.rawCategory}] ${r.comment}`)),
      list("Preferences", [JSON.stringify(prefs)]),
    );
  } catch (e) {
    const err = toApiError(e);
    root.replaceChildren(el("p", { text: `エラー [${err.code}]: ${err.message}` }));
  }
}
