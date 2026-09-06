// @vitest-environment jsdom
/*
 * ai-draft.js の UI とエラー処理。
 *
 * fetch を差し替えて、BFF が各種の応答を返したときにフォームがどうなるかを見る。
 * 特に「AI が失敗したときにフォームを壊さない」ことを固定したい。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "../../public");
const ADD_HTML = readFileSync(join(PUBLIC, "add.html"), "utf8");
const BODY = ADD_HTML.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, "");

const KEY = "test-client-key";
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

const goodPayload = (over = {}) => ({
  schemaVersion: 1,
  draft: {
    title: "豚バラ白菜のミルフィーユ蒸し",
    timeMinutes: 12,
    servings: 2,
    ingredients: [
      { name: "豚バラ肉", amount: "200g" },
      { name: "白菜", amount: "1/4個" },
    ],
    steps: ["白菜を切る。", "豚バラと重ねて蒸す。"],
    protein: ["豚肉"],
    plant: ["白菜"],
    genre: ["和風"],
    notes: "ポン酢で。",
    sourceUrl: null,
    ...(over.draft ?? {}),
  },
  confidence: { ...HIGH, ...(over.confidence ?? {}) },
  followUps: over.followUps ?? [],
  rationale: "メモの記載どおり。",
  meta: { latencyMs: 3000, cached: false },
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const errorBody = (code, extra = {}) => ({ error: { code, message: code, ...extra } });

let fetchMock;

/** 非同期のクリックハンドラが落ち着くまで待つ */
async function settle(check, timeoutMs = 1000) {
  const started = Date.now();
  for (;;) {
    try {
      if (check()) return;
    } catch {
      /* まだ揃っていない */
    }
    if (Date.now() - started > timeoutMs) {
      check(); // 最後の失敗をそのまま投げさせる
      throw new Error("待機がタイムアウトしました");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const $ = (id) => document.getElementById(id);
const warnTexts = () => [...document.querySelectorAll("#ai-warnings p, #ai-warnings li")].map((n) => n.textContent);

function typeMemo(text = "豚バラと白菜を重ねて蒸すだけ。10分、2人分") {
  const memo = $("ai-memo");
  memo.value = text;
  memo.dispatchEvent(new window.Event("input", { bubbles: true }));
}

beforeEach(async () => {
  document.body.innerHTML = BODY;
  localStorage.clear();
  localStorage.setItem("ai_bff_key", KEY);
  localStorage.setItem("ai_bff_endpoint", "https://bff.test/v1/draft");

  fetchMock = vi.fn().mockResolvedValue(json(goodPayload()));
  globalThis.fetch = fetchMock;

  vi.resetModules();
  await import("../../public/assets/add.js");
  await import("../../public/assets/ai-draft.js");
});

describe("正常系", () => {
  it("フォームが埋まり、取り消しボタンが出る", async () => {
    typeMemo();
    $("ai-generate").click();
    await settle(() => $("f-title").value === "豚バラ白菜のミルフィーユ蒸し");

    expect($("f-time").value).toBe("12");
    expect($("ai-undo").hidden).toBe(false);
    expect($("ai-regenerate").hidden).toBe(false);
    expect($("ai-status").textContent).toContain("下書きを作りました");
  });

  it("語彙をリクエストに載せる（tags.js の全タグ）", async () => {
    typeMemo();
    $("ai-generate").click();
    await settle(() => fetchMock.mock.calls.length === 1);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.vocabulary.protein).toContain("豚肉");
    expect(body.vocabulary.plant).toHaveLength(22);
    expect(body.vocabulary.genre).toHaveLength(5);
    expect(body.schemaVersion).toBe(1);
    expect(fetchMock.mock.calls[0][1].headers["X-Client-Key"]).toBe(KEY);
  });

  it("元記事URLが無いことは警告にしない（無いのが普通）", async () => {
    typeMemo();
    $("ai-generate").click();
    await settle(() => $("f-title").value !== "");
    expect(warnTexts().join(" ")).not.toContain("元記事URL");
  });

  it("followUps は警告として出る", async () => {
    fetchMock.mockResolvedValue(
      json(
        goodPayload({
          confidence: { ingredientAmounts: "medium" },
          followUps: [{ field: "ingredientAmounts", message: "分量は目安です。" }],
        })
      )
    );
    typeMemo();
    $("ai-generate").click();
    await settle(() => warnTexts().some((t) => t.includes("分量は目安です")));
  });

  it("「作り直す」は nocache を付ける", async () => {
    typeMemo();
    $("ai-generate").click();
    // 生成中は「作り直す」も無効化されるので、完了を待ってから押す
    await settle(() => $("ai-regenerate").hidden === false && !$("ai-regenerate").disabled);

    $("ai-regenerate").click();
    await settle(() => fetchMock.mock.calls.length === 2);
    expect(fetchMock.mock.calls[1][0]).toContain("nocache=1");
  });

  it("多重押下しても1回しか呼ばない", async () => {
    let release;
    fetchMock.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(json(goodPayload()))))
    );
    typeMemo();
    $("ai-generate").click();
    $("ai-generate").click();
    $("ai-generate").click();
    await settle(() => fetchMock.mock.calls.length >= 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release();
  });
});

