import type { Geometry } from "geojson";
import type { LngLat } from "../../types/api";

/** Issue #11 の4分類。BEの提供元・カテゴリからFE側の対応表（catalog.ts）で正規化する。 */
export type RoadCategory = "danger" | "convenience" | "terrain" | "facility";

/** 公的規制／統計／ユーザー報告。ユーザー投稿と公的情報を区別して扱う。 */
export type InfoClass = "official" | "statistics" | "community";

export type Origin = "restriction" | "accident" | "traffic" | "observation";

/** permanent=恒常、scheduled=曜日・時間帯で繰り返す恒常情報、temporary=期間限定。 */
export type Temporality = "permanent" | "scheduled" | "temporary";

/**
 * 日時の3状態。known=値あり、unknown=提供元が不明と明示（null）、missing=項目自体がない（欠測）。
 */
export type Stamp = { state: "known"; value: string } | { state: "unknown" } | { state: "missing" };

export type Verification = "verified" | "unverified" | "unknown" | "n/a";
export type ItemStatus = "active" | "resolved" | "withdrawn" | "expired";

export interface RoadInfoItem {
  /** 提供元ごとの接頭辞つき。地図・一覧・選択で共通に使う。 */
  id: string;
  origin: Origin;
  infoClass: InfoClass;
  category: RoadCategory;
  /** 種別の表示名（例: 工事、交通規制）。 */
  kindLabel: string;
  title: string;
  description?: string;
  geometry: Geometry;
  /** 一覧からの移動・ラベル用の代表点。 */
  position: LngLat;
  temporality: Temporality;
  /** 更新日時（観測日時／提供元の更新日時）。 */
  updatedAt: Stamp;
  /** FEの取得元（提供元）がデータを取得した日時。 */
  retrievedAt: Stamp;
  expiresAt: Stamp;
  source: { name?: string; authority?: string; kind?: string };
  status?: ItemStatus;
  verification: Verification;
  schedule?: { days?: number[]; start?: string; end?: string };
  /** 詳細カードに必ず添える注記（例: 事故履歴は過去の発生地点）。 */
  notes: string[];
}

/** 提供元ごとの提供状況。enabled=false は「未提供」であり、0件を安全と読ませない。 */
export interface SourceAvailability {
  key: string;
  origin: Origin;
  label: string;
  enabled: boolean;
  featureCount?: number;
  retrievedAt: Stamp;
}
