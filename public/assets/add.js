/* 投稿フォーム → GitHub Contents API 直コミット */

import { STORAGE_WARNING, byNewest, el, rememberSetting, standaloneApp, storageContextNote } from "./common.js";
import { renderRecipe } from "./recipe.js";
import { TAG_GROUPS } from "./tags.js";

const TOKEN_KEY = "gh_token";
const CONFIG_KEY = "gh_config";
const REPO_PREFIX = "public/"; // GitHub Pages の公開ルートがリポジトリ内のどこか

/* ---------- 設定（localStorage） ---------- */

/** GitHub Pages 上なら owner/repo を URL から推測する */
function guessRepo() {
  const m = /^([^.]+)\.github\.io$/.exec(location.hostname);
  if (!m) return {};
  const seg = location.pathname.split("/").filter(Boolean)[0];
  return { owner: m[1], repo: seg ?? `${m[1]}.github.io` };
}

function loadConfig() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}");
  } catch { /* 壊れていたら空扱い */ }
  const guessed = guessRepo();
  return {
    owner: saved.owner || guessed.owner || "",
    repo: saved.repo || guessed.repo || "",
    branch: saved.branch || "main",
    token: localStorage.getItem(TOKEN_KEY) || "",
  };
}

function showStorageContext(id) {
  const box = document.getElementById(id);
  if (!box) return;
  box.textContent = storageContextNote();
  box.dataset.standalone = String(standaloneApp());
}

function initSettings() {
  showStorageContext("storage-context");
  const cfg = loadConfig();
  document.getElementById("cfg-owner").value = cfg.owner;
  document.getElementById("cfg-repo").value = cfg.repo;
  document.getElementById("cfg-branch").value = cfg.branch;
  document.getElementById("cfg-token").value = cfg.token;

  const status = document.getElementById("cfg-status");
  if (!cfg.token || !cfg.owner || !cfg.repo) {
    document.getElementById("settings").open = true;
    status.textContent = "未設定です";
  } else {
    status.textContent = `${cfg.owner}/${cfg.repo} @ ${cfg.branch}`;
  }

  document.getElementById("cfg-save").addEventListener("click", () => {
    const owner = document.getElementById("cfg-owner").value.trim();
    const repo = document.getElementById("cfg-repo").value.trim();
    const branch = document.getElementById("cfg-branch").value.trim() || "main";
    const token = document.getElementById("cfg-token").value.trim();
    const okCfg = rememberSetting(CONFIG_KEY, JSON.stringify({ owner, repo, branch }));
    const okToken = token ? rememberSetting(TOKEN_KEY, token) : true;

    // 書けていないのに「保存しました」と出すと、次に開いて消えている理由が分からない
    status.textContent =
      okCfg && okToken ? `保存しました（${owner}/${repo} @ ${branch}）` : STORAGE_WARNING;
  });

  document.getElementById("cfg-clear").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    document.getElementById("cfg-token").value = "";
    status.textContent = "トークンを削除しました";
  });
}

/* ---------- 動的な材料／手順の行 ---------- */

function ingredientRow(name = "", amount = "") {
  return el("div", { class: "dyn-row" }, [
    el("input", { type: "text", class: "ing-name", placeholder: "材料名（例：玉ねぎ）", value: name }),
    el("input", { type: "text", class: "amount-input ing-amount", placeholder: "分量", value: amount }),
    el("button", { type: "button", class: "row-remove", "aria-label": "この材料を削除", text: "✕" }),
  ]);
}

function stepRow(text = "") {
  return el("div", { class: "dyn-row" }, [
    el("input", { type: "text", class: "step-text", placeholder: "手順を1行で", value: text }),
    el("button", { type: "button", class: "row-remove", "aria-label": "この手順を削除", text: "✕" }),
  ]);
}

