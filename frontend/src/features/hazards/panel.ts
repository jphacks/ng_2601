import type { MapDataState } from "../../api/mapDataLoader";
import { el } from "../../ui/dom";
import { renderState } from "../../ui/state";
import { CATEGORY_DEFS, INFO_CLASS_DEFS, ORIGIN_LABEL } from "./catalog";
import { stateBadges } from "./detailCard";
import { evaluateItem, formatStamp } from "./freshness";
import type { HazardFilter, TemporalityFilter } from "./filter";
import type { InfoClass, RoadCategory, RoadInfoItem, SourceAvailability } from "./types";
import "./hazards.css";

export interface PanelModel {
  loader: MapDataState;
  visible: readonly RoadInfoItem[];
  sources: readonly SourceAvailability[];
  counts: Record<RoadCategory, number>;
  now: Date;
  /** 地図レイヤー「道路・危険情報」のON/OFF。 */
  layerVisible: boolean;
  /** モックデータ表示中は、実際の道路状況ではないことを明示する。 */
  mock: boolean;
  limit: number;
}

export interface PanelActions {
  /** filter を書き換えたあとに呼ぶ。 */
  onFilterChange(): void;
  onSelect(id: string): void;
  onRetry(): void;
  onShowLayer(): void;
}

export interface PanelView {
  element: HTMLElement;
  update(model: PanelModel): void;
  setSelected(id: string | null): void;
}

const TEMPORALITY_OPTIONS: ReadonlyArray<{ id: TemporalityFilter; label: string }> = [
  { id: "all", label: "すべて" },
  { id: "temporary", label: "期間限定" },
  { id: "permanent", label: "恒常" },
];

