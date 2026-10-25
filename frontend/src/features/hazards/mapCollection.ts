import type { FeatureCollection, Geometry } from "geojson";
import { evaluateItem, type Freshness } from "./freshness";
import type { RoadCategory, RoadInfoItem } from "./types";

/** 地図上の見た目の状態。色以外（破線・不透明度）でも区別する。 */
export type VisualState = "current" | "unverified" | "stale";

export interface RoadInfoFeatureProps {
  id: string;
  category: RoadCategory;
  state: VisualState;
}

export function visualState(f: Freshness): VisualState {
  if (f.stale) return "stale";
  if (f.unverified) return "unverified";
  return "current";
}

export function buildRoadInfoCollection(
  items: readonly RoadInfoItem[],
  now: Date,
): FeatureCollection<Geometry, RoadInfoFeatureProps> {
  return {
    type: "FeatureCollection",
    features: items.map((item) => ({
      type: "Feature",
      geometry: item.geometry,
      properties: { id: item.id, category: item.category, state: visualState(evaluateItem(item, now)) },
    })),
  };
}
