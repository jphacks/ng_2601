import type {
  BBox,
  Hazard,
  MapDataResponse,
  Review,
  ReviewDraft,
  Route,
  RouteConditions,
  RouteSearchRequest,
  RoutingOptions,
} from "../types/api";

/** モックと実APIが共通で実装するインターフェース。画面はこれだけに依存する。 */
export interface ApiClient {
  /** 単一ルートを返す。ルートが無い場合は code `no_route` の ApiError。 */
  searchRoute(req: RouteSearchRequest): Promise<Route>;
  getRoute(id: string): Promise<Route>;
  listHazards(routeId?: string): Promise<Hazard[]>;
  /** 表示領域の道路・危険情報（GET /v1/map-data）。信号が中断されたら AbortError を投げる。 */
  getMapData(bbox: BBox, opts?: MapDataOptions): Promise<MapDataResponse>;
  /** bbox 内の口コミ。省略時は全域。 */
  listReviews(params?: { bbox?: BBox }): Promise<Review[]>;
  /** 口コミを投稿し、作成された口コミを返す。 */
  createReview(draft: ReviewDraft): Promise<Review>;
  /** 車種・各条件の選択肢と、車種ごとの初期値。 */
  getRoutingOptions(): Promise<RoutingOptions>;
  /** 保存済みの車種・条件。未ログインなどで取得できない場合は code `unauthorized` の ApiError。 */
  getPreferences(): Promise<RouteConditions>;
  /** 車種・条件を保存し、保存後にサーバーから再取得した値を返す。 */
  updatePreferences(p: RouteConditions): Promise<RouteConditions>;
}

export interface MapDataOptions {
  /** observations の最大件数（BE: 1〜500、既定200）。 */
  limit?: number;
  signal?: AbortSignal;
}