function checkbox(label: Node[], checked: boolean, onChange: (checked: boolean) => void): { label: HTMLLabelElement; input: HTMLInputElement } {
  const input = el("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  return { label: el("label", { className: "hazard-panel__check" }, [input, ...label]), input };
}

function swatch(category: RoadCategory): HTMLElement {
  const s = el("span", { className: `hazard-swatch hazard-swatch--${category}` });
  s.setAttribute("aria-hidden", "true");
  return s;
}

function fieldset(legend: string, className = ""): HTMLFieldSetElement {
  const f = el("fieldset", { className: `hazard-panel__group ${className}`.trim() });
  f.append(el("legend", { className: "hazard-panel__legend", text: legend }));
  return f;
}

/** 「道路情報」タブ。フィルタの入力要素は作り直さず、件数・状態・一覧だけを更新してフォーカスを保つ。 */
export function renderHazardPanel(filter: HazardFilter, actions: PanelActions): PanelView {
  let selectedId: string | null = null;

  const mockNote = el("p", {
    className: "hazard-panel__mock",
    text: "表示中はモックデータです。実際の道路状況ではなく、安全を保証するものでもありません。",
  });
  const layerNote = el("div", { className: "hazard-panel__notice" }, [
    el("p", { text: "地図レイヤー「道路・危険情報」がOFFのため、地図には表示されません。" }),
  ]);
  const showLayer = el("button", { className: "hazard-panel__link", text: "地図に表示する" });
  showLayer.type = "button";
  showLayer.addEventListener("click", actions.onShowLayer);
  layerNote.append(showLayer);

  // --- filters (persistent) ---------------------------------------------
  const categoryGroup = fieldset("カテゴリ");
  const countLabels = new Map<RoadCategory, HTMLElement>();
  const categoryChecks = new Map<RoadCategory, HTMLInputElement>();
  for (const def of CATEGORY_DEFS) {
    const count = el("span", { className: "hazard-panel__count" });
    countLabels.set(def.id, count);
    const c = checkbox([swatch(def.id), el("span", { className: "hazard-panel__check-text", text: def.label }), count], filter.categories.has(def.id), (on) => {
      if (on) filter.categories.add(def.id);
      else filter.categories.delete(def.id);
      actions.onFilterChange();
    });
    categoryChecks.set(def.id, c.input);
    categoryGroup.append(c.label);
  }

  const classGroup = fieldset("情報区分");
  for (const def of INFO_CLASS_DEFS) {
    const c = checkbox([el("span", { className: "hazard-panel__check-text", text: def.label })], filter.infoClasses.has(def.id as InfoClass), (on) => {
      if (on) filter.infoClasses.add(def.id);
      else filter.infoClasses.delete(def.id);
      actions.onFilterChange();
    });
    classGroup.append(c.label);
  }

  const temporalityGroup = fieldset("有効期間", "hazard-panel__group--inline");
  for (const opt of TEMPORALITY_OPTIONS) {
    const input = el("input");
    input.type = "radio";
    input.name = "hazard-temporality";
    input.checked = filter.temporality === opt.id;
    input.addEventListener("change", () => {
      if (!input.checked) return;
      filter.temporality = opt.id;
      actions.onFilterChange();
    });
    temporalityGroup.append(el("label", { className: "hazard-panel__check" }, [input, el("span", { className: "hazard-panel__check-text", text: opt.label })]));
  }

  const stale = checkbox([el("span", { className: "hazard-panel__check-text", text: "期限切れ・解消済み・未確認を隠す" })], filter.hideStale, (on) => {
    filter.hideStale = on;
    actions.onFilterChange();
  });

  // --- dynamic parts ----------------------------------------------------
  const status = el("div", { className: "hazard-panel__status" });
  const sources = el("details", { className: "hazard-panel__sources" });
  const listTitle = el("h3", { className: "hazard-panel__list-title" });
  const list = el("ul", { className: "hazard-panel__list" });

  function renderStatus(model: PanelModel): void {
    const { loader } = model;
    const nodes: HTMLElement[] = [];
    if (loader.status === "loading") nodes.push(renderState({ kind: "loading", message: "道路情報を読み込み中…" }));
    if (loader.status === "error") {
      nodes.push(renderState({ kind: "error", message: `道路情報を取得できませんでした（${loader.error?.message ?? "不明なエラー"}）`, onRetry: actions.onRetry }));
    }
    if (loader.status === "idle" && loader.reason === "zoom") {
      nodes.push(renderState({ kind: "empty", message: "地図を拡大すると道路情報を取得します。" }));
    }
    if (loader.truncated) {
      const warn = el("p", { className: "hazard-panel__warn", text: `ユーザー報告が上限（${model.limit}件）に達したため、一部しか表示されていない可能性があります。地図を拡大してください。` });
      warn.setAttribute("role", "status");
      nodes.push(warn);
    }
    status.replaceChildren(...nodes);
  }

  function renderSources(model: PanelModel): void {
    const summary = el("summary", { text: "情報の提供状況" });
    const items = model.sources.map((s) => {
      const parts = [s.label, s.enabled ? "提供あり" : "提供なし（未提供）"];
      if (s.enabled && s.retrievedAt.state !== "missing") parts.push(`取得: ${formatStamp(s.retrievedAt)}`);
      const li = el("li", { text: parts.join(" ／ ") });
      if (!s.enabled) li.className = "hazard-panel__source--off";
      return li;
    });
    const note = el("p", { className: "hazard-panel__hint", text: "「提供なし」の情報は、該当がないのではなく、データがないことを示します。" });
    sources.replaceChildren(summary, el("ul", {}, items), note);
    sources.hidden = model.sources.length === 0;
  }

  function renderList(model: PanelModel): void {
    const active = document.activeElement;
    const focusedId = active instanceof HTMLElement && list.contains(active) ? active.dataset.id : undefined;
    listTitle.textContent = `表示中の情報（${model.visible.length}件）`;
    if (model.visible.length === 0) {
      const ready = model.loader.status === "ok";
      list.replaceChildren(
        el("li", { className: "hazard-panel__empty", text: ready ? "条件に合う情報はありません。該当がないことは安全を意味しません。" : "" }),
      );
      return;
    }
    list.replaceChildren(
      ...model.visible.map((item) => {
        const f = evaluateItem(item, model.now);
        const button = el("button", { className: `hazard-panel__item${f.stale ? " is-stale" : ""}` });
        button.type = "button";
        button.dataset.id = item.id;
        if (item.id === selectedId) button.setAttribute("aria-current", "true");
        button.addEventListener("click", () => actions.onSelect(item.id));
        button.append(
          swatch(item.category),
          el("span", { className: "hazard-panel__item-body" }, [
            el("span", { className: "hazard-panel__item-title", text: item.title }),
            el("span", { className: "hazard-panel__item-sub", text: `${item.kindLabel} ・ ${ORIGIN_LABEL[item.origin]}` }),
            el("span", { className: "hazard-panel__item-badges" }, stateBadges(item, f)),
          ]),
        );
        return el("li", {}, [button]);
      }),
    );
    if (focusedId) list.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusedId)}"]`)?.focus();
  }

  const element = el("div", { className: "hazard-panel" }, [
    mockNote,
    layerNote,
    categoryGroup,
    classGroup,
    temporalityGroup,
    stale.label,
    status,
    sources,
    listTitle,
    list,
  ]);

  return {
    element,
    update(model) {
      mockNote.hidden = !model.mock;
      layerNote.hidden = model.layerVisible;
      for (const def of CATEGORY_DEFS) {
        const label = countLabels.get(def.id)!;
        label.textContent = model.loader.status === "ok" ? `${model.counts[def.id]}件` : "";
        categoryChecks.get(def.id)!.checked = filter.categories.has(def.id);
      }
      renderStatus(model);
      renderSources(model);
      renderList(model);
    },
    setSelected(id) {
      selectedId = id;
      for (const b of list.querySelectorAll<HTMLElement>("[data-id]")) {
        if (b.dataset.id === id) b.setAttribute("aria-current", "true");
        else b.removeAttribute("aria-current");
      }
    },
  };
}
