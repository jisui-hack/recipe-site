// @vitest-environment jsdom
/*
 * X 投稿まわり。文字数の数え方と、投稿後に URL が入ることを押さえる。
 * 自動投稿はしないので、確認するのは「本文」と「投稿画面を開くリンク」まで。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "../../public");
const ADD_HTML = readFileSync(join(PUBLIC, "add.html"), "utf8");
const BODY = ADD_HTML.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, "");

let x;
const $ = (id) => document.getElementById(id);

beforeEach(async () => {
  document.body.innerHTML = BODY;
  vi.resetModules();
  x = await import("../../public/assets/x-post.js");
  x.initXPost();
});

describe("文字数の数え方（X と同じ）", () => {
  it("日本語は1文字を2として数える", () => {
    expect(x.weightedLength("あいうえお")).toBe(10);
  });

  it("英数字は1文字を1として数える", () => {
    expect(x.weightedLength("hello")).toBe(5);
  });

  it("ハッシュタグ混じりも数えられる", () => {
    // 「#自炊ハック」= # が1 + 日本語5文字×2 = 11
    expect(x.weightedLength("#自炊ハック")).toBe(11);
  });

  it("絵文字は2として数える", () => {
    expect(x.weightedLength("🍳")).toBe(2);
  });
});

describe("投稿文の組み立て", () => {
  it("URL があれば改行して末尾に付ける", () => {
    expect(x.composeText("本文", "https://example.com/a")).toBe("本文\nhttps://example.com/a");
  });

  it("URL が無ければ本文だけ", () => {
    expect(x.composeText("本文", null)).toBe("本文");
  });

  it("投稿画面の URL に本文が入る", () => {
    const u = x.intentUrl("豚バラ白菜 #自炊ハック");
    expect(u.startsWith("https://x.com/intent/post?text=")).toBe(true);
    expect(decodeURIComponent(u.split("text=")[1])).toBe("豚バラ白菜 #自炊ハック");
  });
});

describe("表示", () => {
  const TEXT = "豚バラと白菜を重ねて蒸すだけ。10分・2人分。#自炊ハック #自炊";

  it("紹介文があれば出る", () => {
    expect($("x-post").hidden).toBe(true);
    x.showXPost(TEXT);
    expect($("x-post").hidden).toBe(false);
    expect($("x-post-text").value).toBe(TEXT);
  });

  it("紹介文が空なら出さない", () => {
    x.showXPost("");
    expect($("x-post").hidden).toBe(true);
  });

  it("URL は付けないと伝える", () => {
    x.showXPost(TEXT);
    expect($("x-post-url").textContent).toContain("URL は付けません");
    expect($("x-post-open").href).not.toContain("recipe.html");
  });

  it("文字数が出る", () => {
    x.showXPost(TEXT);
    expect($("x-post-count").textContent).toBe(`${x.weightedLength(TEXT)} / 280`);
    expect($("x-post-count").dataset.over).toBe("false");
  });

  it("超過したら印を付けて投稿リンクを止める", () => {
    x.showXPost("あ".repeat(200)); // 400
    expect($("x-post-count").dataset.over).toBe("true");
    expect($("x-post-open").getAttribute("aria-disabled")).toBe("true");
  });

  it("人が本文を直すと文字数と投稿リンクが追従する", () => {
    x.showXPost(TEXT);
    const ta = $("x-post-text");
    ta.value = "短くした";
    ta.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect($("x-post-count").textContent).toBe("8 / 280");
    expect(decodeURIComponent($("x-post-open").href.split("text=")[1])).toBe("短くした");
  });

  it("取り消すと消える", () => {
    x.showXPost(TEXT);
    x.clearXPost();
    expect($("x-post").hidden).toBe(true);
  });
});

describe("レシピ投稿後に URL が入る", () => {
  it("#result にリンクが出ても本文に URL は入らない", async () => {
    // サイトが整うまで URL は出さない方針（INCLUDE_URL = false）。
    // 投稿が終わって詳細ページの URL が確定しても、本文には足さない。
    x.showXPost("本文");

    const result = $("result");
    result.hidden = false;
    const a = document.createElement("a");
    a.setAttribute("href", "recipe.html?id=2026-0005-abcd");
    a.textContent = "このレシピを見る →";
    result.appendChild(a);

    await new Promise((r) => setTimeout(r, 30));

    expect($("x-post-url").textContent).toContain("URL は付けません");
    expect(decodeURIComponent($("x-post-open").href.split("text=")[1])).toBe("本文");
    expect($("x-post-open").href).not.toContain("recipe.html");
  });

  it("URL を足さないぶん、文字数は本文だけで数える", async () => {
    x.showXPost("本文");
    const result = $("result");
    result.hidden = false;
    const a = document.createElement("a");
    a.setAttribute("href", "recipe.html?id=2026-0005-abcd");
    result.appendChild(a);
    await new Promise((r) => setTimeout(r, 30));

    expect($("x-post-count").textContent).toBe(`${x.weightedLength("本文")} / 280`);
  });
});
