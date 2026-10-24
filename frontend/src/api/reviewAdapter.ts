import type { LngLat, Review, ReviewCategory, VerificationState } from "../types/api";

// BE PR #26 の GET /v1/observations（GeoJSON FeatureCollection）を Review に変換する。暫定。

const CATEGORY_RULES: ReadonlyArray<{ match: RegExp; category: ReviewCategory }> = [
  { match: /surface|pothole|bump|step|gravel|段差|路面|舗装/, category: "surface" },
  { match: /slope|steep|hill|climb|坂/, category: "slope" },
  { match: /traffic|car|congest|crowd|danger|交通|車/, category: "traffic" },
  { match: /parking|rest|toilet|shop|facility|bike_?shop|施設|駐輪|休憩/, category: "facility" },
];

/** BEの category 文字列（自由入力・小文字化済み）をFEの暫定カテゴリへ。未知の値は other。 */
export function normalizeCategory(raw: string): ReviewCategory {
  const value = raw.trim().toLowerCase();
  return CATEGORY_RULES.find((rule) => rule.match.test(value))?.category ?? "other";
}

const VERIFICATION: readonly VerificationState[] = ["unverified", "corroborated", "moderated"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toLngLat(geometry: unknown): LngLat | null {
  if (!isRecord(geometry) || geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) return null;
  const [lng, lat] = geometry.coordinates;
  if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function toReview(feature: unknown): Review | null {
  if (!isRecord(feature) || feature.type !== "Feature") return null;
  const location = toLngLat(feature.geometry);
  const props = feature.properties;
  if (!location || !isRecord(props)) return null;
  const id = typeof feature.id === "string" || typeof feature.id === "number" ? String(feature.id) : null;
  if (!id || typeof props.category !== "string") return null;
  const createdAt =
    typeof props.created_at === "string" ? props.created_at : typeof props.observed_at === "string" ? props.observed_at : "";
  const verification = VERIFICATION.find((v) => v === props.verification_state);
  return {
    id,
    location,
    category: normalizeCategory(props.category),
    rawCategory: props.category,
    comment: typeof props.description === "string" ? props.description : "",
    createdAt,
    verification,
  };
}

/** 形の合わない feature は捨てる。FeatureCollection でなければ例外（呼び出し側がエラー表示にする）。 */
export function observationsToReviews(collection: unknown): Review[] {
  if (!isRecord(collection) || !Array.isArray(collection.features)) {
    throw new Error("unexpected observations response");
  }
  return collection.features.flatMap((feature) => {
    const review = toReview(feature);
    return review ? [review] : [];
  });
}
