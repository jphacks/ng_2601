import "./post.css";
import type { ApiClient } from "../../api/client";
import { toApiError, type ApiError } from "../../api/errors";
import type { LngLat, Review, ReviewCategory } from "../../types/api";
import { el } from "../../ui/dom";
import { icon } from "../../ui/icon";
import type { MapController } from "../map/map";
import { CATEGORY_LABEL } from "./catalog";
import { COMMENT_MAX_LENGTH, countChars, validateDraft, type DraftErrors } from "./validation";

export interface ReviewPostOptions {
  map: MapController;
  client: ApiClient;
  /** 投稿に成功したとき。一覧への反映と確認表示は呼び出し側が行う。 */
  onPosted: (review: Review) => void;
  /** フォームや地点指定を開く直前（他のパネルを閉じるため）。 */
  onOpen?: () => void;
}

export interface ReviewPostFeature {
  /** 地図の上に重ねる投稿フォーム。 */
  sheet: HTMLElement;
  /** 地点指定中の案内（キャンセルできる）。 */
  banner: HTMLElement;
  /** 投稿成功の通知（スクリーンリーダー向けの live region を兼ねる）。 */
  status: HTMLElement;
  /** 投稿を始める。地点が分かっていればフォーム、null なら地図での地点指定から。 */
  start(at: LngLat | null): void;
  /** 地図タップを受け取る。地点指定中なら地点にして true。フォーム表示中も誤タップ防止のため true。 */
  pick(lngLat: LngLat): boolean;
  /** 他のパネルに場所を譲る。入力途中の内容は保持する。 */
  hide(): void;
  /** Escape の処理。扱ったら true。 */
  handleEscape(): boolean;
}

type Mode = "closed" | "form" | "picking";

const CATEGORIES = Object.keys(CATEGORY_LABEL) as ReviewCategory[];
const STATUS_VISIBLE_MS = 6000;
const RETAINED = "入力した内容は残っています。";

function submitErrorMessage(error: ApiError): string {
  switch (error.code) {
    case "unauthorized":
      return `口コミの投稿にはログインが必要です（ログイン機能は未実装のため、実サーバーへは投稿できません）。${RETAINED}`;
    case "invalid_request":
      return `入力内容が受け付けられませんでした。内容を確認してもう一度お試しください。${RETAINED}`;
    case "rate_limited":
      return `短時間に投稿できる件数を超えました。しばらくしてからもう一度お試しください。${RETAINED}`;
    case "timeout":
      return `投稿に時間がかかっています。サーバーには届いている可能性があるため、口コミの一覧を確認してから再度お試しください。${RETAINED}`;
    case "network_error":
      return `通信に失敗しました。通信環境を確認して、もう一度お試しください。${RETAINED}`;
    case "invalid_response":
      return `投稿の結果を確認できませんでした。サーバーには届いている可能性があるため、口コミの一覧を確認してから再度お試しください。${RETAINED}`;
    default:
      return `投稿に失敗しました。時間をおいてもう一度お試しください。${RETAINED}`;
  }
}

function textButton(label: string, className: string): HTMLButtonElement {
  const b = el("button", { className, text: label });
  b.type = "button";
  return b;
}