function initRows() {
  const ings = document.getElementById("ing-rows");
  const steps = document.getElementById("step-rows");
  for (let i = 0; i < 3; i++) ings.appendChild(ingredientRow());
  for (let i = 0; i < 3; i++) steps.appendChild(stepRow());

  document.getElementById("add-ing").addEventListener("click", () => {
    const row = ingredientRow();
    ings.appendChild(row);
    row.querySelector("input").focus();
  });
  document.getElementById("add-step").addEventListener("click", () => {
    const row = stepRow();
    steps.appendChild(row);
    row.querySelector("input").focus();
  });

  for (const box of [ings, steps]) {
    box.addEventListener("click", (e) => {
      const btn = e.target.closest(".row-remove");
      if (!btn) return;
      // 最後の1行は消さずに空にする
      if (box.children.length <= 1) {
        for (const input of box.querySelectorAll("input")) input.value = "";
        return;
      }
      btn.closest(".dyn-row").remove();
    });
  }
}

/* ---------- タグ選択 ---------- */

/** groupKey -> Set(タグ名) */
const selectedTags = new Map(TAG_GROUPS.map((g) => [g.key, new Set()]));

function initTags() {
  const box = document.getElementById("tag-groups");
  box.replaceChildren(
    ...TAG_GROUPS.map((group) =>
      el("section", { class: "tag-group" }, [
        el("h3", { class: "tag-group-title", text: group.label }),
        el(
          "div",
          { class: "chips" },
          group.tags.map((tag) =>
            el(
              "button",
              {
                type: "button",
                class: "chip chip-tag",
                "aria-pressed": "false",
                "data-group": group.key,
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

  box.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-tag");
    if (!btn) return;
    const set = selectedTags.get(btn.dataset.group);
    const name = btn.dataset.name;
    if (set.has(name)) set.delete(name);
    else set.add(name);
    btn.setAttribute("aria-pressed", set.has(name) ? "true" : "false");
  });
}

function clearTags() {
  for (const set of selectedTags.values()) set.clear();
  for (const btn of document.querySelectorAll(".chip-tag")) {
    btn.setAttribute("aria-pressed", "false");
  }
}

/* ---------- フォーム収集・検証 ---------- */

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function collectForm() {
  const val = (id) => document.getElementById(id).value.trim();

  const ingredients = [...document.querySelectorAll("#ing-rows .dyn-row")]
    .map((row) => ({
      name: row.querySelector(".ing-name").value.trim(),
      amount: row.querySelector(".ing-amount").value.trim(),
    }))
    .filter((x) => x.name);

  const steps = [...document.querySelectorAll("#step-rows .step-text")]
    .map((i) => i.value.trim())
    .filter(Boolean);

  const time = parseInt(val("f-time"), 10);
  const servings = parseInt(val("f-servings"), 10);

  const form = {
    title: val("f-title"),
    timeMinutes: Number.isFinite(time) && time > 0 ? time : null,
    servings: Number.isFinite(servings) && servings > 0 ? servings : 1,
    ingredients,
    steps,
    sourceUrl: val("f-source") || null,
    createdAt: todayISO(),
    notes: val("f-notes"),
  };
  // タグはグループごとに配列で持たせる（0個でもキーは残す）
  for (const group of TAG_GROUPS) {
    form[group.key] = [...selectedTags.get(group.key)];
  }
  return form;
}

function validate(form) {
  const errors = [];
  if (!form.title) errors.push("タイトルを入力してください。");
  if (!form.ingredients.length) errors.push("材料を1件以上入力してください。");
  if (!form.steps.length) errors.push("手順を1件以上入力してください。");
  if (form.timeMinutes === null) errors.push("所要時間は1以上の数値で入力してください。");
  if (form.sourceUrl && !/^https?:\/\//i.test(form.sourceUrl)) {
    errors.push("元記事URLは http(s):// から始まる必要があります。");
  }
  return errors;
}

function showErrors(errors) {
  const box = document.getElementById("form-error");
  if (!errors.length) {
    box.hidden = true;
    box.textContent = "";
    return false;
  }
  box.hidden = false;
  box.textContent = errors.join("\n");
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return true;
}

/* ---------- ID採番 ---------- */

function randomSuffix(len = 4) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const buf = crypto.getRandomValues(new Uint8Array(len));
  return [...buf].map((b) => chars[b % chars.length]).join("");
}

function slugify(title) {
  const s = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/, "");
  return s.length >= 2 ? s : randomSuffix();
}

/** 同じ年の既存最大連番 + 1 */
function nextId(index, title, year = new Date().getFullYear()) {
  let max = 0;
  for (const r of index) {
    const m = /^(\d{4})-(\d{4})-/.exec(r.id ?? "");
    if (m && m[1] === String(year)) max = Math.max(max, Number(m[2]));
  }
  return `${year}-${String(max + 1).padStart(4, "0")}-${slugify(title)}`;
}

/* ---------- base64 ---------- */

function bytesToB64(bytes) {
  let bin = "";
  const CHUNK = 0x8000; // 引数が多すぎると fromCharCode が落ちるので分割する
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function textToB64(str) {
  return bytesToB64(new TextEncoder().encode(str));
}

function b64ToText(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/* ---------- 画像の縮小 ---------- */

const MAX_EDGE = 1024;
const TARGET_BYTES = 150 * 1024;

async function shrinkImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  let blob = null;
  for (const q of [0.8, 0.7, 0.6, 0.5]) {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
    if (!blob || blob.size <= TARGET_BYTES) break;
  }
  if (!blob) throw new Error("画像の変換に失敗しました");
  return blob;
}

function initImageField() {
  const input = document.getElementById("f-image");
  const info = document.getElementById("image-info");
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) {
      info.textContent = "";
      return;
    }
    info.textContent = "縮小中…";
    try {
      const blob = await shrinkImage(file);
      info.textContent = `縮小後 約${Math.round(blob.size / 1024)}KB（JPEG）でコミットします`;
    } catch (err) {
      info.textContent = `画像を読み込めませんでした: ${err.message}`;
    }
  });
}

/* ---------- GitHub API ---------- */

function apiUrl(cfg, path) {
  const encoded = encodeURIComponent(path).replace(/%2F/g, "/");
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encoded}`;
}

function describeError(status, body) {
  if (status === 401) return "トークンが無効です（401）。設定を確認してください。";
  if (status === 403) return "権限が足りません（403）。Contents: Read and write を許可してください。";
  if (status === 404) return "リポジトリまたはパスが見つかりません（404）。owner/repo/branch を確認してください。";
  if (status === 409) return "他の変更と競合しました（409）。もう一度実行してください。";
  if (status === 422) return `内容が受け付けられませんでした（422）。${body}`;
  return `${status} ${body}`;
}

async function ghGet(cfg, path) {
  const res = await fetch(`${apiUrl(cfg, path)}?ref=${encodeURIComponent(cfg.branch)}`, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (res.status === 404) return null; // まだ存在しないファイル
  if (!res.ok) throw new Error(describeError(res.status, await res.text()));
  return res.json();
}

/**
 * ファイルを消す。**GitHub は sha が無いと消させない。**
 * 消えていた（404）場合は成功扱いにする。途中で失敗した削除をやり直せるように。
 */
async function deleteFile(cfg, { path, message }) {
  const file = await ghGet(cfg, path);
  if (!file) return false;
  const res = await fetch(apiUrl(cfg, path), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ message, sha: file.sha, branch: cfg.branch }),
  });
  if (!res.ok) throw new Error(`${path}: ${describeError(res.status, await res.text())}`);
  return true;
}

async function putFile(cfg, { path, contentBase64, message, sha }) {
  const res = await fetch(apiUrl(cfg, path), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ message, content: contentBase64, sha, branch: cfg.branch }),
  });
  if (!res.ok) throw new Error(`${path}: ${describeError(res.status, await res.text())}`);
  return res.json();
}

/* ---------- 進捗表示 ---------- */

function renderProgress(steps) {
  document.getElementById("progress-area").hidden = false;
  document.getElementById("progress").replaceChildren(
    ...steps.map((s) =>
      el("li", { class: s.state }, [
        document.createTextNode(s.label),
        s.detail ? el("div", { class: "detail", text: s.detail }) : null,
      ])
    )
  );
}

/* ---------- 投稿ジョブ（失敗したところから再開できる） ---------- */

let job = null;

/**
 * 編集中のレシピ。新規投稿のときは null。
 *
 * 新規と編集で変わるのは3つだけ。
 *   1. ID を採番せず、既存のものを使う
 *   2. 上書きなので GitHub Contents API に sha を渡す（無いと 422 になる）
 *   3. createdAt と、画像を差し替えない場合の thumb を元のまま残す
 *
 * それ以外（検証・タグ・index の更新）は新規投稿とまったく同じ道を通る。
 */
let editing = null;

/** 編集モードに入る。recipe は data/recipes/<id>.json の中身そのまま */
export function startEditing(recipe) {
  editing = { id: recipe.id, createdAt: recipe.createdAt, thumb: recipe.thumb ?? null };
  syncModeLabel();
}

/** 新規投稿に戻す */
export function stopEditing() {
  editing = null;
  syncModeLabel();
}

export function editingRecipe() {
  return editing;
}

/** 「投稿する」か「上書きする」か。押す前に分かるようにしておく */
function syncModeLabel() {
  const submit = document.getElementById("btn-submit");
  if (submit) submit.textContent = editing ? "この内容で上書きする" : "GitHub に投稿する";
  const badge = document.getElementById("edit-badge");
  if (badge) {
    badge.hidden = !editing;
    if (editing) badge.textContent = `${editing.id} を編集中`;
  }
}

function buildJob(form) {
  return {
    form,
    editing,
    id: null,
    index: null,
    imageBlob: null,
    recipe: null,
    steps: [
      {
        key: "index",
        label: editing ? "index.json を読み込み、IDを確認" : "index.json を読み込み、IDを採番",
        state: "todo",
      },
      { key: "image", label: "サムネイル画像をコミット", state: "todo" },
      {
        key: "recipe",
        label: editing ? "レシピ本体を上書き" : "レシピ本体をコミット",
        state: "todo",
      },
      { key: "reindex", label: "index.json を更新", state: "todo" },
    ],
  };
}

function indexRow(recipe) {
  const row = {
    id: recipe.id,
    title: recipe.title,
    thumb: recipe.thumb,
    timeMinutes: recipe.timeMinutes,
    createdAt: recipe.createdAt,
  };
  for (const group of TAG_GROUPS) row[group.key] = recipe[group.key] ?? [];
  return row;
}

const RUNNERS = {
  async index(cfg) {
    const file = await ghGet(cfg, `${REPO_PREFIX}data/index.json`);
    job.index = file ? JSON.parse(b64ToText(file.content)) : [];
    if (job.editing) {
      job.id = job.editing.id;
      return `id = ${job.id}（既存を上書き）`;
    }
    job.id = nextId(job.index, job.form.title);
    return `id = ${job.id}`;
  },

  async image(cfg, step) {
    const input = document.getElementById("f-image");
    const file = input.files?.[0];
    if (!file) {
      if (job.editing?.thumb) {
        step.label = "サムネイル画像（そのまま）";
        return `${job.editing.thumb} を変更しません`;
      }
      step.label = "サムネイル画像（なし）";
      return "画像なしで投稿します";
    }
    job.imageBlob = job.imageBlob ?? (await shrinkImage(file));
    const bytes = new Uint8Array(await job.imageBlob.arrayBuffer());
    const path = `${REPO_PREFIX}data/images/${job.id}.jpg`;
    // 既にあるファイルの上書きは sha が要る（無いと 422）。直前に取り直す
    const existing = job.editing ? await ghGet(cfg, path) : null;
    await putFile(cfg, {
      path,
      contentBase64: bytesToB64(bytes),
      message: `${job.editing ? "update" : "add"} image ${job.id}`,
      sha: existing?.sha,
    });
    return `data/images/${job.id}.jpg（約${Math.round(job.imageBlob.size / 1024)}KB）`;
  },

  async recipe(cfg) {
    const f = job.form;
    job.recipe = {
      id: job.id,
      title: f.title,
      // 画像を選び直していなければ、元の thumb をそのまま残す
      thumb: job.imageBlob ? `data/images/${job.id}.jpg` : (job.editing?.thumb ?? null),
      timeMinutes: f.timeMinutes,
      servings: f.servings,
      ingredients: f.ingredients,
      steps: f.steps,
      protein: f.protein,
      plant: f.plant,
      genre: f.genre,
      sourceUrl: f.sourceUrl,
      // 編集では投稿日を動かさない。一覧の並び順が変わってしまう
      createdAt: job.editing?.createdAt ?? f.createdAt,
      notes: f.notes,
    };
    const path = `${REPO_PREFIX}data/recipes/${job.id}.json`;
    const existing = job.editing ? await ghGet(cfg, path) : null;
    await putFile(cfg, {
      path,
      contentBase64: textToB64(JSON.stringify(job.recipe, null, 2) + "\n"),
      message: `${job.editing ? "update" : "add"} recipe ${job.id}: ${f.title}`,
      sha: existing?.sha,
    });
    return `data/recipes/${job.id}.json`;
  },

  async reindex(cfg) {
    // 直前に取り直して sha と内容を最新にする（競合を減らす）
    const file = await ghGet(cfg, `${REPO_PREFIX}data/index.json`);
    const current = file ? JSON.parse(b64ToText(file.content)) : [];
    const next = [...current.filter((r) => r.id !== job.id), indexRow(job.recipe)].sort(byNewest);
    await putFile(cfg, {
      path: `${REPO_PREFIX}data/index.json`,
      contentBase64: textToB64(JSON.stringify(next, null, 2) + "\n"),
      message: `reindex for ${job.id}`,
      sha: file?.sha,
    });
    return `${next.length}件になりました`;
  },
};

/**
 * 削除の手順。投稿と同じ進捗表示に載せる。
 *
 * 消す順番は **本体 → 画像 → index**。逆にすると、index から消えたのに
 * 本体が残る状態が生まれ、一覧に出ないファイルが積もる。
 */
const DELETE_RUNNERS = {
  async recipe(cfg) {
    await deleteFile(cfg, {
      path: `${REPO_PREFIX}data/recipes/${job.id}.json`,
      message: `delete recipe ${job.id}`,
    });
    return `data/recipes/${job.id}.json`;
  },

  async image(cfg, step) {
    if (!job.deleting.thumb) {
      step.label = "サムネイル画像（なし）";
      return "画像はありません";
    }
    const removed = await deleteFile(cfg, {
      path: `${REPO_PREFIX}${job.deleting.thumb}`,
      message: `delete image ${job.id}`,
    });
    return removed ? job.deleting.thumb : "既にありませんでした";
  },

  async reindex(cfg) {
    const file = await ghGet(cfg, `${REPO_PREFIX}data/index.json`);
    const current = file ? JSON.parse(b64ToText(file.content)) : [];
    const next = current.filter((r) => r.id !== job.id);
    await putFile(cfg, {
      path: `${REPO_PREFIX}data/index.json`,
      contentBase64: textToB64(JSON.stringify(next, null, 2) + "\n"),
      message: `reindex after deleting ${job.id}`,
      sha: file?.sha,
    });
    return `${next.length}件になりました`;
  },
};

/**
 * 投稿済みのレシピを消す。
 * **戻せない操作なので、呼ぶ側で確認を取ってから呼ぶこと。**
 */
export async function deleteRecipe({ id, title, thumb }) {
  const cfg = loadConfig();
  if (!cfg.owner || !cfg.repo || !cfg.token) {
    showErrors(["GitHub 設定（owner / repo / トークン）を先に保存してください。"]);
    document.getElementById("settings").open = true;
    return false;
  }

  job = {
    id,
    deleting: { title, thumb: thumb ?? null },
    steps: [
      { key: "recipe", label: "レシピ本体を削除", state: "todo" },
      { key: "image", label: "サムネイル画像を削除", state: "todo" },
      { key: "reindex", label: "index.json を更新", state: "todo" },
    ],
  };

  const result = document.getElementById("result");
  result.hidden = true;

  for (const step of job.steps) {
    step.state = "doing";
    renderProgress(job.steps);
    try {
      step.detail = await DELETE_RUNNERS[step.key](cfg, step);
      step.state = "done";
    } catch (err) {
      step.state = "fail";
      step.detail = err.message;
      renderProgress(job.steps);
      job = null;
      return false;
    }
    renderProgress(job.steps);
  }

  result.hidden = false;
  result.replaceChildren(
    el("strong", { text: `「${title}」を削除しました。` }),
    el("br"),
    el("span", { class: "muted", text: "GitHub Pages への反映まで数十秒かかります。" })
  );

  stopEditing();
  job = null;
  return true;
}

async function runJob() {
  const cfg = loadConfig();
  const submit = document.getElementById("btn-submit");
  const retry = document.getElementById("btn-retry");
  const result = document.getElementById("result");

  if (!cfg.owner || !cfg.repo || !cfg.token) {
    showErrors(["GitHub 設定（owner / repo / トークン）を先に保存してください。"]);
    document.getElementById("settings").open = true;
    return;
  }

  submit.disabled = true;
  retry.hidden = true;
  result.hidden = true;

  for (const step of job.steps) {
    if (step.state === "done") continue;
    step.state = "doing";
    renderProgress(job.steps);
    try {
      step.detail = await RUNNERS[step.key](cfg, step);
      step.state = "done";
    } catch (err) {
      step.state = "fail";
      step.detail = err.message;
      renderProgress(job.steps);
      retry.hidden = false;
      submit.disabled = false;
      return;
    }
    renderProgress(job.steps);
  }

  submit.disabled = false;
  result.hidden = false;
  result.replaceChildren(
    el("strong", { text: job.editing ? "上書きしました。" : "投稿しました。" }),
    el("br"),
    el("a", { href: `recipe.html?id=${encodeURIComponent(job.id)}`, text: "このレシピを見る →" }),
    el("br"),
    el("span", { class: "muted", text: "GitHub Pages への反映まで数十秒かかります。" })
  );
  // 後片付けを先にやる。**編集モードが残ったままだと次の入力が同じ ID を潰す**ので、
  // 見た目のスクロールより優先する（scrollIntoView で落ちても状態は戻っている）
  document.getElementById("recipe-form").reset();
  document.getElementById("ing-rows").replaceChildren(ingredientRow(), ingredientRow(), ingredientRow());
  document.getElementById("step-rows").replaceChildren(stepRow(), stepRow(), stepRow());
  document.getElementById("image-info").textContent = "";
  clearTags();
  stopEditing();
  job = null;

  result.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
}

/* ---------- AI下書き（ai-mapper.js）向けの公開API ---------- */
/*
 * 追加は export と setTags() だけで、上の既存関数には手を入れていない。
 * ai-draft.js の読み込みを1行消せば元の挙動に完全に戻せる状態を保つため。
 */

export { collectForm, ingredientRow, shrinkImage, stepRow, todayISO };

/**
 * 編集機能（edit.js）向け。GitHub から直接読むために必要。
 *
 * **編集はリポジトリの中身を書き換える。** 土台まで公開サイト（GitHub Pages）から
 * 読むと、反映待ちの数十秒のあいだに古い内容を掴み、直前の変更を巻き戻してしまう。
 * 読む先と書く先を揃えるために、設定と接頭辞を外に出す。
 */
export { REPO_PREFIX };
export function githubConfig() {
  return loadConfig();
}

/**
 * 外部からタグ選択状態を設定する。
 * selectedTags（Map）と DOM の aria-pressed は別々に持っているので、
 * 片方だけ更新すると「見た目は選択済みなのに投稿されない」状態になる。
 */
export function setTags(groupKey, names) {
  const set = selectedTags.get(groupKey);
  if (!set) return;
  set.clear();
  for (const name of names) set.add(name);
  for (const btn of document.querySelectorAll(`.chip-tag[data-group="${groupKey}"]`)) {
    btn.setAttribute("aria-pressed", set.has(btn.dataset.name) ? "true" : "false");
  }
}

/** 現在のタグ選択を groupKey -> string[] で読み出す（Undo のスナップショット用） */
export function getTags() {
  return Object.fromEntries([...selectedTags].map(([key, set]) => [key, [...set]]));
}

/* ---------- 起動 ---------- */

function initForm() {
  document.getElementById("btn-preview").addEventListener("click", () => {
    const form = collectForm();
    if (showErrors(validate(form))) return;
    const file = document.getElementById("f-image").files?.[0];
    document.getElementById("preview-area").hidden = false;
    renderRecipe(
      { ...form, id: "(preview)", thumb: file ? URL.createObjectURL(file) : null },
      document.getElementById("preview")
    );
    document.getElementById("preview-area").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("recipe-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = collectForm();
    if (showErrors(validate(form))) return;
    job = buildJob(form);
    runJob();
  });

  document.getElementById("btn-retry").addEventListener("click", () => {
    if (job) runJob();
  });
}

initSettings();
initRows();
initTags();
initImageField();
initForm();
