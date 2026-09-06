import { describe, expect, it } from "vitest";
import { normalizeDraft, normalizeStep, pickSourceUrl } from "../src/normalize.js";

const VOCAB = {
  protein: ["豚肉", "鶏肉", "卵"],
  plant: ["白菜", "玉ねぎ"],
  genre: ["和風", "洋風"],
};

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

const rawDraft = (over = {}) => ({
  title: "豚バラ白菜のミルフィーユ蒸し",
  timeMinutes: 10,
  servings: 2,
  ingredients: [
    { name: "豚バラ肉", amount: "200g" },
    { name: "白菜", amount: "1/4個" },
  ],
  steps: ["白菜を切る", "豚バラと重ねる"],
  protein: ["豚肉"],
  plant: ["白菜"],
  genre: ["和風"],
  notes: "ポン酢で。",
  sourceUrl: null,
  confidence: { ...HIGH },
  followUps: [],
  rationale: "メモの記載どおり。",
  ...over,
});

const ctx = (over = {}) => ({
  vocabulary: VOCAB,
  inputKinds: ["memo"],
  memo: "豚バラと白菜を重ねて蒸すだけ。ポン酢。10分、2人分",
  meta: { model: "claude-sonnet-5" },
  ...over,
});

describe("normalizeStep（N-3 / N-4）", () => {
  it("番号の接頭辞を剥がす", () => {
    expect(normalizeStep("1. 玉ねぎを薄切りにする")).toBe("玉ねぎを薄切りにする。");
    expect(normalizeStep("２）豚肉を炒める")).toBe("豚肉を炒める。");
    expect(normalizeStep("・味を整える")).toBe("味を整える。");
  });

  it("末尾を句点に統一する（既存レシピが句点ありなので合わせる）", () => {
    expect(normalizeStep("卵を割り入れる")).toBe("卵を割り入れる。");
    expect(normalizeStep("卵を割り入れる。")).toBe("卵を割り入れる。");
    expect(normalizeStep("卵を割り入れる.")).toBe("卵を割り入れる。");
  });

  it("空行は空文字のまま", () => {
    expect(normalizeStep("  ")).toBe("");
    expect(normalizeStep("3.")).toBe("");
  });
});

describe("pickSourceUrl（N-7）", () => {
  const memo = "参考 https://note.com/foo/n/abc123 を見た";

  it("メモに実在する URL だけ通す", () => {
    expect(pickSourceUrl("https://note.com/foo/n/abc123", memo)).toBe(
      "https://note.com/foo/n/abc123"
    );
  });

  it("モデルが作った実在しない URL は捨てる", () => {
    expect(pickSourceUrl("https://cookpad.com/recipe/1234567", memo)).toBeNull();
  });

  it("末尾に句読点が付いていても照合できる", () => {
    expect(pickSourceUrl("https://note.com/foo/n/abc123。", memo)).toBe(
      "https://note.com/foo/n/abc123"
    );
  });

  it("http(s) 以外は通さない", () => {
    expect(pickSourceUrl("javascript:alert(1)", memo)).toBeNull();
  });
});

