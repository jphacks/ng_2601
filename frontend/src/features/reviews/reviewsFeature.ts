import "./reviews.css";
import type { ApiClient } from "../../api/client";
import type { BBox, LngLat, Review } from "../../types/api";
import { el } from "../../ui/dom";
import { icon } from "../../ui/icon";
import { renderState } from "../../ui/state";
import type { RoadInfoItem } from "../hazards/types";
import type { MapController } from "../map/map";
import { CATEGORY_LABEL } from "./catalog";
import { groupReviews, PICK_RADIUS_M, sortNewestFirst, within, type ReviewPlace } from "./grouping";
import {
  ALL_CATEGORIES,
  createDefaultListFilter,
  filterAndSortReviews,
  isFiltering,
  SORT_LABEL,
  summarizeListFilter,
  type ReviewSort,
} from "./listFilter";
import { hazardCard, reviewDetail, reviewItem } from "./view";

/** 表示範囲の外側も少し先読みして、わずかなパンで取得し直さないようにする。 */
const FETCH_PADDING = 0.25;
const FETCH_DEBOUNCE_MS = 300;
const LOAD_ERROR_MESSAGE = "口コミを読み込めませんでした。通信環境を確認して再試行してください。";

export interface ReviewsFeatureOptions {
  map: MapController;
  client: ApiClient;
  /** 地点の近くの道路・規制情報。口コミとは別の見た目で同じシートに出す。 */
  getRoadInfo: () => readonly RoadInfoItem[];
  /** シートを開く直前（他のパネルを閉じるため）。 */
  onOpen?: () => void;
  /** 口コミの投稿を始める。地点が分からない（一覧から）ときは null。 */
  onPost?: (at: LngLat | null) => void;
  /** 地点シートの「ここを目的地にする」。 */
  onSetDestination?: (at: LngLat) => void;
  /** 地点シートの「ここを出発地にする」。 */
  onSetOrigin?: (at: LngLat) => void;
}

export interface ReviewsFeature {
  /** 地図の上に重ねるボトムシート。 */
  sheet: HTMLElement;
  /** 取得失敗を知らせる小さな表示。 */
  status: HTMLElement;
  /** 「口コミ」タブの中身（表示中の範囲の一覧）。 */
  listPanel: HTMLElement;
  /** 地図上の地点（クリックなど）の近くの口コミ・道路情報を開く。 */
  openNear(lngLat: LngLat): void;
  /** 指定した口コミの詳細を開く。 */
  openReview(id: string): void;
  close(): void;
  /** 開いていれば閉じて true。 */
  handleEscape(): boolean;
  /** 投稿された口コミを一覧・地図に加え、その詳細を開いて確認できるようにする。 */
  showPosted(review: Review): void;
}

interface Selection {
  center: LngLat;
  /** ピンから開いたときの対象。未指定なら center の近くを探す。 */
  ids?: string[];
  /** 指定すると詳細表示。 */
  reviewId?: string;
}

type LoadState = "idle" | "loading" | "ready" | "error";

function padded([west, south, east, north]: BBox): BBox {
  const dLon = (east - west) * FETCH_PADDING;
  const dLat = (north - south) * FETCH_PADDING;
  return [
    Math.max(-180, west - dLon),
    Math.max(-90, south - dLat),
    Math.min(180, east + dLon),
    Math.min(90, north + dLat),
  ];
}

function postButton(label: string): HTMLButtonElement {
  const b = el("button", { className: "review-post-action", text: label });
  b.type = "button";
  return b;
}

function iconButton(label: string, className: string, name: "back" | "close"): HTMLButtonElement {
  const b = el("button", { className }, [icon(name)]);
  b.type = "button";
  b.setAttribute("aria-label", label);
  return b;
}

