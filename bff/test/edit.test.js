// @vitest-environment jsdom
/*
 * 投稿済みレシピの上書き。
 *
 * ここが壊れると **公開中のレシピを別物で潰す** ので、
 * 「新規と何が違うか」を1つずつ固定する。見るのは4点。
 *   1. ID を採番し直さない
 *   2. GitHub に sha を渡す（無いと 422 で落ちる）
 *   3. createdAt を動かさない（一覧の並びが変わってしまう）
 *   4. 画像を選び直さなければ thumb を残す
 *
 * GitHub API は fetch ごと差し替える。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "../../public");
const ADD_HTML = readFileSync(join(PUBLIC, "add.html"), "utf8");
const BODY = ADD_HTML.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, "");

const CFG = { owner: "jisui-hack", repo: "recipe-site", branch: "main", token: "github_pat_test" };

const EXISTING = {
  id: "2026-0003-oyakodon",
  title: "フライパンひとつで親子丼",
  thumb: "data/images/2026-0003-oyakodon.jpg",
  timeMinutes: 12,
  servings: 1,
  ingredients: [{ name: "鶏もも肉", amount: "100g" }],
  steps: ["鶏肉を切る。"],
  protein: ["鶏肉"],
  plant: ["玉ねぎ"],
  genre: ["和風"],
  sourceUrl: null,
  createdAt: "2026-08-08",
  notes: "卵は2回に分けて。",
};

let addMod;
let puts; // PUT された内容を順に貯める

/** GitHub API を模す。GET は sha 付きで返し、PUT は記録する */
function mockGitHub({ recipeExists = true, imageExists = true } = {}) {
  puts = [];
  return vi.fn(async (url, opt = {}) => {
    const u = String(url);

    if (u.includes("api.github.com") && (opt.method ?? "GET") === "GET") {
      if (u.includes("data/index.json")) {
        const list = [{ id: EXISTING.id, title: EXISTING.title, createdAt: EXISTING.createdAt }];
        return json({ sha: "sha-index", content: b64(JSON.stringify(list)) });
      }
      if (u.includes("data/recipes/")) {
        return recipeExists ? json({ sha: "sha-recipe" }) : new Response("", { status: 404 });
      }
      if (u.includes("data/images/")) {
        return imageExists ? json({ sha: "sha-image" }) : new Response("", { status: 404 });
      }
    }

    if (opt.method === "PUT") {
      puts.push({ url: u, body: JSON.parse(opt.body) });
      return json({ content: { sha: "new" } });
    }

    // フォーム外の取得（一覧など）は空で返す
    return json([]);
  });
}

const json = (obj) =>
  new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });

const b64 = (text) => Buffer.from(text, "utf8").toString("base64");

/** PUT のうち、パスに frag を含むもの */
const putFor = (frag) => puts.find((p) => p.url.includes(frag));