describe("normalizeDraft", () => {
  it("正常系はそのまま通る", () => {
    const out = normalizeDraft(rawDraft(), ctx());
    expect(out.draft.title).toBe("豚バラ白菜のミルフィーユ蒸し");
    expect(out.draft.steps).toEqual(["白菜を切る。", "豚バラと重ねる。"]);
    expect(out.followUps).toEqual([]);
  });

  it("N-1: 語彙外のタグを落とし、そのグループの確信度を下げる", () => {
    const out = normalizeDraft(
      rawDraft({ protein: ["豚肉", "豚バラ肉"], genre: ["和食"] }),
      ctx()
    );
    expect(out.draft.protein).toEqual(["豚肉"]);
    expect(out.draft.genre).toEqual([]);
    expect(out.confidence.protein).toBe("medium");
    expect(out.rationale).toMatch(/語彙外/);
  });

  it("N-2: 材料名の重複を除去する", () => {
    const out = normalizeDraft(
      rawDraft({
        ingredients: [
          { name: "白菜", amount: "1/4個" },
          { name: "白菜", amount: "少々" },
        ],
      }),
      ctx()
    );
    expect(out.draft.ingredients).toHaveLength(1);
  });

  it("N-5 / N-9: 材料が空になったら null（422）", () => {
    expect(normalizeDraft(rawDraft({ ingredients: [{ name: "  ", amount: "" }] }), ctx())).toBeNull();
    expect(normalizeDraft(rawDraft({ steps: ["  "] }), ctx())).toBeNull();
  });

  it("N-6: 範囲外の数値は null にして followUps に入れる", () => {
    const out = normalizeDraft(rawDraft({ timeMinutes: 9999 }), ctx());
    expect(out.draft.timeMinutes).toBeNull();
    expect(out.followUps.some((f) => f.field === "timeMinutes")).toBe(true);
  });

  it("N-10: 長すぎる文字列を切り詰める", () => {
    const out = normalizeDraft(rawDraft({ title: "あ".repeat(200) }), ctx());
    expect(out.draft.title.length).toBe(60);
  });

  it("N-8: 写真だけの入力では分量・時間・人数を low に落とす", () => {
    const out = normalizeDraft(rawDraft(), ctx({ inputKinds: ["image"], memo: "" }));
    expect(out.confidence.ingredientAmounts).toBe("low");
    expect(out.confidence.timeMinutes).toBe("low");
    expect(out.confidence.servings).toBe("low");
    // 材料名と手順は落としきらない（落とすと写真だけの入力で何も残らない）
    expect(out.confidence.ingredientNames).toBe("medium");
    expect(out.confidence.steps).toBe("medium");
  });

  it("N-8: 分量が空の材料が半数を超えたら分量を low にする", () => {
    const out = normalizeDraft(
      rawDraft({
        ingredients: [
          { name: "豚バラ肉", amount: "" },
          { name: "白菜", amount: "" },
          { name: "ポン酢", amount: "大さじ2" },
        ],
      }),
      ctx()
    );
    expect(out.confidence.ingredientAmounts).toBe("low");
  });

  it("スカラーが null なら確認を促す", () => {
    const out = normalizeDraft(rawDraft({ timeMinutes: null }), ctx());
    expect(out.followUps.some((f) => f.field === "timeMinutes")).toBe(true);
  });

  it("モデルの followUps を取り込みつつ、未知のフィールド名は捨てる", () => {
    const out = normalizeDraft(
      rawDraft({
        followUps: [
          { field: "servings", message: "人数を確認してください。" },
          { field: "wat", message: "無視されるはず" },
        ],
      }),
      ctx()
    );
    expect(out.followUps.map((f) => f.field)).toContain("servings");
    expect(out.followUps.map((f) => f.field)).not.toContain("wat");
  });

  it("confidence が壊れていても low で補完して落ちない", () => {
    const out = normalizeDraft(rawDraft({ confidence: null }), ctx());
    expect(out.confidence.title).toBe("low");
  });

  it("meta に inputKinds が入る", () => {
    const out = normalizeDraft(rawDraft(), ctx());
    expect(out.meta.inputKinds).toEqual(["memo"]);
    expect(out.meta.model).toBe("claude-sonnet-5");
  });
});

