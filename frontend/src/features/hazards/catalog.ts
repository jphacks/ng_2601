import type { InfoClass, Origin, RoadCategory } from "./types";

export interface CategoryDef {
  id: RoadCategory;
  label: string;
  /** tokens.css のCSS変数名。地図（MapLibre）には解決済みの値を渡す。 */
  cssVar: string;
}

export const CATEGORY_DEFS: readonly CategoryDef[] = [
  { id: "danger", label: "危険", cssVar: "--color-category-danger" },
  { id: "convenience", label: "便利", cssVar: "--color-category-convenience" },
  { id: "terrain", label: "地形", cssVar: "--color-category-terrain" },
  { id: "facility", label: "道路設備", cssVar: "--color-category-facility" },
];

export const CATEGORY_LABEL: Record<RoadCategory, string> = {
  danger: "危険",
  convenience: "便利",
  terrain: "地形",
  facility: "道路設備",
};

export interface InfoClassDef {
  id: InfoClass;
  label: string;
}

export const INFO_CLASS_DEFS: readonly InfoClassDef[] = [
  { id: "official", label: "公的規制" },
  { id: "statistics", label: "統計（過去の実績）" },
  { id: "community", label: "ユーザー報告" },
  { id: "measurement", label: "機器による計測" },
];

export const INFO_CLASS_LABEL: Record<InfoClass, string> = {
  official: "公的規制",
  statistics: "統計（過去の実績）",
  community: "ユーザー報告",
  measurement: "機器による計測",
};

export const ORIGIN_LABEL: Record<Origin, string> = {
  restriction: "交通規制",
  accident: "事故履歴",
  traffic: "交通量",
  observation: "ユーザー報告",
  surface: "路面の計測",
};

/** 提供元（BEのレイヤー）→ 情報区分・分類。FE側の暫定対応表で、BEの合意ではない。 */
export const ORIGIN_DEFAULTS: Record<Origin, { infoClass: InfoClass; category: RoadCategory }> = {
  restriction: { infoClass: "official", category: "facility" },
  accident: { infoClass: "statistics", category: "danger" },
  traffic: { infoClass: "statistics", category: "danger" },
  observation: { infoClass: "community", category: "danger" },
  surface: { infoClass: "measurement", category: "terrain" },
};

/**
 * observations.category は BE では自由入力の文字列。部分一致で分類し、未知の値は「危険／その他」に落とす。
 * BEの実際の値一覧を確認したらここを差し替える。
 */
const OBSERVATION_RULES: ReadonlyArray<{ match: RegExp; category: RoadCategory; label: string }> = [
  { match: /construction|工事/i, category: "danger", label: "工事" },
  { match: /debris|glass|obstacle|fallen|落下|ガラス|障害/i, category: "danger", label: "ガラス片・落下物" },
  { match: /obstruction/i, category: "danger", label: "障害物" },
  { match: /intersection|crossing|交差点/i, category: "danger", label: "危険な交差点" },
  { match: /steep|slope|hill|grade|坂|傾斜/i, category: "terrain", label: "急坂" },
  { match: /surface|pavement|路面|舗装/i, category: "terrain", label: "路面" },
  { match: /bike_?lane|cycle_?lane|bicycle_?lane|レーン/i, category: "facility", label: "自転車レーン" },
  { match: /regulation|restriction|closure|規制/i, category: "facility", label: "交通規制" },
  { match: /parking|rack|駐輪/i, category: "convenience", label: "駐輪場" },
];

export function classifyObservation(category: string | null | undefined): { category: RoadCategory; label: string } {
  const text = category?.trim();
  if (!text) return { category: "danger", label: "その他" };
  const rule = OBSERVATION_RULES.find((r) => r.match.test(text));
  return rule ? { category: rule.category, label: rule.label } : { category: "danger", label: "その他" };
}