/** 進捗が終わるまで待つ */
async function settle(check, timeoutMs = 1500) {
  const started = Date.now();
  for (;;) {
    try {
      if (check()) return;
    } catch {
      /* まだ */
    }
    if (Date.now() - started > timeoutMs) {
      check();
      throw new Error("待機がタイムアウトしました");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const $ = (id) => document.getElementById(id);

function submit() {
  $("recipe-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}

beforeEach(async () => {
  document.body.innerHTML = BODY;
  localStorage.clear();
  // add.js は設定とトークンを別のキーに分けて持つ
  localStorage.setItem("gh_config", JSON.stringify({ owner: CFG.owner, repo: CFG.repo, branch: CFG.branch }));
  localStorage.setItem("gh_token", CFG.token);
  vi.resetModules();
  globalThis.fetch = mockGitHub();
  addMod = await import("../../public/assets/add.js");
});

describe("編集モードに入る", () => {
  it("ボタンの文言と札が変わる（上書きと気づかずに押させない）", () => {
    expect($("btn-submit").textContent).toBe("GitHub に投稿する");

    addMod.startEditing(EXISTING);
    expect($("btn-submit").textContent).toBe("この内容で上書きする");
    expect($("edit-badge").hidden).toBe(false);
    expect($("edit-badge").textContent).toContain(EXISTING.id);
  });

  it("解除すると新規に戻る", () => {
    addMod.startEditing(EXISTING);
    addMod.stopEditing();
    expect($("btn-submit").textContent).toBe("GitHub に投稿する");
    expect($("edit-badge").hidden).toBe(true);
    expect(addMod.editingRecipe()).toBeNull();
  });
});

describe("上書きのコミット", () => {
  beforeEach(() => {
    addMod.startEditing(EXISTING);
    $("f-title").value = "フライパンひとつで親子丼（改）";
    $("ing-rows").replaceChildren(addMod.ingredientRow("鶏もも肉", "120g"));
    $("step-rows").replaceChildren(addMod.stepRow("鶏肉を切る。"));
  });

  it("ID を採番し直さない", async () => {
    submit();
    await settle(() => putFor("data/recipes/"));

    const put = putFor("data/recipes/");
    expect(put.url).toContain(`${EXISTING.id}.json`);

    const body = JSON.parse(Buffer.from(put.body.content, "base64").toString("utf8"));
    expect(body.id).toBe(EXISTING.id);
  });

  it("sha を渡す（無いと GitHub が 422 を返す）", async () => {
    submit();
    await settle(() => putFor("data/recipes/"));
    expect(putFor("data/recipes/").body.sha).toBe("sha-recipe");
  });

  it("createdAt を動かさない（一覧の並びが変わってしまう）", async () => {
    submit();
    await settle(() => putFor("data/recipes/"));

    const body = JSON.parse(Buffer.from(putFor("data/recipes/").body.content, "base64").toString("utf8"));
    expect(body.createdAt).toBe("2026-08-08");
    expect(body.title).toBe("フライパンひとつで親子丼（改）");
  });

  it("画像を選び直さなければ thumb を残す", async () => {
    submit();
    await settle(() => putFor("data/recipes/"));

    const body = JSON.parse(Buffer.from(putFor("data/recipes/").body.content, "base64").toString("utf8"));
    expect(body.thumb).toBe(EXISTING.thumb);
    // 画像自体はコミットしない
    expect(putFor("data/images/")).toBeUndefined();
  });

  it("index.json も更新する（重複させない）", async () => {
    submit();
    await settle(() => putFor("data/index.json"));

    const list = JSON.parse(Buffer.from(putFor("data/index.json").body.content, "base64").toString("utf8"));
    expect(list.filter((r) => r.id === EXISTING.id)).toHaveLength(1);
    expect(list[0].title).toBe("フライパンひとつで親子丼（改）");
  });

  it("終わったら編集モードを抜ける（次の入力で同じ ID を潰さない）", async () => {
    submit();
    // result を出したあとに後片付けが走るので、最後の PUT まで待ってから見る
    await settle(() => putFor("data/index.json"));
    await new Promise((r) => setTimeout(r, 20));

    expect(addMod.editingRecipe()).toBeNull();
    expect($("btn-submit").textContent).toBe("GitHub に投稿する");
  });
});

describe("新規投稿は今までどおり", () => {
  it("sha を渡さず、新しい ID を採る", async () => {
    $("f-title").value = "新しいレシピ";
    $("ing-rows").replaceChildren(addMod.ingredientRow("豚肉", "100g"));
    $("step-rows").replaceChildren(addMod.stepRow("焼く。"));

    submit();
    await settle(() => putFor("data/recipes/"));

    const put = putFor("data/recipes/");
    expect(put.body.sha).toBeUndefined();
    expect(put.url).not.toContain(EXISTING.id);

    const body = JSON.parse(Buffer.from(put.body.content, "base64").toString("utf8"));
    expect(body.id).not.toBe(EXISTING.id);
    expect(body.createdAt).toBe(addMod.todayISO());
  });
});

describe("直すレシピを選ぶ一覧", () => {
  /*
   * 一覧は **GitHub を先に見る。** 編集はリポジトリを書き換えるので、
   * 土台まで公開サイトから読むと、反映待ちの数十秒で古い内容を掴み、
   * 直前の変更を巻き戻す。ローカルのチェックアウトが古いときも同じ。
   */
  const INDEX = [
    { id: "2026-0004-0dwz", title: "豚肉とごぼうの山椒煮", createdAt: "2026-08-26", protein: ["豚肉"], plant: ["ごぼう"], genre: ["和風"] },
    { id: "2026-0003-oyakodon", title: "フライパンひとつで親子丼", createdAt: "2026-08-08", protein: ["鶏肉"], plant: ["玉ねぎ"], genre: ["和風"] },
    { id: "2026-0001-gyudon", title: "簡単10分 牛丼", createdAt: "2026-08-06", protein: ["牛肉"], plant: ["玉ねぎ"], genre: ["和風"] },
  ];

  /** GitHub / サイト どちらから読むかを切り替えられるモック */
  function mockSources({ githubOk = true, siteIndex = INDEX.slice(0, 1) } = {}) {
    return vi.fn(async (url, opt = {}) => {
      const u = String(url);
      if (u.includes("api.github.com")) {
        if (!githubOk) return new Response("", { status: 401 });
        if (u.includes("data/index.json")) return json({ content: b64(JSON.stringify(INDEX)) });
        if (u.includes("data/recipes/")) return json({ content: b64(JSON.stringify(EXISTING)) });
      }
      if (u.includes("data/index.json")) return json(siteIndex);
      if (u.includes("data/recipes/")) return json(EXISTING);
      if (opt.method === "PUT") { puts.push({ url: u, body: JSON.parse(opt.body) }); return json({}); }
      return json([]);
    });
  }

  const titles = () =>
    [...document.querySelectorAll(".edit-item-title")].map((n) => n.textContent);

  const type = (text) => {
    const q = $("edit-query");
    q.value = text;
    q.dispatchEvent(new window.Event("input", { bubbles: true }));
  };

  async function boot(mock) {
    globalThis.fetch = mock;
    await import("../../public/assets/edit.js");
    await settle(() => document.querySelectorAll(".edit-item, .edit-empty").length > 0);
  }

  it("トークンがあれば GitHub の一覧を出す（公開サイトより新しい）", async () => {
    await boot(mockSources({ githubOk: true, siteIndex: INDEX.slice(2) }));

    expect(titles()).toHaveLength(3);
    expect(titles()[0]).toBe("豚肉とごぼうの山椒煮");
    expect($("edit-status").textContent).toContain("GitHub");
  });

  it("GitHub が読めなければサイト側に落とし、落ちたことを言う", async () => {
    await boot(mockSources({ githubOk: false, siteIndex: INDEX.slice(2) }));

    // 空リストのまま黙ると「投稿が消えた」ように見える
    expect(titles()).toEqual(["簡単10分 牛丼"]);
    expect($("edit-status").textContent).toContain("401");
  });

  it("料理名で絞り込める", async () => {
    await boot(mockSources());
    type("牛丼");
    expect(titles()).toEqual(["簡単10分 牛丼"]);
    expect($("edit-count").textContent).toBe("1 / 3 件");
  });

  it("タグでも引ける（index.json に材料は無いため）", async () => {
    await boot(mockSources());
    type("ごぼう");
    expect(titles()).toEqual(["豚肉とごぼうの山椒煮"]);
  });

  it("空白区切りは AND", async () => {
    await boot(mockSources());
    type("和風 鶏肉");
    expect(titles()).toEqual(["フライパンひとつで親子丼"]);
  });

  it("該当なしはそう言う", async () => {
    await boot(mockSources());
    type("そんなものはない");
    expect(titles()).toEqual([]);
    expect(document.querySelector(".edit-empty").textContent).toBe("見つかりませんでした");
  });

  it("選ぶとフォームに入り、編集モードになる", async () => {
    await boot(mockSources());
    document.querySelector(".edit-item").click();
    await settle(() => $("f-title").value === EXISTING.title);

    expect($("btn-submit").textContent).toBe("この内容で上書きする");
    expect(document.querySelector('.edit-item[aria-current="true"]')).toBeTruthy();
  });
});

describe("削除", () => {
  /*
   * **戻せない操作。** 1クリックで通らないこと、消す順番が正しいこと、
   * index に残骸を残さないことを固定する。
   */
  const INDEX = [
    { id: "2026-0003-oyakodon", title: "フライパンひとつで親子丼", createdAt: "2026-08-08" },
    { id: "2026-0001-gyudon", title: "簡単10分 牛丼", createdAt: "2026-08-06" },
  ];

  let deletes;

  function mockAll({ thumb = null } = {}) {
    deletes = [];
    puts = [];
    return vi.fn(async (url, opt = {}) => {
      const u = String(url);
      if (opt.method === "DELETE") {
        deletes.push({ url: u, body: JSON.parse(opt.body) });
        return json({});
      }
      if (opt.method === "PUT") {
        puts.push({ url: u, body: JSON.parse(opt.body) });
        return json({});
      }
      if (u.includes("api.github.com")) {
        if (u.includes("data/index.json")) return json({ sha: "si", content: b64(JSON.stringify(INDEX)) });
        if (u.includes("data/recipes/")) return json({ sha: "sr", content: b64(JSON.stringify({ ...EXISTING, thumb })) });
        if (u.includes("data/images/")) return json({ sha: "simg" });
      }
      if (u.includes("data/index.json")) return json(INDEX);
      if (u.includes("data/recipes/")) return json({ ...EXISTING, thumb });
      return json([]);
    });
  }

  async function bootAndPick(mock) {
    globalThis.fetch = mock;
    await import("../../public/assets/edit.js");
    await settle(() => document.querySelectorAll(".edit-item").length > 0);
    document.querySelector(".edit-item").click();
    await settle(() => $("edit-delete") && !$("edit-delete").hidden);
  }

  it("1回目では消さない（身構えるだけ）", async () => {
    await bootAndPick(mockAll());
    $("edit-delete").click();

    expect(deletes).toHaveLength(0);
    expect($("edit-delete").textContent).toContain("本当に削除");
    expect($("edit-delete").classList.contains("armed")).toBe(true);
  });

  it("2回押すと消える。順番は 本体 → 画像 → index", async () => {
    await bootAndPick(mockAll({ thumb: "data/images/2026-0003-oyakodon.jpg" }));
    $("edit-delete").click();
    $("edit-delete").click();
    await settle(() => puts.length > 0);

    expect(deletes.map((d) => d.url.split("/contents/")[1].split("?")[0])).toEqual([
      "public/data/recipes/2026-0003-oyakodon.json",
      "public/data/images/2026-0003-oyakodon.jpg",
    ]);
    // index の更新は最後。先に消すと、一覧に出ないファイルが残る
    expect(puts[0].url).toContain("data/index.json");
  });

  it("sha を渡して消す（無いと GitHub が拒む）", async () => {
    await bootAndPick(mockAll());
    $("edit-delete").click();
    $("edit-delete").click();
    await settle(() => deletes.length > 0);

    expect(deletes[0].body.sha).toBe("sr");
  });

  it("index から消す（残骸を残さない）", async () => {
    await bootAndPick(mockAll());
    $("edit-delete").click();
    $("edit-delete").click();
    await settle(() => puts.length > 0);

    const list = JSON.parse(Buffer.from(puts[0].body.content, "base64").toString("utf8"));
    expect(list.find((r) => r.id === "2026-0003-oyakodon")).toBeUndefined();
    expect(list).toHaveLength(1);
  });

  it("画像が無ければ画像は消しにいかない", async () => {
    await bootAndPick(mockAll({ thumb: null }));
    $("edit-delete").click();
    $("edit-delete").click();
    await settle(() => puts.length > 0);

    expect(deletes.filter((d) => d.url.includes("images"))).toHaveLength(0);
  });

  it("消したら一覧から外れ、編集モードも抜ける", async () => {
    await bootAndPick(mockAll());
    $("edit-delete").click();
    $("edit-delete").click();
    await settle(() => puts.length > 0);
    await new Promise((r) => setTimeout(r, 20));

    expect([...document.querySelectorAll(".edit-item-title")].map((n) => n.textContent))
      .toEqual(["簡単10分 牛丼"]);
    expect(addMod.editingRecipe()).toBeNull();
    expect($("edit-delete").hidden).toBe(true);
  });

  it("別のレシピを選ぶと身構えが解ける（取り違えて消さない）", async () => {
    await bootAndPick(mockAll());
    $("edit-delete").click();
    expect($("edit-delete").classList.contains("armed")).toBe(true);

    document.querySelectorAll(".edit-item")[1].click();
    await settle(() => !$("edit-delete").classList.contains("armed"));

    expect(deletes).toHaveLength(0);
  });
});
