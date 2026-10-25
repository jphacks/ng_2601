import "./preferences.css";
import type { BikeType, PreferenceModes, RoutingOptions } from "../../types/api";
import { el } from "../../ui/dom";
import { renderState } from "../../ui/state";
import type { RouteStore } from "../route/routeState";
import { BIKE_TYPE_ICONS } from "./bikeIcons";
import { BIKE_TYPE_ORDER, DETAIL_MODE_KEYS, MODE_META, bikeTypeLabel, modeLabel } from "./labels";
import { defaultsFor, isUnsaved, type PreferencesState, type PreferencesStore } from "./preferencesState";

function textButton(label: string, className: string): HTMLButtonElement {
  const b = el("button", { className, text: label });
  b.type = "button";
  return b;
}

/** 選択肢ごとのラジオ。ラベル全体がタップ領域で、ラジオ本体は見えなくするがキーボード操作は残す。 */
function segments<T extends string>(
  name: string,
  values: readonly T[],
  label: (v: T) => string,
  onChange: (v: T) => void,
  iconOf?: (v: T) => string,
): { root: HTMLElement; inputs: Map<T, HTMLInputElement> } {
  const inputs = new Map<T, HTMLInputElement>();
  const root = el("div", { className: "route__segments pref__segments" });
  for (const v of values) {
    const input = el("input");
    input.type = "radio";
    input.name = name;
    input.value = v;
    input.addEventListener("change", () => {
      if (input.checked) onChange(v);
    });
    inputs.set(v, input);
    const content = el("span", { text: label(v) });
    if (iconOf) {
      input.setAttribute("aria-label", label(v));
      content.className = "pref__icon";
      content.innerHTML = iconOf(v);
      content.setAttribute("aria-hidden", "true");
    }
    const option = el("label", { className: "route__segment" }, [input, content]);
    if (iconOf) option.title = label(v);
    root.append(option);
  }
  return { root, inputs };
}

interface Controls {
  node: HTMLElement;
  sync(state: PreferencesState): void;
}

/**
 * 車種・坂道許容度・詳細パラメータの編集パネル(#10)。
 * 値の編集は routeStore の draft に反映するだけで、「この条件で再検索」を押すまで経路の結果は変わらない(#6)。
 * 再検索ボタンは経路ビュー側（パネル下部）に、保存は「設定」タブ（renderPreferencesSave）に置く。
 */
