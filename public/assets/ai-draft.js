/*
 * AI下書き機能：UI 制御と BFF 通信。
 *
 * ここが落ちても既存の投稿フォームは動く。add.html からこのファイルの
 * <script> を1行消せば、完全に元の状態に戻る。
 */

import { shrinkImage, todayISO } from "./add.js";
import {
  applyDraft,
  clearAiMarks,
  FIELD_LABEL,
  fieldTarget,
  initEditTracking,
  restoreForm,
  snapshotForm,
} from "./ai-mapper.js";
import { el } from "./common.js";
import { initIllustrate, refreshIllustrateMode, setSourcePhoto } from "./illustrate.js";
import { clearXPost, initXPost, showXPost } from "./x-post.js";
import { TAG_GROUPS } from "./tags.js";

const DEFAULT_ENDPOINT = "https://recipe-ai-bff.example.workers.dev/v1/draft";
const ENDPOINT_KEY = "ai_bff_endpoint";
const CLIENT_KEY = "ai_bff_key";
const TIMEOUT_MS = 30_000;

const STATUS_STEPS = [
  "メモを読んでいます…",
  "材料を整理しています…",
  "手順をまとめています…",
  "タグを選んでいます…",
];

let lastSnapshot = null;
let inFlight = null;

/* ---------- 設定 ---------- */

/**
 * 保存されているエンドポイント。**空のときに既定値へ落とさない。**
 * 以前は DEFAULT_ENDPOINT（実在しない example ドメイン）へ落としていたが、
 * 鍵だけ入れて URL を入れ忘れると DNS が引けず「AI に繋がりませんでした」に
 * なり、設定漏れが通信障害に見えていた。DEFAULT_ENDPOINT は入力欄の
 * placeholder 表示だけに使う。
 */
function endpoint() {
  return (localStorage.getItem(ENDPOINT_KEY) || "").trim();
}

/** エンドポイントと鍵が両方そろって初めて使える */
function isConfigured() {
  return Boolean(endpoint() && clientKey());
}

function clientKey() {
  return localStorage.getItem(CLIENT_KEY) || "";
}

/**
 * 鍵が入っていないあいだは入口を畳む（CSS 側で見出しと設定だけ残す）。
 * add.html は公開されているので、動かないボタンを訪問者に見せないため。
 */
function syncConfiguredState() {
  const section = document.getElementById("ai-draft");
  if (section) section.classList.toggle("is-unconfigured", !isConfigured());
}

function initAiSettings() {
  const box = document.getElementById("ai-settings");
  const epInput = document.getElementById("ai-cfg-endpoint");
  const keyInput = document.getElementById("ai-cfg-key");
  const status = document.getElementById("ai-cfg-status");

  epInput.value = localStorage.getItem(ENDPOINT_KEY) || "";
  epInput.placeholder = DEFAULT_ENDPOINT;
  keyInput.value = clientKey();
  if (!isConfigured()) {
    status.textContent = !endpoint() && !clientKey()
      ? "未設定です"
      : !endpoint()
        ? "エンドポイントが未入力です"
        : "クライアントキーが未入力です";
    box.open = true; // 初回はここから始めてもらう
  }
  syncConfiguredState();

  document.getElementById("ai-cfg-save").addEventListener("click", () => {
    const ep = epInput.value.trim();
    if (ep) localStorage.setItem(ENDPOINT_KEY, ep);
    else localStorage.removeItem(ENDPOINT_KEY);
    const key = keyInput.value.trim();
    if (key) localStorage.setItem(CLIENT_KEY, key);
    status.textContent = "保存しました";
    syncConfiguredState();
    box.open = false;
  });

  document.getElementById("ai-cfg-clear").addEventListener("click", () => {
    localStorage.removeItem(CLIENT_KEY);
    keyInput.value = "";
    status.textContent = "キーを削除しました";
    syncConfiguredState();
  });
}

/* ---------- 語彙 ---------- */

/**
 * tags.js から語彙を組み立てる。ここが唯一の語彙生成点。
 * BFF に語彙をハードコードしないので、tags.js に1行足せば AI にも反映される。
 */
export function buildVocabulary() {
  return Object.fromEntries(TAG_GROUPS.map((g) => [g.key, g.tags.map((t) => t.name)]));
}

