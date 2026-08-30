/*
 * 料理写真をイラストにする部分。
 *
 * 撮った写真 → イラスト → レシピのサムネイル＆X用画像、までを1画面で終わらせる。
 * 生成した画像は「サムネイルに使う」を押すまでフォームに入らない。
 * 1枚 約¥5 かかるので、押していないものが勝手にコミットされないようにする。
 */

import { el } from "./common.js";

let sourceBlob = null; // 元写真（縮小済み）
let resultBlob = null; // 生成されたイラスト
let resultUrl = null;  // プレビュー用の object URL
let adopted = false;   // サムネイルに採用したか

function $(id) {
  return document.getElementById(id);
}

function revoke() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
}

function setStatus(text) {
  $("il-status").textContent = text;
}

function setBusy(busy) {
  for (const id of ["il-run", "il-adopt", "il-again"]) {
    const b = $(id);
    if (b) b.disabled = busy;
  }
  const run = $("il-run");
  if (busy) run.setAttribute("aria-busy", "true");
  else run.removeAttribute("aria-busy");
}

/** base64 ⇄ Blob */
async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  return btoa(bin);
}

function base64ToBlob(base64, mediaType) {
  const bin = atob(base64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mediaType });
}

/** 元写真が選ばれたらイラスト化ボタンを出す */
export function setSourcePhoto(blob) {
  sourceBlob = blob;
  if (!blob) {
    revoke();
    resultBlob = null;
    adopted = false;
    const r = $("il-result");
    if (r) r.hidden = true;
  }
  syncMode();
}

/**
 * フォームに入っている材料。写真が無いときはこれを元に描く。
 * collectForm() は空行を落とすが、ここは名前だけ拾えればよいので DOM を直接見る。
 */
function recipeFromForm() {
  const title = ($("f-title")?.value ?? "").trim();

  // 分量欄と手順に切り方が書かれていることが多い。名前だけ送ると形が変わる
  const ingredients = [...document.querySelectorAll("#ing-rows .dyn-row")]
    .map((row) => ({
      name: row.querySelector(".ing-name")?.value.trim() ?? "",
      amount: row.querySelector(".ing-amount")?.value.trim() ?? "",
    }))
    .filter((i) => i.name);

  const steps = [...document.querySelectorAll("#step-rows .step-text")]
    .map((el) => el.value.trim())
    .filter(Boolean);

  return { title, ingredients, steps };
}

/** 写真が無くても、料理名が入っていれば描ける */
function canDrawFromRecipe() {
  return recipeFromForm().title.length > 0;
}

/**
 * 入口が2つあるので、いまどちらで動くのかを画面に出す。
 * **黙って切り替わると、写真を選んだつもりで文章から描かれる事故が起きる。**
 */
function syncMode() {
  const box = $("illustrate");
  if (!box) return;

  const fromPhoto = Boolean(sourceBlob);
  box.hidden = !fromPhoto && !canDrawFromRecipe();

  const title = $("il-title");
  const note = $("il-note");
  const run = $("il-run");
  if (!title || !note || !run) return;

  if (fromPhoto) {
    title.textContent = "写真をイラストにする";
    note.textContent =
      "料理だけを描き直すので、部屋・手・同席者は写りません。1枚あたり約5円かかります。";
    run.textContent = "イラストにする";
  } else {
    title.textContent = "レシピからイラストを作る";
    note.textContent =
      "写真が無いときに、料理名と材料から描き起こします。実際に作ったものの絵ではありません。1枚あたり約5円かかります。";
    run.textContent = "レシピから作る";
  }
}

/**
 * 下書きを流し込んだあとに呼ぶ。
 *
 * **applyDraft は value を直接代入するので input イベントが飛ばない。**
 * 打ち込みの監視だけに頼ると、AI が料理名を埋めてもこの欄が出てこない。
 */
export function refreshIllustrateMode() {
  syncMode();
}

/** 料理名や材料を打ち替えたら、出せる／出せないを見直す */
export function watchRecipeFields() {
  const form = document.getElementById("recipe-form");
  if (!form) return;
  form.addEventListener("input", (e) => {
    if (sourceBlob) return; // 写真があるときは関係ない
    if (e.target.id === "f-title" || e.target.classList?.contains("ing-name")) syncMode();
  });
}

