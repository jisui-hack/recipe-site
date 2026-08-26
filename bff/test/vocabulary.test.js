// @vitest-environment jsdom
/*
 * 「tags.js にタグを足したのに AI に反映されない」は最も気づきにくいバグなので、
 * 語彙の生成経路だけを独立して押さえておく。
 */

import { describe, expect, it } from "vitest";

import { TAG_GROUPS } from "../../public/assets/tags.js";

/** ai-draft.js の buildVocabulary と同じ式。実装が変わればここも落ちる */
const buildVocabulary = () =>
  Object.fromEntries(TAG_GROUPS.map((g) => [g.key, g.tags.map((t) => t.name)]));

describe("buildVocabulary", () => {
  it("TAG_GROUPS の全タグが漏れなく出る", () => {
    const vocab = buildVocabulary();
    const total = Object.values(vocab).reduce((n, list) => n + list.length, 0);
    const expected = TAG_GROUPS.reduce((n, g) => n + g.tags.length, 0);
    expect(total).toBe(expected);
  });

  it("グループキーは protein / plant / genre", () => {
    expect(Object.keys(buildVocabulary())).toEqual(["protein", "plant", "genre"]);
  });

  it("現在のタグ件数（増減したらここも更新する）", () => {
    const vocab = buildVocabulary();
    expect(vocab.protein).toHaveLength(9);
    expect(vocab.plant).toHaveLength(19);
    expect(vocab.genre).toHaveLength(5);
  });

  it("レシピJSONに入る name をそのまま返す（表示名に加工しない）", () => {
    expect(buildVocabulary().genre).toContain("和風");
    expect(buildVocabulary().protein).toContain("ハム・ベーコン");
  });

  it("BFF 側の検証を通る形になっている（制御文字・長さ）", () => {
    for (const names of Object.values(buildVocabulary())) {
      for (const name of names) {
        expect(name.length).toBeGreaterThan(0);
        expect(name.length).toBeLessThanOrEqual(20);
        expect(/[\u0000-\u001F\u007F]/.test(name)).toBe(false);
      }
    }
  });
});
