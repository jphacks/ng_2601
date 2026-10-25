import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";
import type { Feature, FeatureCollection, LineString } from "geojson";
import type { BBox, LngLat, Route } from "../../types/api";
import { CATEGORY_DEFS } from "../hazards/catalog";
import { geometryBBox } from "../hazards/geometry";
import { buildRoadInfoCollection } from "../hazards/mapCollection";
import type { RoadInfoItem } from "../hazards/types";
import { formatSegmentText, distanceOnLine, type RouteSelectionTarget, type SegmentFacts } from "../elevation/selection";
import type { RouteGradientSegment } from "../elevation/gradientSegments";
import { el } from "../../ui/dom";
import { renderState } from "../../ui/state";
import { CATEGORY_GLYPH, CATEGORY_LABEL } from "../reviews/catalog";
import type { ReviewPlace } from "../reviews/grouping";
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

export interface MapHandlers {
  /**
   * 地図クリック／タップで地点を選択したとき。
   * true を返すと呼び出し側が地点を使ったとして、汎用の「選択した地点」マーカーを置かない。
   */
  onPick?: (lngLat: LngLat) => boolean | void;
  /** 道路・危険情報の図形をクリックしたとき（id）。何もない場所をクリックしたとき（null）。 */
  onSelectRoadInfo?: (id: string | null) => void;
  /**
   * 地図上のルート区間を選んだとき。distanceM は区間始点からの経路距離(m)。
   * グラフ側で同じ位置を選ぶために使う（#9）。
   */
  onSelectRouteSegment?: (distanceM: number) => void;
}

export interface Viewport {
  bbox: BBox;
  zoom: number;
}

/**
 * グラフと共有する選択位置。
 * 地図の描画に必要なカーソル位置・区間・100m計測窓だけを持つ（elevation/selection）。
 */

/** 出発地・目的地。未指定は null。 */
export interface Endpoints {
  origin: LngLat | null;
  destination: LngLat | null;
}

/** ブラウザーから取得した現在地。画面表示だけに使い、保存・送信しない。 */
export interface CurrentLocation {
  lngLat: LngLat;
  /** 水平方向の誤差 (m)。 */
  accuracyM: number;
}

export interface MapController {
  setRoutes(routes: Route[]): void;
  setRouteGradientSegments(routeId: string, segments: readonly RouteGradientSegment[] | null): void;
  /** グラフ側で選んだ位置を地図へ反映する。null で解除（#9）。 */
  setRouteSelection(selection: RouteSelectionTarget | null): void;
  setEndpoints(endpoints: Endpoints): void;
  /** 地点指定モードの間、カーソルを十字にして地図を指定待ちと分かるようにする。 */
  setPicking(on: boolean): void;
  /** 経路全体が見えるよう表示範囲を合わせる。パネルに隠れない余白を取る。 */
  fitToRoute(route: Route): void;
  /** 現在地マーカーを置く（null で消す）。recenter が true なら現在地へ地図を移動する。 */
  setCurrentLocation(location: CurrentLocation | null, recenter?: boolean): void;
  /** 道路・危険情報（FE-09）。フィルタ済みの項目を渡す。 */
  setRoadInfo(items: readonly RoadInfoItem[], now?: Date): void;
  setSelectedRoadInfo(id: string | null): void;
  /** 選択した項目が見えるよう地図を移動する。 */
  focusRoadInfo(id: string): void;
  /** 表示領域が変わったとき（移動・ズーム終了時と初期表示時）。 */
  onViewportChange(listener: (viewport: Viewport) => void): void;
  /** 口コミのピンを置き換える。ピンの選択（クリック／Enter）で onSelect を呼ぶ。 */
  setReviews(places: ReviewPlace[], onSelect: (place: ReviewPlace) => void): void;
  /** 口コミの投稿地点を示すマーカー。null で消す。 */
  setDraftPoint(point: LngLat | null): void;
  setLayerVisible(id: LayerId, visible: boolean): void;
  isLayerVisible(id: LayerId): boolean;
  onLayersChange(listener: () => void): void;
  /** 現在の表示範囲。地図が使えない間は null。 */
  getBounds(): BBox | null;
  zoomIn(): void;
  zoomOut(): void;
  resetNorth(): void;
  /** コンテナをDOMへ接続した後、地図キャンバスを実際の表示サイズに合わせる。 */
  resize(): void;
  destroy(): void;
}

