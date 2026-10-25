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

type ModeKey = keyof PreferenceModes;

/**
 * 段階を左から順に並べたつまみ。つまみの上に各段階の名前を並べ（坂道許容度の両端表示と同じ位置）、見出しの右に現在の値を出す。
 * キーボードでは矢印キーで1段ずつ動かせる。
 */
function stepSlider(
  key: ModeKey,
  values: readonly string[],
  onChange: (key: ModeKey, value: string) => void,
): { node: HTMLElement; sync(draft: PreferenceModes, busy: boolean): void } {
  const title = MODE_META[key].title;
  const slider = el("input", { className: "pref__slider" });
  slider.type = "range";
  slider.id = `pref-${key}`;
  slider.min = "0";
  slider.max = String(Math.max(values.length - 1, 0));
  slider.step = "1";
  slider.addEventListener("input", () => {
    const v = values[Number(slider.value)];
    if (v) onChange(key, v);
  });
  const label = el("label", { className: "route__field-label", text: title });
  label.htmlFor = slider.id;
  const current = el("span", { className: "pref__current" });
  const ticks = el("div", { className: "pref__ticks" });
  ticks.style.setProperty("--steps", String(values.length));
  ticks.setAttribute("aria-hidden", "true");
  for (const v of values) ticks.append(el("span", { text: (MODE_META[key].labels as Record<string, string>)[v] ?? v }));
  const node = el("div", { className: "route__field" }, [
    el("div", { className: "pref__head" }, [label, current]),
    ticks,
    slider,
  ]);
  return {
    node,
    sync(draft, busy) {
      const value = draft[key];
      slider.value = String(Math.max(values.indexOf(value), 0));
      slider.disabled = busy;
      const text = modeLabel(key, value);
      slider.setAttribute("aria-valuetext", `${title}: ${text}`);
      current.textContent = text;
    },
  };
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

    // --- 坂道許容度と詳細パラメータ（BEの段階の順に並べた段階つまみ。詳細は折りたたみ） ---
    const setDraft = (key: ModeKey, value: string) => routeStore.setDraft({ [key]: value });
    const hill = stepSlider("hillMode", options.modes.hillMode, setDraft);
    const detailSliders = DETAIL_MODE_KEYS.map((key) => stepSlider(key, options.modes[key], setDraft));
    const sliders = [hill, ...detailSliders];
    const details = el("details", { className: "pref__advanced" });
    details.append(el("summary", { className: "pref__summary", text: "詳細パラメータ" }));
    const detailBody = el("div", { className: "pref__advanced-body" }, detailSliders.map((s) => s.node));
    const reset = textButton("坂道・詳細を初期値に戻す", "route__button pref__reset");
    reset.addEventListener("click", () => prefs.resetToDefaults());
    detailBody.append(reset);
    details.append(detailBody);

    const node = el("div", { className: "pref__controls" }, [bikeSet, hill.node, details]);

    function sync(state: PreferencesState): void {
      const { draft, status } = routeStore.getState();
      const busy = status.kind === "loading";
      for (const [b, input] of bike.inputs) {
        input.checked = b === draft.bikeType;
        input.disabled = busy;
      }
      bikeCurrent.textContent = bikeTypeLabel(draft.bikeType);
      for (const slider of sliders) slider.sync(draft, busy);
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

/** 「設定」タブ。経路ビューで選んでいる条件（車種・坂道許容度・詳細パラメータ）を次回からの初期値として保存する。 */
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
    el("p", { className: "pref__status", text: "「経路」で選んだ条件（詳細パラメータを含む）を、次回からの初期値として保存します。" }),
    current,
    saveRow,
  ]);
}
