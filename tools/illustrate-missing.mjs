#!/usr/bin/env node
/*
 * サムネイルが無いレシピに、レシピ本文からイラストを作って入れる。
 *
 *   GEMINI_API_KEY='...' node tools/illustrate-missing.mjs [--dry-run]
 *
 * **キーは環境変数から直接読む。** ファイルにも履歴にも残さないなら、
 * 前に空白を1つ入れて実行する（zsh の HIST_IGNORE_SPACE）。
 *
 * 画風はサイト本体と同じものを使う。bff/src/illustrate.js の
 * buildRecipePrompt() をそのまま呼ぶので、フォームから作った絵と揃う。
 * ここでプロンプトを書き直さないこと。揃わなくなる。
 *
 * 生成は1枚 約5円。走らせる前に対象を表示して数えられるようにしてある。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildRecipePrompt } from "../bff/src/illustrate.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECIPES = join(ROOT, "public/data/recipes");
const IMAGES = join(ROOT, "public/data/images");

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite-image";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DRY = process.argv.includes("--dry-run");

const KEY = process.env.GEMINI_API_KEY;
if (!KEY && !DRY) {
  console.error(`
GEMINI_API_KEY が設定されていません。

  GEMINI_API_KEY='AIza...' node tools/illustrate-missing.mjs

キーは aistudio.google.com/apikey で見られます。
何が対象になるか見るだけなら --dry-run を付けてください。
`);
  process.exit(1);
}

/* ---------- 対象を選ぶ ---------- */

function loadRecipes() {
  return readdirSync(RECIPES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: join(RECIPES, f), data: JSON.parse(readFileSync(join(RECIPES, f), "utf8")) }))
    .filter((r) => !r.data.thumb)
    .sort((a, b) => a.data.id.localeCompare(b.data.id));
}

/* ---------- 生成 ---------- */

async function generate(recipe) {
  const prompt = buildRecipePrompt({
    title: recipe.title,
    ingredients: recipe.ingredients ?? [],
    steps: recipe.steps ?? [],
  });

  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(MODEL)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // 429 はたいてい無料枠のまま。待っても直らないので、そう言う
    const hint = res.status === 429 ? "（無料枠のままかもしれません。請求先の紐づけを確認）" : "";
    throw new Error(`Gemini が ${res.status} を返しました${hint}\n${body.slice(0, 300)}`);
  }

  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.map((p) => p.inlineData ?? p.inline_data).find((d) => d?.data);
  if (!inline) {
    const reason = json?.promptFeedback?.blockReason ?? json?.candidates?.[0]?.finishReason ?? "不明";
    throw new Error(`画像が返りませんでした（${reason}）`);
  }
  return Buffer.from(inline.data, "base64");
}

/**
 * サイトに載せる形に整える。フォームから入れた画像と揃えたいので、
 * 長辺1024px の JPEG にする（add.js の shrinkImage と同じ考え方）。
 * macOS の sips を使う。依存を増やさないため。
 */
function toJpeg(pngBuffer, outPath) {
  const tmp = mkdtempSync(join(tmpdir(), "illust-"));
  const src = join(tmp, "src.png");
  writeFileSync(src, pngBuffer);

  for (const quality of [70, 60, 50, 40]) {
    execFileSync("sips", [
      "-Z", "1024",
      "-s", "format", "jpeg",
      "-s", "formatOptions", String(quality),
      src, "--out", outPath,
    ], { stdio: "ignore" });
    if (statSync(outPath).size <= 200_000) break;
  }
  return statSync(outPath).size;
}

/* ---------- 本体 ---------- */

const targets = loadRecipes();

if (!targets.length) {
  console.log("サムネイルが無いレシピはありません。");
  process.exit(0);
}

console.log(`サムネイルが無いレシピ: ${targets.length}件`);
for (const { data } of targets) {
  console.log(`  ${data.id}  ${data.title}`);
  console.log(`      材料: ${(data.ingredients ?? []).map((i) => i.name).join("、")}`);
}
console.log(`\nモデル: ${MODEL}`);
console.log(`概算: 約${targets.length * 5}円\n`);

if (DRY) {
  console.log("--dry-run なので、ここで止めます。");
  console.log("\n--- 送るプロンプト（1件目） ---");
  console.log(
    buildRecipePrompt({
      title: targets[0].data.title,
      ingredients: targets[0].data.ingredients ?? [],
      steps: targets[0].data.steps ?? [],
    })
  );
  process.exit(0);
}

let done = 0;
for (const { file, data } of targets) {
  process.stdout.write(`${data.id} を生成中… `);
  try {
    const started = Date.now();
    const png = await generate(data);
    const out = join(IMAGES, `${data.id}.jpg`);
    const size = toJpeg(png, out);

    data.thumb = `data/images/${data.id}.jpg`;
    writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");

    console.log(`できました（${Math.round((Date.now() - started) / 1000)}秒 / ${Math.round(size / 1024)}KB）`);
    done += 1;
  } catch (e) {
    console.log(`失敗\n  ${e.message}`);
  }
}

console.log(`\n${done}/${targets.length} 件できました。`);
if (done) {
  console.log("index.json を作り直します…");
  execFileSync("node", [join(ROOT, "scripts/reindex.mjs")], { stdio: "inherit" });
  console.log("\n絵を確認してから、コミットしてください。");
}
