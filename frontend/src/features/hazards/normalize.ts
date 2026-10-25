import type { Feature, Geometry } from "geojson";
import type { MapDataResponse, ObservationProps, RestrictionProps, SourceStatus } from "../../types/api";
import { classifyObservation, ORIGIN_DEFAULTS, ORIGIN_LABEL } from "./catalog";
import { representativePoint } from "./geometry";
import type { ItemStatus, Origin, RoadInfoItem, SourceAvailability, Stamp, Temporality, Verification } from "./types";

// 日付のみ(YYYY-MM-DD)か、オフセット付きの日時(YYYY-MM-DDThh:mm[:ss[.fff]](Z|±hh:mm))。
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

/** 構文と各成分の範囲を確認する。オフセットの無い日時はビューアのタイムゾーンで解釈が変わるため認めない。 */
function isValidTimestamp(value: string): boolean {
  const m = ISO_DATETIME.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return false;
  if (m[4] === undefined) return true;
  if (Number(m[4]) > 23 || Number(m[5]) > 59 || (m[6] !== undefined && Number(m[6]) > 59)) return false;
  const offset = m[7]!;
  return offset === "Z" || (Number(offset.slice(1, 3)) <= 23 && Number(offset.slice(4)) <= 59);
}

/** undefined=欠測、null/空/不正な日時=不明、それ以外=値あり。 */
export function stampOf(value: unknown): Stamp {
  if (value === undefined) return { state: "missing" };
  if (typeof value !== "string" || !isValidTimestamp(value) || Number.isNaN(new Date(value).getTime())) return { state: "unknown" };
  return { state: "known", value };
}

