import type {
  Hazard,
  Preferences,
  Review,
  Route,
  RouteSearchRequest,
} from "../types/api";

/** モックと実APIが共通で実装するインターフェース。画面はこれだけに依存する。 */
export interface ApiClient {
  /** 単一ルートを返す。ルートが無い場合は code `no_route` の ApiError。 */
  searchRoute(req: RouteSearchRequest): Promise<Route>;
  getRoute(id: string): Promise<Route>;
  listHazards(routeId?: string): Promise<Hazard[]>;
  listReviews(params?: { routeId?: string; hazardId?: string }): Promise<Review[]>;
  getPreferences(): Promise<Preferences>;
  updatePreferences(p: Preferences): Promise<Preferences>;
}
