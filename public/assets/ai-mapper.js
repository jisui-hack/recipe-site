/*
 * DraftPayload → 投稿フォームの DOM。
 *
 * このモジュールはネットワークに触れない。入力は payload、出力は DOM の副作用だけ。
 * そのおかげで jsdom で単体テストできる。
 */

import { getTags, ingredientRow, setTags, stepRow } from "./add.js";
import { TAG_GROUPS } from "./tags.js";

/** 値が1つのフィールド。confidence が low なら値を入れず、人に聞く */
const SCALAR_FIELDS = ["title", "timeMinutes", "servings", "sourceUrl"];
/** 配列のフィールド。low でも入れる（捨てると写真だけの入力で何も残らない） */
const LIST_FIELDS = ["ingredientNames", "steps", "protein", "plant", "genre"];

const FIELD_INPUT_ID = {
  title: "f-title",
  timeMinutes: "f-time",
  servings: "f-servings",
  sourceUrl: "f-source",
  notes: "f-notes",
};

export const FIELD_LABEL = {
  title: "タイトル",
  timeMinutes: "所要時間",
  servings: "人数",
  sourceUrl: "元記事URL",
  ingredientNames: "材料",
  ingredientAmounts: "分量",
  steps: "手順",
  protein: "肉・魚・卵のタグ",
  plant: "野菜・豆腐などのタグ",
  genre: "ジャンル",
  notes: "メモ",
};

/** followUps の field からフォーカス先の要素を引く */
export function fieldTarget(field) {
  if (FIELD_INPUT_ID[field]) return document.getElementById(FIELD_INPUT_ID[field]);
  if (field === "ingredientNames" || field === "ingredientAmounts") {
    return document.querySelector("#ing-rows input");
  }
  if (field === "steps") return document.querySelector("#step-rows input");
  return document.getElementById("tag-groups");
}

/* ---------- 人が触った欄の記録 ---------- */

/**
 * 人が1文字でも打った欄には data-user-edited を立てる。
 *
 * 「空欄だけ埋める」だと所要時間と人数が絶対に埋まらない。
 * add.html が value="10" / value="1" を初期値として持っているためで、
 * これは「入力済み」ではなく「未編集の既定値」。
 * したがって判定は「空かどうか」ではなく「人が触ったかどうか」で行う。
 */
export function initEditTracking(form = document.getElementById("recipe-form")) {
  if (!form) return;
  form.addEventListener(
    "input",
    (e) => {
      const el = e.target;
      if (!el.matches("input, textarea")) return;
      el.dataset.userEdited = "true";
      // 人が直した時点で AI の印は消す
      delete el.dataset.aiFilled;
      delete el.dataset.aiUncertain;
      el.removeAttribute("aria-describedby");
    },
    true
  );
}

/** 人が触っていない、または空になっている欄は AI が埋めてよい */
function canFill(el) {
  return el && (!el.dataset.userEdited || el.value.trim() === "");
}

function mark(el, uncertain) {
  if (!el) return;
  el.dataset.aiFilled = "true";
  if (uncertain) {
    el.dataset.aiUncertain = "true";
    // 色（緑／琥珀）だけで区別しない。読み上げにも伝える
    el.setAttribute("aria-describedby", "ai-uncertain-note");
  } else {
    delete el.dataset.aiUncertain;
    el.removeAttribute("aria-describedby");
  }
}

/** AI の印をすべて消す */
export function clearAiMarks(root = document) {
  for (const el of root.querySelectorAll("[data-ai-filled]")) {
    delete el.dataset.aiFilled;
    delete el.dataset.aiUncertain;
    el.removeAttribute("aria-describedby");
  }
}

/* ---------- スナップショット（取り消し用） ---------- */

/**
 * collectForm() では戻せない。空行を捨てるので、
 * 初期3行のうち1行だけ書いた状態から適用 → 取り消しすると行が減ってしまう。
 * DOM の状態をそのまま控える。
 */
export function snapshotForm() {
  const val = (id) => document.getElementById(id);
  const scalars = {};
  for (const id of Object.values(FIELD_INPUT_ID)) {
    const el = val(id);
    if (el) scalars[id] = { value: el.value, userEdited: Boolean(el.dataset.userEdited) };
  }

  const ingredients = [...document.querySelectorAll("#ing-rows .dyn-row")].map((row) => {
    const name = row.querySelector(".ing-name");
    const amount = row.querySelector(".ing-amount");
    return {
      name: name.value,
      amount: amount.value,
      nameEdited: Boolean(name.dataset.userEdited),
      amountEdited: Boolean(amount.dataset.userEdited),
    };
  });

  const steps = [...document.querySelectorAll("#step-rows .step-text")].map((el) => ({
    text: el.value,
    edited: Boolean(el.dataset.userEdited),
  }));

  return { scalars, ingredients, steps, tags: getTags() };
}

