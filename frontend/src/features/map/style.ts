import type { StyleSpecification } from "maplibre-gl";

// 国土地理院 淡色地図。利用条件: https://maps.gsi.go.jp/development/ichiran.html
// 提供元を変える場合はこのファイルだけを編集する。
export const BASEMAP_TILES = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";
export const BASEMAP_MAX_ZOOM = 18;

/** レイヤーパネルの凡例に出すベースマップ名。提供元を変えるときはタイルURLと一緒に直す。 */
export const BASEMAP_LEGEND_LABEL = "国土地理院 淡色地図";

/** 地図右下に常時表示する帰属。リンクは呼び出し側で組み立てる。 */
export const ATTRIBUTION = {
  label: "地理院タイル",
  url: "https://maps.gsi.go.jp/development/ichiran.html",
} as const;

/** 名古屋駅周辺（シードとモックデータの範囲） */
export const INITIAL_VIEW = { center: [136.8816, 35.1709] as [number, number], zoom: 15 };

export function createStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [BASEMAP_TILES],
        tileSize: 256,
        maxzoom: BASEMAP_MAX_ZOOM,
        attribution: ATTRIBUTION.label,
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#e9eee8" } },
      { id: "basemap", type: "raster", source: "basemap" },
    ],
  };
}
