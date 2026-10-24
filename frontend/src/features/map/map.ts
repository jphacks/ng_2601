import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";
import type { Feature, FeatureCollection, LineString } from "geojson";
import type { Hazard, HazardType, LngLat, Review, Route } from "../../types/api";
import { el } from "../../ui/dom";
import { renderState } from "../../ui/state";
import { createMarker, hideMarker, showMarker, type MarkerSpec } from "./markers";
import { BASEMAP_MAX_ZOOM, INITIAL_VIEW, createStyle } from "./style";

// MapLibre v6 のWorkerをViteで依存ファイルごとビルドし、生成URLを指定する。
maplibregl.setWorkerUrl(workerUrl);

export type LayerId = "basemap" | "routes" | "hazards" | "reviews";

export interface LayerDef {
  id: LayerId;
  label: string;
  /** 凡例の見本。cssClass は map.css の .legend__swatch--* */
  legend: { shape: "area" | "line" | "dot"; cssClass: string; text: string };
}

/** 重ねられるレイヤーの一覧。後続Issue（経路 #6・危険情報 #11・口コミ #12）はここへデータを流し込む。 */
export const LAYER_DEFS: readonly LayerDef[] = [
  { id: "basemap", label: "ベースマップ", legend: { shape: "area", cssClass: "basemap", text: "国土地理院 淡色地図" } },
  { id: "routes", label: "ルート", legend: { shape: "line", cssClass: "route", text: "ルート" } },
  { id: "hazards", label: "道路・危険情報", legend: { shape: "dot", cssClass: "hazard", text: "危険情報" } },
  { id: "reviews", label: "口コミ", legend: { shape: "dot", cssClass: "review", text: "口コミ" } },
];

/** 口コミは座標を持たないため、地図に置くときに位置を添える。 */
export interface ReviewPin {
  review: Review;
  lngLat: LngLat;
}

export interface MapHandlers {
  /** 地図クリック／タップで地点を選択したとき。 */
  onPick?: (lngLat: LngLat) => void;
}

export interface MapController {
  setRoutes(routes: Route[]): void;
  setHazards(hazards: Hazard[]): void;
  setReviews(pins: ReviewPin[]): void;
  setLayerVisible(id: LayerId, visible: boolean): void;
  isLayerVisible(id: LayerId): boolean;
  onLayersChange(listener: () => void): void;
  zoomIn(): void;
  zoomOut(): void;
  resetNorth(): void;
  destroy(): void;
}

const HAZARD_LABEL: Record<HazardType, string> = {
  steep_slope: "急坂",
  stairs: "階段",
  construction: "工事",
  narrow_road: "狭い道",
  other: "その他",
};
const SEVERITY_LABEL = { 1: "低", 2: "中", 3: "高" } as const;

const ROUTE_SOURCE = "routes";
const ROUTE_LAYER = "routes";

/**
 * 地図を container に初期化する。WebGL不可などで失敗したら再試行付きの表示に切り替える。
 * 返す controller は再試行しても同じものを使え、保持したデータと表示状態を作り直した地図へ反映する。
 */
