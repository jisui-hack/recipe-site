#!/usr/bin/env node
/**
 * public/data/recipes/*.json を全走査して public/data/index.json を再生成する。
 * タグが語彙（public/assets/tags.js）にあるかも検証する。依存なし。
 *
 *   node scripts/reindex.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { TAG_GROUPS, findTag } from "../public/assets/tags.js";

const RECIPES_DIR = fileURLToPath(new URL("../public/data/recipes/", import.meta.url));
const INDEX_FILE = fileURLToPath(new URL("../public/data/index.json", import.meta.url));

function toIndexRow(recipe) {
  const row = {
    id: recipe.id,
    title: recipe.title,
    thumb: recipe.thumb ?? null,
    timeMinutes: recipe.timeMinutes ?? null,
    createdAt: recipe.createdAt ?? "",
    // 材料名（一覧の検索用。分量は要らない）
    ing: (recipe.ingredients ?? []).map((i) => (i.name ?? "").trim()).filter(Boolean),
  };
  // タグはグループごとにそのまま持たせる（一覧・材料から探すで使う）
  for (const group of TAG_GROUPS) row[group.key] = recipe[group.key] ?? [];
  return row;
}

/** createdAt 降順、同日は id 昇順 */
function byNewest(a, b) {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id.localeCompare(b.id);
}

async function main() {
  const files = (await readdir(RECIPES_DIR)).filter((f) => f.endsWith(".json")).sort();
  const rows = [];
  const problems = [];

  for (const file of files) {
    const raw = await readFile(new URL(file, `file://${RECIPES_DIR}`), "utf8");
    let recipe;
    try {
      recipe = JSON.parse(raw);
    } catch (err) {
      problems.push(`${file}: JSONとして読めません (${err.message})`);
      continue;
    }
    const expectedId = file.replace(/\.json$/, "");
    if (!recipe.id) recipe.id = expectedId;
    if (recipe.id !== expectedId) {
      problems.push(`${file}: id "${recipe.id}" とファイル名が一致しません`);
    }
    if (!recipe.title) problems.push(`${file}: title がありません`);

    // 語彙にないタグはタイプミスなので弾く（タグ自体は0個でよい）
    for (const group of TAG_GROUPS) {
      for (const name of recipe[group.key] ?? []) {
        if (!findTag(group.key, name)) {
          problems.push(`${file}: ${group.key} の "${name}" は tags.js にありません`);
        }
      }
    }

    rows.push(toIndexRow(recipe));
  }

  if (problems.length) {
    console.error("次の問題があります:\n" + problems.map((p) => `  - ${p}`).join("\n"));
    process.exitCode = 1;
    return;
  }

  rows.sort(byNewest);
  await writeFile(INDEX_FILE, JSON.stringify(rows, null, 2) + "\n", "utf8");
  console.log(`index.json を更新しました（${rows.length}件）`);
}

await main();
