import type { Route } from "../../types/api";
import { GSI_PROVIDER } from "./dem/config";
import { waitForConsumer } from "./dem/async";
import { loadDemTile } from "./dem/loader";
import { createElevationSampler, type ElevationResult } from "./dem/sampler";
import { buildRouteProfile, sampleRoutePoints, type ProfilePoint, type ProfileSummary } from "./profile";

export interface RouteAnalysis {
  points: ProfilePoint[];
  summary: ProfileSummary;
  errorCount: number;
  levelLabels: string[];
  source: "gsi" | "mock";
  spacingM: number;
}

export type ElevationState =
  | { kind: "idle" }
  | { kind: "loading"; done: number; total: number }
  | { kind: "ready"; analysis: RouteAnalysis }
  | { kind: "error"; message: string };

export interface AnalyzeOptions {
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
}
export type RouteAnalyzer = (route: Route, options: AnalyzeOptions) => Promise<RouteAnalysis | null>;

/** 同じ解析経路に合成標高を渡す。モックでは標高タイルに通信しない。 */
export function createRouteAnalyzer(mode: "gsi" | "mock"): RouteAnalyzer {
  return async (route, { signal, onProgress }) => {
    const samples = sampleRoutePoints(route.coordinates);
    if (samples.length < 2) throw new Error("標高を解析できる経路座標がありません。");
    onProgress(0, samples.length);
    let sample = createElevationSampler(GSI_PROVIDER, loadDemTile);
    if (mode === "mock") {
      const scenario = new URLSearchParams(location.search).get("elevation");
      await waitForConsumer(new Promise((resolve) => setTimeout(resolve, scenario === "slow" ? 3000 : 250)), signal);
      if (scenario === "error") throw new Error("標高データを取得できませんでした（モック通信エラー）。");
      const flat = scenario === "flat" || (scenario !== "hill" && route.elevationProfile.totalDescentM === 0);
      let index = 0;
      sample = async (): Promise<ElevationResult> => {
        const i = index++;
        if (scenario === "missing" || (scenario === "partial" && i >= samples.length / 3 && i <= samples.length * 2 / 3)) {
          return { status: "nodata" };
        }
        const t = samples[i].distance / samples[samples.length - 1].distance;
        return { status: "ok", elevation: flat ? 10 : 10 + Math.sin(t * Math.PI) * 25 + t * 5, levelLabel: "合成データ" };
      };
    }
    const result = await buildRouteProfile(route.coordinates, sample, { signal, onProgress, samples });
    if (result.status === "cancelled") return null;
    if (result.status === "invalid") throw new Error("標高を解析できる経路座標がありません。");
    return {
      points: result.points, summary: result.summary, errorCount: result.errorCount,
      levelLabels: result.levelLabels, source: mode,
      spacingM: samples[1].distance - samples[0].distance,
    };
  };
}

export const analyzeRoute = createRouteAnalyzer(import.meta.env.VITE_API_MODE === "http" ? "gsi" : "mock");
