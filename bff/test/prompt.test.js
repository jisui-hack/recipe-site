import { describe, expect, it } from "vitest";
import { buildMessages, buildTool, TOOL_NAME } from "../src/prompt.js";

const VOCAB = {
  protein: ["牛肉", "豚肉", "鶏肉"],
  plant: ["玉ねぎ", "白菜"],
  genre: ["和風", "洋風"],
};

describe("buildTool", () => {
  it("enum に語彙の配列そのものが入る（入れ子の配列にならない）", () => {
    const tool = buildTool(VOCAB);
    const proteinEnum = tool.input_schema.properties.protein.items.enum;
    expect(Array.isArray(proteinEnum)).toBe(true);
    expect(proteinEnum).toEqual(["牛肉", "豚肉", "鶏肉"]);
    // テンプレート文字列を replace すると [["牛肉", ...]] になり、
    // スキーマとしては通ってしまうので必ず要素の型まで見る
    for (const v of proteinEnum) expect(typeof v).toBe("string");
  });

  it("3グループすべてに語彙が注入される", () => {
    const tool = buildTool(VOCAB);
    const p = tool.input_schema.properties;
    expect(p.plant.items.enum).toEqual(["玉ねぎ", "白菜"]);
    expect(p.genre.items.enum).toEqual(["和風", "洋風"]);
  });

  it("語彙が空でも壊れない", () => {
    const tool = buildTool({});
    expect(tool.input_schema.properties.protein.items.enum).toEqual([]);
  });

  it("渡した語彙配列を書き換えない（参照を持ち回らない）", () => {
    const vocab = { protein: ["牛肉"] };
    const tool = buildTool(vocab);
    tool.input_schema.properties.protein.items.enum.push("侵入");
    expect(vocab.protein).toEqual(["牛肉"]);
  });

  it("confidence は材料名と分量を別々に持つ", () => {
    const conf = buildTool(VOCAB).input_schema.properties.confidence;
    expect(conf.required).toContain("ingredientNames");
    expect(conf.required).toContain("ingredientAmounts");
    expect(conf.required).not.toContain("ingredients");
  });

  it("xPost が必須に入っている（X 紹介文を同時に生成させる）", () => {
    const props = buildTool(VOCAB).input_schema.properties;
    expect(props.xPost.type).toBe("string");
    expect(props.xPost.maxLength).toBe(145);
    expect(buildTool(VOCAB).input_schema.required).toContain("xPost");
  });

  it("必須フィールドが揃っている", () => {
    const required = buildTool(VOCAB).input_schema.required;
    for (const key of ["title", "ingredients", "steps", "confidence", "rationale"]) {
      expect(required).toContain(key);
    }
  });
});

describe("buildMessages", () => {
  it("メモを <memo> で囲む", () => {
    const [msg] = buildMessages({ memo: "牛丼", image: null, today: "2026-08-11" });
    const text = msg.content.at(-1).text;
    expect(text).toContain("<memo>\n牛丼\n</memo>");
    expect(text).toContain(TOOL_NAME);
  });

  it("画像はテキストより前に置く", () => {
    const [msg] = buildMessages({
      memo: "",
      image: { mediaType: "image/jpeg", base64: "AAAA" },
      today: "2026-08-11",
    });
    expect(msg.content[0].type).toBe("image");
    expect(msg.content[1].type).toBe("text");
  });

  it("画像があるときだけ image_note を付ける", () => {
    const withImage = buildMessages({
      memo: "x",
      image: { mediaType: "image/jpeg", base64: "AAAA" },
      today: "2026-08-11",
    })[0].content.at(-1).text;
    const withoutImage = buildMessages({ memo: "x", image: null, today: "2026-08-11" })[0]
      .content.at(-1).text;
    expect(withImage).toContain("<image_note>");
    expect(withoutImage).not.toContain("<image_note>");
  });
});
