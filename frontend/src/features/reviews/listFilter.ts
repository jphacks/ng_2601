import type { Review, ReviewCategory } from "../../types/api";
import { CATEGORY_LABEL } from "./catalog";
import { sortNewestFirst } from "./grouping";

export type ReviewSort = "newest" | "oldest";

export const SORT_LABEL: Record<ReviewSort, string> = { newest: "新しい順", oldest: "古い順" };

/** 「口コミ」タブの一覧の並び替え・絞り込み条件。 */
export interface ReviewListFilter {
  sort: ReviewSort;
  /** 表示するカテゴリ。全カテゴリが入っていれば絞り込みなし。 */
  categories: Set<ReviewCategory>;
  /** コメントの部分一致。空なら絞り込まない。 */
  keyword: string;
}

export const ALL_CATEGORIES = Object.keys(CATEGORY_LABEL) as ReviewCategory[];

export function createDefaultListFilter(): ReviewListFilter {
  return { sort: "newest", categories: new Set(ALL_CATEGORIES), keyword: "" };
}

export function isFiltering(filter: ReviewListFilter): boolean {
  return filter.categories.size !== ALL_CATEGORIES.length || filter.keyword.trim() !== "";
}

export function filterAndSortReviews(reviews: readonly Review[], filter: ReviewListFilter): Review[] {
  const keyword = filter.keyword.trim().toLowerCase();
  const matched = reviews.filter(
    (r) => filter.categories.has(r.category) && (keyword === "" || r.comment.toLowerCase().includes(keyword)),
  );
  const newest = sortNewestFirst(matched);
  return filter.sort === "newest" ? newest : newest.reverse();
}

/** たたんだ状態の見出しに添える、現在の条件の要約。 */
export function summarizeListFilter(filter: ReviewListFilter): string {
  const parts: string[] = [SORT_LABEL[filter.sort]];
  if (filter.categories.size === ALL_CATEGORIES.length) parts.push("すべて");
  else if (filter.categories.size === 0) parts.push("カテゴリなし");
  else parts.push(ALL_CATEGORIES.filter((c) => filter.categories.has(c)).map((c) => CATEGORY_LABEL[c]).join("・"));
  const keyword = filter.keyword.trim();
  if (keyword) parts.push(`「${keyword}」`);
  return parts.join(" / ");
}
