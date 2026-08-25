/*
 * X（旧Twitter）への投稿を助ける部分。
 *
 * やること: AI が書いた紹介文を出す / 文字数を X と同じ数え方で表示する /
 *          コピー / 投稿画面を開く。
 *
 * **自動投稿はしない。** 理由は3つある。
 *   1. X API に「下書きに保存」の口が無い。下書きはクライアント側の機能。
 *   2. BFF に書き込み権限を持たせると、この設計の前提（D-1）が崩れる。
 *   3. 2026-02 に新規無料枠が終わり、リンク付き投稿は割に合わない。
 * 代わりに、投稿画面を本文入りで開くところまでを自動にする。
 */

import { el } from "./common.js";

const SITE_BASE = "https://jisui-hack.github.io/recipe-site";
const X_LIMIT = 280; // 重み付き。日本語は1文字=2

let currentText = "";

/**
 * X と同じ数え方の文字数。
 * コードポイントが 0x1100 未満（と一部の記号）は 1、それ以外は 2 と数える。
 */
export function weightedLength(text) {
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    const light =
      c <= 0x10ff ||
      (c >= 0x2000 && c <= 0x200d) ||
      (c >= 0x2010 && c <= 0x201f) ||
      (c >= 0x2032 && c <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

/** 投稿本文。URL があれば末尾に付ける（X では URL は一律 23 として数えられる） */
export function composeText(body, url) {
  return url ? `${body}\n${url}` : body;
}

/** 投稿画面を開く URL。X が本文を入れた状態で開いてくれる */
export function intentUrl(text) {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

function box() {
  return document.getElementById("x-post");
}

function render(url) {
  const text = composeText(currentText, url);
  const used = weightedLength(currentText) + (url ? 24 : 0); // URL は 23 + 改行1
  const over = used > X_LIMIT;

  document.getElementById("x-post-text").value = currentText;
  const counter = document.getElementById("x-post-count");
  counter.textContent = `${used} / ${X_LIMIT}`;
  counter.dataset.over = over ? "true" : "false";

  const open = document.getElementById("x-post-open");
  open.href = intentUrl(text);
  open.setAttribute("aria-disabled", over ? "true" : "false");

  document.getElementById("x-post-url").textContent = url
    ? `投稿にこの URL が付きます: ${url}`
    : "レシピを投稿するとURLが決まります。先にXへ出す場合はURLなしになります。";
}

/** BFF が返した紹介文を表示する */
export function showXPost(text) {
  currentText = (text ?? "").trim();
  if (!currentText) {
    box().hidden = true;
    return;
  }
  box().hidden = false;
  render(null);
}

export function clearXPost() {
  currentText = "";
  const b = box();
  if (b) b.hidden = true;
}

/**
 * レシピの投稿が終わったら、確定した URL を本文に反映する。
 *
 * add.js は投稿成功時に #result へ詳細ページへのリンクを入れる。
 * add.js に手を入れたくないので、その DOM 変化を見て拾う。
 */
function watchForPostedRecipe() {
  const result = document.getElementById("result");
  if (!result) return;
  new MutationObserver(() => {
    if (result.hidden || !currentText) return;
    const link = result.querySelector('a[href^="recipe.html?id="]');
    if (!link) return;
    const id = new URLSearchParams(link.getAttribute("href").split("?")[1]).get("id");
    if (id) render(`${SITE_BASE}/recipe.html?id=${encodeURIComponent(id)}`);
  }).observe(result, { childList: true, subtree: true, attributes: true });
}

export function initXPost() {
  const b = box();
  if (!b) return;

  document.getElementById("x-post-text").addEventListener("input", (e) => {
    currentText = e.target.value;
    const link = document.getElementById("result")?.querySelector('a[href^="recipe.html?id="]');
    const id = link && new URLSearchParams(link.getAttribute("href").split("?")[1]).get("id");
    render(id ? `${SITE_BASE}/recipe.html?id=${encodeURIComponent(id)}` : null);
  });

  document.getElementById("x-post-copy").addEventListener("click", async () => {
    const status = document.getElementById("x-post-status");
    const link = document.getElementById("result")?.querySelector('a[href^="recipe.html?id="]');
    const id = link && new URLSearchParams(link.getAttribute("href").split("?")[1]).get("id");
    const text = composeText(currentText, id ? `${SITE_BASE}/recipe.html?id=${id}` : null);
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "コピーしました";
    } catch {
      // 権限が無い環境向けの保険。選択状態にすれば手でコピーできる
      document.getElementById("x-post-text").select();
      status.textContent = "選択しました。⌘C でコピーしてください";
    }
    setTimeout(() => (status.textContent = ""), 3000);
  });

  watchForPostedRecipe();
}
