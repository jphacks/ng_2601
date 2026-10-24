export const UNKNOWN = "不明";
const valid = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

export function formatDistance(m: number): string {
  if (!valid(m) || m < 0) return UNKNOWN;
  return m < 999.5 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

export function formatElevation(m: number | null): string {
  return valid(m) ? `${Number(m.toFixed(1)).toFixed(1)} m` : UNKNOWN;
}

export function formatGrade(percent: number | null): string {
  if (!valid(percent)) return UNKNOWN;
  const rounded = Number(percent.toFixed(1));
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(1)} %`;
}

export function formatDuration(sec: number): string {
  if (!valid(sec) || sec < 0) return UNKNOWN;
  const minutes = Math.max(1, Math.round(sec / 60));
  return minutes < 60 ? `${minutes} 分` : `${Math.floor(minutes / 60)} 時間 ${minutes % 60} 分`;
}