describe("X の投稿文（xPost）", () => {
  const TITLE = "豚バラ白菜のミルフィーユ蒸し";

  /** 先頭のタイトルを外した本文だけを見たいとき */
  const bodyOf = (xPost) => xPost.split("\n\n").slice(1).join("\n\n");

  it("先頭にレシピのタイトルが付く", () => {
    const out = normalizeDraft(rawDraft({ xPost: "ごぼうは煮物に向く。" }), ctx());
    expect(out.xPost).toBe(`${TITLE}\n\nごぼうは煮物に向く。`);
  });

  it("モデルがタイトルを書いてきたら二重にしない", () => {
    // 表記がぶれるのでモデルには書かせない。書いてきたら捨てて付け直す
    const out = normalizeDraft(
      rawDraft({ xPost: `${TITLE}\n\nごぼうは煮物に向く。` }),
      ctx()
    );
    expect(out.xPost).toBe(`${TITLE}\n\nごぼうは煮物に向く。`);
    expect(out.xPost.split(TITLE)).toHaveLength(2); // 1回だけ
  });

  it("本文が空ならタイトルも付けない", () => {
    expect(normalizeDraft(rawDraft({ xPost: "" }), ctx()).xPost).toBe("");
    expect(normalizeDraft(rawDraft({ xPost: undefined }), ctx()).xPost).toBe("");
  });

  it("改行を保つ（レシピの形をそのまま出すため）", () => {
    const body = [
      "豚ひき肉は炒め料理を基本に考えるといい。",
      "",
      "【材料】2人分",
      "豚ひき肉 200g",
      "玉ねぎ 1/2個",
      "",
      "【作り方】",
      "1 なすを素揚げする",
      "2 ひき肉と玉ねぎを炒める",
    ].join("\n");
    const out = normalizeDraft(rawDraft({ xPost: body }), ctx());

    expect(bodyOf(out.xPost)).toBe(body.split("\n\n").join("\n\n"));
    expect(out.xPost.startsWith(`${TITLE}\n\n`)).toBe(true);
    expect(out.xPost.split("\n")).toHaveLength(11); // タイトル + 空行 + 本文9行
  });

  it("モデルが URL を書いてきたら落とす（正しい URL は投稿時に付ける）", () => {
    const out = normalizeDraft(
      rawDraft({ xPost: "10分でできる https://cookpad.com/recipe/123" }),
      ctx()
    );
    expect(out.xPost).not.toContain("http");
    expect(out.xPost).toContain("10分でできる");
  });

  it("空行が3行以上続いたら2行にまとめる", () => {
    const out = normalizeDraft(rawDraft({ xPost: "紹介文。\n\n\n\n【材料】2人分\nなす 2本" }), ctx());
    expect(bodyOf(out.xPost)).toBe("紹介文。\n\n【材料】2人分\nなす 2本");
  });

  it("ハッシュタグは落とす（プロンプトで禁じても書いてくるため）", () => {
    const out = normalizeDraft(
      rawDraft({ xPost: "ごぼうは煮物に向く。15分ほどで作れる。#自炊ハック #作り置き" }),
      ctx()
    );
    expect(out.xPost).not.toContain("#");
    expect(bodyOf(out.xPost)).toBe("ごぼうは煮物に向く。15分ほどで作れる。");
  });

  it("全角のハッシュタグも落とす", () => {
    const out = normalizeDraft(rawDraft({ xPost: "15分で作れる。＃自炊ハック" }), ctx());
    expect(bodyOf(out.xPost)).toBe("15分で作れる。");
  });

  it("長すぎたら切り詰める（タイトルは別勘定）", () => {
    const out = normalizeDraft(rawDraft({ xPost: "あ".repeat(300) }), ctx());
    expect(bodyOf(out.xPost).length).toBeLessThanOrEqual(170);
  });

  it("X の重みで 280 に収まる（実際に出る形で確かめる）", () => {
    const out = normalizeDraft(
      rawDraft({
        xPost: [
          "豚ひき肉は炒め料理を基本に考えるといい。",
          "",
          "【材料】2人分",
          "豚ひき肉 200g",
          "玉ねぎ 1/2個",
          "なす 2本",
          "カレー粉 大さじ1",
          "",
          "【作り方】",
          "1 なすを素揚げする",
          "2 ひき肉と玉ねぎを炒める",
          "3 カレー粉とルーで味付け",
          "4 水分を飛ばす",
        ].join("\n"),
      }),
      ctx()
    );
    const weighted = [...out.xPost].reduce((n, c) => n + (c.codePointAt(0) < 0x1100 ? 1 : 2), 0);
    expect(weighted).toBeLessThanOrEqual(280);
  });
});
