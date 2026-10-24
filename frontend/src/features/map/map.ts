import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";
import type { Feature, FeatureCollection, LineString } from "geojson";
import type { Hazard, HazardType, LngLat, Review, Route } from "../../types/api";
import { el } from "../../ui/dom";
import { renderState } from "../../ui/state";
import { createMarker, hideMarker, showMarker, type MarkerSpec } from "./markers";
import { BASEMAP_LEGEND_LABEL, BASEMAP_MAX_ZOOM, INITIAL_VIEW, createStyle } from "./style";

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
  { id: "basemap", label: "ベースマップ", legend: { shape: "area", cssClass: "basemap", text: BASEMAP_LEGEND_LABEL } },
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
  /**
   * 地図クリック／タップで地点を選択したとき。
   * true を返すと呼び出し側が地点を使ったとして、汎用の「選択した地点」マーカーを置かない。
   */
  onPick?: (lngLat: LngLat) => boolean | void;
}

/** 出発地・目的地。未指定は null。 */
export interface Endpoints {
  origin: LngLat | null;
  destination: LngLat | null;
}

export interface MapController {
  setRoutes(routes: Route[]): void;
  setEndpoints(endpoints: Endpoints): void;
  /** 地点指定モードの間、カーソルを十字にして地図を指定待ちと分かるようにする。 */
  setPicking(on: boolean): void;
  /** 経路全体が見えるよう表示範囲を合わせる。パネルに隠れない余白を取る。 */
  fitToRoute(route: Route): void;
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
  let endpointMarkers: maplibregl.Marker[] = [];
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
      for (const m of markers) {
        // 既に表示中のマーカーは触らない（開いたポップアップとフォーカスを保つ）。
        const attached = m.getElement().isConnected;
        if (on && !attached) showMarker(m, map);
        else if (!on && attached) hideMarker(m);
      }
    }
  }

  function syncRoutes(): void {
    if (!map || !loaded) return;
    (map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource).setData(routeCollection());
  }

  /** 出発地・目的地は常に表示（レイヤー切替の対象外）。地図の作り直し後も再度載せる。 */
  function syncEndpoints(): void {
    if (!map) return;
    for (const m of endpointMarkers) if (!m.getElement().isConnected) showMarker(m, map);
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
        syncEndpoints();
      });

      m.on("click", (e) => {
        // マーカー操作は地点選択として扱わない。
        const target = e.originalEvent.target;
        if (target instanceof Element && target.closest(".map-marker, .maplibregl-popup")) return;
        const lngLat: LngLat = [e.lngLat.lng, e.lngLat.lat];
        if (handlers.onPick?.(lngLat) === true) return;
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
      });

      // 失敗したことを隠さない。失敗したタイルが読めるまで表示を残す。
      const failed = new Set<string>();
      const tileKey = (tile: { tileID?: { key: number } } | undefined) => (tile?.tileID ? String(tile.tileID.key) : "other");
      m.on("error", (e) => {
        console.error("MapLibre:", e.error);
        failed.add(tileKey((e as { tile?: { tileID?: { key: number } } }).tile));
        notice.textContent = "地図データを読み込めませんでした。通信環境を確認してください。";
        notice.hidden = false;
      });
      m.on("sourcedata", (e) => {
        if (e.sourceId !== "basemap" || !e.tile) return;
        failed.delete(tileKey(e.tile));
        if (failed.size === 0) notice.hidden = true;
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
    setEndpoints({ origin, destination }) {
      const specs: MarkerSpec[] = [];
      const coords = (p: LngLat) => `緯度 ${p[1].toFixed(5)} / 経度 ${p[0].toFixed(5)}`;
      if (origin) {
        specs.push({ id: "origin", lngLat: origin, glyph: "発", label: "出発地", title: "出発地", description: coords(origin), kind: "origin" });
      }
      if (destination) {
        specs.push({ id: "destination", lngLat: destination, glyph: "着", label: "目的地", title: "目的地", description: coords(destination), kind: "destination" });
      }
      endpointMarkers = replaceMarkers(endpointMarkers, specs);
      syncEndpoints();
    },
    setPicking(on) {
      canvas.classList.toggle("map__canvas--picking", on);
    },
    fitToRoute(route) {
      if (!map || route.coordinates.length === 0) return;
      const bounds = route.coordinates.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(route.coordinates[0], route.coordinates[0]),
      );
      // 検索パネルは広い画面で左側、狭い画面で上側を覆う。覆われない範囲に収める。
      const w = container.clientWidth;
      const h = container.clientHeight;
      const padding =
        w >= 768
          ? { top: 64, bottom: 64, left: 464, right: 96 }
          : { top: Math.min(Math.round(h * 0.65) + 80, h - 200), bottom: 48, left: 32, right: 32 };
      map.fitBounds(bounds, { padding, maxZoom: 16 });
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
