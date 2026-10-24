import * as maplibregl from "maplibre-gl";
import type { LngLat } from "../../types/api";

export interface MarkerSpec {
  id: string;
  lngLat: LngLat;
  /** マーカー内の短い表示（1〜2文字）。 */
  glyph: string;
  /** スクリーンリーダー向けの名前。 */
  label: string;
  title: string;
  description: string;
  /** CSSクラスに使う種別（hazard / review / pick）。 */
  kind: string;
  /** 指定するとポップアップの代わりに呼ばれる（一覧シートを開く用途）。 */
  onSelect?: () => void;
}

/** フォーカス可能なDOMマーカー。説明文はHTMLとして解釈させない（textContent + setDOMContent）。 */
export function createMarker(spec: MarkerSpec): maplibregl.Marker {
  const element = document.createElement("div");
  element.setAttribute("role", "button");
  element.tabIndex = 0;
  element.className = `map-marker map-marker--${spec.kind}`;
  element.textContent = spec.glyph;
  element.setAttribute("aria-label", `${spec.label}の詳細を開く`);

  const { onSelect } = spec;
  if (onSelect) {
    element.addEventListener("click", onSelect);
    element.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      onSelect();
    });
    return new maplibregl.Marker({ element }).setLngLat(spec.lngLat);
  }

  const content = document.createElement("div");
  content.className = "map-popup";
  const title = document.createElement("h3");
  title.textContent = spec.title;
  const description = document.createElement("p");
  description.textContent = spec.description;
  content.append(title, description);

  const popup = new maplibregl.Popup({ offset: 22, maxWidth: "260px" }).setDOMContent(content);
  return new maplibregl.Marker({ element }).setLngLat(spec.lngLat).setPopup(popup);
}

/** remove() で外れたポップアップのキーボードイベントも再登録して再表示する。 */
export function showMarker(marker: maplibregl.Marker, map: maplibregl.Map): void {
  marker.addTo(map).setPopup(marker.getPopup());
}

export function hideMarker(marker: maplibregl.Marker): void {
  marker.getPopup()?.remove();
  marker.remove();
}
