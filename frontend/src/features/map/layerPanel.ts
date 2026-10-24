import { el } from "../../ui/dom";
import { CATEGORY_DEFS } from "../hazards/catalog";
import { LAYER_DEFS, type MapController } from "./map";

/** レイヤーON/OFFと、ONのレイヤーだけを示す凡例。 */
export function renderLayerPanel(controller: MapController): HTMLElement {
  const fieldset = el("fieldset", { className: "layer-panel__list" });
  fieldset.append(el("legend", { className: "layer-panel__legend", text: "表示するレイヤー" }));
  const checks = new Map<string, HTMLInputElement>();
  for (const def of LAYER_DEFS) {
    const input = el("input");
    input.type = "checkbox";
    input.checked = controller.isLayerVisible(def.id);
    input.addEventListener("change", () => controller.setLayerVisible(def.id, input.checked));
    checks.set(def.id, input);
    fieldset.append(el("label", { className: "layer-panel__item" }, [input, el("span", { text: def.label })]));
  }

  const legendList = el("ul", { className: "legend__list" });
  const legend = el("section", { className: "legend" }, [el("h3", { className: "legend__title", text: "凡例" }), legendList]);

  function legendItem(swatchClass: string, text: string, extra = ""): HTMLElement {
    const swatch = el("span", { className: `legend__swatch ${swatchClass}` });
    swatch.setAttribute("aria-hidden", "true");
    return el("li", { className: `legend__item${extra}` }, [swatch, el("span", { text })]);
  }

  /** 道路・危険情報の凡例: カテゴリ（色）と状態（線種）。 */
  function hazardLegend(): HTMLElement[] {
    return [
      ...CATEGORY_DEFS.map((c) => legendItem(`legend__swatch--dot legend__swatch--cat-${c.id}`, c.label, " legend__item--sub")),
      legendItem("legend__swatch--line-dashed", "未確認（破線・薄い表示）", " legend__item--sub"),
      legendItem("legend__swatch--line-dotted", "期限切れ・解消済み（点線・薄い表示）", " legend__item--sub"),
    ];
  }

  function refresh(): void {
    legendList.replaceChildren(
      ...LAYER_DEFS.filter((d) => controller.isLayerVisible(d.id)).flatMap((d) => [
        legendItem(`legend__swatch--${d.legend.shape} legend__swatch--${d.legend.cssClass}`, d.legend.text),
        ...(d.id === "hazards" ? hazardLegend() : []),
      ]),
    );
    for (const def of LAYER_DEFS) checks.get(def.id)!.checked = controller.isLayerVisible(def.id);
  }
  controller.onLayersChange(refresh);
  refresh();

  return el("div", { className: "layer-panel" }, [fieldset, legend]);
}