const ROUTE_SOURCE = "routes";
const ROUTE_LAYER = "routes";
const ROUTE_UNKNOWN_LAYER = "routes-unknown";
const ROUTE_SELECTION_HALO = "routes-selection-halo";

function segmentFacts(properties: Record<string, unknown> | null | undefined): SegmentFacts | null {
  const fromM = properties?.startDistanceM;
  const toM = properties?.endDistanceM;
  if (typeof fromM !== "number" || !Number.isFinite(fromM) || typeof toM !== "number" || !Number.isFinite(toM)) return null;
  const grade = properties?.gradePercent;
  const windowFromM = properties?.windowFromM;
  const windowToM = properties?.windowToM;
  return {
    fromM,
    toM,
    gradePercent: typeof grade === "number" && Number.isFinite(grade) ? grade : null,
    windowFromM: typeof windowFromM === "number" && Number.isFinite(windowFromM) ? windowFromM : null,
    windowToM: typeof windowToM === "number" && Number.isFinite(windowToM) ? windowToM : null,
  };
}

function createRouteCursor(): HTMLElement {
  const element = document.createElement("div");
  element.className = "map-route-cursor";
  element.setAttribute("aria-hidden", "true");
  return element;
}

const ROAD_SOURCE = "road-info";
const ROAD_FILL = "road-info-fill";
const ROAD_LINE = "road-info-line";
const ROAD_LINE_UNVERIFIED = "road-info-line-unverified";
const ROAD_LINE_STALE = "road-info-line-stale";
const ROAD_CIRCLE = "road-info-circle";
const ROAD_HALO_LINE = "road-info-halo-line";
const ROAD_HALO_CIRCLE = "road-info-halo-circle";
/** 「道路・危険情報」レイヤーのON/OFFで切り替える描画レイヤー。 */
const ROAD_LAYERS = [ROAD_HALO_LINE, ROAD_HALO_CIRCLE, ROAD_FILL, ROAD_LINE, ROAD_LINE_UNVERIFIED, ROAD_LINE_STALE, ROAD_CIRCLE];
/** クリック判定に使う図形。面は外周線のみ（面の内側は地点選択に使えるようにする）。 */
const ROAD_HIT_LAYERS = [ROAD_FILL, ROAD_CIRCLE, ROAD_LINE, ROAD_LINE_UNVERIFIED, ROAD_LINE_STALE];
const HIT_TOLERANCE_PX = 8;

/** 地図のクリック判定と区間一覧で同じ文言を使う。#8の区間表示を1か所の整形に寄せる。 */
function segmentText(properties: Record<string, unknown> | null | undefined): string | null {
  const facts = segmentFacts(properties);
  return facts ? formatSegmentText(facts) : null;
}

/** 地図のクリック判定と区間セレクターで同じ説明文を作れるよう、区間を地物の属性に落とす。 */
function segmentProperties(routeId: string, segment: RouteGradientSegment, index: number): Record<string, unknown> {
  return {
    routeId,
    segmentIndex: index,
    direction: segment.direction,
    startDistanceM: segment.fromM,
    endDistanceM: segment.toM,
    gradePercent: segment.gradePercent,
    windowFromM: segment.windowFromM,
    windowToM: segment.windowToM,
  };
}

/**
 * 地図を container に初期化する。WebGL不可などで失敗したら再試行付きの表示に切り替える。
 * 返す controller は再試行しても同じものを使え、保持したデータと表示状態を作り直した地図へ反映する。
 */
