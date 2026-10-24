import type { RoadInfoItem, Stamp } from "./types";

/** upcoming=開始前の予定（現在はまだ適用されていない可能性がある）。 */
export type Validity = "current" | "expired" | "inactive" | "upcoming" | "no-expiry";

export interface Freshness {
  /** 更新日時の状態。known / unknown(null) / missing(欠測) を区別する。 */
  updated: Stamp["state"];
  validity: Validity;
  unverified: boolean;
  /** 期限切れ・解消済み・開始前など、現在有効とは言えない。 */
  stale: boolean;
  /** 詳細カードに添える注意文。現在の事実として断定しない言い回し。 */
  cautions: string[];
}

const STATUS_CAUTION = {
  resolved: "提供元で「解消済み」とされています。",
  withdrawn: "報告が取り下げられています。",
  expired: "提供元で期限切れとされています。",
} as const;

export function evaluateItem(item: RoadInfoItem, now: Date): Freshness {
  const cautions: string[] = [];
  const inactive = item.status === "resolved" || item.status === "withdrawn" || item.status === "expired";
  const expired = item.expiresAt.state === "known" && new Date(item.expiresAt.value).getTime() < now.getTime();

  const upcoming = item.startsAt.state === "known" && new Date(item.startsAt.value).getTime() > now.getTime();

  let validity: Validity;
  if (inactive) validity = "inactive";
  else if (expired) validity = "expired";
  else if (upcoming) validity = "upcoming";
  else if (item.expiresAt.state === "known") validity = "current";
  else validity = "no-expiry";

  if (inactive && item.status && item.status !== "active") cautions.push(STATUS_CAUTION[item.status]);
  if (validity === "expired") cautions.push("有効期限を過ぎています。現在は解消している可能性があります。");
  if (validity === "upcoming") cautions.push("開始前の予定情報です。現在はまだ適用されていない可能性があります。");
  if (item.verification === "unverified") cautions.push("未確認の情報です。実際の状況とは異なる可能性があります。");
  if (item.updatedAt.state === "unknown") cautions.push("更新日時が不明です。情報が古い可能性があります。");
  if (item.updatedAt.state === "missing") {
    cautions.push("更新日時のデータがありません（欠測）。最新かどうか判断できません。");
  }
  if (validity === "no-expiry" && item.temporality === "temporary") {
    cautions.push("期間限定の情報ですが有効期限が分かりません。");
  }

  return {
    updated: item.updatedAt.state,
    validity,
    unverified: item.verification === "unverified",
    stale: validity === "expired" || validity === "inactive" || validity === "upcoming",
    cautions,
  };
}

const formatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
});

/** 表示用。unknown と missing を別の言葉で出し分ける。 */
export function formatStamp(stamp: Stamp, noneLabel = "不明"): string {
  if (stamp.state === "known") return formatter.format(new Date(stamp.value));
  if (stamp.state === "unknown") return noneLabel;
  return "データなし（欠測）";
}
