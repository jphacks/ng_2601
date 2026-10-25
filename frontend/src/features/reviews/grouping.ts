import type { LngLat, Review } from "../../types/api";

/** 同じピンにまとめる距離 (m)。 */
export const GROUP_RADIUS_M = 30;
/** 地図クリックで口コミ・公的情報を拾う半径 (m)。 */
export const PICK_RADIUS_M = 50;

/** 近接する口コミをまとめた地図上の1地点。 */
export interface ReviewPlace {
  id: string;
  center: LngLat;
  /** 新しい順。 */
  reviews: Review[];
}

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** 2点間の大円距離 (m)。 */
export function distanceM(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** point から radiusM 以内の要素。 */
export function within<T>(items: readonly T[], locate: (item: T) => LngLat, point: LngLat, radiusM: number): T[] {
  return items.filter((item) => distanceM(locate(item), point) <= radiusM);
}

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/** 新しい順（日時が不正なものは末尾）。 */
export function sortNewestFirst(reviews: readonly Review[]): Review[] {
  return [...reviews].sort((a, b) => time(b.createdAt) - time(a.createdAt));
}

/** 近接（GROUP_RADIUS_M 以内）の口コミを1地点にまとめる。中心は最も新しい口コミの位置。 */
export function groupReviews(reviews: readonly Review[]): ReviewPlace[] {
  const places: ReviewPlace[] = [];
  for (const review of sortNewestFirst(reviews)) {
    const place = places.find((p) => distanceM(p.center, review.location) <= GROUP_RADIUS_M);
    if (place) place.reviews.push(review);
    else places.push({ id: `place-${review.id}`, center: review.location, reviews: [review] });
  }
  return places;
}
