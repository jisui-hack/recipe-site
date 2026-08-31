/** 画面をまたいで使う小さな部品。 */

import { TAG_GROUPS, tagsOf } from "./tags.js";

export const DATA_INDEX = "data/index.json";

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v; // tags.js のイラストなど、自前の定数だけに使う
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(child);
  }
  return node;
}

/** createdAt 降順、同日は id 昇順 */
export function byNewest(a, b) {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id.localeCompare(b.id);
}

export async function loadIndex() {
  const res = await fetch(DATA_INDEX, { cache: "no-cache" });
  if (!res.ok) throw new Error(`index.json: ${res.status}`);
  return res.json();
}

/** タグのイラストを並べた行（カード用・小さめ） */
export function tagIconRow(recipe) {
  const tags = tagsOf(recipe);
  if (!tags.length) return null;
  return el(
    "span",
    { class: "tag-icons", "aria-hidden": "true" },
    tags.map(({ tag }) => el("span", { class: "tag-icon-wrap", html: tag.icon, title: tag.name }))
  );
}

/** カードの読み上げ用に、タグ名をまとめたテキスト */
function tagText(recipe) {
  const names = tagsOf(recipe).map(({ tag }) => tag.name);
  return names.length ? `タグ: ${names.join("、")}` : "";
}

/**
 * レシピカード1枚。
 * @param {object} r index.json の1行
 * @param {number} matched 材料タグの一致数（0なら非表示）
 */
export function renderCard(r, matched = 0) {
  const thumb = r.thumb
    ? el("img", {
        class: "card-thumb",
        src: r.thumb,
        alt: r.title,
        loading: "lazy",
        width: "72",
        height: "72",
      })
    : el("div", { class: "card-thumb card-thumb-ph", text: "🍳", "aria-hidden": "true" });

  const meta = el("div", { class: "card-meta" }, [
    el("span", { text: `⏱ ${r.timeMinutes ?? "-"}分` }),
    matched > 0 ? el("span", { class: "badge", text: `${matched}つ一致` }) : null,
    tagIconRow(r),
    tagText(r) ? el("span", { class: "visually-hidden", text: tagText(r) }) : null,
  ]);

  return el("li", {}, [
    el("a", { class: "card", href: `recipe.html?id=${encodeURIComponent(r.id)}` }, [
      thumb,
      el("div", { class: "card-body" }, [el("p", { class: "card-title", text: r.title }), meta]),
    ]),
  ]);
}

/** タイトルの部分一致（NFKC・大文字小文字を無視） */
export function matchesQuery(recipe, query) {
  const q = query.normalize("NFKC").trim().toLowerCase();
  if (!q) return true;
  return recipe.title.normalize("NFKC").toLowerCase().includes(q);
}

/** レシピが持つ材料タグ（protein + plant）の名前一覧 */
export function ingredientTagsOf(recipe) {
  return TAG_GROUPS.filter((g) => g.key !== "genre").flatMap((g) => recipe[g.key] ?? []);
}

/* ---------- 設定の保存 ---------- */

/**
 * localStorage へ書いて、**本当に残ったか読み返す。**
 *
 * プライベートブラウズや、保存が禁じられた状態では setItem が例外を投げるか、
 * 投げずに何も残らないことがある。それを見ずに「保存しました」と出していたため、
 * 次に開くと消えている理由が分からなかった。書けたかどうかを返す。
 */
export function rememberSetting(key, value) {
  try {
    if (value === null || value === undefined || value === "") {
      localStorage.removeItem(key);
      return localStorage.getItem(key) === null;
    }
    localStorage.setItem(key, value);
    return localStorage.getItem(key) === value;
  } catch {
    return false;
  }
}

/**
 * この端末で設定を覚えていられるか。
 * 覚えられないなら、入れ直しても無駄だと先に言ったほうがよい。
 */
export function storageWorks() {
  const probe = "__probe__";
  try {
    localStorage.setItem(probe, "1");
    const ok = localStorage.getItem(probe) === "1";
    localStorage.removeItem(probe);
    return ok;
  } catch {
    return false;
  }
}

/** 保存が効かない端末への案内。文言を1か所にまとめる */
export const STORAGE_WARNING =
  "この画面では設定を保存できません。プライベートブラウズか、" +
  "アプリ内ブラウザで開いている可能性があります。Safari や Chrome で開き直してください。";
