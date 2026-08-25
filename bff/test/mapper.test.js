// @vitest-environment jsdom
/*
 * ai-mapper.js を実際の add.html に対して動かす。
 * DOM 操作だけのモジュールなのでネットワークを立てずに検証できる。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "../../public");
const ADD_HTML = readFileSync(join(PUBLIC, "add.html"), "utf8");
const BODY = ADD_HTML.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, "");

let addMod;
let mapper;

const HIGH = {
  title: "high",
  timeMinutes: "high",
  servings: "high",
  ingredientNames: "high",
  ingredientAmounts: "high",
  steps: "high",
  protein: "high",
  plant: "high",
  genre: "high",
  notes: "high",
  sourceUrl: "high",
};

const payload = (over = {}) => ({
  schemaVersion: 1,
  draft: {
    title: "豚バラ白菜のミルフィーユ蒸し",
    timeMinutes: 12,
    servings: 2,
    ingredients: [
      { name: "豚バラ肉", amount: "200g" },
      { name: "白菜", amount: "1/4個" },
      { name: "ポン酢", amount: "適量" },
      { name: "酒", amount: "大さじ2" },
    ],
    steps: ["白菜を切る。", "豚バラと交互に重ねる。", "蓋をして8分蒸す。", "ポン酢をかける。"],
    protein: ["豚肉"],
    plant: ["白菜"],
    genre: ["和風"],
    notes: "ポン酢で。",
    sourceUrl: null,
    ...(over.draft ?? {}),
  },
  confidence: { ...HIGH, ...(over.confidence ?? {}) },
  followUps: [],
  rationale: "",
  meta: {},
});

/** 人が打った操作を模す（input イベントを出さないと userEdited が立たない） */
function type(el, value) {
  el.value = value;
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}

const ingNames = () =>
  [...document.querySelectorAll("#ing-rows .ing-name")].map((i) => i.value).filter(Boolean);
const stepTexts = () =>
  [...document.querySelectorAll("#step-rows .step-text")].map((i) => i.value).filter(Boolean);

beforeEach(async () => {
  document.body.innerHTML = BODY;
  localStorage.clear();
  vi.resetModules();
  addMod = await import("../../public/assets/add.js");
  mapper = await import("../../public/assets/ai-mapper.js");
  mapper.initEditTracking();
});

describe("applyDraft — 基本", () => {
  it("タイトル・材料・手順・タグが入る", () => {
    mapper.applyDraft(payload());
    expect(document.getElementById("f-title").value).toBe("豚バラ白菜のミルフィーユ蒸し");
    expect(ingNames()).toEqual(["豚バラ肉", "白菜", "ポン酢", "酒"]);
    expect(stepTexts()).toHaveLength(4);
    expect(addMod.getTags().protein).toEqual(["豚肉"]);
  });

  it("初期3行を超える分だけ行が増える", () => {
    expect(document.querySelectorAll("#ing-rows .dyn-row")).toHaveLength(3);
    mapper.applyDraft(payload());
    expect(document.querySelectorAll("#ing-rows .dyn-row")).toHaveLength(4);
  });

  it("タグは Set と aria-pressed の両方が更新される", () => {
    mapper.applyDraft(payload());
    const chip = document.querySelector('.chip-tag[data-group="protein"][data-name="豚肉"]');
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(addMod.collectForm().protein).toEqual(["豚肉"]);
  });

  it("AI が埋めた欄に印が付く", () => {
    mapper.applyDraft(payload());
    expect(document.getElementById("f-title").dataset.aiFilled).toBe("true");
    expect(document.getElementById("f-title").dataset.aiUncertain).toBeUndefined();
  });
});

describe("上書きポリシー", () => {
  it("HTML の初期値（所要時間10 / 人数1）は未編集なので上書きする", () => {
    // ここが「空欄だけ埋める」だと絶対に埋まらない欄
    expect(document.getElementById("f-time").value).toBe("10");
    mapper.applyDraft(payload());
    expect(document.getElementById("f-time").value).toBe("12");
    expect(document.getElementById("f-servings").value).toBe("2");
  });

  it("人が打った欄は上書きしない", () => {
    type(document.getElementById("f-title"), "自分で書いたタイトル");
    type(document.getElementById("f-time"), "30");
    const applied = mapper.applyDraft(payload());
    expect(document.getElementById("f-title").value).toBe("自分で書いたタイトル");
    expect(document.getElementById("f-time").value).toBe("30");
    expect(applied.protected).toContain("title");
  });

  it("人が打って消した欄は埋めてよい", () => {
    const title = document.getElementById("f-title");
    type(title, "あ");
    type(title, "");
    mapper.applyDraft(payload());
    expect(title.value).toBe("豚バラ白菜のミルフィーユ蒸し");
  });

  it("材料が1行でも書かれていれば消さずに足す", () => {
    type(document.querySelector("#ing-rows .ing-name"), "自分の材料");
    mapper.applyDraft(payload());
    expect(ingNames()).toContain("自分の材料");
    expect(ingNames()).toContain("豚バラ肉");
  });

  it("手順が書かれていれば触らない", () => {
    type(document.querySelector("#step-rows .step-text"), "自分の手順");
    const applied = mapper.applyDraft(payload());
    expect(stepTexts()).toEqual(["自分の手順"]);
    expect(applied.protected).toContain("steps");
  });

  it("タグが既に選ばれていれば触らない", () => {
    addMod.setTags("protein", ["鶏肉"]);
    const applied = mapper.applyDraft(payload());
    expect(addMod.getTags().protein).toEqual(["鶏肉"]);
    expect(applied.protected).toContain("protein");
  });
});

