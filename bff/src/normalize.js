/*
 * LLM の出力をそのままフロントに渡さないための検証・正規化。
 * N-1〜N-10 の各処理はここに集約する。
 */

import {
  AMOUNT_FIELD,
  CONFIDENCE_LEVELS,
  DRAFT_FIELDS,
  IMAGE_KINDS,
  LIST_FIELDS,
  SCALAR_FIELDS,
  SCHEMA_VERSION,
  clampConfidence,
} from "./schema.js";

const MAX = {
  title: 60,
  ingredientName: 30,
  ingredientAmount: 20,
  step: 120,
  notes: 300,
  rationale: 400,
  // プロンプトの指示は145文字。ここは暴走を止める最後の砦なので少し余裕を持たせる
  // （125ちょうどで切ると、わずかに超えただけの文が途中で千切れる）
  xPost: 170,
  followUpMessage: 100,
};

/** N-3: 前後の空白（全角含む）を落とす */
function trim(value) {
  return typeof value === "string" ? value.replace(/^[\s　]+|[\s　]+$/g, "") : "";
}

/** N-10: 長さ制限。スキーマの maxLength はモデルへの指示にすぎないので実際に切る */
function cut(value, max) {
  const s = trim(value);
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * N-3 / N-4: 手順1行の整形。
 * - 「1. 」「２）」のような番号の接頭辞を剥がす（モデルが付けてしまう場合の保険）
 * - 末尾を句点「。」に統一する。既存レシピの steps が句点ありなので合わせる
 */
export function normalizeStep(raw) {
  let s = trim(raw);
  s = s.replace(/^[\s　]*[0-9０-９]+[.．、)）:：]\s*/, "");
  s = s.replace(/^[\s　]*[・-]\s*/, "");
  s = trim(s);
  if (!s) return "";
  s = s.replace(/[。．.]+$/, "");
  if (!s) return "";
  return `${s}。`;
}

/** N-7: モデルが作った URL を通さない。メモに literal で含まれるものだけ採用する */
export function pickSourceUrl(candidate, memo) {
  const url = trim(candidate);
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (!memo) return null;
  // 末尾に句読点や閉じ括弧が付いた形で書かれていることがあるので、
  // メモ側から URL らしき文字列を抜き出して比較する
  const found = memo.match(/https?:\/\/[^\s　"'<>「」（）()]+/g) ?? [];
  const stripped = url.replace(/[。、.,)）」』]+$/, "");
  return found.some((f) => f === url || f.replace(/[。、.,)）」』]+$/, "") === stripped)
    ? stripped
    : null;
}

function normalizeConfidence(raw) {
  const out = {};
  for (const key of DRAFT_FIELDS) {
    const v = raw?.[key];
    out[key] = CONFIDENCE_LEVELS.includes(v) ? v : "low";
  }
  return out;
}

/**
 * N-8: 確信度クリップ。
 * モデルの自己申告を、システム側が知っている物理的制約で上書きする。
 *
 * ここは写真の種類で分岐する。
 * 「料理の写真から 200g を読み取った」は起こりえないが、
 * 「紙に 200g と書いてある」は普通に起こる。同じ扱いにすると、
 * 手書きメモの取り込み（UC-3）で読み取れた分量まで捨ててしまう。
 */
function clipConfidence(conf, { inputKinds, ingredients, imageKind }) {
  const out = { ...conf };
  const imageOnly = inputKinds.includes("image") && !inputKinds.includes("memo");

  if (imageOnly) {
    if (imageKind === "handwritten_note") {
      // 書かれている内容の読み取り。メモを打ってもらったのと近いが、
      // 手書きの読み違いはありうるので全体を medium で頭打ちにする
      for (const key of DRAFT_FIELDS) out[key] = clampConfidence(out[key], "medium");
    } else {
      // 料理そのものの写真。分量・時間・人数は物理的に読み取れない
      out[AMOUNT_FIELD] = "low";
      out.timeMinutes = "low";
      out.servings = "low";
      out.title = clampConfidence(out.title, "medium");
      out.genre = clampConfidence(out.genre, "medium");
      out.ingredientNames = clampConfidence(out.ingredientNames, "medium");
      out.steps = clampConfidence(out.steps, "medium");
    }
  }

  // 分量が空の材料が半数を超えたら、分量は信用できない
  if (ingredients.length) {
    const blank = ingredients.filter((i) => !i.amount).length;
    if (blank * 2 > ingredients.length) out[AMOUNT_FIELD] = "low";
  }

  return out;
}

/**
 * X の紹介文の整形。
 * URL を書かないよう指示してあるが、書いてきた場合は落とす。
 * 投稿時にこちらで正しい URL を付けるので、モデルが作った URL は害にしかならない。
 */
