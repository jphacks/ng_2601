import type { StyleSpecification } from "maplibre-gl";

// OpenFreeMap Liberty（ベクタータイル）。利用条件: https://openfreemap.org/
// 提供元を変える場合はこのファイルだけを編集する。
export const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
/** タイル読み込み失敗の回復を見るソース。 */
export const BASEMAP_SOURCE = "openmaptiles";
export const BASEMAP_MAX_ZOOM = 18;

/** レイヤーパネルの凡例に出すベースマップ名。提供元を変えるときはスタイルURLと一緒に直す。 */
export const BASEMAP_LEGEND_LABEL = "OpenStreetMap";

/** 地図右下に常時表示する帰属。リンクは呼び出し側で組み立てる。 */
export const ATTRIBUTION = {
  label: "© OpenFreeMap © OpenMapTiles © OpenStreetMap",
  url: "https://www.openstreetmap.org/copyright",
} as const;

/** 名古屋駅周辺（シードとモックデータの範囲） */
export const INITIAL_VIEW = { center: [136.8816, 35.1709] as [number, number], zoom: 15 };

// 店などのPOI、一方通行の矢印、道路番号、3D建物、線路の縞、広域の陰影は、自転車の情報を重ねると邪魔になる。
const HIDDEN_LAYER = /^(poi_r|road_one_way|highway-shield|road_shield|building-3d|road_area_pattern|natural_earth)|_hatching$/;

/** Google マップのように、道・駅・地名だけが目に入る地図にする。 */
export function simplifyStyle(_previous: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification {
  return {
    ...next,
    layers: next.layers
      .filter((layer) => !HIDDEN_LAYER.test(layer.id))
      // 「Nagoya 名古屋」のような英語との併記をやめ、日本語の名前だけにする。
      .map((layer) => (layer.type === "symbol" ? { ...layer, layout: { ...layer.layout, "text-field": ["get", "name"] } } : layer)),
  };
}
