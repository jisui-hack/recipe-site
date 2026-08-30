/*
 * 投稿済みのレシピをフォームに読み込んで直す。
 *
 * **読む先と書く先を揃える。** 編集はリポジトリの中身を書き換えるので、
 * 土台も GitHub から読む。公開サイト（GitHub Pages）は反映が数十秒遅れるため、
 * そちらを土台にすると、投稿直後に直したときに前の内容へ巻き戻してしまう。
 * ローカルで開いている場合も、手元のチェックアウトが古いと同じことが起きる。
 *
 * トークン未設定のときだけ、サイト自身の JSON にフォールバックする
 * （設定前でも「どれを直すか」は見えたほうがよい。上書きはどのみちできない）。
 *
 * 上書きのコミットは add.js の既存の道をそのまま通る。新規と違うのは
 * ID を採番しないことと sha を渡すことだけで、検証・タグ・index の更新は共有する。
 */

import { byNewest } from "./common.js";
import { TAG_GROUPS } from "./tags.js";
import {
  REPO_PREFIX,
  deleteRecipe,
  githubConfig,
  ingredientRow,
  setTags,
  startEditing,
  stepRow,
  stopEditing,
} from "./add.js";

const $ = (id) => document.getElementById(id);

/** 読み込んだ一覧。絞り込みはこれを使い回す */
let recipes = [];

/** いまフォームに入っているレシピ。削除に id と thumb が要る */
let current = null;

/** 削除ボタンを2回押させるための状態。戻せない操作を1クリックで通さない */
let armed = false;
let armedTimer = null;

function setStatus(text) {
  const s = $("edit-status");
  if (s) s.textContent = text;
}

/* ---------- 取得 ---------- */

function apiUrl(cfg, path) {
  const encoded = encodeURIComponent(path).replace(/%2F/g, "/");
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encoded}?ref=${encodeURIComponent(cfg.branch)}`;
}

function usable(cfg) {
  return Boolean(cfg.owner && cfg.repo && cfg.token);
}

/** GitHub から1ファイル読む。base64 で返ってくる */
async function ghRead(cfg, path) {
  const res = await fetch(apiUrl(cfg, path), {
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub から読めませんでした（${res.status}）`);
  const file = await res.json();
  // UTF-8 の日本語が化けないように decode する
  const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** サイト自身から読む（トークン未設定のとき用） */
async function siteRead(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`読めませんでした（${res.status}）`);
  return res.json();
}

/**
 * GitHub を優先し、駄目ならサイト側に落とす。
 *
 * **トークンが切れていても一覧は見えたほうがよい。** 空のリストだけ出されると
 * 「投稿が消えた」ように見える。落ちたことは from に出して隠さない。
 */
async function loadIndex() {
  const cfg = githubConfig();
  if (usable(cfg)) {
    try {
      return { list: await ghRead(cfg, `${REPO_PREFIX}data/index.json`), from: "GitHub" };
    } catch (e) {
      const list = await siteRead("data/index.json");
      return { list, from: `公開サイト（GitHub は ${e.message}）` };
    }
  }
  return { list: await siteRead("data/index.json"), from: "公開サイト（トークン未設定）" };
}

async function loadRecipe(id) {
  const cfg = githubConfig();
  const path = `data/recipes/${id}.json`;
  if (!usable(cfg)) return siteRead(path);
  try {
    return await ghRead(cfg, `${REPO_PREFIX}${path}`);
  } catch {
    // 土台が古くなる可能性があるので、落ちたことは呼び出し側で伝える
    const recipe = await siteRead(path);
    recipe.__fromSite = true;
    return recipe;
  }
}

/* ---------- 一覧の表示 ---------- */

/** 検索対象。index.json には材料が無いので、料理名とタグで引く */
function haystack(r) {
  const tags = TAG_GROUPS.flatMap((g) => r[g.key] ?? []);
  return [r.title, r.id, r.createdAt, ...tags].join(" ").toLowerCase();
}

function matches(r, query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = haystack(r);
  return terms.every((t) => hay.includes(t)); // 空白区切りは AND
}

function renderList() {
  const query = $("edit-query").value;
  const hits = recipes.filter((r) => matches(r, query));

  $("edit-count").textContent = query.trim()
    ? `${hits.length} / ${recipes.length} 件`
    : `${recipes.length} 件`;

  if (!hits.length) {
    const li = document.createElement("li");
    li.className = "edit-empty";
    li.textContent = recipes.length ? "見つかりませんでした" : "投稿されたレシピがありません";
    $("edit-list").replaceChildren(li);
    return;
  }

  $("edit-list").replaceChildren(
    ...hits.map((r) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "edit-item";
      btn.dataset.id = r.id;

      const title = document.createElement("span");
      title.className = "edit-item-title";
      title.textContent = r.title;

      const meta = document.createElement("span");
      meta.className = "edit-item-meta";
      const tags = TAG_GROUPS.flatMap((g) => r[g.key] ?? []).slice(0, 4);
      meta.textContent = [r.createdAt, tags.join("・")].filter(Boolean).join("　");

      btn.append(title, meta);

      const li = document.createElement("li");
      li.appendChild(btn);
      return li;
    })
  );
}