export function renderPreferences(routeStore: RouteStore, prefs: PreferencesStore): HTMLElement {
  const body = el("div", { className: "pref__body" });
  const root = el("section", { className: "pref" }, [body]);
  root.setAttribute("aria-label", "車種と走り方の設定");

  /** 選択肢を取得できたときだけ作る部分。取得し直したら作り直す。 */
  let controls: Controls | null = null;
  let builtFor: RoutingOptions | null = null;

  function buildControls(options: RoutingOptions): Controls {
    // --- 車種 ---
    const bikes = BIKE_TYPE_ORDER.filter((b) => options.bikeTypes[b]);
    const bike = segments<BikeType>(
      "pref-bike-type",
      bikes,
      bikeTypeLabel,
      (b) => prefs.selectBike(b),
      (b) => BIKE_TYPE_ICONS[b],
    );
    bike.root.classList.add("pref__bikes");
    // 選んだ車種名は各ラジオの aria-label で読み上げられるので、見出し横の表示は読み上げない。
    const bikeCurrent = el("span", { className: "pref__current" });
    bikeCurrent.setAttribute("aria-hidden", "true");
    const bikeSet = el("fieldset", { className: "route__fieldset" }, [
      el("legend", { className: "route__field-label pref__head" }, [el("span", { text: "自転車の種類" }), bikeCurrent]),
      bike.root,
    ]);

    // --- 坂道許容度（BEの段階の順に並べたスライダー） ---
    const hillValues = options.modes.hillMode;
    const slider = el("input", { className: "pref__slider" });
    slider.type = "range";
    slider.id = "pref-hill-mode";
    slider.min = "0";
    slider.max = String(hillValues.length - 1);
    slider.step = "1";
    slider.addEventListener("input", () => {
      const v = hillValues[Number(slider.value)];
      if (v) routeStore.setDraft({ hillMode: v });
    });
    const hillLabel = el("label", { className: "route__field-label", text: MODE_META.hillMode.title });
    hillLabel.htmlFor = slider.id;
    const hillCurrent = el("span", { className: "pref__current" });
    const hillRange = el("div", { className: "pref__range-ends" }, [
      el("span", { text: "坂道を避ける" }),
      el("span", { text: "坂道を許容する" }),
    ]);
    hillRange.setAttribute("aria-hidden", "true");
    const hillField = el("div", { className: "route__field" }, [
      el("div", { className: "pref__head" }, [hillLabel, hillCurrent]),
      hillRange,
      slider,
    ]);

    // --- 詳細パラメータ（折りたたみ） ---
    const detailSets = new Map<(typeof DETAIL_MODE_KEYS)[number], Map<string, HTMLInputElement>>();
    const details = el("details", { className: "pref__advanced" });
    details.append(el("summary", { className: "pref__summary", text: "詳細パラメータ" }));
    const detailBody = el("div", { className: "pref__advanced-body" });
    for (const key of DETAIL_MODE_KEYS) {
      const values: readonly string[] = options.modes[key];
      const seg = segments<string>(
        `pref-${key}`,
        values,
        (v) => (MODE_META[key].labels as Record<string, string>)[v] ?? v,
        (v) => routeStore.setDraft({ [key]: v }),
      );
      detailSets.set(key, seg.inputs);
      detailBody.append(
        el("fieldset", { className: "route__fieldset" }, [
          el("legend", { className: "route__field-label", text: MODE_META[key].title }),
          seg.root,
        ]),
      );
    }
    const reset = textButton("坂道・詳細を初期値に戻す", "route__button pref__reset");
    reset.addEventListener("click", () => prefs.resetToDefaults());
    detailBody.append(reset);
    details.append(detailBody);

    const node = el("div", { className: "pref__controls" }, [bikeSet, hillField, details]);

    function sync(state: PreferencesState): void {
      const { draft, status } = routeStore.getState();
      const busy = status.kind === "loading";
      for (const [b, input] of bike.inputs) {
        input.checked = b === draft.bikeType;
        input.disabled = busy;
      }
      bikeCurrent.textContent = bikeTypeLabel(draft.bikeType);
      slider.value = String(Math.max(hillValues.indexOf(draft.hillMode), 0));
      slider.disabled = busy;
      const hillText = modeLabel("hillMode", draft.hillMode);
      slider.setAttribute("aria-valuetext", `坂道を${hillText}`);
      hillCurrent.textContent = hillText;
      for (const [key, inputs] of detailSets) {
        for (const [v, input] of inputs) {
          input.checked = v === draft[key];
          input.disabled = busy;
        }
      }
      const defaults = defaultsFor(state, draft.bikeType);
      reset.disabled =
        busy ||
        defaults === null ||
        (Object.keys(defaults) as Array<keyof PreferenceModes>).every((k) => defaults[k] === draft[k]);
    }
    return { node, sync };
  }

  function sync(): void {
    const state = prefs.getState();
    const { options } = state;
    if (options.kind !== "ready") {
      controls = null;
      builtFor = null;
      body.replaceChildren(
        options.kind === "loading"
          ? renderState({ kind: "loading", message: "設定を読み込み中…" })
          : renderState({
              kind: "error",
              message: `設定の選択肢を取得できませんでした。（${options.message}）`,
              onRetry: () => void prefs.load(),
            }),
      );
      return;
    }
    if (!controls || builtFor !== options.options) {
      controls = buildControls(options.options);
      builtFor = options.options;
      body.replaceChildren(controls.node);
    }
    controls.sync(state);
  }

  routeStore.subscribe(sync);
  prefs.subscribe(sync);
  sync();
  return root;
}

/** 「設定」タブ。経路ビューで選んでいる車種・坂道許容度を次回からの初期値として保存する。 */
export function renderPreferencesSave(routeStore: RouteStore, prefs: PreferencesStore): HTMLElement {
  const current = el("p", { className: "pref__current-summary" });
  const status = el("p", { className: "pref__status" });
  status.setAttribute("role", "status");
  const saveButton = textButton("この設定を保存", "route__button pref__save-button");
  saveButton.addEventListener("click", () => void prefs.save());
  const saveRow = el("div", { className: "pref__save" }, [status, saveButton]);

  /** 保存状態の文言。通信の失敗と、未保存の値が残っていることは必ず伝える。 */
  function saveMessage(state: PreferencesState, unsaved: boolean | null): { text: string; warn: boolean } {
    if (state.save.kind === "saving") return { text: "保存中…", warn: false };
    if (state.save.kind === "error") {
      return { text: `保存に失敗しました。変更はまだ保存されていません。（${state.save.message}）`, warn: true };
    }
    if (unsaved === null) {
      return { text: `保存済みの設定を取得できていません。${state.savedNote ?? ""}`.trim(), warn: true };
    }
    if (unsaved) return { text: "未保存の変更があります。", warn: true };
    return { text: state.save.kind === "saved" ? "保存しました。" : "保存済みの設定と同じです。", warn: false };
  }

  function sync(): void {
    const state = prefs.getState();
    const { draft } = routeStore.getState();
    current.textContent = `いまの条件：${bikeTypeLabel(draft.bikeType)}・坂道 ${modeLabel("hillMode", draft.hillMode)}`;
    const unsaved = isUnsaved(state, draft);
    const msg = saveMessage(state, unsaved);
    status.textContent = msg.text;
    status.classList.toggle("pref__status--warn", msg.warn);
    saveButton.textContent = state.save.kind === "saving" ? "保存中…" : "この設定を保存";
    saveButton.disabled = state.save.kind === "saving" || unsaved === false;
  }

  routeStore.subscribe(sync);
  prefs.subscribe(sync);
  sync();
  return el("section", { className: "pref" }, [
    el("p", { className: "pref__status", text: "「経路」で選んだ車種と坂道許容度を、次回からの初期値として保存します。" }),
    current,
    saveRow,
  ]);
}