export function restoreForm(snap) {
  if (!snap) return;
  for (const [id, saved] of Object.entries(snap.scalars)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.value = saved.value;
    if (saved.userEdited) el.dataset.userEdited = "true";
    else delete el.dataset.userEdited;
  }

  const ings = snap.ingredients.length ? snap.ingredients : [{ name: "", amount: "" }];
  document.getElementById("ing-rows").replaceChildren(
    ...ings.map((i) => {
      const row = ingredientRow(i.name, i.amount);
      if (i.nameEdited) row.querySelector(".ing-name").dataset.userEdited = "true";
      if (i.amountEdited) row.querySelector(".ing-amount").dataset.userEdited = "true";
      return row;
    })
  );

  const steps = snap.steps.length ? snap.steps : [{ text: "" }];
  document.getElementById("step-rows").replaceChildren(
    ...steps.map((s) => {
      const row = stepRow(s.text);
      if (s.edited) row.querySelector(".step-text").dataset.userEdited = "true";
      return row;
    })
  );

  for (const group of TAG_GROUPS) setTags(group.key, snap.tags[group.key] ?? []);
  clearAiMarks();
}

/* ---------- 適用 ---------- */

function isLow(confidence, field) {
  return confidence[field] === "low";
}

function isUncertain(confidence, field) {
  return confidence[field] !== "high";
}

function applyScalar(field, value, confidence, result) {
  const el = document.getElementById(FIELD_INPUT_ID[field]);
  if (!el) return;
  if (value == null || value === "") {
    result.skipped.push(field);
    return;
  }
  if (isLow(confidence, field)) {
    // ほぼ当て推量の値をスカラー欄に書くと、人はそのまま投稿してしまう
    result.skipped.push(field);
    return;
  }
  if (!canFill(el)) {
    result.protected.push(field);
    return;
  }
  el.value = String(value);
  mark(el, isUncertain(confidence, field));
  result.filled.push(field);
}

function applyIngredients(items, confidence, result) {
  const box = document.getElementById("ing-rows");
  const rows = [...box.querySelectorAll(".dyn-row")];
  const existing = rows
    .map((r) => r.querySelector(".ing-name").value.trim())
    .filter(Boolean);

  const nameUncertain = isUncertain(confidence, "ingredientNames");
  const amountUncertain = isUncertain(confidence, "ingredientAmounts");

  const build = (item) => {
    const row = ingredientRow(item.name, item.amount);
    mark(row.querySelector(".ing-name"), nameUncertain);
    // 分量は名前と別に判定する。写真だけの入力では名前は読めても分量は読めない
    if (item.amount) mark(row.querySelector(".ing-amount"), amountUncertain);
    return row;
  };

  if (!existing.length) {
    const next = items.map(build);
    // 既存フォームの「初期3行」の感覚に合わせて、少なければ空行で埋める
    while (next.length < 3) next.push(ingredientRow());
    box.replaceChildren(...next);
    result.filled.push("ingredientNames");
    if (items.some((i) => i.amount)) result.filled.push("ingredientAmounts");
    return;
  }

  // 人が既に書いている場合は消さずに、重複しないものだけ足す
  let added = 0;
  for (const item of items) {
    if (existing.includes(item.name)) continue;
    const empty = rows.find(
      (r) => !r.querySelector(".ing-name").value.trim() && !r.querySelector(".ing-name").dataset.userEdited
    );
    if (empty) {
      empty.remove();
      rows.splice(rows.indexOf(empty), 1);
    }
    box.appendChild(build(item));
    added++;
  }
  if (added) result.filled.push("ingredientNames");
  else result.protected.push("ingredientNames");
}

function applySteps(steps, confidence, result) {
  const box = document.getElementById("step-rows");
  const rows = [...box.querySelectorAll(".dyn-row")];
  const existing = rows.map((r) => r.querySelector(".step-text").value.trim()).filter(Boolean);
  const uncertain = isUncertain(confidence, "steps");

  if (existing.length) {
    result.protected.push("steps");
    return;
  }

  const next = steps.map((text) => {
    const row = stepRow(text);
    mark(row.querySelector(".step-text"), uncertain);
    return row;
  });
  while (next.length < 3) next.push(stepRow());
  box.replaceChildren(...next);
  result.filled.push("steps");
}

function applyTags(draft, confidence, result) {
  for (const group of TAG_GROUPS) {
    const names = draft[group.key];
    if (!Array.isArray(names) || !names.length) continue;
    const current = getTags()[group.key] ?? [];
    if (current.length) {
      result.protected.push(group.key);
      continue;
    }
    setTags(group.key, names);
    result.filled.push(group.key);
    if (isUncertain(confidence, group.key)) result.uncertainTags.push(group.key);
  }
}

/**
 * DraftPayload をフォームに流し込む。
 *
 * @param {object} payload BFF が返した DraftPayload
 * @returns {{filled: string[], skipped: string[], protected: string[], uncertainTags: string[]}}
 */
export function applyDraft(payload) {
  const { draft, confidence } = payload;
  const result = { filled: [], skipped: [], protected: [], uncertainTags: [] };

  for (const field of SCALAR_FIELDS) {
    applyScalar(field, draft[field], confidence, result);
  }

  if (draft.notes) {
    const el = document.getElementById("f-notes");
    if (canFill(el)) {
      el.value = draft.notes;
      mark(el, isUncertain(confidence, "notes"));
      result.filled.push("notes");
    } else {
      result.protected.push("notes");
    }
  }

  if (draft.ingredients?.length) applyIngredients(draft.ingredients, confidence, result);
  if (draft.steps?.length) applySteps(draft.steps, confidence, result);
  applyTags(draft, confidence, result);

  return result;
}

export const FIELD_GROUPS = { SCALAR_FIELDS, LIST_FIELDS };
