import type { ReviewCategory, VerificationState } from "../../types/api";

// BEにカテゴリ一覧の合意はない。FE側の暫定表（docs/api-contract.md の未合意事項）。
export const CATEGORY_LABEL: Record<ReviewCategory, string> = {
  surface: "路面・段差",
  slope: "坂",
  traffic: "交通",
  facility: "施設",
  other: "その他",
};

/** 地図ピンに載せる1文字。 */
export const CATEGORY_GLYPH: Record<ReviewCategory, string> = {
  surface: "路",
  slope: "坂",
  traffic: "車",
  facility: "施",
  other: "他",
};

export const VERIFICATION_LABEL: Record<VerificationState, string> = {
  unverified: "未確認",
  corroborated: "複数の報告あり",
  moderated: "確認済み",
};