/** 先頭から最初に値のあるものを採用。なければ null が1つでもあれば不明、全て欠落なら欠測。 */
export function firstStamp(...values: unknown[]): Stamp {
  const stamps = values.map(stampOf);
  return stamps.find((s) => s.state === "known") ?? stamps.find((s) => s.state === "unknown") ?? { state: "missing" };
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

type IdMaker = (origin: Origin, raw: string | undefined, geometry: Geometry) => string;

/** 同一提供元内で id が重複・欠落しても地図／一覧／選択で衝突しない ID を作る。 */
function createIdMaker(): IdMaker {
  const seen = new Map<string, number>();
  return (origin, raw, geometry) => {
    const p = representativePoint(geometry);
    const base = `${origin}:${raw ?? (p ? `${p[0].toFixed(5)},${p[1].toFixed(5)}` : "unknown")}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  };
}

function restrictionVerification(confidence: string | null | undefined): Verification {
  if (confidence === "high") return "verified";
  if (confidence === "low") return "unverified";
  return "unknown";
}

function observationTemporality(kind: ObservationProps["temporal_kind"]): Temporality {
  if (kind === "temporary" || kind === "date_range") return "temporary";
  if (kind === "time_of_day") return "scheduled";
  return "permanent";
}

function observationVerification(state: ObservationProps["verification_state"]): Verification {
  if (state === "unverified") return "unverified";
  if (state === "corroborated" || state === "moderated") return "verified";
  return "unknown";
}

const OBSERVATION_STATUSES: readonly string[] = ["active", "resolved", "withdrawn", "expired"];

function normalizeRestriction(feature: Feature<Geometry, RestrictionProps>, makeId: IdMaker): RoadInfoItem | null {
  const geometry = feature.geometry;
  const position = geometry && representativePoint(geometry);
  if (!geometry || !position) return null;
  const p = feature.properties ?? {};
  const scheduled = (p.days?.length ?? 0) > 0 || !!(p.start_time && p.end_time);
  return {
    id: makeId("restriction", text(p.id), geometry),
    origin: "restriction",
    ...ORIGIN_DEFAULTS.restriction,
    kindLabel: ORIGIN_LABEL.restriction,
    title: text(p.name) ?? "交通規制",
    enforcement: p.enforcement === "block" || p.enforcement === "warn" ? p.enforcement : undefined,
    geometry,
    position,
    temporality: scheduled ? "scheduled" : "permanent",
    updatedAt: stampOf(p.observed_at),
    retrievedAt: stampOf(p.retrieved_at),
    // 規制データは開始・有効期限を持たない。BEが取得時刻で絞った結果だけが返る。
    startsAt: { state: "missing" },
    expiresAt: { state: "missing" },
    source: { name: text(p.source), authority: text(p.authority), kind: text(p.source_kind) },
    verification: restrictionVerification(p.confidence),
    schedule: scheduled ? { days: p.days, start: text(p.start_time), end: text(p.end_time) } : undefined,
    notes: [],
  };
}

function normalizeStatistics(
  origin: "accident" | "traffic",
  feature: Feature<Geometry, Record<string, unknown>>,
  status: SourceStatus,
  makeId: IdMaker,
): RoadInfoItem | null {
  const geometry = feature.geometry;
  const position = geometry && representativePoint(geometry);
  if (!geometry || !position) return null;
  const p = feature.properties ?? {};
  const meta = status.metadata ?? {};
  const notes: string[] = [];
  let title: string;
  let description: string | undefined;
  if (origin === "accident") {
    title = p.bicycle_involved === true ? "自転車が関与した事故の発生地点" : "事故の発生地点";
    if (p.fatal_or_serious === true) description = "死亡または重傷事故";
    notes.push("過去に発生した事故の記録であり、現在の危険を示すものではありません。");
    if (meta.window !== undefined && meta.window !== null) notes.push(`集計期間: ${typeof meta.window === "string" ? meta.window : JSON.stringify(meta.window)}`);
  } else {
    title = "交通量の観測地点";
    if (typeof p.vehicle_count === "number") description = `観測された交通量: ${p.vehicle_count}`;
    notes.push("観測時点の交通量であり、現在の混雑を示すものではありません。");
  }
  if (meta.coverage === "partial") notes.push("対象範囲の一部のみのデータです。");
  return {
    id: makeId(origin, text(p.id), geometry),
    origin,
    ...ORIGIN_DEFAULTS[origin],
    kindLabel: ORIGIN_LABEL[origin],
    title,
    description,
    geometry,
    position,
    temporality: "permanent",
    updatedAt: firstStamp(meta.generated_at, meta.retrieved_at),
    retrievedAt: stampOf(meta.retrieved_at),
    startsAt: { state: "missing" },
    expiresAt: { state: "missing" },
    source: { name: text(meta.source), authority: text(meta.authority) },
    verification: "n/a",
    notes,
  };
}

function normalizeObservation(
  feature: Feature<Geometry, ObservationProps>,
  source: { authority: string },
  makeId: IdMaker,
): RoadInfoItem | null {
  const geometry = feature.geometry;
  const position = geometry && representativePoint(geometry);
  if (!geometry || !position) return null;
  const p: Partial<ObservationProps> = feature.properties ?? {};
  const kind = classifyObservation(p.category);
  const status = p.status && OBSERVATION_STATUSES.includes(p.status) ? (p.status as ItemStatus) : undefined;
  return {
    id: makeId("observation", feature.id === undefined ? undefined : text(String(feature.id)), geometry),
    origin: "observation",
    infoClass: ORIGIN_DEFAULTS.observation.infoClass,
    category: kind.category,
    kindLabel: kind.label,
    title: kind.label,
    description: text(p.description),
    geometry,
    position,
    temporality: observationTemporality(p.temporal_kind),
    updatedAt: firstStamp(p.updated_at, p.observed_at),
    retrievedAt: { state: "missing" },
    startsAt: stampOf(p.starts_at),
    expiresAt: firstStamp(p.expires_at, p.ends_at),
    source: { name: "ユーザー報告", authority: source.authority, kind: "community" },
    status,
    verification: observationVerification(p.verification_state),
    notes: [],
  };
}

export interface NormalizedMapData {
  items: RoadInfoItem[];
  sources: SourceAvailability[];
}

function sourceRows(origin: Origin, label: string, status: SourceStatus): SourceAvailability[] {
  const sub = status.sources;
  if (sub && Object.keys(sub).length > 0) {
    return Object.entries(sub).map(([key, s]) => ({
      key: `${origin}:${key}`,
      origin,
      label: `${label}（${s.source_id ?? key}）`,
      enabled: s.enabled,
      featureCount: s.feature_count,
      retrievedAt: firstStamp(s.metadata?.retrieved_at, s.metadata?.generated_at),
    }));
  }
  return [
    {
      key: origin,
      origin,
      label,
      enabled: status.enabled,
      featureCount: status.feature_count,
      retrievedAt: firstStamp(status.metadata?.retrieved_at, status.metadata?.generated_at),
    },
  ];
}

export function normalizeMapData(data: MapDataResponse): NormalizedMapData {
  const items: RoadInfoItem[] = [];
  const makeId = createIdMaker();
  const push = (item: RoadInfoItem | null) => {
    if (item) items.push(item);
  };

  const accidents = data.route_context?.accidents;
  const traffic = data.route_context?.traffic;
  const observations = data.observations;

  for (const f of data.restrictions?.features ?? []) push(normalizeRestriction(f, makeId));
  for (const f of accidents?.features ?? []) push(normalizeStatistics("accident", f, accidents.source_status, makeId));
  for (const f of traffic?.features ?? []) push(normalizeStatistics("traffic", f, traffic.source_status, makeId));
  const observationSource = {
    authority: observations?.source?.authority ?? "community",
  };
  for (const f of observations?.features ?? []) push(normalizeObservation(f, observationSource, makeId));

  const sources: SourceAvailability[] = [];
  if (data.restrictions?.source_status) {
    sources.push(...sourceRows("restriction", ORIGIN_LABEL.restriction, data.restrictions.source_status));
  }
  if (accidents?.source_status) sources.push(...sourceRows("accident", ORIGIN_LABEL.accident, accidents.source_status));
  if (traffic?.source_status) sources.push(...sourceRows("traffic", ORIGIN_LABEL.traffic, traffic.source_status));
  if (observations) {
    sources.push({
      key: "observation",
      origin: "observation",
      label: ORIGIN_LABEL.observation,
      enabled: true,
      retrievedAt: { state: "missing" },
    });
  }
  return { items, sources };
}
