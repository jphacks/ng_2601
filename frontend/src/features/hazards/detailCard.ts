import { el } from "../../ui/dom";
import { icon } from "../../ui/icon";
import { CATEGORY_LABEL, INFO_CLASS_LABEL } from "./catalog";
import { evaluateItem, formatStamp, type Freshness } from "./freshness";
import type { RoadInfoItem } from "./types";

const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

export function scheduleText(schedule: NonNullable<RoadInfoItem["schedule"]>): string {
  const days = schedule.days?.length ? schedule.days.map((d) => DAY_LABELS[d] ?? "?").join("・") : "毎日";
  const time = schedule.start && schedule.end ? ` ${schedule.start}〜${schedule.end}` : "";
  return `${days}${time}`;
}

function badge(label: string, modifier: string): HTMLElement {
  return el("span", { className: `hazard-badge hazard-badge--${modifier}`, text: label });
}

export function stateBadges(item: RoadInfoItem, freshness: Freshness): HTMLElement[] {
  const badges: HTMLElement[] = [];
  if (freshness.validity === "expired") badges.push(badge("期限切れ", "stale"));
  if (freshness.validity === "inactive") {
    badges.push(badge(item.status === "withdrawn" ? "取り下げ" : item.status === "expired" ? "期限切れ" : "解消済み", "stale"));
  }
  if (freshness.unverified) badges.push(badge("未確認", "unverified"));
  return badges;
}

function infoClassIcon(item: RoadInfoItem): HTMLElement {
  const label = `${CATEGORY_LABEL[item.category]} · ${INFO_CLASS_LABEL[item.infoClass]}`;
  const wrap = el("span", { className: "hazard-detail__class" }, [icon("person")]);
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", label);
  wrap.title = label;
  return wrap;
}

function enforcementBadge(enforcement: NonNullable<RoadInfoItem["enforcement"]>): HTMLElement {
  const label = enforcement === "block" ? "通行止め" : "注意";
  return el("span", { className: `hazard-badge hazard-badge--${enforcement}` }, [icon(enforcement === "block" ? "ban" : "warning"), el("span", { text: label })]);
}

/** 詳細カードの中身。全て textContent で組み立て、提供元の文字列をHTMLとして解釈しない。 */
export function renderDetailContent(item: RoadInfoItem, now: Date): HTMLElement {
  const freshness = evaluateItem(item, now);
  const root = el("div", { className: `hazard-detail hazard-detail--${item.category}` });

  const title = el("h3", { className: "hazard-detail__title", text: item.title });
  title.id = "hazard-detail-title";
  title.tabIndex = -1;
  const source = item.infoClass === "community" ? "ユーザー" : (item.source.authority ?? item.source.name);
  const meta = el("p", { className: "hazard-detail__meta" }, [infoClassIcon(item)]);
  const metaText = [source, item.updatedAt.state === "known" ? `${formatStamp(item.updatedAt)} 更新` : undefined].filter(Boolean).join(" · ");
  if (metaText) meta.append(el("span", { text: metaText }));
  const heading = el("div", { className: "hazard-detail__heading" }, [title, meta]);
  root.append(el("header", { className: "hazard-detail__header" }, [heading]));

  const badges = stateBadges(item, freshness);
  if (item.enforcement) badges.unshift(enforcementBadge(item.enforcement));
  if (badges.length > 0) root.append(el("div", { className: "hazard-detail__badges" }, badges));
  if (item.description) root.append(el("p", { className: "hazard-detail__description", text: item.description }));

  const when = [
    item.schedule ? scheduleText(item.schedule) : undefined,
    item.expiresAt.state === "known" ? `${formatStamp(item.expiresAt)} まで` : undefined,
  ].filter(Boolean).join(" · ");
  if (when) root.append(el("p", { className: "hazard-detail__when", text: when }));

  // 更新日時の不明・欠測、開始前の予定などの注意は、バッジやメタ情報に出ないのでここで必ず見せる。
  if (freshness.cautions.length > 0) {
    const cautions = el("ul", { className: "hazard-detail__cautions" });
    for (const c of freshness.cautions) cautions.append(el("li", { text: c }));
    root.append(cautions);
  }

  if (item.notes.length > 0) {
    const notes = el("ul", { className: "hazard-detail__notes" });
    for (const n of item.notes) notes.append(el("li", { text: n }));
    root.append(notes);
  }
  return root;
}
