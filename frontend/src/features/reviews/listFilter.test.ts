import { describe, expect, it } from "vitest";
import type { Review } from "../../types/api";
import { createDefaultListFilter, filterAndSortReviews, isFiltering, summarizeListFilter } from "./listFilter";

const review = (id: string, category: Review["category"], comment: string, createdAt: string): Review => ({
  id, location: [139.7, 35.6], category, rawCategory: category, comment, createdAt,
});
const reviews = [
  review("a", "surface", "段差が多い", "2026-10-01T00:00:00Z"),
  review("b", "slope", "急な坂", "2026-10-03T00:00:00Z"),
  review("c", "surface", "路面が荒れている", "2026-10-02T00:00:00Z"),
];

describe("review list filter", () => {
  it("sorts newest first by default and can reverse", () => {
    const filter = createDefaultListFilter();
    expect(filterAndSortReviews(reviews, filter).map((r) => r.id)).toEqual(["b", "c", "a"]);
    filter.sort = "oldest";
    expect(filterAndSortReviews(reviews, filter).map((r) => r.id)).toEqual(["a", "c", "b"]);
  });
  it("filters by category and keyword", () => {
    const filter = createDefaultListFilter();
    filter.categories = new Set(["surface"]);
    expect(filterAndSortReviews(reviews, filter).map((r) => r.id)).toEqual(["c", "a"]);
    filter.keyword = " 段差 ";
    expect(filterAndSortReviews(reviews, filter).map((r) => r.id)).toEqual(["a"]);
    expect(isFiltering(filter)).toBe(true);
    expect(summarizeListFilter(filter)).toBe("新しい順 / 路面・段差 / 「段差」");
  });
  it("the default filter is not filtering", () => {
    const filter = createDefaultListFilter();
    expect(isFiltering(filter)).toBe(false);
    expect(summarizeListFilter(filter)).toBe("新しい順 / すべて");
  });
});
