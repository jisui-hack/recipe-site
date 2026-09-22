/* レシピ詳細。add.html のプレビューからも renderRecipe を使う。 */

import { el } from "./common.js";
import { TAG_GROUPS, findTag } from "./tags.js";

/** タグをグループごとにイラスト付きで並べる */
function tagSection(recipe) {
  const rows = [];
  for (const group of TAG_GROUPS) {
    const names = (recipe[group.key] ?? []).filter((n) => findTag(group.key, n));
    if (!names.length) continue;
    rows.push(
      el("div", { class: "tag-row" }, [
        el("span", { class: "tag-row-label", text: group.label }),
        el(
          "span",
          { class: "tag-row-items" },
          names.map((name) =>
            el("span", { class: "tag-pill" }, [
              el("span", { class: "tag-icon-wrap", html: findTag(group.key, name).icon, "aria-hidden": "true" }),
              el("span", { text: name }),
            ])
          )
        ),
      ])
    );
  }
  return rows.length ? el("div", { class: "tag-rows" }, rows) : null;
}

/** 材料・手順の「済」トグル。タップ／Enter／Space で切り替える */
function bindCheckToggles(root) {
  const toggle = (node) => {
    const on = node.getAttribute("aria-pressed") !== "true";
    node.setAttribute("aria-pressed", on ? "true" : "false");
    node.classList.toggle("is-done", on);
  };
  root.addEventListener("click", (e) => {
    const node = e.target.closest(".check");
    if (node && root.contains(node)) toggle(node);
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const node = e.target.closest(".check");
    if (!node) return;
    e.preventDefault();
    toggle(node);
  });
}

/**
 * 調理中に画面がロックされないようにするボタン。
 * Wake Lock API に対応した端末（iOS 16.4+ / Android Chrome）でだけ出す。
 * 別タブに移るとOSが解放するので、戻ってきたら取り直す。
 */
let wakeLock = null;
function wakeLockButton() {
  if (!("wakeLock" in navigator)) return null;
  const btn = el("button", { type: "button", class: "wake-btn", "aria-pressed": "false", text: "画面をつけたままにする" });
  const setLabel = (on) => {
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "画面をつけたまま：オン" : "画面をつけたままにする";
  };
  const acquire = async () => {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; setLabel(false); });
      setLabel(true);
    } catch {
      setLabel(false);
    }
  };
  btn.addEventListener("click", async () => {
    if (wakeLock) { await wakeLock.release(); wakeLock = null; setLabel(false); return; }
    await acquire();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && btn.getAttribute("aria-pressed") === "true" && !wakeLock) acquire();
  });
  return btn;
}

export function renderRecipe(r, root) {
  const nodes = [];

  if (r.thumb) {
    nodes.push(el("img", { class: "detail-thumb", src: r.thumb, alt: r.title, loading: "lazy" }));
  }
  nodes.push(el("h1", { class: "detail-title", text: r.title }));

  nodes.push(
    el("div", { class: "detail-meta" }, [
      el("span", { text: `⏱ ${r.timeMinutes ?? "-"}分` }),
      el("span", { text: `${r.servings ?? 1}人前` }),
    ])
  );

  nodes.push(tagSection(r));

  // 材料・手順はタップで「済」にできる（このページ内だけ。保存はしない）
  nodes.push(
    el("div", { class: "section-head" }, [
      el("h2", { text: "材料" }),
      el("span", { class: "muted hint", text: "タップで済にできます" }),
    ])
  );
  const rows = (r.ingredients ?? []).map((ing) =>
    el("tr", { class: "check", role: "button", tabindex: "0", "aria-pressed": "false" }, [
      el("th", { scope: "row", text: ing.name }),
      el("td", { class: "amount", text: ing.amount ?? "" }),
    ])
  );
  nodes.push(el("table", { class: "ingredients" }, [el("tbody", {}, rows)]));

  nodes.push(
    el("div", { class: "section-head" }, [
      el("h2", { text: "手順" }),
      wakeLockButton(),
    ])
  );
  nodes.push(
    el(
      "ol",
      { class: "steps" },
      (r.steps ?? []).map((s) =>
        el("li", { class: "check", role: "button", tabindex: "0", "aria-pressed": "false", text: s })
      )
    )
  );

  if (r.notes) {
    nodes.push(el("h2", { text: "メモ" }));
    nodes.push(el("p", { text: r.notes }));
  }

  if (r.sourceUrl) {
    nodes.push(
      el("p", {}, [
        el("a", {
          href: r.sourceUrl,
          target: "_blank",
          rel: "noopener noreferrer",
          text: "元記事を見る →",
        }),
      ])
    );
  }

  root.replaceChildren(...nodes.filter(Boolean));
  root.hidden = false;
  if (!root.dataset.checkBound) {
    bindCheckToggles(root);
    root.dataset.checkBound = "1";
  }
}

async function main() {
  const status = document.getElementById("status");
  const root = document.getElementById("recipe");
  const id = new URLSearchParams(location.search).get("id");

  if (!id) {
    status.textContent = "レシピIDが指定されていません。";
    return;
  }
  // パストラバーサル防止：IDに使える文字を限定する
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    status.textContent = "見つかりませんでした。";
    return;
  }

  try {
    const res = await fetch(`data/recipes/${id}.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error("not found");
    const recipe = await res.json();
    status.hidden = true;
    document.title = `${recipe.title} | 自炊の本棚`;
    renderRecipe(recipe, root);
  } catch {
    status.textContent = "見つかりませんでした。";
  }
}

if (document.getElementById("recipe")) main();
