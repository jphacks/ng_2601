import { el } from "../../ui/dom";
import { CATEGORY_DEFS } from "../hazards/catalog";
import { LAYER_DEFS, type MapController } from "./map";

const GRADIENT_LEGEND = [
  { className: "gradient-uphill", text: "上り（勾配 +）" },
  { className: "gradient-flat", text: "平坦（0%）" },
  { className: "gradient-downhill", text: "下り（勾配 −）" },
  { className: "gradient-unknown", text: "勾配不明（欠測または100m窓なし）" },
] as const;

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
      legendItem("legend__swatch--line-dotted", "期限切れ・解消済み・開始前（点線・薄い表示）", " legend__item--sub"),
    ];
  }

  function refresh(): void {
    const items: HTMLElement[] = [];
    for (const def of LAYER_DEFS.filter((d) => controller.isLayerVisible(d.id))) {
      if (def.id === "routes") {
        items.push(...GRADIENT_LEGEND.map((item) => legendItem(`legend__swatch--line legend__swatch--${item.className}`, item.text)));
        const thinLine = el("span", { className: "legend__width-key legend__width-key--thin" });
        const thickLine = el("span", { className: "legend__width-key legend__width-key--thick" });
        thinLine.setAttribute("aria-hidden", "true");
        thickLine.setAttribute("aria-hidden", "true");
        const widthKey = el("li", { className: "legend__item legend__item--grade-width" }, [
          thinLine,
          el("span", { text: "小" }),
          thickLine,
          el("span", { text: "大" }),
          el("span", { text: "勾配の大きさ（100m平均）" }),
        ]);
        widthKey.setAttribute("aria-label", "線が太いほど勾配の大きさが大きい表示です");
        items.push(widthKey);
        items.push(el("li", {
          className: "legend__item legend__note",
          text: "灰色の破線は欠測または連続した100mの勾配データがない区間です。0%として扱いません。",
        }));
        items.push(el("li", {
          className: "legend__item legend__note",
          text: "地図上の区間を選ぶと、対応する100m平均勾配を数値で確認できます。",
        }));
        continue;
      }
      const swatch = el("span", { className: `legend__swatch legend__swatch--${def.legend.shape} legend__swatch--${def.legend.cssClass}` });
      swatch.setAttribute("aria-hidden", "true");
      items.push(el("li", { className: "legend__item" }, [swatch, el("span", { text: def.legend.text })]));
      if (def.id === "hazards") items.push(...hazardLegend());
    }
    legendList.replaceChildren(...items);
    for (const def of LAYER_DEFS) checks.get(def.id)!.checked = controller.isLayerVisible(def.id);
  }
  controller.onLayersChange(refresh);
  refresh();

  return el("div", { className: "layer-panel" }, [fieldset, legend]);
}
