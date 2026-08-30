/**
 * DraftPayload のフィールド定義。フロントとサーバで同じ分類を使う。
 *
 * v1.1 で ingredients を ingredientNames / ingredientAmounts に分けた。
 * 写真だけを入力にした場合、材料の「名前」は読めるが「分量」は読めない。
 * 1つの confidence でまとめると、分量が読めないせいで材料名まで捨てることになる。
 */

/** 値が1つだけのフィールド。confidence が low なら値を入れない（人に聞く） */
export const SCALAR_FIELDS = ["title", "timeMinutes", "servings", "sourceUrl"];

/** 配列のフィールド。confidence が low でも値は入れる（琥珀色 + 警告） */
export const LIST_FIELDS = ["ingredientNames", "steps", "protein", "plant", "genre"];

/** 上のどちらでもない特殊枠。材料行の「分量」列だけを指す */
export const AMOUNT_FIELD = "ingredientAmounts";

export const DRAFT_FIELDS = [...SCALAR_FIELDS, ...LIST_FIELDS, AMOUNT_FIELD, "notes"];

export const CONFIDENCE_LEVELS = ["low", "medium", "high"];

/**
 * 写真が何なのか。
 *
 * 手書きメモの写真をサムネイルにしてしまう事故を防ぐために使う。
 * チェックボックスの既定を ON にしたまま注意書きを添えるだけでは、
 * UC-3（手書きメモの取り込み）で毎回押し忘れる。
 */
export const IMAGE_KINDS = ["dish", "handwritten_note", "other", "none"];

/** high > medium > low の順序比較用 */
export function confidenceRank(level) {
  const i = CONFIDENCE_LEVELS.indexOf(level);
  return i < 0 ? 0 : i;
}

/** level を max 以下に切り下げる */
export function clampConfidence(level, max) {
  return confidenceRank(level) > confidenceRank(max) ? max : level;
}

export const SCHEMA_VERSION = 1;

/** プロンプト・ツール定義を変えたら必ず上げる。ログとキャッシュキーに入る */
export const PROMPT_VERSION = "2026-08-30.1";
