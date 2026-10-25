import type { BikeType, PreferenceModes } from "../../types/api";

/** 表示名。BEは値(キー)だけを返すため、日本語の表示はFEで持つ。未知の値はキーをそのまま表示する。 */
export const BIKE_TYPE_LABELS: Record<BikeType, string> = {
  city: "シティサイクル",
  electric_assist: "電動アシスト自転車",
  road: "ロードバイク",
  gravel: "グラベルバイク",
  mamachari: "ママチャリ",
};

/** 車種の選択肢の並び。BEが返した車種のうち、この順で並べる。 */
export const BIKE_TYPE_ORDER = Object.keys(BIKE_TYPE_LABELS) as BikeType[];

export interface ModeMeta<K extends keyof PreferenceModes> {
  /** 条件の見出し（検索条件の一覧にも使う） */
  title: string;
  /** 選択肢の上に出す問いかけ。詳細パラメータだけが持つ。 */
  question?: string;
  labels: Record<PreferenceModes[K], string>;
}

/*
 * 詳細パラメータの文言は、BRouterプロファイル（back/brouter_extension/profiles/japan_bicycle.brf）の重み付けに合わせる。
 * どの段階も通りにくさの重みを変えるだけで、距離の上限や完全な回避は保証しないため、「〜しない」「◯m以内」とは書かない。
 */
export const MODE_META: { [K in keyof PreferenceModes]: ModeMeta<K> } = {
  hillMode: {
    title: "坂道許容度",
    labels: { avoid: "避ける", balanced: "ふつう", accept: "許容する" },
  },
  trafficMode: {
    title: "交通量の多い道路",
    question: "交通量の多い道路をどの程度避けますか？",
    labels: { avoid: "極力避ける", balanced: "できれば避ける", direct: "気にしない" },
  },
  surfaceMode: {
    title: "未舗装路",
    question: "砂利道や土の道を通ってもよいですか？",
    labels: { paved: "通りたくない", comfortable: "少しなら可", rough_ok: "多くても可" },
  },
  walkingMode: {
    title: "押し歩き区間",
    question: "自転車を降りて押して歩く区間を通ってもよいですか？",
    labels: { never: "避けたい", short: "少しなら可", long: "多くても可" },
  },
};

/** 詳細パラメータの並びと見出し（坂道許容度は専用のスライダー）。避けたい度合いと、通ってよい道の条件を分けて並べる。 */
export const DETAIL_MODE_GROUPS = [
  { title: "ルートの優先条件", keys: ["trafficMode"] },
  { title: "通行の許容条件", keys: ["surfaceMode", "walkingMode"] },
] as const satisfies ReadonlyArray<{ title: string; keys: ReadonlyArray<keyof PreferenceModes> }>;

export function bikeTypeLabel(v: BikeType): string {
  return BIKE_TYPE_LABELS[v] ?? v;
}

export function modeLabel<K extends keyof PreferenceModes>(key: K, value: PreferenceModes[K]): string {
  return (MODE_META[key].labels as Record<string, string>)[value] ?? value;
}
