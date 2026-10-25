import type { LngLat, ReviewCategory, ReviewDraft } from "../../types/api";

/** コメントの上限（文字数）。BEの上限(2000)よりFEで厳しくしている暫定値。 */
export const COMMENT_MAX_LENGTH = 500;

export interface DraftInput {
  location: LngLat | null;
  category: ReviewCategory | null;
  comment: string;
}

export interface DraftErrors {
  location?: string;
  category?: string;
  comment?: string;
}

export type DraftValidation = { ok: true; draft: ReviewDraft } | { ok: false; errors: DraftErrors };

/** サロゲートペア（絵文字など）を1文字として数える。 */
export function countChars(text: string): number {
  return [...text].length;
}

/** 送信前の入力検証。本文は前後の空白を除いて判定・送信する。 */
export function validateDraft({ location, category, comment }: DraftInput): DraftValidation {
  const text = comment.trim();
  const errors: DraftErrors = {};
  if (!location) errors.location = "投稿する地点を地図で指定してください。";
  if (!category) errors.category = "カテゴリを選んでください。";
  if (text === "") errors.comment = "コメントを入力してください。";
  else if (countChars(text) > COMMENT_MAX_LENGTH) {
    errors.comment = `コメントは${COMMENT_MAX_LENGTH}文字以内で入力してください（現在${countChars(text)}文字）。`;
  }
  if (!location || !category || errors.comment) return { ok: false, errors };
  return { ok: true, draft: { location, category, comment: text } };
}