/* ---------- 通信 ---------- */

class DraftError extends Error {
  constructor(status, code, detail, retryAfterSec) {
    super(detail || code);
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function requestDraft({ memo, imageBlob, nocache, signal }) {
  const body = {
    schemaVersion: 1,
    memo,
    image: imageBlob
      ? { mediaType: "image/jpeg", base64: await blobToBase64(imageBlob) }
      : null,
    vocabulary: buildVocabulary(),
    today: todayISO(),
  };

  const url = endpoint() + (nocache ? "?nocache=1" : "");
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Key": clientKey() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw new DraftError(0, "TIMEOUT");
    throw new DraftError(0, "NETWORK");
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const info = payload.error ?? {};
    throw new DraftError(res.status, info.code ?? "UNKNOWN", info.message, info.retryAfterSec);
  }

  const payload = await res.json().catch(() => null);
  if (!isDraftPayload(payload)) throw new DraftError(0, "BAD_PAYLOAD");
  return payload;
}

/**
 * 適用する前に形だけ確かめる。
 * 古い BFF や別のサービスが 200 を返したときに applyDraft の途中で落ちると、
 * フォームが半分だけ書き換わった状態で「通信エラー」と表示されることになる。
 */
function isDraftPayload(p) {
  return (
    p != null &&
    typeof p === "object" &&
    p.draft != null &&
    typeof p.draft === "object" &&
    Array.isArray(p.draft.ingredients) &&
    Array.isArray(p.draft.steps) &&
    p.confidence != null &&
    typeof p.confidence === "object" &&
    Array.isArray(p.followUps)
  );
}

/* ---------- 表示 ---------- */

function setStatus(text) {
  document.getElementById("ai-status").textContent = text;
}

function showWarnings(nodes) {
  const box = document.getElementById("ai-warnings");
  if (!nodes.length) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  box.replaceChildren(...nodes);
}

function warningList(title, items) {
  return [
    el("p", { class: "ai-warn-title", text: title }),
    el(
      "ul",
      { class: "ai-warn-list" },
      items.map(({ field, message }) =>
        el("li", {}, [
          el("button", {
            type: "button",
            class: "link-btn ai-jump",
            "data-field": field ?? "",
            text: message,
          }),
        ])
      )
    ),
  ];
}

function renderResult(payload, applied, imageNotices = []) {
  const items = payload.followUps.map((f) => ({
    field: f.field,
    message: `${FIELD_LABEL[f.field] ?? f.field}: ${f.message}`,
  }));

  for (const field of applied.skipped) {
    // 元記事URLは無いのが普通なので、無かったことを警告として出さない
    if (field === "sourceUrl") continue;
    if (items.some((i) => i.field === field)) continue;
    items.push({ field, message: `${FIELD_LABEL[field] ?? field}: 読み取れませんでした。入力してください。` });
  }
  for (const field of applied.protected) {
    items.push({
      field,
      message: `${FIELD_LABEL[field] ?? field}: 既に入力があったので上書きしていません。`,
    });
  }
  // タグはチップなので、入力欄のような色分けが付けられない。文言で補う
  for (const field of applied.uncertainTags) {
    if (items.some((i) => i.field === field)) continue;
    items.push({ field, message: `${FIELD_LABEL[field] ?? field}: 推測で選びました。確認してください。` });
  }

  const nodes = items.length ? warningList("確認してください", items) : [];

  // 画像まわりの通知は、フィールドに紐づかないので別立てで出す
  for (const text of imageNotices) {
    nodes.unshift(el("p", { class: "ai-warn-title", text }));
  }

  if (payload.rationale) {
    nodes.push(
      el("details", { class: "ai-rationale" }, [
        el("summary", { text: "AI がどう読み取ったか" }),
        el("p", { text: payload.rationale }),
      ])
    );
  }
  showWarnings(nodes);

  const meta = payload.meta ?? {};
  setStatus(
    `下書きを作りました（${(meta.latencyMs ?? 0) / 1000 | 0}秒${meta.cached ? " / 前回の結果" : ""}）。` +
      "内容を確認して直してください。"
  );
}

function showError(error) {
  const nodes = [];
  const add = (text) => nodes.push(el("p", { class: "ai-warn-title", text }));

  switch (error.code) {
    case "TIMEOUT":
    case "NETWORK":
      add("AI に繋がりませんでした。手入力でも投稿できます。");
      break;
    case "UNAUTHORIZED":
      add("AI 下書きの設定が必要です。下の「AI下書きの設定」を開いてキーを入れてください。");
      document.getElementById("ai-settings").open = true;
      break;
    case "FORBIDDEN_ORIGIN":
      add("この URL からは AI 下書きを使えません（接続元が許可されていません）。");
      break;
    case "RATE_LIMITED": {
      const sec = error.retryAfterSec ?? 0;
      const min = Math.ceil(sec / 60);
      add(`利用回数の上限に達しました。${min > 0 ? `あと約${min}分` : "少し時間"}おいてから試してください。`);
      break;
    }
    case "PAYLOAD_TOO_LARGE":
      add("画像が大きすぎます。別の写真で試してください。");
      break;
    case "EXTRACTION_FAILED":
      add("メモから読み取れませんでした。材料か手順を一言足してみてください。");
      document.getElementById("ai-memo").focus();
      break;
    case "UPSTREAM_TIMEOUT":
      add("AI の応答が間に合いませんでした。もう一度試すか、手入力で進めてください。");
      break;
    case "BAD_PAYLOAD":
    case "APPLY_FAILED":
      add("AI の応答を読み取れませんでした。フォームは元のままです。");
      add("設定のエンドポイント URL が正しいか確認してください。");
      break;
    default:
      add(error.message || "AI の呼び出しに失敗しました。手入力でも投稿できます。");
  }

  nodes.push(el("p", { class: "muted", text: "AI が使えなくても、これまで通り手入力で投稿できます。" }));
  showWarnings(nodes);
  setStatus("");
  setBusy(false);
}

/* ---------- 画像 ---------- */

let aiImageBlob = null;

function initAiImage() {
  const input = document.getElementById("ai-image");
  const info = document.getElementById("ai-image-info");

  input.addEventListener("change", async () => {
    aiImageBlob = null;
    setSourcePhoto(null);
    const file = input.files?.[0];
    if (!file) {
      info.textContent = "";
      return;
    }
    info.textContent = "縮小中…";
    try {
      // add.js の縮小処理をそのまま使う。長辺1024px / 目標150KB。
      // canvas 再エンコードなので EXIF（位置情報を含む）は落ちる。
      aiImageBlob = await shrinkImage(file);
      info.textContent = `約${Math.round(aiImageBlob.size / 1024)}KB に縮小して送ります`;
      setSourcePhoto(aiImageBlob);
    } catch (e) {
      info.textContent = `画像を読み込めませんでした: ${e.message}`;
    }
  });
}

/** AI がサムネイルを入れたかどうか。取り消しのときに戻すために覚えておく */
let thumbSetByAi = false;

/**
 * 「この写真をサムネイルにも使う」がONなら、投稿フォームの画像欄にも同じファイルを入れる。
 * @returns {"done"|"skipped"|"unsupported"} 結果。skipped 以外は利用者に伝える
 */
function syncThumbnail() {
  const useAsThumb = document.getElementById("ai-image-as-thumb").checked;
  const source = document.getElementById("ai-image").files?.[0];
  const target = document.getElementById("f-image");
  if (!useAsThumb || !source || target.files?.length) return "skipped";
  try {
    const dt = new DataTransfer();
    dt.items.add(source);
    target.files = dt.files;
    target.dispatchEvent(new Event("change"));
    thumbSetByAi = true;
    return "done";
  } catch {
    // 黙って何もしないと「サムネイルが付いていない」ことに投稿後まで気づけない
    return "unsupported";
  }
}

/**
 * 手書きメモの写真をサムネイルにしてしまう事故を防ぐ。
 * チェックボックスの既定を ON にしたまま注意書きを添えるだけでは押し忘れるので、
 * モデルが「紙・画面の写真」と判断したらこちらで外す。
 * @returns {boolean} 外したかどうか
 */
function unsetThumbForNote(imageKind) {
  if (imageKind !== "handwritten_note") return false;
  const box = document.getElementById("ai-image-as-thumb");
  if (!box.checked) return false;
  box.checked = false;
  return true;
}

/** 取り消しのときにサムネイルも戻す。人が自分で選んだ画像には触らない */
function revertThumbnail() {
  if (!thumbSetByAi) return;
  const target = document.getElementById("f-image");
  target.value = "";
  document.getElementById("image-info").textContent = "";
  thumbSetByAi = false;
}

/* ---------- 生成 ---------- */

/** 生成中に押されても困るボタンをまとめて止める */
function setBusy(busy) {
  const generate = document.getElementById("ai-generate");
  generate.disabled = busy;
  if (busy) generate.setAttribute("aria-busy", "true");
  else generate.removeAttribute("aria-busy");
  // 「作り直す」「取り消す」も止める。押せるのに何も起きないのが一番分かりにくい
  for (const id of ["ai-regenerate", "ai-undo"]) {
    document.getElementById(id).disabled = busy;
  }
}

async function onGenerate({ nocache = false } = {}) {
  const undo = document.getElementById("ai-undo");
  const memo = document.getElementById("ai-memo").value.trim();

  if (inFlight) return; // 多重押下の防止
  if (!memo && !aiImageBlob) {
    showWarnings([el("p", { class: "ai-warn-title", text: "メモを書くか、写真を選んでください。" })]);
    return;
  }
  if (!isConfigured()) {
    showError(new DraftError(401, "UNAUTHORIZED"));
    return;
  }

  setBusy(true);
  showWarnings([]);

  // 実際の進捗ではないが、4秒の無反応より待ち時間の体感がよくなる
  let step = 0;
  setStatus(STATUS_STEPS[0]);
  const ticker = setInterval(() => {
    step = Math.min(step + 1, STATUS_STEPS.length - 1);
    setStatus(STATUS_STEPS[step]);
  }, 1800);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  inFlight = controller;

  try {
    const payload = await requestDraft({
      memo,
      imageBlob: aiImageBlob,
      nocache,
      signal: controller.signal,
    });

    const snapshot = snapshotForm();
    try {
      clearAiMarks();
      const applied = applyDraft(payload);
      lastSnapshot = snapshot;

      const imageNotices = [];
      if (unsetThumbForNote(payload.meta?.imageKind)) {
        imageNotices.push(
          "写真が手書きメモ・レシピの紙と判断されたので、サムネイルには使いませんでした。" +
            "料理の写真を使いたい場合は、下のサムネイル欄で選んでください。"
        );
      }
      if (syncThumbnail() === "unsupported") {
        imageNotices.push("この環境では写真をサムネイルに自動でコピーできません。下の欄で選んでください。");
      }
      renderResult(payload, applied, imageNotices);
      // 料理名が埋まったので、写真が無くても「レシピからイラストを作る」を出せる
      refreshIllustrateMode();
      showXPost(payload.xPost);
      undo.hidden = false;
      document.getElementById("ai-regenerate").hidden = false;
    } catch (applyError) {
      // 途中まで書き換わったフォームを人に押し付けない
      restoreForm(snapshot);
      throw new DraftError(0, "APPLY_FAILED", applyError?.message);
    }
  } catch (e) {
    showError(e instanceof DraftError ? e : new DraftError(0, "NETWORK"));
  } finally {
    clearInterval(ticker);
    clearTimeout(timer);
    inFlight = null;
    setBusy(false);
  }
}

function onUndo() {
  restoreForm(lastSnapshot);
  revertThumbnail();
  clearXPost();
  refreshIllustrateMode(); // 料理名が消えたらイラストの欄も引っ込める
  lastSnapshot = null;
  document.getElementById("ai-undo").hidden = true;
  showWarnings([]);
  setStatus("下書きを取り消しました。");
}

/* ---------- 起動 ---------- */

function init() {
  if (!document.getElementById("ai-draft")) return;
  initEditTracking();
  initAiSettings();
  initIllustrate();
  initXPost();
  initAiImage();

  document.getElementById("ai-generate").addEventListener("click", () => onGenerate());
  document.getElementById("ai-regenerate").addEventListener("click", () => onGenerate({ nocache: true }));
  document.getElementById("ai-undo").addEventListener("click", onUndo);

  // 警告からその欄へ飛ぶ
  document.getElementById("ai-warnings").addEventListener("click", (e) => {
    const btn = e.target.closest(".ai-jump");
    if (!btn) return;
    const target = fieldTarget(btn.dataset.field);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus?.();
  });
}

init();
