import type {
  BBox,
  Hazard,
  MapDataResponse,
  Preferences,
  Review,
  Route,
  RouteSearchRequest,
} from "../types/api";

/** モックと実APIが共通で実装するインターフェース。画面はこれだけに依存する。 */
export interface ApiClient {
  searchRoutes(req: RouteSearchRequest): Promise<Route[]>;
  getRoute(id: string): Promise<Route>;
  listHazards(routeId?: string): Promise<Hazard[]>;
  /** 表示領域の道路・危険情報（GET /v1/map-data）。信号が中断されたら AbortError を投げる。 */
  getMapData(bbox: BBox, opts?: MapDataOptions): Promise<MapDataResponse>;
  listReviews(params?: { routeId?: string; hazardId?: string }): Promise<Review[]>;
  getPreferences(): Promise<Preferences>;
  updatePreferences(p: Preferences): Promise<Preferences>;
}

export interface MapDataOptions {
  /** observations の最大件数（BE: 1〜500、既定200）。 */
  limit?: number;
  signal?: AbortSignal;
}