export function createReviewsFeature(options: ReviewsFeatureOptions): ReviewsFeature {
  const { map, client, getRoadInfo, onOpen, onPost, onSetDestination, onSetOrigin } = options;

  let reviews: Review[] = [];
  let load: LoadState = "idle";
  // 一度でも取得できたら、再取得中・失敗中も手元の口コミを出し続ける。
  let loadedOnce = false;
  let signature = "";
  let seq = 0;
  let lastBox: BBox | null = null;
  let timer: number | undefined;
  let selection: Selection | null = null;
  let returnFocus: HTMLElement | null = null;

  // --- DOM ---------------------------------------------------------------
  const title = el("h2", { className: "review-sheet__title" });
  title.id = "review-sheet-title";
  title.tabIndex = -1;
  const back = iconButton("一覧に戻る", "review-sheet__button", "back");
  const closeButton = iconButton("閉じる", "review-sheet__button", "close");
  const body = el("div", { className: "review-sheet__body" });
  const sheet = el("section", { className: "review-sheet" }, [
    el("header", { className: "review-sheet__header" }, [back, title, closeButton]),
    body,
  ]);
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-labelledby", title.id);
  sheet.inert = true;

  const status = el("div", { className: "reviews-status" });
  status.hidden = true;
  const listContent = el("div");
  // 投稿ボタンは再描画で作り直さない（フォーカスを保つ）。
  const listPost = postButton("口コミを投稿");
  listPost.addEventListener("click", () => onPost?.(null));
  const listSummary = el("p", { className: "reviews-list__summary" });
  const listFilter = createDefaultListFilter();
  const filterSummary = el("span", { className: "reviews-filter__current" });
  const listPanel = el("div", { className: "reviews-list" }, [
    el("div", { className: "reviews-actions" }, [listSummary, listPost]),
    renderListFilter(),
    listContent,
  ]);

  /** 並び替え・絞り込み。最初はたたんでおき、要約だけ見せる。入力要素は作り直さない。 */
  function renderListFilter(): HTMLElement {
    const onChange = () => renderList();
    const sortGroup = el("fieldset", { className: "reviews-filter__group" }, [
      el("legend", { className: "reviews-filter__legend", text: "並び替え" }),
    ]);
    for (const sort of Object.keys(SORT_LABEL) as ReviewSort[]) {
      const input = el("input");
      input.type = "radio";
      input.name = "reviews-sort";
      input.checked = listFilter.sort === sort;
      input.addEventListener("change", () => {
        if (!input.checked) return;
        listFilter.sort = sort;
        onChange();
      });
      sortGroup.append(el("label", { className: "reviews-filter__option" }, [input, el("span", { text: SORT_LABEL[sort] })]));
    }
    const categoryGroup = el("fieldset", { className: "reviews-filter__group" }, [
      el("legend", { className: "reviews-filter__legend", text: "カテゴリ" }),
    ]);
    for (const category of ALL_CATEGORIES) {
      const input = el("input");
      input.type = "checkbox";
      input.checked = listFilter.categories.has(category);
      input.addEventListener("change", () => {
        if (input.checked) listFilter.categories.add(category);
        else listFilter.categories.delete(category);
        onChange();
      });
      categoryGroup.append(
        el("label", { className: "reviews-filter__option" }, [input, el("span", { text: CATEGORY_LABEL[category] })]),
      );
    }
    const keyword = el("input", { className: "reviews-filter__keyword" });
    keyword.type = "search";
    keyword.id = "reviews-filter-keyword";
    keyword.placeholder = "コメントを検索";
    keyword.autocomplete = "off";
    keyword.addEventListener("input", () => {
      listFilter.keyword = keyword.value;
      onChange();
    });
    const keywordLabel = el("label", { className: "reviews-filter__legend", text: "キーワード" });
    keywordLabel.htmlFor = keyword.id;
    const details = el("details", { className: "reviews-filter" }, [
      el("summary", { className: "reviews-filter__summary" }, [
        el("span", { text: "並び替え・絞り込み" }),
        filterSummary,
      ]),
      el("div", { className: "reviews-filter__body" }, [
        sortGroup,
        categoryGroup,
        el("div", { className: "reviews-filter__group" }, [keywordLabel, keyword]),
      ]),
    ]);
    return details;
  }

  // --- data ------------------------------------------------------------
  function retry(): void {
    const box = lastBox ?? map.getBounds();
    if (box) fetchReviews(box);
  }

  function fetchReviews(viewport: BBox): void {
    lastBox = viewport;
    const mine = ++seq;
    if (!loadedOnce) {
      load = "loading";
      renderAll();
    }
    client
      .listReviews({ bbox: padded(viewport) })
      .then((fetched) => {
        if (mine !== seq) return; // 後から始めた取得が優先
        // 開いているシートの口コミは、地図を動かして範囲外になっても消さない。
        const kept = new Set(selection?.ids ?? []);
        const fresh = new Set(fetched.map((r) => r.id));
        const next = sortNewestFirst([...fetched, ...reviews.filter((r) => kept.has(r.id) && !fresh.has(r.id))]);
        const nextSignature = JSON.stringify(next);
        const changed = nextSignature !== signature || load !== "ready" || !loadedOnce;
        const dataChanged = nextSignature !== signature || !loadedOnce;
        signature = nextSignature;
        reviews = next;
        load = "ready";
        loadedOnce = true;
        if (dataChanged) map.setReviews(groupReviews(reviews), selectPlace);
        if (changed) renderAll();
      })
      .catch((error: unknown) => {
        if (mine !== seq) return;
        console.error("reviews:", error);
        load = "error";
        renderAll();
      });
  }

  map.onViewportChange(({ bbox }) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fetchReviews(bbox), FETCH_DEBOUNCE_MS);
  });

  // --- selection ---------------------------------------------------------
  function selectPlace(place: ReviewPlace): void {
    open({ center: place.center, ids: place.reviews.map((r) => r.id) });
  }

  function open(next: Selection): void {
    if (!selection) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      onOpen?.();
    }
    // 別の地点・一覧⇔詳細の切り替えでは見出しへフォーカスを移す。
    const entering = !selection || selection.reviewId !== next.reviewId || selection.center !== next.center;
    selection = next;
    renderSheet(entering);
  }

  function close(): void {
    if (!selection) return;
    selection = null;
    sheet.classList.remove("is-open");
    sheet.inert = true;
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  back.addEventListener("click", () => {
    if (selection?.reviewId) open({ ...selection, reviewId: undefined });
  });
  closeButton.addEventListener("click", close);

  function selectedReviews(): Review[] {
    if (!selection) return [];
    const { ids, center } = selection;
    if (ids) {
      const wanted = new Set(ids);
      return reviews.filter((r) => wanted.has(r.id));
    }
    return within(reviews, (r) => r.location, center, PICK_RADIUS_M);
  }

  // --- rendering ---------------------------------------------------------
  function userSection(): HTMLElement {
    const section = el("section", { className: "review-section" });
    if (!loadedOnce) {
      section.append(
        el("h3", { className: "review-section__title", text: "ユーザーの口コミ" }),
        load === "error"
          ? renderState({ kind: "error", message: LOAD_ERROR_MESSAGE, onRetry: retry })
          : renderState({ kind: "loading", message: "口コミを読み込み中…" }),
      );
      return section;
    }
    const items = selectedReviews();
    section.append(el("h3", { className: "review-section__title", text: `ユーザーの口コミ（${items.length}件）` }));
    if (items.length === 0) {
      section.append(renderState({ kind: "empty", message: "この地点にはまだ口コミがありません。" }));
    } else {
      section.append(
        el(
          "ul",
          { className: "review-list" },
          items.map((review) => reviewItem(review, () => selection && open({ ...selection, reviewId: review.id }))),
        ),
      );
    }
    return section;
  }

  function hazardSection(): HTMLElement | null {
    if (!selection) return null;
    const hazards = within(getRoadInfo(), (h) => h.position, selection.center, PICK_RADIUS_M);
    if (hazards.length === 0) return null;
    return el("section", { className: "review-section" }, [
      el("h3", { className: "review-section__title", text: `道路・規制情報（${hazards.length}件）` }),
      el("ul", { className: "review-road-list" }, hazards.map(hazardCard)),
    ]);
  }

  /** 経路探索の導線。地図をタップした人の多くは目的地を決めたいので、シートの先頭に置く。 */
  function routeActions(here: LngLat): HTMLElement[] {
    if (!onSetDestination && !onSetOrigin) return [];
    const row = el("div", { className: "review-route-actions" });
    if (onSetDestination) {
      const b = el("button", { className: "review-route-actions__primary", text: "ここを目的地にする" });
      b.type = "button";
      b.addEventListener("click", () => onSetDestination(here));
      row.append(b);
    }
    if (onSetOrigin) {
      const b = el("button", { className: "review-route-actions__secondary", text: "ここを出発地にする" });
      b.type = "button";
      b.addEventListener("click", () => onSetOrigin(here));
      row.append(b);
    }
    return [row];
  }

  function renderSheet(focusTitle: boolean): void {
    if (!selection) return;
    const detail = selection.reviewId ? reviews.find((r) => r.id === selection!.reviewId) : undefined;
    back.hidden = !detail;
    if (detail) {
      title.textContent = "口コミの詳細";
      body.replaceChildren(reviewDetail(detail));
    } else {
      title.textContent = "この地点";
      const hazards = hazardSection();
      const here = selection.center;
      const post = postButton("この地点に口コミを投稿");
      post.addEventListener("click", () => onPost?.(here));
      body.replaceChildren(
        ...routeActions(here),
        userSection(),
        ...(onPost ? [post] : []),
        ...(hazards ? [hazards] : []),
      );
    }
    sheet.inert = false;
    sheet.classList.add("is-open");
    if (focusTitle) {
      body.scrollTop = 0;
      title.focus({ preventScroll: true });
    }
  }

  function renderStatus(): void {
    if (load !== "error") {
      status.hidden = true;
      status.replaceChildren();
      return;
    }
    if (!status.hidden) return; // 表示中は作り直さない（読み上げの繰り返しを避ける）
    status.replaceChildren(renderState({ kind: "error", message: LOAD_ERROR_MESSAGE, onRetry: retry }));
    status.hidden = false;
  }

  function renderList(): void {
    filterSummary.textContent = summarizeListFilter(listFilter);
    listSummary.textContent = "";
    if (!loadedOnce) {
      listContent.replaceChildren(
        load === "error"
          ? renderState({ kind: "error", message: LOAD_ERROR_MESSAGE, onRetry: retry })
          : renderState({ kind: "loading", message: "口コミを読み込み中…" }),
      );
      return;
    }
    if (reviews.length === 0) {
      listContent.replaceChildren(renderState({ kind: "empty", message: "表示中の範囲に口コミはありません。" }));
      return;
    }
    const shown = filterAndSortReviews(reviews, listFilter);
    listSummary.textContent = isFiltering(listFilter)
      ? `表示中の範囲 ${reviews.length}件中 ${shown.length}件`
      : `表示中の範囲 ${reviews.length}件`;
    listContent.replaceChildren(
      shown.length === 0
        ? renderState({ kind: "empty", message: "条件に合う口コミはありません。" })
        : el(
            "ul",
            { className: "review-list" },
            shown.map((review) => reviewItem(review, () => openReview(review.id))),
          ),
    );
  }

  function renderAll(): void {
    renderStatus();
    renderList();
    if (selection) renderSheet(false);
  }

  function openReview(id: string): void {
    const place = groupReviews(reviews).find((p) => p.reviews.some((r) => r.id === id));
    if (place) open({ center: place.center, ids: place.reviews.map((r) => r.id), reviewId: id });
  }

  function showPosted(review: Review): void {
    reviews = sortNewestFirst([review, ...reviews.filter((r) => r.id !== review.id)]);
    signature = JSON.stringify(reviews);
    load = "ready";
    loadedOnce = true;
    map.setReviews(groupReviews(reviews), selectPlace);
    renderAll();
    openReview(review.id);
    // サーバー側の状態（投稿日時など）に合わせるため取得し直す。失敗しても投稿済みの表示は残る。
    retry();
  }

  renderAll();

  return {
    sheet,
    status,
    listPanel,
    openNear: (lngLat) => open({ center: lngLat }),
    openReview,
    close,
    showPosted,
    handleEscape() {
      if (!selection) return false;
      close();
      return true;
    },
  };
}