export function normalizeXPost(raw) {
  let s = trim(raw);
  if (!s) return "";
  s = s.replace(/https?:\/\/\S+/g, "");
  // ハッシュタグは付けない方針（2026-08-26）。プロンプトで禁じているが、
  // モデルは習慣的に付けたがるので出口でも落とす。URL と同じ扱い。
  s = s.replace(/[#＃][^\s#＃]+/g, "");
  s = s.replace(/[ \t]{2,}/g, " ");
  // 末尾に取り残された記号や空行を整える
  s = s.replace(/\n{3,}/g, "\n\n").replace(/^[\s　]+|[\s　]+$/g, "");
  return s;
}

/** モデルが変な値を返しても IMAGE_KINDS の範囲に収める */
function normalizeImageKind(raw, hasImage) {
  if (!hasImage) return "none";
  return IMAGE_KINDS.includes(raw) && raw !== "none" ? raw : "other";
}

/**
 * LLM の tool_use.input を DraftPayload に変換する。
 * 不正なら null を返す（呼び出し側が 422 にする）。
 *
 * @returns {object|null}
 */
export function normalizeDraft(raw, ctx) {
  if (!raw || typeof raw !== "object") return null;

  const { vocabulary, inputKinds, memo, meta } = ctx;
  const notes = [];
  const followUps = [];

  const addFollowUp = (field, message) => {
    if (followUps.length < 8 && !followUps.some((f) => f.field === field)) {
      followUps.push({ field, message });
    }
  };

  /* N-1 / N-2: 語彙フィルタと重複除去 */
  const filterTags = (key) => {
    const allowed = new Set(vocabulary[key] ?? []);
    const input = Array.isArray(raw[key]) ? raw[key] : [];
    const kept = [];
    let dropped = 0;
    for (const name of input) {
      const t = trim(name);
      if (!t) continue;
      if (!allowed.has(t)) {
        dropped++;
        continue;
      }
      if (!kept.includes(t)) kept.push(t);
    }
    return { kept, dropped };
  };

  const tags = {};
  const droppedTags = [];
  for (const key of ["protein", "plant", "genre"]) {
    const { kept, dropped } = filterTags(key);
    tags[key] = kept;
    if (dropped) droppedTags.push(`${key}:${dropped}件`);
  }

  /* N-2 / N-5 / N-10: 材料 */
  const seenNames = new Set();
  const ingredients = [];
  for (const item of Array.isArray(raw.ingredients) ? raw.ingredients : []) {
    const name = cut(item?.name, MAX.ingredientName);
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);
    ingredients.push({ name, amount: cut(item?.amount, MAX.ingredientAmount) });
  }

  /* N-3 / N-4 / N-5 / N-10: 手順 */
  const steps = [];
  for (const s of Array.isArray(raw.steps) ? raw.steps : []) {
    const line = normalizeStep(cut(s, MAX.step));
    if (line) steps.push(line);
  }

  /* N-9: 材料か手順が空になったら下書きとして成立しない */
  if (!ingredients.length || !steps.length) return null;

  /* N-6: 数値クランプ */
  const clampInt = (value, min, max, field, label) => {
    if (value == null) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const i = Math.round(n);
    if (i < min || i > max) {
      addFollowUp(field, `${label}が範囲外だったため空にしました。入力してください。`);
      return null;
    }
    return i;
  };
  const timeMinutes = clampInt(raw.timeMinutes, 1, 600, "timeMinutes", "所要時間");
  const servings = clampInt(raw.servings, 1, 20, "servings", "人数");

  /* N-7 */
  const sourceUrl = pickSourceUrl(raw.sourceUrl, memo);
  if (raw.sourceUrl && !sourceUrl) {
    notes.push("メモに実在しない元記事URLが出力されたため破棄しました。");
  }

  /* N-8 */
  let confidence = normalizeConfidence(raw.confidence);
  if (droppedTags.length) {
    // 語彙外を出したモデルは、そのグループの判断自体が怪しい
    for (const entry of droppedTags) {
      const key = entry.split(":")[0];
      confidence[key] = clampConfidence(confidence[key], "medium");
    }
    notes.push(`語彙外のタグを除去しました（${droppedTags.join(" / ")}）。`);
  }
  const imageKind = normalizeImageKind(trim(raw.imageKind), inputKinds.includes("image"));
  confidence = clipConfidence(confidence, { inputKinds, ingredients, imageKind });

  /* モデルの followUps を取り込む（未知のフィールド名は捨てる） */
  for (const f of Array.isArray(raw.followUps) ? raw.followUps : []) {
    const field = trim(f?.field);
    const message = cut(f?.message, MAX.followUpMessage);
    if (DRAFT_FIELDS.includes(field) && message) addFollowUp(field, message);
  }

  /* スカラー項目が low なら値を入れないので、必ず確認を促す */
  const title = cut(raw.title, MAX.title) || null;
  const scalarValues = { title, timeMinutes, servings, sourceUrl };
  const scalarLabels = {
    title: "タイトル",
    timeMinutes: "所要時間",
    servings: "人数",
    sourceUrl: "元記事URL",
  };
  for (const key of SCALAR_FIELDS) {
    if (key === "sourceUrl") continue; // 無くて当たり前なので促さない
    if (scalarValues[key] == null) {
      addFollowUp(key, `${scalarLabels[key]}がメモから読み取れませんでした。入力してください。`);
    } else if (confidence[key] === "low") {
      addFollowUp(key, `${scalarLabels[key]}は推測です。確認してください。`);
    }
  }
  if (confidence[AMOUNT_FIELD] === "low") {
    addFollowUp(AMOUNT_FIELD, "分量は読み取れていません。実際に使った量に直してください。");
  }

  const rationale = [cut(raw.rationale, MAX.rationale), ...notes].filter(Boolean).join(" ");

  /* X の紹介文。レシピの一部ではないので draft の外に置く */
  const xPost = normalizeXPost(cut(raw.xPost, MAX.xPost));

  return {
    schemaVersion: SCHEMA_VERSION,
    draft: {
      title,
      timeMinutes,
      servings,
      ingredients,
      steps,
      protein: tags.protein,
      plant: tags.plant,
      genre: tags.genre,
      notes: cut(raw.notes, MAX.notes),
      sourceUrl,
    },
    confidence,
    followUps,
    rationale,
    xPost,
    meta: { ...meta, inputKinds, imageKind },
  };
}

export const FIELD_GROUPS = { SCALAR_FIELDS, LIST_FIELDS, AMOUNT_FIELD };
