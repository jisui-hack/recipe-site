/* リクエストの検証。ここを通ったものだけが Anthropic に届く */

const MEMO_MAX = 4000;
const IMAGE_MAX_BYTES = 1_500_000; // デコード後
const VOCAB_GROUP_MAX = 100;
const VOCAB_NAME_MAX = 20;
const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp"]);

export class ValidationError extends Error {}

function fail(msg) {
  throw new ValidationError(msg);
}

/** base64 のデコード後バイト数。文字列を実際に展開せずに求める */
function base64Bytes(b64) {
  const clean = b64.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) fail("image.base64 が base64 ではありません");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

/**
 * 語彙の検証。
 * ここが緩いと「語彙に見せかけた指示」を enum 経由で注入できてしまうので、
 * 制御文字と改行は無条件で弾く。
 */
function validateVocabulary(vocab) {
  if (!vocab || typeof vocab !== "object" || Array.isArray(vocab)) {
    fail("vocabulary はオブジェクトである必要があります");
  }
  const keys = Object.keys(vocab);
  if (!keys.length) fail("vocabulary が空です");
  if (keys.length > 20) fail("vocabulary のグループが多すぎます");

  const out = {};
  for (const key of keys) {
    if (!/^[a-z][a-zA-Z0-9_]{0,30}$/.test(key)) fail(`vocabulary のキーが不正です: ${key}`);
    const names = vocab[key];
    if (!Array.isArray(names)) fail(`vocabulary.${key} は配列である必要があります`);
    if (names.length > VOCAB_GROUP_MAX) fail(`vocabulary.${key} の件数が多すぎます`);

    const seen = new Set();
    for (const name of names) {
      if (typeof name !== "string") fail(`vocabulary.${key} に文字列以外が含まれています`);
      if (!name.length || name.length > VOCAB_NAME_MAX) fail(`vocabulary.${key} のタグ名の長さが不正です`);
      // 制御文字・改行・タブを含む語彙は拒否（プロンプトインジェクション経路を塞ぐ）
      if (/[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029]/.test(name)) {
        fail(`vocabulary.${key} に制御文字が含まれています`);
      }
      seen.add(name);
    }
    out[key] = [...seen];
  }
  return out;
}

/** @returns 正規化済みのリクエスト。以降はこの戻り値だけを使う */
export function validateRequest(body) {
  if (!body || typeof body !== "object") fail("JSON オブジェクトを送ってください");
  if (body.schemaVersion !== 1) fail("schemaVersion は 1 のみ対応しています");

  const memo = typeof body.memo === "string" ? body.memo.trim() : "";
  if (memo.length > MEMO_MAX) fail(`memo は ${MEMO_MAX} 文字以内にしてください`);

  let image = null;
  if (body.image != null) {
    if (typeof body.image !== "object") fail("image はオブジェクトである必要があります");
    const { mediaType, base64 } = body.image;
    if (!ALLOWED_MEDIA.has(mediaType)) fail("image.mediaType は jpeg / png / webp のみ対応しています");
    if (typeof base64 !== "string" || !base64.length) fail("image.base64 がありません");
    const bytes = base64Bytes(base64);
    if (bytes > IMAGE_MAX_BYTES) {
      const err = new ValidationError("画像が大きすぎます");
      err.tooLarge = true;
      throw err;
    }
    image = { mediaType, base64: base64.replace(/\s/g, ""), bytes };
  }

  if (!memo && !image) fail("メモか画像のどちらかを入れてください");

  const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
    ? body.today
    : new Date().toISOString().slice(0, 10);

  return {
    memo,
    image,
    vocabulary: validateVocabulary(body.vocabulary),
    today,
    inputKinds: [memo ? "memo" : null, image ? "image" : null].filter(Boolean),
  };
}

export const LIMITS = { MEMO_MAX, IMAGE_MAX_BYTES, VOCAB_GROUP_MAX, VOCAB_NAME_MAX };