export function mountMap(container: HTMLElement, handlers: MapHandlers = {}): MapController {
  let map: maplibregl.Map | null = null;
  let loaded = false;
  let routes: Route[] = [];
  let roadItems: readonly RoadInfoItem[] = [];
  let roadNow = new Date();
  let selectedRoadId: string | null = null;
  let picking = false;
  let gradientRouteId: string | null = null;
  let gradientSegments: readonly RouteGradientSegment[] | null = null;
  let routeSelection: RouteSelectionTarget | null = null;
  /** 直前に地図へ反映したハイライト区間。毎フレーム setFilter しないためのキー。 */
  let appliedSelectionKey: string | null = null;
  let routeCursor: maplibregl.Marker | null = null;
  let reviewMarkers: maplibregl.Marker[] = [];
  let pickMarker: maplibregl.Marker | null = null;
  let endpointMarkers: maplibregl.Marker[] = [];
  let draftMarker: maplibregl.Marker | null = null;
  let endpoints: Endpoints = { origin: null, destination: null };
  let currentMarker: maplibregl.Marker | null = null;
  const visible: Record<LayerId, boolean> = { basemap: true, routes: true, hazards: true, reviews: true };
  const listeners: Array<() => void> = [];
  const viewportListeners: Array<(viewport: Viewport) => void> = [];

  const canvas = el("div", { className: "map__canvas" });
  const notice = el("p", { className: "map__notice" });
  // クリック以外でも区間を選べるよう、区間一覧をキーボード操作可能なselectで置く。
  const gradientPanel = el("div", { className: "map__gradient-panel" });
  const segmentSelect = el("select", { className: "map__gradient-select" });
  segmentSelect.setAttribute("aria-label", "勾配区間を選択");
  segmentSelect.hidden = true;
  const gradientSelection = el("p", { className: "map__gradient-selection" });
  notice.setAttribute("role", "status");
  gradientSelection.setAttribute("role", "status");
  gradientSelection.setAttribute("aria-live", "polite");
  notice.hidden = true;
  gradientSelection.hidden = true;
  gradientPanel.hidden = true;
  gradientPanel.append(segmentSelect, gradientSelection);
  container.append(canvas, notice, gradientPanel);
  let selectedSegmentIndex: number | null = null;

  function routeCollection(): FeatureCollection<LineString> {
    const features: Array<Feature<LineString>> = [];
    for (const route of routes) {
      const segments = route.id === gradientRouteId ? gradientSegments : null;
      if (segments?.length) {
        segments.forEach((segment, index) => features.push({
          type: "Feature",
          id: `${route.id}:${index}`,
          properties: segmentProperties(route.id, segment, index),
          geometry: { type: "LineString", coordinates: segment.coordinates },
        }));
        continue;
      }
      features.push({
        type: "Feature",
        properties: { id: route.id, name: route.name, direction: "unknown", segmentIndex: -1 },
        geometry: { type: "LineString", coordinates: route.coordinates },
      });
    }
    return { type: "FeatureCollection", features };
  }

  function syncGradientPanel(): void {
    gradientPanel.hidden = segmentSelect.hidden && gradientSelection.hidden;
  }

  /** 区間セレクターの表示状態を、描画中の区間とルートレイヤーの表示に合わせる。 */
  function syncSegmentOptions(): void {
    const segments = visible.routes && gradientSegments?.length ? gradientSegments : null;
    const options: HTMLOptionElement[] = [];
    if (segments) {
      const placeholder = el("option", { text: "勾配区間を選択" });
      placeholder.value = "";
      options.push(placeholder);
      segments.forEach((segment, index) => {
        const option = el("option", { text: segmentText(segmentProperties(gradientRouteId ?? "", segment, index)) ?? "" });
        option.value = String(index);
        options.push(option);
      });
    }
    segmentSelect.replaceChildren(...options);
    segmentSelect.hidden = options.length === 0;
    segmentSelect.value = selectedSegmentIndex === null ? "" : String(selectedSegmentIndex);
    syncGradientPanel();
  }

  function showGradientSelection(text: string, index: number | null): void {
    gradientSelection.textContent = text;
    gradientSelection.hidden = false;
    selectedSegmentIndex = index;
    segmentSelect.value = index === null ? "" : String(index);
    syncGradientPanel();
  }

  function clearGradientSelection(): void {
    gradientSelection.textContent = "";
    gradientSelection.hidden = true;
    selectedSegmentIndex = null;
    segmentSelect.value = "";
    syncGradientPanel();
  }

  function selectionKey(): string {
    return `${gradientRouteId ?? ""}:${routeSelection?.segmentIndex ?? -1}:${routeSelection?.windowFromM ?? ""}:${routeSelection?.windowToM ?? ""}`;
  }

  /** ハイライト区間が変わったときだけ setFilter する（グラフのホバーで毎フレーム再設定しない）。 */
  function applyRouteSelectionFilter(): void {
    if (!map || !loaded || !map.getLayer(ROUTE_SELECTION_HALO)) return;
    const key = selectionKey();
    if (key === appliedSelectionKey) return;
    appliedSelectionKey = key;
    const selected = routeSelection;
    if (!selected || gradientRouteId === null) {
      map.setFilter(ROUTE_SELECTION_HALO, ["==", ["get", "routeId"], ""]);
      return;
    }
    // 20mごとの区間ではなく、勾配の根拠になった100m窓全体を帯で示す。
    // 各区間は自分の中心に最も近い100m窓を持つため、窓の値では絞れない。距離の範囲で選ぶ。
    if (selected.windowFromM !== null && selected.windowToM !== null) {
      map.setFilter(ROUTE_SELECTION_HALO, [
        "all",
        ["==", ["get", "routeId"], gradientRouteId],
        [">=", ["get", "startDistanceM"], selected.windowFromM - 1e-6],
        ["<=", ["get", "endDistanceM"], selected.windowToM + 1e-6],
      ]);
      return;
    }
    if (selected.segmentIndex !== null) {
      map.setFilter(ROUTE_SELECTION_HALO, [
        "all",
        ["==", ["get", "routeId"], gradientRouteId],
        ["==", ["get", "segmentIndex"], selected.segmentIndex],
      ]);
      return;
    }
    map.setFilter(ROUTE_SELECTION_HALO, ["==", ["get", "routeId"], ""]);
  }

  /** グラフで選んだ位置をマーカーで示す。区間ハイライトは applyRouteSelectionFilter が担当する。 */
  function applyRouteSelection(): void {
    applyRouteSelectionFilter();
    syncGradientSelection();
    // ルート非表示の間はルート上の選択も出さない（パネルと同じくレイヤー表示に合わせる）。
    if (!routeSelection || !visible.routes) {
      routeCursor?.remove();
      return;
    }
    routeCursor ??= new maplibregl.Marker({ element: createRouteCursor(), anchor: "center" });
    routeCursor.setLngLat(routeSelection.lngLat);
    if (map && !routeCursor.getElement().isConnected) routeCursor.addTo(map);
  }

  /**
   * #8の区間一覧（キーボード操作）も#9の距離ベースの選択へ流す。
   * 選択状態は link.ts の distanceM 1つに集約し、一覧とグラフが別々の選択を持たないようにする。
   */
  segmentSelect.addEventListener("change", () => {
    const index = segmentSelect.value === "" ? null : Number(segmentSelect.value);
    const segment = index === null ? undefined : gradientSegments?.[index];
    const text = index === null || !segment ? null : segmentText(segmentProperties(gradientRouteId ?? "", segment, index));
    if (!segment || text === null) {
      clearGradientSelection();
      return;
    }
    // 区間の中央を選び、グラフのスライダー・数値表示も同じ位置へ動かす（#9）。
    if (handlers.onSelectRouteSegment) handlers.onSelectRouteSegment((segment.fromM + segment.toM) / 2);
    else showGradientSelection(text, index);
  });

  /** 共有の選択位置（距離）から区間の文言と一覧の値を導く。グラフ側の選択にも表示だけを追従させる。 */
  function syncGradientSelection(): void {
    const index = visible.routes ? routeSelection?.segmentIndex : null;
    const segment = typeof index === "number" && index >= 0 ? gradientSegments?.[index] : undefined;
    const text = !segment || typeof index !== "number" || index < 0
      ? null
      : segmentText(segmentProperties(gradientRouteId ?? "", segment, index));
    if (typeof index !== "number" || index < 0 || text === null) {
      if (selectedSegmentIndex !== null || !gradientSelection.hidden) clearGradientSelection();
      return;
    }
    if (text === gradientSelection.textContent && selectedSegmentIndex === index && !gradientSelection.hidden) return;
    showGradientSelection(text, index);
  }

  function syncVisibility(): void {
    syncSegmentOptions();
    if (!visible.routes) clearGradientSelection();
    if (!map || !loaded) return;
    const vis = (on: boolean) => (on ? "visible" : "none");
    map.setLayoutProperty("basemap", "visibility", vis(visible.basemap));
    map.setLayoutProperty(ROUTE_LAYER, "visibility", vis(visible.routes));
    for (const id of ROAD_LAYERS) map.setLayoutProperty(id, "visibility", vis(visible.hazards));
    const groups: Array<[boolean, maplibregl.Marker[]]> = [[visible.reviews, reviewMarkers]];
    map.setLayoutProperty(ROUTE_UNKNOWN_LAYER, "visibility", vis(visible.routes));
    if (map.getLayer(ROUTE_SELECTION_HALO)) map.setLayoutProperty(ROUTE_SELECTION_HALO, "visibility", vis(visible.routes));
    for (const [on, markers] of groups) {
      for (const m of markers) {
        // 既に表示中のマーカーは触らない（開いたポップアップとフォーカスを保つ）。
        const attached = m.getElement().isConnected;
        if (on && !attached) showMarker(m, map);
        else if (!on && attached) hideMarker(m);
      }
    }
  }

  function currentBounds(): BBox | null {
    if (!map || !loaded) return null;
    const b = map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  function syncRoutes(): void {
    if (!map || !loaded) return;
    (map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource).setData(routeCollection());
  }

  function syncRoadInfo(): void {
    if (!map || !loaded) return;
    (map.getSource(ROAD_SOURCE) as maplibregl.GeoJSONSource).setData(buildRoadInfoCollection(roadItems, roadNow));
  }

  function syncSelection(): void {
    if (!map || !loaded) return;
    const match: maplibregl.ExpressionSpecification = ["==", ["get", "id"], selectedRoadId ?? ""];
    map.setFilter(ROAD_HALO_LINE, ["all", ["!=", ["geometry-type"], "Point"], match]);
    map.setFilter(ROAD_HALO_CIRCLE, ["all", ["==", ["geometry-type"], "Point"], match]);
  }

  function emitViewport(): void {
    if (!map) return;
    const [[west, south], [east, north]] = map.getBounds().toArray();
    const viewport: Viewport = { bbox: [west, south, east, north], zoom: map.getZoom() };
    for (const l of viewportListeners) l(viewport);
  }

  /** 道路・危険情報の描画レイヤーを追加する。色はCSS変数から解決する（MapLibreはvar()を解釈しない）。 */
  function addRoadInfoLayers(m: maplibregl.Map): void {
    const css = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const byCategory = [
      "match",
      ["get", "category"],
      ...CATEGORY_DEFS.flatMap((c) => [c.id, color(c.cssVar, "#c2410c")]),
      "#c2410c",
    ] as unknown as maplibregl.ExpressionSpecification;
    const surface = color("--color-surface", "#ffffff");
    const text = color("--color-text", "#283326");
    const selected = color("--color-selected", "#dda15e");
    const isPoint: maplibregl.ExpressionSpecification = ["==", ["geometry-type"], "Point"];
    const notPoint: maplibregl.ExpressionSpecification = ["!=", ["geometry-type"], "Point"];
    const stateIs = (state: string): maplibregl.ExpressionSpecification => ["==", ["get", "state"], state];
    const noMatch: maplibregl.ExpressionSpecification = ["==", ["get", "id"], ""];

    m.addSource(ROAD_SOURCE, { type: "geojson", data: buildRoadInfoCollection(roadItems, roadNow) });
    m.addLayer({
      id: ROAD_HALO_LINE,
      type: "line",
      source: ROAD_SOURCE,
      filter: ["all", notPoint, noMatch],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": selected, "line-width": 12, "line-opacity": 0.7 },
    });
    m.addLayer({
      id: ROAD_HALO_CIRCLE,
      type: "circle",
      source: ROAD_SOURCE,
      filter: ["all", isPoint, noMatch],
      paint: { "circle-color": selected, "circle-radius": 16, "circle-opacity": 0.7 },
    });
    m.addLayer({
      id: ROAD_FILL,
      type: "fill",
      source: ROAD_SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": byCategory,
        "fill-opacity": ["match", ["get", "state"], "current", 0.22, 0.1],
      },
    });
    const line = (id: string, state: string, opacity: number, dash?: number[]): maplibregl.LayerSpecification => ({
      id,
      type: "line",
      source: ROAD_SOURCE,
      filter: ["all", notPoint, stateIs(state)],
      layout: { "line-join": "round", "line-cap": dash ? "butt" : "round" },
      paint: {
        "line-color": byCategory,
        "line-width": 4,
        "line-opacity": opacity,
        ...(dash ? { "line-dasharray": dash } : {}),
      },
    });
    // 線種でも区別する: 実線=有効、破線=未確認、点線=期限切れ・解消済み。
    m.addLayer(line(ROAD_LINE, "current", 0.9));
    m.addLayer(line(ROAD_LINE_UNVERIFIED, "unverified", 0.8, [3, 2]));
    m.addLayer(line(ROAD_LINE_STALE, "stale", 0.55, [1, 2]));
    m.addLayer({
      id: ROAD_CIRCLE,
      type: "circle",
      source: ROAD_SOURCE,
      filter: isPoint,
      paint: {
        "circle-color": byCategory,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4, 16, 8],
        "circle-opacity": ["match", ["get", "state"], "current", 1, "unverified", 0.75, 0.45],
        "circle-stroke-width": 2,
        // 期限切れ・未確認は暗い縁取りにして、白縁の有効な点と見分けられるようにする。
        "circle-stroke-color": ["match", ["get", "state"], "current", surface, text],
      },
    });
  }

  /** 出発地・目的地は常に表示（レイヤー切替の対象外）。地図の作り直し後も再度載せる。 */
  function syncEndpoints(): void {
    if (!map) return;
    for (const m of endpointMarkers) if (!m.getElement().isConnected) showMarker(m, map);
  }

  /** 現在地マーカーも地図の作り直し後に載せ直す。 */
  function syncCurrentLocation(): void {
    if (map && currentMarker && !currentMarker.getElement().isConnected) showMarker(currentMarker, map);
  }

  /** 投稿地点も地図の作り直し後に載せ直す。 */
  function syncDraft(): void {
    if (map && draftMarker && !draftMarker.getElement().isConnected) showMarker(draftMarker, map);
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
    // 地図を作り直したら、作った地図に対してハイライトを再設定する。
    appliedSelectionKey = null;
    try {
      const rootStyles = getComputedStyle(document.documentElement);
      const routeColor = rootStyles.getPropertyValue("--color-route").trim();
      const gradeColor = (name: string, fallback: string) => rootStyles.getPropertyValue(`--route-gradient-${name}`).trim() || fallback;
      const uphillColor = gradeColor("uphill", "#c2410c");
      const flatColor = gradeColor("flat", "#334155");
      const downhillColor = gradeColor("downhill", "#1d4ed8");
      const unknownColor = gradeColor("unknown", "#64748b");
      const selectionColor = rootStyles.getPropertyValue("--color-accent").trim() || "#dda15e";
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
          filter: ["!=", ["get", "direction"], "unknown"],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": ["match", ["get", "direction"], "uphill", uphillColor, "downhill", downhillColor, "flat", flatColor, routeColor || "#2563eb"],
            "line-width": ["interpolate", ["linear"], ["min", ["abs", ["get", "gradePercent"]], 10], 0, 4, 10, 8],
            "line-opacity": 0.95,
          },
        });
        // 選択区間の帯はルート線の下に敷き、色分けを隠さない。
        m.addLayer({
          id: ROUTE_SELECTION_HALO,
          type: "line",
          source: ROUTE_SOURCE,
          filter: ["==", ["get", "routeId"], ""],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": selectionColor, "line-width": 18, "line-opacity": 0.95 },
        }, ROUTE_LAYER);
        m.addLayer({
          id: ROUTE_UNKNOWN_LAYER,
          type: "line",
          source: ROUTE_SOURCE,
          filter: ["==", ["get", "direction"], "unknown"],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": unknownColor, "line-width": 4, "line-dasharray": [1.5, 1.5], "line-opacity": 0.95 },
        });
        addRoadInfoLayers(m);
        syncSelection();
        syncVisibility();
        syncEndpoints();
        syncCurrentLocation();
        applyRouteSelection();
        syncDraft();
        emitViewport();
      });
      m.on("moveend", emitViewport);

      const hitAt = (point: { x: number; y: number }) =>
        loaded
          ? m.queryRenderedFeatures(
              [
                [point.x - HIT_TOLERANCE_PX, point.y - HIT_TOLERANCE_PX],
                [point.x + HIT_TOLERANCE_PX, point.y + HIT_TOLERANCE_PX],
              ],
              // 非表示のレイヤーは対象にしない（レイヤーOFF中に選択されないように）。
              { layers: ROAD_HIT_LAYERS.filter((id) => m.getLayoutProperty(id, "visibility") !== "none") },
            )
          : [];
      m.on("mousemove", (e) => {
        m.getCanvas().style.cursor = !picking && hitAt(e.point).length > 0 ? "pointer" : "";
      });

      m.on("click", (e) => {
        // マーカー操作は地点選択として扱わない。
        const target = e.originalEvent.target;
        if (target instanceof Element && target.closest(".map-marker, .maplibregl-popup")) return;
        // 道路・危険情報の図形は詳細カードを開き、地点選択にはしない。
        const hitId: unknown = hitAt(e.point)[0]?.properties?.id;
        // 地点指定モード中は、近くの道路情報ではなくタップした地点を優先する。
        if (!picking && typeof hitId === "string") {
          handlers.onSelectRoadInfo?.(hitId);
          return;
        }
        handlers.onSelectRoadInfo?.(null);
        const lngLat: LngLat = [e.lngLat.lng, e.lngLat.lat];
        if (handlers.onPick?.(lngLat) === true) return;
        const routeFeature = m.queryRenderedFeatures(e.point, { layers: [ROUTE_LAYER, ROUTE_UNKNOWN_LAYER] })[0];
        const facts = segmentFacts(routeFeature?.properties);
        if (facts) {
          const index = routeFeature?.properties?.segmentIndex;
          showGradientSelection(formatSegmentText(facts), typeof index === "number" ? index : null);
          // タップ位置を区間内の距離へ投影し、グラフ側で同じ位置を選ぶ（#9）。
          // 描画用のジオメトリはタイル境界で分割・単純化され得るため、元の区間形状を使う。
          const segmentIndex = routeFeature?.properties?.segmentIndex;
          const source = typeof segmentIndex === "number" && gradientSegments ? gradientSegments[segmentIndex] : undefined;
          const along = source ? distanceOnLine(source.coordinates, lngLat) : null;
          handlers.onSelectRouteSegment?.(along === null ? facts.fromM : Math.min(facts.toM, facts.fromM + along));
          return;
        }
        clearGradientSelection();
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
      gradientRouteId = null;
      gradientSegments = null;
      routeSelection = null;
      appliedSelectionKey = null;
      clearGradientSelection();
      syncSegmentOptions();
      applyRouteSelection();
      syncRoutes();
    },
    setRouteGradientSegments(routeId, next) {
      gradientRouteId = routeId;
      gradientSegments = next;
      routeSelection = null;
      appliedSelectionKey = null;
      clearGradientSelection();
      syncSegmentOptions();
      applyRouteSelection();
      syncRoutes();
    },
    setRouteSelection(selection) {
      routeSelection = selection;
      applyRouteSelection();
    },
    setEndpoints({ origin, destination }) {
      // 地点が変わっていなければマーカーを作り直さない（開いたポップアップとフォーカスを保つ）。
      const same = (a: LngLat | null, b: LngLat | null) => (a === null || b === null ? a === b : a[0] === b[0] && a[1] === b[1]);
      if (same(origin, endpoints.origin) && same(destination, endpoints.destination)) {
        syncEndpoints();
        return;
      }
      endpoints = { origin, destination };
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
      picking = on;
      canvas.classList.toggle("map__canvas--picking", on);
      if (map) map.getCanvas().style.cursor = "";
    },
    fitToRoute(route) {
      if (!map || route.coordinates.length === 0) return;
      const bounds = route.coordinates.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(route.coordinates[0], route.coordinates[0]),
      );
      // 検索パネルは広い画面で左側を、狭い画面では経路結果シートが下側を覆う。覆われない範囲に収める。
      // 狭い画面のシートは下から高さ約65%（shell.cssの.search-card--route-results）を占める。
      const w = container.clientWidth;
      const h = container.clientHeight;
      // 画面が低いとh-200の上限がシートの高さを下回り、経路の下端がシートに隠れる。シートの高さは必ず確保する。
      const sheet = Math.round(h * 0.65);
      const padding =
        w >= 768
          ? { top: 64, bottom: 64, left: 464, right: 96 }
          : { top: 48, bottom: Math.max(Math.min(sheet + 80, h - 200), sheet), left: 32, right: 32 };
      map.fitBounds(bounds, { padding, maxZoom: 16 });
    },
    setCurrentLocation(location, recenter = false) {
      if (currentMarker) hideMarker(currentMarker);
      currentMarker = null;
      if (!location) return;
      currentMarker = createMarker({
        id: "current-location",
        lngLat: location.lngLat,
        glyph: "",
        label: "現在地",
        title: "現在地",
        description: `精度 約${Math.round(location.accuracyM)} m`,
        kind: "current",
      });
      syncCurrentLocation();
      if (recenter && map) {
        // 精度が粗いとき（IPベースなど）は寄り過ぎない。現在より引いた表示にはしない。
        const zoom = Math.max(map.getZoom(), location.accuracyM > 500 ? 13 : 16);
        map.flyTo({ center: location.lngLat, zoom });
      }
    },
    setRoadInfo(items, now = new Date()) {
      roadItems = items;
      roadNow = now;
      syncRoadInfo();
    },
    setSelectedRoadInfo(id) {
      selectedRoadId = id;
      syncSelection();
    },
    focusRoadInfo(id) {
      const item = roadItems.find((i) => i.id === id);
      if (!map || !item) return;
      const box = geometryBBox(item.geometry);
      if (item.geometry.type === "Point" || !box) {
        map.easeTo({ center: item.position, zoom: Math.max(map.getZoom(), 16) });
      } else {
        map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: 80, maxZoom: 17 });
      }
    },
    setReviews(places, onSelect) {
      reviewMarkers = replaceMarkers(
        reviewMarkers,
        places.map((place) => {
          const count = place.reviews.length;
          const category = place.reviews[0].category;
          return {
            id: place.id,
            lngLat: place.center,
            glyph: count > 1 ? String(count) : CATEGORY_GLYPH[category],
            label: count > 1 ? `口コミ${count}件` : `口コミ（${CATEGORY_LABEL[category]}）`,
            title: "",
            description: "",
            kind: "review",
            onSelect: () => onSelect(place),
          };
        }),
      );
      syncVisibility();
    },
    setDraftPoint(point) {
      if (draftMarker) hideMarker(draftMarker);
      draftMarker = point
        ? createMarker({
            id: "draft",
            lngLat: point,
            glyph: "投",
            label: "口コミの投稿地点",
            title: "口コミの投稿地点",
            description: `緯度 ${point[1].toFixed(5)} / 経度 ${point[0].toFixed(5)}`,
            kind: "draft",
          })
        : null;
      syncDraft();
    },
    setLayerVisible(id, on) {
      visible[id] = on;
      syncVisibility();
      // ルートの再表示では選択マーカーと区間表示を今の選択へ戻す。
      applyRouteSelection();
      notify();
    },
    isLayerVisible: (id) => visible[id],
    onLayersChange: (listener) => void listeners.push(listener),
    getBounds: currentBounds,
    onViewportChange: (listener) => void viewportListeners.push(listener),
    zoomIn: () => void map?.zoomIn(),
    zoomOut: () => void map?.zoomOut(),
    resetNorth: () => void map?.resetNorth(),
    resize: () => map?.resize(),
    destroy() {
      map?.remove();
      map = null;
      container.replaceChildren();
    },
  };
}
