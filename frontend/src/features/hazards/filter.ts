import { evaluateItem } from "./freshness";
import type { InfoClass, RoadCategory, RoadInfoItem } from "./types";
import { CATEGORY_DEFS, INFO_CLASS_DEFS } from "./catalog";

export type TemporalityFilter = "all" | "temporary" | "permanent";

export interface HazardFilter {
  categories: Set<RoadCategory>;
  infoClasses: Set<InfoClass>;
  /** temporary=期間限定のみ。permanent=恒常（時間帯で繰り返すものを含む）のみ。 */
  temporality: TemporalityFilter;
  /** 期限切れ・解消済み・開始前・未確認を隠す。 */
  hideStale: boolean;
}

export function createDefaultFilter(): HazardFilter {
  return {
    categories: new Set(CATEGORY_DEFS.map((c) => c.id)),
    infoClasses: new Set(INFO_CLASS_DEFS.map((c) => c.id)),
    temporality: "all",
    hideStale: false,
  };
}

function matchesNonCategory(item: RoadInfoItem, filter: HazardFilter, now: Date): boolean {
  if (!filter.infoClasses.has(item.infoClass)) return false;
  if (filter.temporality === "temporary" && item.temporality !== "temporary") return false;
  if (filter.temporality === "permanent" && item.temporality === "temporary") return false;
  if (filter.hideStale) {
    const f = evaluateItem(item, now);
    if (f.stale || f.unverified) return false;
  }
  return true;
}

export function applyFilter(items: readonly RoadInfoItem[], filter: HazardFilter, now: Date): RoadInfoItem[] {
  return items.filter((i) => filter.categories.has(i.category) && matchesNonCategory(i, filter, now));
}

/** カテゴリのチェックボックス用。カテゴリ以外の条件を満たす件数をカテゴリ別に数える。 */
export function countByCategory(
  items: readonly RoadInfoItem[],
  filter: HazardFilter,
  now: Date,
): Record<RoadCategory, number> {
  const counts: Record<RoadCategory, number> = { danger: 0, convenience: 0, terrain: 0, facility: 0 };
  for (const item of items) if (matchesNonCategory(item, filter, now)) counts[item.category] += 1;
  return counts;
}