export function createReviewPostFeature(options: ReviewPostOptions): ReviewPostFeature {
  const { map, client, onPosted, onOpen } = options;

  let mode: Mode = "closed";
  let location: LngLat | null = null;
  let category: ReviewCategory | null = null;
  let submitting = false;
  let showErrors = false;
  let returnFocus: HTMLElement | null = null;
  let statusTimer: number | undefined;

  // --- DOM ---------------------------------------------------------------
  const title = el("h2", { className: "review-sheet__title", text: "口コミを投稿" });
  title.id = "review-post-title";
  title.tabIndex = -1;
  const closeButton = el("button", { className: "review-sheet__button" }, [icon("close")]);
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "投稿を閉じる");

  // 地点
  const changeLocation = textButton("地点を変更", "post-form__secondary");
  const locationError = el("p", { className: "post-form__error" });
  locationError.id = "review-post-location-error";
  locationError.hidden = true;
  const locationField = el("div", { className: "post-form__field" }, [
    el("div", { className: "post-form__location" }, [
      el("span", { className: "post-form__label", text: "地点" }),
      changeLocation,
    ]),
    locationError,
  ]);

  // カテゴリ
  const categoryError = el("p", { className: "post-form__error" });
  categoryError.id = "review-post-category-error";
  categoryError.hidden = true;
  const radios = new Map<ReviewCategory, HTMLInputElement>();
  const chips = el("div", { className: "post-chips" });
  for (const value of CATEGORIES) {
    const input = el("input");
    input.type = "radio";
    input.name = "review-category";
    input.value = value;
    input.addEventListener("change", () => {
      category = value;
      refreshErrors();
    });
    radios.set(value, input);
    chips.append(el("label", { className: "post-chip" }, [input, el("span", { text: CATEGORY_LABEL[value] })]));
  }
  const categoryField = el("fieldset", { className: "post-form__field" }, [
    el("legend", { className: "post-form__label", text: "カテゴリ" }),
    chips,
    categoryError,
  ]);
  categoryField.setAttribute("aria-describedby", categoryError.id);

  // コメント
  const commentLabel = el("label", { className: "post-form__label", text: "コメント" });
  commentLabel.htmlFor = "review-post-comment";
  const comment = el("textarea", { className: "post-form__textarea" });
  comment.id = "review-post-comment";
  comment.rows = 5;
  comment.placeholder = "例: 段差が多い";
  comment.autocomplete = "off";
  const counter = el("p", { className: "post-form__counter" });
  counter.id = "review-post-counter";
  const commentError = el("p", { className: "post-form__error" });
  commentError.id = "review-post-comment-error";
  commentError.hidden = true;
  comment.setAttribute("aria-describedby", `${counter.id} ${commentError.id}`);
  const commentField = el("div", { className: "post-form__field" }, [commentLabel, comment, counter, commentError]);

  const notice = el("p", {
    className: "post-form__notice",
    text: "位置とともに公開されます。個人情報は書かないでください。",
  });

  const submitError = el("p", { className: "post-form__submit-error" });
  submitError.setAttribute("role", "alert");
  submitError.hidden = true;

  // 送信中もフォーカスを失わないよう disabled ではなく aria-disabled にし、処理側で二重送信を防ぐ。
  const cancelButton = textButton("キャンセル", "post-form__secondary");
  const submitButton = el("button", { className: "post-form__primary", text: "投稿する" });
  submitButton.type = "submit";
  const actions = el("div", { className: "post-form__actions" }, [cancelButton, submitButton]);

  const form = el("form", { className: "post-form" }, [
    locationField,
    categoryField,
    commentField,
    notice,
    submitError,
    actions,
  ]);
  form.noValidate = true;

  const body = el("div", { className: "review-sheet__body" }, [form]);
  const sheet = el("section", { className: "review-sheet post-sheet" }, [
    el("header", { className: "review-sheet__header" }, [title, closeButton]),
    body,
  ]);
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-labelledby", title.id);
  sheet.inert = true;

  // 地点指定中の案内。見た目は経路の地点指定と同じ（route.css の .pick-banner）。
  const bannerText = el("span", { text: "地図をタップして地点を指定" });
  const bannerCancel = textButton("キャンセル", "pick-banner__cancel");
  const banner = el("div", { className: "pick-banner" }, [bannerText, bannerCancel]);
  banner.setAttribute("role", "status");
  banner.hidden = true;

  const status = el("div", { className: "post-toast" });
  status.setAttribute("role", "status");
  status.hidden = true;

  // --- view sync -----------------------------------------------------------
  function currentErrors(): DraftErrors {
    const result = validateDraft({ location, category, comment: comment.value });
    return result.ok ? {} : result.errors;
  }

  function setError(node: HTMLElement, control: HTMLElement | null, message: string | undefined): void {
    node.hidden = !message;
    node.textContent = message ?? "";
    control?.setAttribute("aria-invalid", String(Boolean(message)));
  }

  /** 送信を試みた後は、入力のたびに誤りの表示を更新する。 */
  function refreshErrors(): void {
    const length = countChars(comment.value.trim());
    counter.textContent = `${length}/${COMMENT_MAX_LENGTH}`;
    counter.classList.toggle("is-over", length > COMMENT_MAX_LENGTH);
    const errors = showErrors ? currentErrors() : {};
    setError(locationError, null, errors.location);
    setError(categoryError, null, errors.category);
    setError(commentError, comment, errors.comment);
    for (const input of radios.values()) input.setAttribute("aria-invalid", String(Boolean(errors.category)));
  }

  function renderLocation(): void {
    map.setDraftPoint(mode === "closed" ? null : location);
  }

  function setSubmitting(on: boolean): void {
    submitting = on;
    form.setAttribute("aria-busy", String(on));
    comment.readOnly = on;
    for (const input of radios.values()) input.disabled = on;
    for (const b of [submitButton, changeLocation, cancelButton, closeButton]) {
      b.setAttribute("aria-disabled", String(on));
    }
    submitButton.textContent = on ? "投稿中…" : "投稿する";
  }

  function showForm(): void {
    mode = "form";
    banner.hidden = true;
    map.setPicking(false);
    renderLocation();
    refreshErrors();
    sheet.inert = false;
    sheet.classList.add("is-open");
    body.scrollTop = 0;
    title.focus({ preventScroll: true });
  }

  function beginPick(): void {
    mode = "picking";
    sheet.classList.remove("is-open");
    sheet.inert = true;
    banner.hidden = false;
    map.setPicking(true);
    renderLocation();
  }

  /** 画面から片付ける。入力内容は残す。 */
  function hideUi(): void {
    mode = "closed";
    sheet.classList.remove("is-open");
    sheet.inert = true;
    banner.hidden = true;
    map.setPicking(false);
    map.setDraftPoint(null);
  }

  function resetDraft(): void {
    location = null;
    category = null;
    showErrors = false;
    comment.value = "";
    for (const input of radios.values()) input.checked = false;
    setError(submitError, null, undefined);
    refreshErrors();
  }

  /** 利用者が破棄した。入力内容も消す。 */
  function discard(): void {
    if (submitting) return;
    hideUi();
    resetDraft();
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  function cancelPick(): void {
    if (location) showForm();
    else discard();
  }

  function announce(message: string): void {
    window.clearTimeout(statusTimer);
    status.textContent = message;
    status.hidden = false;
    statusTimer = window.setTimeout(() => {
      status.hidden = true;
      status.textContent = "";
    }, STATUS_VISIBLE_MS);
  }

  // --- submit --------------------------------------------------------------
  async function submit(): Promise<void> {
    if (submitting) return; // 二重送信防止（Enter連打・ダブルタップ）
    showErrors = true;
    const result = validateDraft({ location, category, comment: comment.value });
    refreshErrors();
    if (!result.ok) {
      if (result.errors.location) changeLocation.focus();
      else if (result.errors.category) [...radios.values()][0].focus();
      else comment.focus();
      return;
    }
    setError(submitError, null, undefined);
    setSubmitting(true);
    try {
      const review = await client.createReview(result.draft);
      setSubmitting(false);
      hideUi();
      resetDraft();
      returnFocus = null; // 投稿後は口コミシートが見出しへフォーカスを移す
      announce("口コミを投稿しました。");
      onPosted(review);
    } catch (error) {
      setSubmitting(false);
      console.error("review post:", error);
      setError(submitError, null, submitErrorMessage(toApiError(error)));
      submitButton.focus({ preventScroll: true });
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void submit();
  });
  comment.addEventListener("input", refreshErrors);
  changeLocation.addEventListener("click", () => {
    if (!submitting) beginPick();
  });
  cancelButton.addEventListener("click", discard);
  closeButton.addEventListener("click", discard);
  bannerCancel.addEventListener("click", cancelPick);
  // キーボード表示で隠れないよう、フォーカス中の入力を見える位置へ。
  sheet.addEventListener("focusin", (e) => {
    if (e.target instanceof HTMLElement && e.target !== title) e.target.scrollIntoView({ block: "nearest" });
  });

  refreshErrors();
  renderLocation();

  return {
    sheet,
    banner,
    status,
    start(at) {
      if (mode === "closed") {
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        onOpen?.();
      }
      if (at) location = at;
      if (location) showForm();
      else beginPick();
    },
    pick(lngLat) {
      if (mode === "picking") {
        location = lngLat;
        showForm();
        return true;
      }
      return mode === "form";
    },
    hide() {
      if (mode !== "closed") hideUi();
    },
    handleEscape() {
      if (mode === "closed") return false;
      if (submitting) return true;
      if (mode === "picking") cancelPick();
      else discard();
      return true;
    },
  };
}