export function mountMap(container: HTMLElement, handlers: MapHandlers = {}): MapController {
  let map: maplibregl.Map | null = null;
  let loaded = false;
  let routes: Route[] = [];
  let hazardMarkers: maplibregl.Marker[] = [];
  let reviewMarkers: maplibregl.Marker[] = [];
  let pickMarker: maplibregl.Marker | null = null;
  const visible: Record<LayerId, boolean> = { basemap: true, routes: true, hazards: true, reviews: true };
  const listeners: Array<() => void> = [];

  const canvas = el("div", { className: "map__canvas" });
  const notice = el("p", { className: "map__notice" });
  notice.setAttribute("role", "status");
  notice.hidden = true;
  container.append(canvas, notice);

  function routeCollection(): FeatureCollection<LineString> {
    const features: Array<Feature<LineString>> = routes.map((r) => ({
      type: "Feature",
      properties: { id: r.id, name: r.name },
      geometry: { type: "LineString", coordinates: r.coordinates },
    }));
    return { type: "FeatureCollection", features };
  }

  function syncVisibility(): void {
    if (!map || !loaded) return;
    const vis = (on: boolean) => (on ? "visible" : "none");
    map.setLayoutProperty("basemap", "visibility", vis(visible.basemap));
    map.setLayoutProperty(ROUTE_LAYER, "visibility", vis(visible.routes));
    const groups: Array<[boolean, maplibregl.Marker[]]> = [
      [visible.hazards, hazardMarkers],
      [visible.reviews, reviewMarkers],
    ];
    for (const [on, markers] of groups) {
      for (const m of markers) (on ? showMarker(m, map) : hideMarker(m));
    }
  }

  function syncRoutes(): void {
    if (!map || !loaded) return;
    (map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource).setData(routeCollection());
  }

  function replaceMarkers(old: maplibregl.Marker[], specs: MarkerSpec[]): maplibregl.Marker[] {
    for (const m of old) hideMarker(m);
    return specs.map(createMarker);
  }

  function showFallback(message: string): void {
    pickMarker = null;
    canvas.replaceChildren(
      renderState({ kind: "error", message, onRetry: () => init() }),
    );
    canvas.classList.add("map__canvas--fallback");
  }

  function init(): void {
    canvas.replaceChildren();
    canvas.classList.remove("map__canvas--fallback");
    notice.hidden = true;
    loaded = false;
    try {
      const routeColor = getComputedStyle(document.documentElement).getPropertyValue("--color-route").trim();
      const m = new maplibregl.Map({
        container: canvas,
        style: createStyle(),
        center: INITIAL_VIEW.center,
        zoom: INITIAL_VIEW.zoom,
        maxZoom: BASEMAP_MAX_ZOOM,
        // 帰属表示はシェルの .attribution に常時表示する。
        attributionControl: false,
      });
      map = m;

      m.on("load", () => {
        loaded = true;
        m.addSource(ROUTE_SOURCE, { type: "geojson", data: routeCollection() });
        m.addLayer({
          id: ROUTE_LAYER,
          type: "line",
          source: ROUTE_SOURCE,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": routeColor || "#2563eb", "line-width": 5, "line-opacity": 0.85 },
        });
        syncVisibility();
      });

      m.on("click", (e) => {
        // マーカー操作は地点選択として扱わない。
        const target = e.originalEvent.target;
        if (target instanceof Element && target.closest(".map-marker, .maplibregl-popup")) return;
        const lngLat: LngLat = [e.lngLat.lng, e.lngLat.lat];
        if (pickMarker) hideMarker(pickMarker);
        pickMarker = createMarker({
          id: "pick",
          lngLat,
          glyph: "",
          label: "選択した地点",
          title: "選択した地点",
          description: `緯度 ${lngLat[1].toFixed(5)} / 経度 ${lngLat[0].toFixed(5)}`,
          kind: "pick",
        });
        showMarker(pickMarker, m);
        pickMarker.togglePopup();
        handlers.onPick?.(lngLat);
      });

      // 失敗したことを隠さない。タイルが読めたら表示を消す。
      m.on("error", (e) => {
        console.error("MapLibre:", e.error);
        notice.textContent = "地図データを読み込めませんでした。通信環境を確認してください。";
        notice.hidden = false;
      });
      m.on("sourcedata", (e) => {
        if (e.sourceId === "basemap" && e.isSourceLoaded) notice.hidden = true;
      });
    } catch (error) {
      console.error("MapLibre initialization:", error);
      map = null;
      showFallback("地図を表示できませんでした。WebGL対応のブラウザーか確認してください。");
    }
  }

  init();

  const notify = () => listeners.forEach((l) => l());

  return {
    setRoutes(next) {
      routes = next;
      syncRoutes();
    },
    setHazards(hazards) {
      hazardMarkers = replaceMarkers(
        hazardMarkers,
        hazards.map((h) => ({
          id: h.id,
          lngLat: h.location,
          glyph: "!",
          label: `${HAZARD_LABEL[h.type]}（${h.description}）`,
          title: HAZARD_LABEL[h.type],
          description: `${h.description}（重要度: ${SEVERITY_LABEL[h.severity]}）`,
          kind: "hazard",
        })),
      );
      syncVisibility();
    },
    setReviews(pins) {
      reviewMarkers = replaceMarkers(
        reviewMarkers,
        pins.map(({ review, lngLat }) => ({
          id: review.id,
          lngLat,
          glyph: String(review.rating),
          label: `評価${review.rating}の口コミ`,
          title: `評価 ${review.rating} / 5`,
          description: review.comment,
          kind: "review",
        })),
      );
      syncVisibility();
    },
    setLayerVisible(id, on) {
      visible[id] = on;
      syncVisibility();
      notify();
    },
    isLayerVisible: (id) => visible[id],
    onLayersChange: (listener) => void listeners.push(listener),
    zoomIn: () => void map?.zoomIn(),
    zoomOut: () => void map?.zoomOut(),
    resetNorth: () => void map?.resetNorth(),
    destroy() {
      map?.remove();
      map = null;
      container.replaceChildren();
    },
  };
}