describe("確信度の扱い", () => {
  it("スカラーが low なら値を入れず skipped に入れる", () => {
    const applied = mapper.applyDraft(payload({ confidence: { timeMinutes: "low" } }));
    expect(document.getElementById("f-time").value).toBe("10"); // 初期値のまま
    expect(applied.skipped).toContain("timeMinutes");
  });

  it("配列が low でも値は入れる（写真だけの入力で何も残らなくなるのを防ぐ）", () => {
    const applied = mapper.applyDraft(
      payload({ confidence: { ingredientNames: "low", ingredientAmounts: "low", steps: "low" } })
    );
    expect(ingNames()).toHaveLength(4);
    expect(stepTexts()).toHaveLength(4);
    expect(applied.filled).toContain("ingredientNames");
  });

  it("medium 以下の欄には要確認の印と aria-describedby が付く", () => {
    mapper.applyDraft(payload({ confidence: { title: "medium" } }));
    const title = document.getElementById("f-title");
    expect(title.dataset.aiUncertain).toBe("true");
    expect(title.getAttribute("aria-describedby")).toBe("ai-uncertain-note");
    // 読み上げ用の説明が実在すること（色だけの区別にしない）
    expect(document.getElementById("ai-uncertain-note")).not.toBeNull();
  });

  it("材料名と分量は別々に判定される", () => {
    mapper.applyDraft(payload({ confidence: { ingredientAmounts: "low" } }));
    const row = document.querySelector("#ing-rows .dyn-row");
    expect(row.querySelector(".ing-name").dataset.aiUncertain).toBeUndefined();
    expect(row.querySelector(".ing-amount").dataset.aiUncertain).toBe("true");
  });
});

describe("スナップショットと取り消し", () => {
  it("空行の数まで含めて元に戻る", () => {
    type(document.querySelector("#ing-rows .ing-name"), "自分の材料");
    const before = {
      rows: document.querySelectorAll("#ing-rows .dyn-row").length,
      names: ingNames(),
      time: document.getElementById("f-time").value,
    };

    const snap = mapper.snapshotForm();
    mapper.applyDraft(payload());
    expect(ingNames().length).toBeGreaterThan(before.names.length);

    mapper.restoreForm(snap);
    expect(document.querySelectorAll("#ing-rows .dyn-row").length).toBe(before.rows);
    expect(ingNames()).toEqual(before.names);
    expect(document.getElementById("f-time").value).toBe(before.time);
  });

  it("取り消すと AI の印が消える", () => {
    const snap = mapper.snapshotForm();
    mapper.applyDraft(payload());
    expect(document.querySelectorAll("[data-ai-filled]").length).toBeGreaterThan(0);
    mapper.restoreForm(snap);
    expect(document.querySelectorAll("[data-ai-filled]").length).toBe(0);
  });

  it("人が編集した印も復元される", () => {
    type(document.getElementById("f-title"), "自分のタイトル");
    const snap = mapper.snapshotForm();
    mapper.applyDraft(payload());
    mapper.restoreForm(snap);
    expect(document.getElementById("f-title").dataset.userEdited).toBe("true");
  });

  it("何も触っていない状態から適用 → 取り消しで初期状態に戻る", () => {
    const snap = mapper.snapshotForm();
    mapper.applyDraft(payload());
    mapper.restoreForm(snap);
    expect(document.querySelectorAll("#ing-rows .dyn-row")).toHaveLength(3);
    expect(document.querySelectorAll("#step-rows .dyn-row")).toHaveLength(3);
    expect(document.getElementById("f-title").value).toBe("");
    expect(addMod.getTags().protein).toEqual([]);
  });
});

describe("既存の validate() との整合", () => {
  it("下書きを適用しただけで投稿の必須条件を満たす", async () => {
    mapper.applyDraft(payload());
    const form = addMod.collectForm();
    expect(form.title).toBeTruthy();
    expect(form.ingredients.length).toBeGreaterThan(0);
    expect(form.steps.length).toBeGreaterThan(0);
    expect(form.timeMinutes).toBe(12);
  });
});
