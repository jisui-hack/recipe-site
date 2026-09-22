/* 材料から探す：肉・魚・卵／野菜・豆腐などのタグを選んで絞り込む */

import { byNewest, el, ingredientTagsOf, loadIndex, renderCard } from "./common.js";
import { SEARCHABLE_GROUPS } from "./tags.js";

const STORE_KEY = "search_state";

const state = {
  index: [],
  selected: new Set(), // タグ名
  mode: "or",
};

function saveState() {
  try {
    sessionStorage.setItem(
      STORE_KEY,
      JSON.stringify({ selected: [...state.selected], mode: state.mode })
    );
  } catch { /* 保存できなくてよい */ }
}

function loadState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "null");
    if (!saved) return;
    state.selected = new Set(saved.selected ?? []);
    state.mode = saved.mode === "subset" ? "subset" : "or";
  } catch { /* 壊れていたら初期状態 */ }
}

/**
 * 絞り込み。
 * - いずれか使う（OR）: 選んだ素材のどれかを使うレシピ。一致数が多い順。
 * - これだけで作れる（サブセット）: レシピの素材がすべて選択に含まれるもの。
 *   （調味料はタグにしていないので、選んだ素材だけで組み立てられるレシピが残る）
 */
function filterRecipes() {
  const scored = state.index.map((r) => {
    const tags = ingredientTagsOf(r);
    const matched = tags.filter((t) => state.selected.has(t)).length;
    const isSubset = tags.length > 0 && tags.every((t) => state.selected.has(t));
    return { r, matched, isSubset };
  });

  if (state.selected.size === 0) {
    return scored.sort((a, b) => byNewest(a.r, b.r));
  }

  const list = scored.filter((s) => (state.mode === "subset" ? s.isSubset : s.matched >= 1));
  list.sort(
    (a, b) =>
      b.matched - a.matched ||
      (a.r.timeMinutes ?? 999) - (b.r.timeMinutes ?? 999) ||
      a.r.title.localeCompare(b.r.title, "ja")
  );
  return list;
}

/* ---------- 描画 ---------- */

function renderGroups() {
  const box = document.getElementById("groups");
  box.replaceChildren(
    ...SEARCHABLE_GROUPS.map((group) =>
      el("section", { class: "tag-group" }, [
        el("h2", { class: "tag-group-title", text: group.label }),
        el(
          "div",
          { class: "chips" },
          group.tags.map((tag) =>
            el(
              "button",
              {
                type: "button",
                class: "chip chip-tag",
                "aria-pressed": state.selected.has(tag.name) ? "true" : "false",
                "data-name": tag.name,
              },
              [
                el("span", { class: "tag-icon-wrap", html: tag.icon, "aria-hidden": "true" }),
                el("span", { class: "chip-label", text: tag.name }),
              ]
            )
          )
        ),
      ])
    )
  );
}

function renderSelected() {
  const area = document.getElementById("selected-area");
  const box = document.getElementById("selected-chips");
  if (state.selected.size === 0) {
    area.hidden = true;
    box.replaceChildren();
    return;
  }
  area.hidden = false;
  box.replaceChildren(
    ...[...state.selected].map((name) =>
      el(
        "button",
        { type: "button", class: "chip-remove", "data-name": name, "aria-label": `${name} を外す` },
        [document.createTextNode(`${name} ✕`)]
      )
    )
  );
}

function render() {
  renderGroups();
  renderSelected();

  const list = filterRecipes();

  document.getElementById("list-heading").textContent =
    state.selected.size === 0 ? `レシピ（${list.length}件）` : `該当レシピ（${list.length}件）`;

  const status = document.getElementById("status");
  status.hidden = list.length > 0;
  status.textContent =
    state.mode === "subset"
      ? "選んだ素材だけで作れるレシピはありませんでした。「いずれか使う」も試してみてください。"
      : "該当するレシピがありませんでした。";

  document
    .getElementById("card-list")
    .replaceChildren(...list.map(({ r, matched }) => renderCard(r, matched)));

  // 貼り付くバーの件数。結果が画面外にあっても、ここで手応えが返る
  document.getElementById("hit-count").textContent =
    state.selected.size === 0 ? "" : `→ ${list.length}件`;

  saveState();
}

/* ---------- イベント ---------- */

function bindEvents() {
  document.getElementById("groups").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-tag");
    if (!btn) return;
    const name = btn.dataset.name;
    if (state.selected.has(name)) state.selected.delete(name);
    else state.selected.add(name);
    render();
  });

  document.getElementById("selected-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-remove");
    if (!btn) return;
    state.selected.delete(btn.dataset.name);
    render();
  });

  document.getElementById("clear-all").addEventListener("click", () => {
    state.selected.clear();
    render();
  });

  document.getElementById("jump-results").addEventListener("click", () => {
    document.getElementById("list-heading").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener("change", () => {
      state.mode = radio.value;
      render();
    });
  }
}

async function main() {
  const status = document.getElementById("status");
  try {
    state.index = await loadIndex();
    loadState();
    document.querySelector(`input[name="mode"][value="${state.mode}"]`).checked = true;
    bindEvents();
    render();
  } catch (err) {
    status.textContent = `読み込みに失敗しました: ${err.message}`;
  }
}

main();