describe("入力が足りないとき", () => {
  it("メモも写真も無ければ通信しない", async () => {
    $("ai-generate").click();
    await settle(() => warnTexts().some((t) => t.includes("メモを書くか")));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("クライアントキーが未設定なら設定を開いて通信しない", async () => {
    localStorage.removeItem("ai_bff_key");
    typeMemo();
    $("ai-generate").click();
    await settle(() => $("ai-settings").open === true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("エラー処理 — フォームを壊さないこと", () => {
  const untouched = () =>
    $("f-title").value === "" &&
    $("f-time").value === "10" &&
    document.querySelectorAll("#ing-rows .dyn-row").length === 3;

  it("通信エラーでもフォームは元のまま", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    typeMemo();
    $("ai-generate").click();
    await settle(() => warnTexts().some((t) => t.includes("AI に繋がりませんでした")));
    expect(untouched()).toBe(true);
    expect(warnTexts().join(" ")).toContain("手入力でも投稿できます");
  });

  it("401 は設定を開く", async () => {
    fetchMock.mockResolvedValue(json(errorBody("UNAUTHORIZED"), 401));
    typeMemo();
    $("ai-generate").click();
    await settle(() => $("ai-settings").open === true);
    expect(untouched()).toBe(true);
  });

  it("429 は待ち時間を出す", async () => {
    fetchMock.mockResolvedValue(json(errorBody("RATE_LIMITED", { retryAfterSec: 420 }), 429));
    typeMemo();
    $("ai-generate").click();
    await settle(() => warnTexts().some((t) => t.includes("7分")));
    expect(untouched()).toBe(true);
  });

  it("422 はメモ欄にフォーカスする", async () => {
    fetchMock.mockResolvedValue(json(errorBody("EXTRACTION_FAILED"), 422));
    typeMemo();
    $("ai-generate").click();
    await settle(() => document.activeElement === $("ai-memo"));
    expect(untouched()).toBe(true);
  });

  it("413 は画像が大きい旨を出す", async () => {
    fetchMock.mockResolvedValue(json(errorBody("PAYLOAD_TOO_LARGE"), 413));
    typeMemo();
    $("ai-generate").click();
    await settle(() => warnTexts().some((t) => t.includes("画像が大きすぎます")));
  });

  it("200 でも中身が DraftPayload でなければ適用しない", async () => {
    fetchMock.mockResolvedValue(json({ hello: "world" }));
    typeMemo();
    $("ai-generate").click();
    await settle(() => warnTexts().some((t) => t.includes("読み取れませんでした")));
    expect(untouched()).toBe(true);
    expect($("ai-undo").hidden).toBe(true);
  });

  it("confidence が欠けた応答でも適用しない", async () => {
    const broken = goodPayload();
    delete broken.confidence;
    fetchMock.mockResolvedValue(json(broken));
    typeMemo();
    $("ai-generate").click();
    await settle(() => warnTexts().length > 0);
    expect(untouched()).toBe(true);
  });

  it("失敗してもボタンは押せる状態に戻る", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    typeMemo();
    $("ai-generate").click();
    await settle(() => $("ai-generate").disabled === false);
    expect($("ai-generate").hasAttribute("aria-busy")).toBe(false);
  });
});

describe("取り消し", () => {
  it("適用前の状態に戻る", async () => {
    typeMemo();
    $("ai-generate").click();
    await settle(() => $("f-title").value !== "");

    $("ai-undo").click();
    expect($("f-title").value).toBe("");
    expect($("f-time").value).toBe("10");
    expect($("f-servings").value).toBe("1");
    expect(document.querySelectorAll("#ing-rows .dyn-row")).toHaveLength(3);
    expect(document.querySelectorAll("[data-ai-filled]")).toHaveLength(0);
    expect($("ai-undo").hidden).toBe(true);
  });

  it("人が先に書いた内容は取り消しでも残る", async () => {
    const title = $("f-title");
    title.value = "自分のタイトル";
    title.dispatchEvent(new window.Event("input", { bubbles: true }));

    typeMemo();
    $("ai-generate").click();
    await settle(() => $("f-time").value === "12");

    $("ai-undo").click();
    expect(title.value).toBe("自分のタイトル");
    expect(title.dataset.userEdited).toBe("true");
  });
});

describe("鍵が未設定のとき", () => {
  /*
   * add.html は GitHub Pages で公開されている。鍵を持たない訪問者に
   * 押しても動かないボタンを見せないための畳み込み。
   * localStorage を消してから読み込み直す必要があるので、この describe だけ
   * beforeEach をやり直している。
   */
  beforeEach(async () => {
    document.body.innerHTML = BODY;
    localStorage.clear();
    vi.resetModules();
    await import("../../public/assets/add.js");
    await import("../../public/assets/ai-draft.js");
  });

  it("入口が畳まれ、設定が開いた状態になる", () => {
    expect($("ai-draft").classList.contains("is-unconfigured")).toBe(true);
    expect($("ai-settings").open).toBe(true);
    expect($("ai-cfg-status").textContent).toBe("未設定です");
  });

  it("エンドポイントだけでは畳みは解けない", () => {
    $("ai-cfg-endpoint").value = "https://bff.test/v1/draft";
    $("ai-cfg-save").click();
    expect($("ai-draft").classList.contains("is-unconfigured")).toBe(true);
  });

  it("キーだけでは畳みは解けない（URL 未入力を通信障害に見せない）", async () => {
    // 以前は既定の example ドメインへ落としていて、設定漏れが
    // 「AI に繋がりませんでした」になっていた。
    $("ai-cfg-key").value = KEY;
    $("ai-cfg-save").click();
    expect($("ai-draft").classList.contains("is-unconfigured")).toBe(true);
    expect($("ai-cfg-status").textContent).toBe("保存しました");

    // この状態で生成を押しても fetch は飛ばない
    const spy = vi.fn();
    globalThis.fetch = spy;
    typeMemo();
    $("ai-generate").click();
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).not.toHaveBeenCalled();
    expect(warnTexts().join("")).toContain("設定");
  });

  it("両方そろうと畳みが解ける", () => {
    $("ai-cfg-endpoint").value = "https://bff.test/v1/draft";
    $("ai-cfg-key").value = KEY;
    $("ai-cfg-save").click();

    expect($("ai-draft").classList.contains("is-unconfigured")).toBe(false);
    expect(localStorage.getItem("ai_bff_key")).toBe(KEY);
  });

  it("キーを削除すると畳み直す", () => {
    $("ai-cfg-endpoint").value = "https://bff.test/v1/draft";
    $("ai-cfg-key").value = KEY;
    $("ai-cfg-save").click();
    $("ai-cfg-clear").click();

    expect($("ai-draft").classList.contains("is-unconfigured")).toBe(true);
  });
});

describe("設定が保存できない端末", () => {
  /*
   * プライベートブラウズやアプリ内ブラウザでは setItem が例外を投げる。
   * 以前はそれを見ずに「保存しました」と出していたので、
   * **次に開いて消えている理由が分からなかった。**
   */
  beforeEach(async () => {
    document.body.innerHTML = BODY;
    localStorage.clear();
    vi.resetModules();
    await import("../../public/assets/add.js");
    await import("../../public/assets/ai-draft.js");
  });

  // 壊した localStorage を次のテストへ持ち越さない
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * プライベートブラウズの再現。jsdom の localStorage は prototype 経由では
   * 差し替わらないので、インスタンスの setItem を直接置き換える。
   */
  function breakStorage() {
    const real = window.localStorage.setItem.bind(window.localStorage);
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    return real;
  }

  it("保存できなければ、そう言う（「保存しました」と嘘をつかない）", () => {
    breakStorage();
    $("ai-cfg-endpoint").value = "https://bff.test/v1/draft";
    $("ai-cfg-key").value = KEY;
    $("ai-cfg-save").click();

    expect($("ai-cfg-status").textContent).not.toContain("保存しました");
    expect($("ai-cfg-status").textContent).toContain("保存できません");
  });

  it("保存できなければ設定を閉じない（できたと思わせない）", () => {
    breakStorage();
    $("ai-settings").open = true;
    $("ai-cfg-endpoint").value = "https://bff.test/v1/draft";
    $("ai-cfg-key").value = KEY;
    $("ai-cfg-save").click();

    expect($("ai-settings").open).toBe(true);
    expect($("ai-draft").classList.contains("is-unconfigured")).toBe(true);
  });

  it("GitHub 設定でも同じ", () => {
    breakStorage();
    $("cfg-owner").value = "jisui-hack";
    $("cfg-repo").value = "recipe-site";
    $("cfg-token").value = "github_pat_x";
    $("cfg-save").click();

    expect($("cfg-status").textContent).toContain("保存できません");
  });

  it("書けるときは今までどおり", () => {
    $("ai-cfg-endpoint").value = "https://bff.test/v1/draft";
    $("ai-cfg-key").value = KEY;
    $("ai-cfg-save").click();

    expect($("ai-cfg-status").textContent).toBe("保存しました");
    expect(localStorage.getItem("ai_bff_key")).toBe(KEY);
  });
});

describe("どちらの保存領域か", () => {
  /*
   * **ホーム画面のアプリと Safari は別の保存領域を持つ。**
   * 同じ URL でも設定は共有されない。これを知らないと
   * 「アプリから開いたら設定が消えた」と見える。実際に踏んだ。
   */
  async function boot() {
    document.body.innerHTML = BODY;
    localStorage.clear();
    vi.resetModules();
    await import("../../public/assets/add.js");
    await import("../../public/assets/ai-draft.js");
  }

  afterEach(() => {
    delete window.navigator.standalone;
    vi.restoreAllMocks();
  });

  it("ブラウザで開いていると、設定が別々だと伝える", async () => {
    await boot();
    for (const id of ["storage-context", "ai-storage-context"]) {
      expect($(id).textContent).toContain("別々");
      expect($(id).dataset.standalone).toBe("false");
    }
  });

  it("ホーム画面のアプリなら、消えないと伝える", async () => {
    Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
    await boot();
    for (const id of ["storage-context", "ai-storage-context"]) {
      expect($(id).textContent).toContain("消えません");
      expect($(id).dataset.standalone).toBe("true");
    }
  });
});
