import type { ApiClient } from "../../api/client";
import { createMapDataLoader, type MapDataLoader, type MapDataState } from "../../api/mapDataLoader";
import { el } from "../../ui/dom";
import { icon } from "../../ui/icon";
import type { MapController } from "../map/map";
import { renderDetailContent } from "./detailCard";
import { applyFilter, countByCategory, createDefaultFilter } from "./filter";
import { normalizeMapData, type NormalizedMapData } from "./normalize";
import { renderHazardPanel } from "./panel";
import type { RoadInfoItem } from "./types";

/** observations の最大取得件数（BEの上限は500、既定200）。 */
const LIMIT = 200;
/** 期限の経過を反映するため、時刻依存の表示を定期的に再評価する。 */
const REFRESH_MS = 60_000;

export interface HazardsFeatureOptions {
  map: MapController;
  client: ApiClient;
  /** モックデータ表示中か（注意書きを出す）。 */
  mock: boolean;
  /** 項目が選択されたとき。fromList は一覧からの選択（地図の外で操作している）。 */
  onSelect?: (fromList: boolean) => void;
}

export interface HazardsFeature {
  /** 「道路情報」タブの中身。 */
  panel: HTMLElement;
  /** 地図上の詳細カード。シェルが地図の上に配置する。 */
  card: HTMLElement;
  select(id: string | null, source?: "map" | "list"): void;
  /** 詳細カードを閉じる。開いていたら true。 */
  closeDetail(): boolean;
  /** 現在のフィルタと鮮度条件に合う道路情報（近隣の口コミシートでも使う）。 */
  getVisibleItems(): readonly RoadInfoItem[];
  dispose(): void;
}

/** 道路・危険情報の取得、フィルタ、地図、一覧、詳細カードをつなぐ。 */
export function createHazardsFeature({ map, client, mock, onSelect }: HazardsFeatureOptions): HazardsFeature {
  const filter = createDefaultFilter();
  const loader: MapDataLoader = createMapDataLoader(client, { limit: LIMIT });

  let loaderState: MapDataState = loader.getState();
  let normalized: NormalizedMapData = { items: [], sources: [] };
  let normalizedFrom: MapDataState["data"];
  let selectedId: string | null = null;
  let renderedCardKey = "";
  let dataVersion = 0;

  const closeButton = el("button", { className: "hazard-card__close" }, [icon("close")]);
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "詳細を閉じる");
  const content = el("div", { className: "hazard-card__content" });
  const card = el("aside", { className: "hazard-card" }, [closeButton, content]);
  card.setAttribute("role", "region");
  card.setAttribute("aria-labelledby", "hazard-detail-title");
  card.hidden = true;

  const panel = renderHazardPanel(filter, {
    onFilterChange: () => refresh(),
    onSelect: (id) => select(id, "list"),
    onRetry: () => loader.retry(),
    onShowLayer: () => map.setLayerVisible("hazards", true),
  });

  function renderCard(visible: readonly RoadInfoItem[], now: Date): void {
    const item = selectedId ? visible.find((i) => i.id === selectedId) : undefined;
    card.hidden = !item;
    if (!item) {
      content.replaceChildren();
      renderedCardKey = "";
      return;
    }
    // 時刻を分単位にして、毎分の再評価で内容が変わったときだけ描き直す。
    const key = `${item.id}@${Math.floor(now.getTime() / REFRESH_MS)}@${dataVersion}`;
    if (key === renderedCardKey) return;
    renderedCardKey = key;
    content.replaceChildren(renderDetailContent(item, now));
  }

  function refresh(): void {
    const now = new Date();
    const visible = applyFilter(normalized.items, filter, now);
    if (selectedId && !visible.some((i) => i.id === selectedId)) {
      selectedId = null;
      map.setSelectedRoadInfo(null);
      panel.setSelected(null);
    }
    map.setRoadInfo(visible, now);
    panel.update({
      loader: loaderState,
      visible,
      sources: normalized.sources,
      counts: countByCategory(normalized.items, filter, now),
      now,
      layerVisible: map.isLayerVisible("hazards"),
      mock,
      limit: LIMIT,
    });
    renderCard(visible, now);
  }

  function select(id: string | null, source: "map" | "list" = "map"): void {
    selectedId = id;
    renderedCardKey = "";
    map.setSelectedRoadInfo(id);
    panel.setSelected(id);
    refresh();
    if (!id || !selectedId) return;
    if (source === "list") {
      map.focusRoadInfo(id);
      content.querySelector<HTMLElement>("#hazard-detail-title")?.focus({ preventScroll: true });
    }
    onSelect?.(source === "list");
  }

  closeButton.addEventListener("click", () => select(null));
  card.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    select(null);
  });

  loader.subscribe((state) => {
    loaderState = state;
    if (state.data !== normalizedFrom) {
      normalizedFrom = state.data;
      dataVersion += 1;
      normalized = state.data ? normalizeMapData(state.data) : { items: [], sources: [] };
    }
    refresh();
  });
  map.onViewportChange(({ bbox, zoom }) => loader.request(bbox, zoom));
  map.onLayersChange(refresh);
  const timer = setInterval(() => {
    if (!mock && loaderState.status === "ok") loader.retry();
    refresh();
  }, REFRESH_MS);
  refresh();

  return {
    panel: panel.element,
    card,
    select,
    getVisibleItems: () => map.isLayerVisible("hazards") ? applyFilter(normalized.items, filter, new Date()) : [],
    closeDetail() {
      if (!selectedId) return false;
      select(null);
      return true;
    },
    dispose() {
      clearInterval(timer);
      loader.dispose();
    },
  };
}
