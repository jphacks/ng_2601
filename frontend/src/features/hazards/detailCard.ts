import { el } from "../../ui/dom";
import { CATEGORY_LABEL, INFO_CLASS_LABEL } from "./catalog";
import { evaluateItem, formatStamp, type Freshness } from "./freshness";
import type { RoadInfoItem } from "./types";

const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];
const TEMPORALITY_LABEL = { permanent: "恒常", scheduled: "時間帯限定", temporary: "期間限定" } as const;

export function scheduleText(schedule: NonNullable<RoadInfoItem["schedule"]>): string {
  const days = schedule.days?.length ? schedule.days.map((d) => DAY_LABELS[d] ?? "?").join("・") : "毎日";
  const time = schedule.start && schedule.end ? ` ${schedule.start}〜${schedule.end}` : "";
  return `${days}${time}`;
}

/** 有効期限の表示。期限なし（恒常）・不明・欠測を取り違えない。 */
export function expiryText(item: RoadInfoItem, freshness: Freshness): string {
  if (item.expiresAt.state === "known") {
    return freshness.validity === "expired" ? `${formatStamp(item.expiresAt)}（期限切れ）` : formatStamp(item.expiresAt);
  }
  if (item.temporality !== "temporary" && item.expiresAt.state === "missing") {
    return item.temporality === "scheduled" ? "なし（時間帯で繰り返し）" : "なし（恒常）";
  }
  return formatStamp(item.expiresAt);
}

function badge(label: string, modifier: string): HTMLElement {
  return el("span", { className: `hazard-badge hazard-badge--${modifier}`, text: label });
}

export function stateBadges(item: RoadInfoItem, freshness: Freshness): HTMLElement[] {
  const badges: HTMLElement[] = [];
  if (freshness.validity === "expired") badges.push(badge("期限切れ", "stale"));
  if (freshness.validity === "upcoming") badges.push(badge("開始前", "stale"));
  if (freshness.validity === "inactive") {
    badges.push(badge(item.status === "withdrawn" ? "取り下げ" : item.status === "expired" ? "期限切れ" : "解消済み", "stale"));
  }
  if (freshness.unverified) badges.push(badge("未確認", "unverified"));
  if (freshness.updated === "unknown") badges.push(badge("更新日時不明", "unknown"));
  if (freshness.updated === "missing") badges.push(badge("更新日時欠測", "unknown"));
  return badges;
}

function row(term: string, value: string, modifier?: string): HTMLElement[] {
  const dd = el("dd", { text: value });
  if (modifier) dd.className = `hazard-detail__value--${modifier}`;
  return [el("dt", { text: term }), dd];
}

/** 詳細カードの中身。全て textContent で組み立て、提供元の文字列をHTMLとして解釈しない。 */
export function renderDetailContent(item: RoadInfoItem, now: Date): HTMLElement {
  const freshness = evaluateItem(item, now);
  const root = el("div", { className: `hazard-detail hazard-detail--${item.category}` });

  const icon = el("span", { className: "hazard-detail__icon" }, [el("span", { className: `hazard-swatch hazard-swatch--${item.category}` })]);
  icon.setAttribute("aria-hidden", "true");
  const eyebrow = [CATEGORY_LABEL[item.category], INFO_CLASS_LABEL[item.infoClass], TEMPORALITY_LABEL[item.temporality]].join(" · ");
  const title = el("h3", { className: "hazard-detail__title", text: item.title });
  title.id = "hazard-detail-title";
  title.tabIndex = -1;
  const heading = el("div", { className: "hazard-detail__heading" }, [el("p", { className: "hazard-detail__eyebrow", text: eyebrow }), title]);
  if (item.kindLabel !== item.title) heading.append(el("p", { className: "hazard-detail__kind", text: item.kindLabel }));
  root.append(el("header", { className: "hazard-detail__header" }, [icon, heading]));

  const badges = stateBadges(item, freshness);
  if (badges.length > 0) root.append(el("div", { className: "hazard-detail__badges" }, badges));
  if (item.description) root.append(el("p", { className: "hazard-detail__description", text: item.description }));

  const cautions = [...freshness.cautions, ...item.notes];
  if (cautions.length > 0) {
    const list = el("ul", { className: "hazard-detail__cautions" });
    for (const c of cautions) list.append(el("li", { text: c }));
    list.setAttribute("role", "note");
    root.append(list);
  }

  const source = [item.source.name, item.source.authority].filter(Boolean);
  const dl = el("dl", { className: "hazard-detail__facts" });
  dl.append(...row("情報源", source.length > 0 ? [...new Set(source)].join(" / ") : "不明"));
  dl.append(...row("更新日時", formatStamp(item.updatedAt), freshness.updated === "known" ? undefined : "gap"));
  if (item.retrievedAt.state !== "missing") dl.append(...row("取得日時", formatStamp(item.retrievedAt)));
  dl.append(...row("有効期限", expiryText(item, freshness), freshness.validity === "expired" ? "stale" : undefined));
  if (item.startsAt.state === "known") dl.append(...row("開始日時", formatStamp(item.startsAt)));
  if (item.schedule) dl.append(...row("有効な時間帯", scheduleText(item.schedule)));
  root.append(dl);
  return root;
}