/* ---------- フォームへ流し込む ---------- */

/**
 * **空欄も含めて全部上書きする。** 一部だけ残すと、前に開いていたレシピの
 * 材料が混ざったまま上書きしてしまう。AI下書きの「触った欄は残す」とは逆の方針。
 */
function fillForm(recipe) {
  $("f-title").value = recipe.title ?? "";
  $("f-time").value = recipe.timeMinutes ?? "";
  $("f-servings").value = recipe.servings ?? 1;
  $("f-source").value = recipe.sourceUrl ?? "";
  $("f-notes").value = recipe.notes ?? "";

  const ings = recipe.ingredients?.length ? recipe.ingredients : [{ name: "", amount: "" }];
  $("ing-rows").replaceChildren(...ings.map((i) => ingredientRow(i.name ?? "", i.amount ?? "")));

  const steps = recipe.steps?.length ? recipe.steps : [""];
  $("step-rows").replaceChildren(...steps.map((t) => stepRow(t)));

  for (const group of TAG_GROUPS) setTags(group.key, recipe[group.key] ?? []);

  // 画像は File を差し込めない。選び直さなければ元のまま残る
  $("f-image").value = "";
  $("image-info").textContent = recipe.thumb
    ? `サムネイルは ${recipe.thumb} のままです。差し替えるときだけ選んでください`
    : "サムネイルはありません";
}

function markSelected(id) {
  for (const btn of document.querySelectorAll(".edit-item")) {
    btn.setAttribute("aria-current", btn.dataset.id === id ? "true" : "false");
  }
}

async function pick(id) {
  setStatus("読み込んでいます…");
  disarmDelete();
  try {
    const recipe = await loadRecipe(id);
    const fromSite = Boolean(recipe.__fromSite);
    delete recipe.__fromSite; // 保存する JSON に混ぜない

    fillForm(recipe);
    startEditing(recipe);
    markSelected(id);
    current = recipe;
    $("edit-cancel").hidden = false;
    $("edit-delete").hidden = false;
    setStatus(
      fromSite
        ? `${recipe.title} を公開サイトから読み込みました。反映待ちの変更があると巻き戻る恐れがあります`
        : `${recipe.title} を読み込みました`
    );
    $("f-title").scrollIntoView?.({ behavior: "smooth", block: "center" });
  } catch (e) {
    setStatus(e.message);
  }
}

function onCancel() {
  stopEditing();
  markSelected(null);
  current = null;
  disarmDelete();
  $("edit-cancel").hidden = true;
  $("edit-delete").hidden = true;
  setStatus("新規作成に戻しました。フォームの中身はそのままです");
}

/* ---------- 削除 ---------- */

function disarmDelete() {
  armed = false;
  clearTimeout(armedTimer);
  const btn = $("edit-delete");
  if (!btn) return;
  btn.textContent = "このレシピを削除";
  btn.classList.remove("armed");
}

/**
 * 1回目で身構え、2回目で消す。
 *
 * **戻せない操作を1クリックで通さない。** confirm() を使わないのは、
 * 押した直後に別の作業へ移れる（画面が固まらない）ようにするため。
 * 10秒で解除するので、押しっぱなしのまま忘れても事故にならない。
 */
async function onDelete() {
  if (!current) return;

  if (!armed) {
    armed = true;
    const btn = $("edit-delete");
    btn.textContent = `「${current.title}」を本当に削除（もう一度押す）`;
    btn.classList.add("armed");
    setStatus("戻せません。取りやめるなら10秒待つか、別のレシピを選んでください");
    armedTimer = setTimeout(() => {
      disarmDelete();
      setStatus("削除を取りやめました");
    }, 10_000);
    return;
  }

  const target = current;
  disarmDelete();
  setStatus(`${target.title} を削除しています…`);

  const ok = await deleteRecipe({ id: target.id, title: target.title, thumb: target.thumb });
  if (!ok) {
    setStatus("削除に失敗しました。上の進捗を見てください");
    return;
  }

  current = null;
  $("edit-cancel").hidden = true;
  $("edit-delete").hidden = true;
  recipes = recipes.filter((r) => r.id !== target.id);
  renderList();
  setStatus(`${target.title} を削除しました`);
}

async function refresh() {
  setStatus("一覧を読み込んでいます…");
  try {
    const { list, from } = await loadIndex();
    recipes = Array.isArray(list) ? [...list].sort(byNewest) : [];
    renderList();
    setStatus(`${from} から ${recipes.length} 件`);
  } catch (e) {
    recipes = [];
    renderList();
    setStatus(e.message);
  }
}

export async function initEdit() {
  if (!$("edit-pick")) return;

  $("edit-query").addEventListener("input", renderList);
  $("edit-reload").addEventListener("click", refresh);
  $("edit-cancel").addEventListener("click", onCancel);
  $("edit-delete").addEventListener("click", onDelete);
  $("edit-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".edit-item");
    if (btn) pick(btn.dataset.id);
  });

  await refresh();
}

initEdit();
