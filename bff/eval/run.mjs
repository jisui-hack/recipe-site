#!/usr/bin/env node
/*
 * ゴールデンセットを BFF に投げて、期待と突き合わせる。
 *
 *   BFF_ENDPOINT=http://localhost:8787/v1/draft \
 *   BFF_KEY=xxxx \
 *   node eval/run.mjs [ケースIDの一部]
 *
 * 画像のケースは input.image に { mediaType, base64 } を入れる。
 * 実写真が要るのでリポジトリには入れていない。撮ったものをそのまま
 * ケースにして eval/cases/ に置く運用にする（expect.imageKind も書ける）。
 *
 * 単体テストでは測れない「プロンプトを変えたら良くなったのか悪くなったのか」を
 * 見るためのもの。落ちたケースの入力はそのまま新しいケースにする運用にすると、
 * 評価セットが自然に育つ。
 */

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASE_DIR = join(HERE, "cases");
const RESULT_DIR = join(HERE, "results");

const ENDPOINT = process.env.BFF_ENDPOINT ?? "http://localhost:8787/v1/draft";
const KEY = process.env.BFF_KEY ?? "";
const ORIGIN = process.env.BFF_ORIGIN ?? "http://localhost:3000";
const filter = process.argv[2] ?? "";

/** tags.js を読まずに済ませたくないので、実ファイルから語彙を作る */
async function loadVocabulary() {
  // パスに空白や日本語が入るので、URL 化は pathToFileURL に任せる
  const url = pathToFileURL(join(HERE, "../../public/assets/tags.js")).href;
  const { TAG_GROUPS } = await import(url);
  return Object.fromEntries(TAG_GROUPS.map((g) => [g.key, g.tags.map((t) => t.name)]));
}

const RANK = { low: 0, medium: 1, high: 2 };

function checkCase(testCase, payload) {
  const e = testCase.expect;
  const d = payload.draft;
  const fails = [];
  const eq = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());

  if (e.timeMinutes !== undefined && d.timeMinutes !== e.timeMinutes) {
    fails.push(`timeMinutes: ${d.timeMinutes} ≠ ${e.timeMinutes}`);
  }
  if (e.servings !== undefined && d.servings !== e.servings) {
    fails.push(`servings: ${d.servings} ≠ ${e.servings}`);
  }
  for (const key of ["protein", "plant", "genre"]) {
    if (e[key] !== undefined && !eq(d[key], e[key])) {
      fails.push(`${key}: [${d[key]}] ≠ [${e[key]}]`);
    }
  }
  if (e.ingredientsMin && d.ingredients.length < e.ingredientsMin) {
    fails.push(`材料 ${d.ingredients.length} 件 < ${e.ingredientsMin}`);
  }
  if (e.stepsMin && d.steps.length < e.stepsMin) {
    fails.push(`手順 ${d.steps.length} 件 < ${e.stepsMin}`);
  }
  if (e.sourceUrlNull && d.sourceUrl !== null) {
    fails.push(`sourceUrl を捏造: ${d.sourceUrl}`); // ここはゼロ許容
  }
  if (e.sourceUrl && d.sourceUrl !== e.sourceUrl) {
    fails.push(`sourceUrl: ${d.sourceUrl} ≠ ${e.sourceUrl}`);
  }
  for (const word of e.titleNotContains ?? []) {
    if ((d.title ?? "").includes(word)) fails.push(`title に「${word}」が入った`);
  }
  if (e.titleMaxLength && (d.title ?? "").length > e.titleMaxLength) {
    fails.push(`title が ${d.title.length} 文字`);
  }
  if (e.stepsNoLeadingNumber && d.steps.some((s) => /^[0-9０-９]+[.．、)）]/.test(s))) {
    fails.push("手順に番号が残っている");
  }
  if (e.stepsEndWithKuten && d.steps.some((s) => !s.endsWith("。"))) {
    fails.push("手順の末尾が句点でない");
  }
  for (const [field, level] of Object.entries(e.confidenceAtLeast ?? {})) {
    if (RANK[payload.confidence[field]] < RANK[level]) {
      fails.push(`confidence.${field}=${payload.confidence[field]} < ${level}`);
    }
  }
  for (const [field, level] of Object.entries(e.confidenceAtMost ?? {})) {
    if (RANK[payload.confidence[field]] > RANK[level]) {
      fails.push(`confidence.${field}=${payload.confidence[field]} > ${level}`);
    }
  }
  if (e.imageKind && payload.meta.imageKind !== e.imageKind) {
    fails.push(`imageKind: ${payload.meta.imageKind} ≠ ${e.imageKind}`);
  }
  for (const field of e.followUpFields ?? []) {
    if (!payload.followUps.some((f) => f.field === field)) {
      fails.push(`followUps に ${field} が無い`);
    }
  }

  // 既存の validate() を通るか（§11.2 の「構造的妥当性」）
  if (!d.title) fails.push("validate: タイトルが空");
  if (!d.ingredients.length) fails.push("validate: 材料が空");
  if (!d.steps.length) fails.push("validate: 手順が空");
  if (d.timeMinutes === null) fails.push("validate: 所要時間が null（要確認だが投稿はできない）");

  return fails;
}

async function main() {
  if (!KEY) {
    console.error("BFF_KEY を設定してください");
    process.exit(1);
  }

  const vocabulary = await loadVocabulary();
  const files = readdirSync(CASE_DIR)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => !filter || f.includes(filter))
    .sort();

  const results = [];
  let passed = 0;
  let hallucinatedUrls = 0;

  for (const file of files) {
    const testCase = JSON.parse(readFileSync(join(CASE_DIR, file), "utf8"));
    const started = Date.now();

    const res = await fetch(`${ENDPOINT}?nocache=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Key": KEY, Origin: ORIGIN },
      body: JSON.stringify({
        schemaVersion: 1,
        memo: testCase.input.memo ?? "",
        image: testCase.input.image ?? null,
        vocabulary,
        today: new Date().toISOString().slice(0, 10),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.log(`✗ ${testCase.id}  HTTP ${res.status} ${body.slice(0, 160)}`);
      results.push({ id: testCase.id, ok: false, fails: [`HTTP ${res.status}`] });
      continue;
    }

    const payload = await res.json();
    const fails = checkCase(testCase, payload);
    if (fails.some((f) => f.includes("捏造"))) hallucinatedUrls++;

    if (fails.length === 0) {
      passed++;
      console.log(`✓ ${testCase.id}  ${Date.now() - started}ms  in=${payload.meta.tokensIn} out=${payload.meta.tokensOut}`);
    } else {
      console.log(`✗ ${testCase.id}  ${Date.now() - started}ms`);
      for (const f of fails) console.log(`    - ${f}`);
      console.log(`    title: ${payload.draft.title}`);
      console.log(`    steps: ${JSON.stringify(payload.draft.steps, null, 0)}`);
    }
    results.push({ id: testCase.id, ok: fails.length === 0, fails, payload });
  }

  console.log(`\n${passed}/${files.length} 通過`);
  console.log(`sourceUrl の捏造: ${hallucinatedUrls} 件（目標 0）`);

  mkdirSync(RESULT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = join(RESULT_DIR, `${stamp}.json`);
  writeFileSync(out, JSON.stringify({ endpoint: ENDPOINT, results }, null, 2));
  console.log(`結果: ${out}`);

  process.exit(passed === files.length ? 0 : 1);
}

main();
