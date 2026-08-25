// @vitest-environment jsdom
/*
 * 「AI が作った下書き」が「実際にコミットされる JSON」になったとき、
 * リポジトリ自身の検証（scripts/reindex.mjs）を通るかを見る。
 *
 * ここが落ちると reindex が exit 1 になり、GitHub Actions が失敗して
 * **サイト全体が更新されなくなる**。AI の出力が最終的にどこへ行くのかを
 * 押さえておかないと、いちばん高くつく失敗の仕方をする。
 *
 * 語彙の検証は reindex.mjs と同じ findTag をそのまま使っているので、
 * タグに関しては本物の検証と等価。
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TAG_GROUPS, findTag } from "../../public/assets/tags.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const ADD_HTML = readFileSync(join(ROOT, "public/add.html"), "utf8");
const BODY = ADD_HTML.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, "");

/**
 * 既存の committed レシピ。キーの並びが変わっていないかの基準にする。
 * ファイル名を直書きするとテストデータの削除で落ちるので、実際にある1件を拾う。
 */
const RECIPE_DIR = join(ROOT, "public/data/recipes");
const RECIPE_FILES = readdirSync(RECIPE_DIR).filter((f) => f.endsWith(".json")).sort();
const SAMPLE_RECIPE = JSON.parse(readFileSync(join(RECIPE_DIR, RECIPE_FILES[0]), "utf8"));

let addMod;
let mapper;

/**
 * add.js の RUNNERS.recipe が組み立てる形と同じ JSON を作る。
 * add.js には手を入れない方針なので、ここで同じ写像を書いている。
 * ずれたら下の「キーが一致する」テストが落ちる。
 */
function buildRecipeJson(form, id, hasImage) {
  return {
    id,
    title: form.title,
    thumb: hasImage ? `data/images/${id}.jpg` : null,
    timeMinutes: form.timeMinutes,
    servings: form.servings,
    ingredients: form.ingredients,
    steps: form.steps,
    protein: form.protein,
    plant: form.plant,
    genre: form.genre,
    sourceUrl: form.sourceUrl,
    createdAt: form.createdAt,
    notes: form.notes,
  };
}

/** scripts/reindex.mjs が弾く条件をそのまま写したもの */
function reindexProblems(recipe, fileName) {
  const problems = [];
  const expectedId = fileName.replace(/\.json$/, "");
  if (recipe.id !== expectedId) problems.push(`id "${recipe.id}" とファイル名が一致しません`);
  if (!recipe.title) problems.push("title がありません");
  for (const group of TAG_GROUPS) {
    for (const name of recipe[group.key] ?? []) {
      if (!findTag(group.key, name)) {
        problems.push(`${group.key} の "${name}" は tags.js にありません`);
      }
    }
  }
  // JSON として往復できること（コミットされるのは文字列なので）
  try {
    JSON.parse(JSON.stringify(recipe));
  } catch (e) {
    problems.push(`JSON にできません: ${e.message}`);
  }
  return problems;
}

const HIGH = Object.fromEntries(
  [
    "title",
    "timeMinutes",
    "servings",
    "ingredientNames",
    "ingredientAmounts",
    "steps",
    "protein",
    "plant",
    "genre",
    "notes",
    "sourceUrl",
  ].map((k) => [k, "high"])
);

const payload = (over = {}) => ({
  schemaVersion: 1,
  draft: {
    title: "豚バラ白菜のミルフィーユ蒸し",
    timeMinutes: 12,
    servings: 2,
    ingredients: [
      { name: "豚バラ肉", amount: "200g" },
      { name: "白菜", amount: "1/4個" },
    ],
    steps: ["白菜をざく切りにする。", "豚バラと交互に重ねる。"],
    protein: ["豚肉"],
    plant: ["白菜"],
    genre: ["和風"],
    notes: "ポン酢は食べる直前に。",
    sourceUrl: null,
    ...(over.draft ?? {}),
  },
  confidence: { ...HIGH, ...(over.confidence ?? {}) },
  followUps: [],
  rationale: "",
  meta: { imageKind: "none" },
});

beforeEach(async () => {
  document.body.innerHTML = BODY;
  localStorage.clear();
  vi.resetModules();
  addMod = await import("../../public/assets/add.js");
  mapper = await import("../../public/assets/ai-mapper.js");
  mapper.initEditTracking();
});