function showResult(blob, meta) {
  revoke();
  resultBlob = blob;
  resultUrl = URL.createObjectURL(blob);
  adopted = false;

  $("il-preview").src = resultUrl;
  $("il-result").hidden = false;
  $("il-download").href = resultUrl;
  $("il-download").download = `jisui-hack-${Date.now()}.png`;
  $("il-adopt").textContent = "サムネイルに使う";

  const left = (meta.dailyLimit ?? 0) - (meta.todayCount ?? 0);
  setStatus(
    `できました（${Math.round((meta.latencyMs ?? 0) / 1000)}秒）。` +
      `今日 ${meta.todayCount}/${meta.dailyLimit} 枚目。残り ${Math.max(0, left)} 枚。`
  );
}

/** サムネイル欄（#f-image）に入れる。X 用には別途ダウンロードしてもらう */
function adopt() {
  if (!resultBlob) return;
  const target = $("f-image");
  try {
    const file = new File([resultBlob], "illustration.png", { type: resultBlob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    target.files = dt.files;
    target.dispatchEvent(new Event("change"));
    adopted = true;
    $("il-adopt").textContent = "サムネイルに入れました";
    setStatus("サムネイルに入れました。X 用には「画像を保存」から取り出してください。");
  } catch {
    setStatus("この環境では自動で入れられません。「画像を保存」してから、下のサムネイル欄で選んでください。");
  }
}

async function run() {
  const fromPhoto = Boolean(sourceBlob);
  if (!fromPhoto && !canDrawFromRecipe()) {
    setStatus("料理名を入れてください。");
    return;
  }
  const endpoint = (localStorage.getItem("ai_bff_endpoint") || "").replace(/\/v1\/draft$/, "");
  const key = localStorage.getItem("ai_bff_key") || "";
  if (!endpoint || !key) {
    setStatus("先に「AI下書きの設定」でエンドポイントとキーを入れてください。");
    $("ai-settings").open = true;
    return;
  }

  setBusy(true);
  setStatus("イラストにしています…（10秒ほどかかります）");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70_000);

  try {
    const res = await fetch(`${endpoint}/v1/illustrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Key": key },
      body: JSON.stringify({
        schemaVersion: 1,
        ...(fromPhoto
          ? {
              image: {
                mediaType: sourceBlob.type || "image/jpeg",
                base64: await blobToBase64(sourceBlob),
              },
            }
          : { recipe: recipeFromForm() }),
        model: $("il-model").value === "flash" ? "flash" : "lite",
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const info = (await res.json().catch(() => ({}))).error ?? {};
      setStatus(messageFor(res.status, info));
      return;
    }
    const payload = await res.json();
    if (!payload?.image?.base64) {
      setStatus("画像を受け取れませんでした。");
      return;
    }
    showResult(base64ToBlob(payload.image.base64, payload.image.mediaType), payload.meta ?? {});
  } catch (e) {
    setStatus(
      e?.name === "AbortError"
        ? "時間内に返りませんでした。もう一度試してください。"
        : "イラスト化のサーバに繋がりませんでした。写真はそのまま使えます。"
    );
  } finally {
    clearTimeout(timer);
    setBusy(false);
  }
}

function messageFor(status, info) {
  if (status === 429) {
    const min = Math.ceil((info.retryAfterSec ?? 0) / 60);
    return `イラストの上限に達しました。${min > 0 ? `あと約${min}分` : "しばらく"}おいてください。`;
  }
  if (status === 413) return "写真が大きすぎます。";
  if (status === 401) return "クライアントキーが違います。";
  if (status === 422) return "この写真からは生成できませんでした。別の写真で試してください。";
  return "イラストの生成に失敗しました。写真はそのまま使えます。";
}

export function initIllustrate() {
  if (!$("illustrate")) return;
  $("il-run").addEventListener("click", run);
  $("il-again").addEventListener("click", run);
  $("il-adopt").addEventListener("click", adopt);
  watchRecipeFields();
  syncMode(); // 下書き適用済みで開き直した場合に、写真なしでも出せるようにする
}

export function hasAdoptedIllustration() {
  return adopted;
}
