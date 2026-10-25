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
  labels: Record<PreferenceModes[K], string>;
}

export const MODE_META: { [K in keyof PreferenceModes]: ModeMeta<K> } = {
  hillMode: {
    title: "坂道許容度",
    labels: { avoid: "避ける", balanced: "ふつう", accept: "許容する" },
  },
  trafficMode: {
    title: "交通量の多い道",
    labels: { avoid: "避ける", balanced: "ふつう", direct: "気にしない" },
  },
  surfaceMode: {
    title: "路面",
    labels: { paved: "舗装路のみ", comfortable: "快適な路面", rough_ok: "未舗装も可" },
  },
  walkingMode: {
    title: "自転車を押して歩く区間",
    labels: { never: "なし", short: "短い区間", long: "長い区間も可" },
  },
};

/** 詳細パラメータとして折りたたみ内に並べる条件（坂道許容度は専用のスライダー）。 */
export const DETAIL_MODE_KEYS = ["trafficMode", "surfaceMode", "walkingMode"] as const;

export function bikeTypeLabel(v: BikeType): string {
  return BIKE_TYPE_LABELS[v] ?? v;
}

export function modeLabel<K extends keyof PreferenceModes>(key: K, value: PreferenceModes[K]): string {
  return (MODE_META[key].labels as Record<string, string>)[value] ?? value;
}