describe("AI下書き → コミットされる JSON", () => {
  it("reindex の検証を通る", () => {
    mapper.applyDraft(payload());
    const form = addMod.collectForm();
    const id = "2026-0005-abcd";
    const recipe = buildRecipeJson(form, id, false);

    expect(reindexProblems(recipe, `${id}.json`)).toEqual([]);
  });

  it("既存レシピと同じキーになる（写像がずれたら落ちる）", () => {
    mapper.applyDraft(payload());
    const recipe = buildRecipeJson(addMod.collectForm(), "2026-0005-abcd", true);
    expect(Object.keys(recipe)).toEqual(Object.keys(SAMPLE_RECIPE));
  });

  it("thumb は画像の有無で data/images/<id>.jpg か null になる", () => {
    mapper.applyDraft(payload());
    const form = addMod.collectForm();
    expect(buildRecipeJson(form, "2026-0005-abcd", true).thumb).toBe("data/images/2026-0005-abcd.jpg");
    expect(buildRecipeJson(form, "2026-0005-abcd", false).thumb).toBeNull();

    // 既存レシピの thumb も同じ形（null か data/images/*.jpg）に収まっていること
    for (const f of RECIPE_FILES) {
      const t = JSON.parse(readFileSync(join(RECIPE_DIR, f), "utf8")).thumb;
      expect(t === null || /^data\/images\/.+\.jpg$/.test(t)).toBe(true);
    }
  });

  it("全タグを選んでも通る", () => {
    const all = Object.fromEntries(TAG_GROUPS.map((g) => [g.key, g.tags.map((t) => t.name)]));
    mapper.applyDraft(payload({ draft: all }));
    const recipe = buildRecipeJson(addMod.collectForm(), "2026-0005-abcd", false);

    expect(recipe.protein).toHaveLength(9);
    expect(recipe.plant).toHaveLength(18);
    expect(recipe.genre).toHaveLength(5);
    expect(reindexProblems(recipe, "2026-0005-abcd.json")).toEqual([]);
  });

  it("タグが0個でも通る（タグは任意）", () => {
    mapper.applyDraft(payload({ draft: { protein: [], plant: [], genre: [] } }));
    const recipe = buildRecipeJson(addMod.collectForm(), "2026-0005-abcd", false);
    expect(reindexProblems(recipe, "2026-0005-abcd.json")).toEqual([]);
  });

  it("createdAt は AI ではなくクライアントの今日になる", () => {
    mapper.applyDraft(payload());
    const form = addMod.collectForm();
    expect(form.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(form.createdAt).toBe(addMod.todayISO());
  });

  it("語彙外のタグはフロントでは止まらない。最後に reindex が弾く", () => {
    mapper.applyDraft(payload({ draft: { protein: ["ラム肉"], plant: [], genre: [] } }));
    const recipe = buildRecipeJson(addMod.collectForm(), "2026-0005-abcd", false);

    // setTags は tags.js に無い名前でもそのまま Set に入れる（フロントに検証は無い）。
    // 語彙の保証は BFF の N-1 が持ち、reindex が最後の砦になる、という二段構え。
    expect(recipe.protein).toContain("ラム肉");
    expect(reindexProblems(recipe, "2026-0005-abcd.json")).toEqual([
      'protein の "ラム肉" は tags.js にありません',
    ]);
  });
});

describe("タイトルから ID を作る（既存の slugify）", () => {
  /** add.js の slugify と同じ規則。id はファイル名になるので壊れると困る */
  const slugish = (title) =>
    title
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24)
      .replace(/-+$/, "");

  it("日本語だけのタイトルはスラッグが空になる（ランダム後置が必要）", () => {
    expect(slugish("豚バラ白菜のミルフィーユ蒸し").length).toBeLessThan(2);
  });

  it("英数字を含むタイトルはファイル名に使える形になる", () => {
    expect(slugish("簡単10分 牛丼")).toBe("10");
    expect(slugish("Oyakodon")).toBe("oyakodon");
  });

  it("どんなタイトルでもファイル名に使えない文字は残らない", () => {
    for (const t of ["../../etc/passwd", "a/b?c#d", "🍳🍳", "  ", "パスタ／和風"]) {
      expect(slugish(t)).toMatch(/^[a-z0-9-]*$/);
    }
  });
});

describe("I-7: tags.js にタグを足したら BFF 無改修で選べる", () => {
  it("語彙の生成 → Tool Schema の enum まで届く", async () => {
    const { buildTool } = await import("../src/prompt.js");

    // tags.js から作った本物の語彙
    const vocabulary = Object.fromEntries(
      TAG_GROUPS.map((g) => [g.key, g.tags.map((t) => t.name)])
    );
    const before = buildTool(vocabulary).input_schema.properties.protein.items.enum;
    expect(before).toEqual(vocabulary.protein);

    // tags.js に1件足した状態を模す
    const added = { ...vocabulary, protein: [...vocabulary.protein, "ラム肉"] };
    const after = buildTool(added).input_schema.properties.protein.items.enum;

    expect(after).toContain("ラム肉");
    expect(after).toHaveLength(before.length + 1);
    // BFF 側のコードは1行も変えていない
  });

  it("新しいタグは BFF の入力検証も通る", async () => {
    const { validateRequest } = await import("../src/validate.js");
    const vocabulary = Object.fromEntries(
      TAG_GROUPS.map((g) => [g.key, g.tags.map((t) => t.name)])
    );
    vocabulary.protein.push("ラム肉");

    const out = validateRequest({ schemaVersion: 1, memo: "x", vocabulary });
    expect(out.vocabulary.protein).toContain("ラム肉");
  });
});
