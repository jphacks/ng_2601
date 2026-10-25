import type {
  BikeType,
  PreferenceModes,
  RouteConditions,
  RoutingOptions,
} from "../types/api";
import { ApiError } from "./errors";

/** FEが扱える値。BEが知らない値を返しても、ここに無いものは選択肢から外す。 */
const KNOWN_BIKE_TYPES: readonly BikeType[] = ["city", "electric_assist", "road", "gravel", "mamachari"];
const KNOWN_VALUES: { [K in keyof PreferenceModes]: readonly PreferenceModes[K][] } = {
  hillMode: ["avoid", "balanced", "accept"],
  trafficMode: ["avoid", "balanced", "direct"],
  surfaceMode: ["paved", "comfortable", "rough_ok"],
  walkingMode: ["never", "short", "long"],
};

/** FEのキー(camelCase)とBEのキー(snake_case)の対応。 */
const MODE_KEYS: ReadonlyArray<[keyof PreferenceModes, string]> = [
  ["hillMode", "hill_mode"],
  ["trafficMode", "traffic_mode"],
  ["surfaceMode", "surface_mode"],
  ["walkingMode", "walking_mode"],
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function invalid(message: string): ApiError {
  return new ApiError(502, { code: "invalid_response", message: `設定データの形式が不正です（${message}）` });
}

/** BEの`preferences`オブジェクトをFEの値へ。1つでも欠けていたり未知の値なら不正とする。 */
function readModes(raw: unknown, where: string): PreferenceModes {
  if (!isRecord(raw)) throw invalid(`${where} がありません`);
  const modes: Record<string, string> = {};
  for (const [key, beKey] of MODE_KEYS) {
    const v = raw[beKey];
    if (typeof v !== "string" || !(KNOWN_VALUES[key] as readonly string[]).includes(v)) {
      throw invalid(`${where}.${beKey}`);
    }
    modes[key] = v;
  }
  return modes as unknown as PreferenceModes;
}

const readBikeType = (v: unknown, where: string): BikeType => {
  if (typeof v !== "string" || !(KNOWN_BIKE_TYPES as readonly string[]).includes(v)) throw invalid(where);
  return v as BikeType;
};

/** `GET /v1/routing-options` の応答を RoutingOptions へ。 */
export function fromBackendOptions(body: unknown): RoutingOptions {
  if (!isRecord(body) || !isRecord(body.bike_types) || !isRecord(body.preferences)) {
    throw invalid("bike_types / preferences がありません");
  }
  const bikeTypes: RoutingOptions["bikeTypes"] = {};
  for (const bike of KNOWN_BIKE_TYPES) {
    const entry = body.bike_types[bike];
    if (entry === undefined) continue;
    if (!isRecord(entry)) throw invalid(`bike_types.${bike}`);
    bikeTypes[bike] = { defaults: readModes(entry.defaults, `bike_types.${bike}.defaults`) };
  }
  if (Object.keys(bikeTypes).length === 0) throw invalid("対応する車種がありません");

  const modes = {} as RoutingOptions["modes"];
  for (const [key, beKey] of MODE_KEYS) {
    const values = body.preferences[beKey];
    if (!Array.isArray(values)) throw invalid(`preferences.${beKey}`);
    // BEの並びを保ったまま、FEが扱える値だけ残す。
    const known = values.filter((v): v is string => typeof v === "string" && (KNOWN_VALUES[key] as readonly string[]).includes(v));
    if (known.length === 0) throw invalid(`preferences.${beKey}`);
    (modes as Record<string, string[]>)[key] = known;
  }
  return { bikeTypes, modes };
}

/** `GET /v1/auth/me` の応答から保存済みの車種・経路条件を取り出す。 */
export function fromBackendMe(body: unknown): RouteConditions {
  if (!isRecord(body)) throw invalid("応答がありません");
  return { bikeType: readBikeType(body.bike_type, "bike_type"), ...readModes(body.preferences, "preferences") };
}

/** `PUT /v1/auth/me/preferences` のbody。保存対象は車種と4つの条件すべて。 */
export function toBackendPreferences(p: RouteConditions): Record<string, string> {
  const body: Record<string, string> = { bike_type: p.bikeType };
  for (const [key, beKey] of MODE_KEYS) body[beKey] = p[key];
  return body;
}

/** `POST /v1/routes` の`preferences`。 */
export function toBackendRoutePreferences(p: PreferenceModes): Record<string, string> {
  const body: Record<string, string> = {};
  for (const [key, beKey] of MODE_KEYS) body[beKey] = p[key];
  return body;
}
