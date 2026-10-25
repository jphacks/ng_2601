import type { Review } from "../../types/api";
import { el } from "../../ui/dom";
import { icon } from "../../ui/icon";
import { renderDetailContent } from "../hazards/detailCard";
import type { RoadInfoItem } from "../hazards/types";
import { CATEGORY_LABEL, VERIFICATION_LABEL } from "./catalog";

export const ANONYMOUS_NAME = "匿名ユーザー";

const dateFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "日時不明" : dateFormat.format(t);
}

/** 情報源の見分け。色だけに頼らず、アイコンと文言を必ず添える。 */
export function sourceBadge(source: "user" | "official"): HTMLElement {
  const official = source === "official";
  return el("span", { className: `source-badge source-badge--${source}` }, [
    icon(official ? "shield" : "user"),
    el("span", { text: official ? "公的情報" : "ユーザー投稿" }),
  ]);
}

function categoryChip(review: Review): HTMLElement {
  return el("span", { className: "review-chip", text: CATEGORY_LABEL[review.category] });
}

/** 一覧の1件。本文は textContent のみで、HTMLとして解釈しない。 */
export function reviewItem(review: Review, onOpen: () => void): HTMLElement {
  const button = el("button", { className: "review-item" }, [
    el("span", { className: "review-item__head" }, [sourceBadge("user"), categoryChip(review)]),
    el("span", { className: "review-item__text", text: review.comment || "（本文なし）" }),
    el("span", { className: "review-item__meta", text: formatDateTime(review.createdAt) }),
  ]);
  button.type = "button";
  button.setAttribute("aria-label", `${CATEGORY_LABEL[review.category]}の口コミ ${formatDateTime(review.createdAt)} を開く`);
  button.addEventListener("click", onOpen);
  return el("li", {}, [button]);
}

/** 詳細カード: カテゴリ・本文・投稿日時・投稿者。 */
export function reviewDetail(review: Review): HTMLElement {
  const meta = el("dl", { className: "review-detail__meta" });
  const row = (label: string, value: string) => meta.append(el("dt", { text: label }), el("dd", { text: value }));
  row("投稿日時", formatDateTime(review.createdAt));
  row("投稿者", review.authorName || ANONYMOUS_NAME);
  if (review.verification) row("確認状況", VERIFICATION_LABEL[review.verification]);
  if (review.category === "other" && review.rawCategory) row("カテゴリ（原文）", review.rawCategory);
  return el("article", { className: "review-detail" }, [
    el("div", { className: "review-item__head" }, [sourceBadge("user"), categoryChip(review)]),
    el("p", { className: "review-detail__text", text: review.comment || "（本文なし）" }),
    meta,
  ]);
}

/** main の道路情報表示を共有し、出典・期限・未確認の注意を保つ。 */
export function hazardCard(item: RoadInfoItem): HTMLElement {
  const detail = renderDetailContent(item, new Date());
  // 地図上の詳細カードと同時にDOMへ置くため、共通の見出しIDを使わない。
  detail.querySelector("[id]")?.removeAttribute("id");
  return el("li", { className: `review-road-card review-road-card--${item.infoClass}` }, [detail]);
}
