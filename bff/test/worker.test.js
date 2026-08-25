/*
 * Worker のエントリポイントに対する結合テスト。
 *
 * 単体テストは各モジュールの中身しか見ていないので、
 * 「認証の順序」「CORS ヘッダの有無」「レート制限を消費する位置」といった
 * 組み合わせの部分はここでしか落ちない。
 *
 * Anthropic SDK はモックする（ネットワークにも API キーにも依存しない）。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/* ---------- Anthropic SDK のモック ---------- */

const createMock = vi.fn();

class FakeAPIConnectionError extends Error {}
class FakeAPIError extends Error {
  constructor(status) {
    super(`status ${status}`);
    this.status = status;
  }
}

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    constructor() {
      this.messages = { create: createMock };
    }
  }
  FakeAnthropic.APIConnectionError = FakeAPIConnectionError;
  FakeAnthropic.APIError = FakeAPIError;
  return { default: FakeAnthropic };
});

const { default: worker } = await import("../src/index.js");

/* ---------- テスト用の env / ctx ---------- */

const CLIENT_KEY = "test-client-key-0123456789abcdef";
const ORIGIN = "https://example.github.io";

function fakeKV() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

function makeEnv(over = {}) {
  return {
    ALLOWED_ORIGINS: `${ORIGIN},http://localhost:3000`,
    CLIENT_SHARED_KEY: CLIENT_KEY,
    ANTHROPIC_API_KEY: "sk-ant-test",
    MODEL: "claude-sonnet-5",
    HOURLY_REQUEST_LIMIT: "20",
    DAILY_REQUEST_LIMIT: "100",
    KV: fakeKV(),
    ...over,
  };
}

const waited = [];
const ctx = { waitUntil: (p) => waited.push(p) };

const VOCAB = {
  protein: ["豚肉", "鶏肉"],
  plant: ["白菜", "玉ねぎ"],
  genre: ["和風", "洋風"],
};

function draftRequest(body = {}, headers = {}) {
  return new Request("https://bff.example.dev/v1/draft", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "X-Client-Key": CLIENT_KEY,
      ...headers,
    },
    body: JSON.stringify({
      schemaVersion: 1,
      memo: "豚バラと白菜を重ねて蒸すだけ。ポン酢。10分、2人分",
      vocabulary: VOCAB,
      today: "2026-08-11",
      ...body,
    }),
  });
}

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

function goodMessage(over = {}) {
  return {
    model: "claude-sonnet-5",
    stop_reason: "tool_use",
    usage: { input_tokens: 1500, output_tokens: 700 },
    content: [
      {
        type: "tool_use",
        name: "emit_recipe_draft",
        input: {
          title: "豚バラ白菜のミルフィーユ蒸し",
          timeMinutes: 10,
          servings: 2,
          ingredients: [
            { name: "豚バラ肉", amount: "200g" },
            { name: "白菜", amount: "1/4個" },
          ],
          steps: ["白菜を切る", "豚バラと重ねて蒸す"],
          protein: ["豚肉"],
          plant: ["白菜"],
          genre: ["和風"],
          notes: "ポン酢で。",
          sourceUrl: null,
          confidence: { ...HIGH },
          followUps: [],
          rationale: "メモの記載どおり。",
        },
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  createMock.mockReset();
  createMock.mockResolvedValue(goodMessage());
  waited.length = 0;
});

/* ---------- CORS / 認証 ---------- */

describe("CORS とオリジン検証", () => {
  it("許可オリジンのプリフライトは 204 と CORS ヘッダを返す", async () => {
    const res = await worker.fetch(
      new Request("https://bff.example.dev/v1/draft", {
        method: "OPTIONS",
        headers: { Origin: ORIGIN },
      }),
      makeEnv(),
      ctx
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("許可外オリジンのプリフライトは素通りしない", async () => {
    const res = await worker.fetch(
      new Request("https://bff.example.dev/v1/draft", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example.com" },
      }),
      makeEnv(),
      ctx
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("ワイルドカードは返さない", async () => {
    const res = await worker.fetch(draftRequest(), makeEnv(), ctx);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("許可外オリジンの本リクエストは 403 で CORS ヘッダなし", async () => {
    const res = await worker.fetch(
      draftRequest({}, { Origin: "https://evil.example.com" }),
      makeEnv(),
      ctx
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("Origin ヘッダが無い場合も 403", async () => {
    const req = new Request("https://bff.example.dev/v1/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Key": CLIENT_KEY },
      body: "{}",
    });
    expect((await worker.fetch(req, makeEnv(), ctx)).status).toBe(403);
  });
});

describe("クライアントキー", () => {
  it("キーが違えば 401、AI は呼ばれない", async () => {
    const res = await worker.fetch(draftRequest({}, { "X-Client-Key": "wrong" }), makeEnv(), ctx);
    expect(res.status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("キーが無ければ 401", async () => {
    const req = new Request("https://bff.example.dev/v1/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: "{}",
    });
    expect((await worker.fetch(req, makeEnv(), ctx)).status).toBe(401);
  });

  it("Secret 未設定のまま公開されても素通りしない", async () => {
    const env = makeEnv({ CLIENT_SHARED_KEY: undefined });
    const res = await worker.fetch(draftRequest({}, { "X-Client-Key": "" }), env, ctx);
    expect(res.status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("ルーティング", () => {
  it("/v1/health はキー無しでも通る", async () => {
    const res = await worker.fetch(
      new Request("https://bff.example.dev/v1/health", { headers: { Origin: ORIGIN } }),
      makeEnv(),
      ctx
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.promptVersion).toBeTruthy();
    expect(body.hasApiKey).toBe(true);
  });

  it("未知のパスは 404", async () => {
    const res = await worker.fetch(
      new Request("https://bff.example.dev/v1/nope", {
        method: "POST",
        headers: { Origin: ORIGIN, "X-Client-Key": CLIENT_KEY },
      }),
      makeEnv(),
      ctx
    );
    expect(res.status).toBe(404);
  });

  it("GET /v1/draft は 404（POST のみ）", async () => {
    const res = await worker.fetch(
      new Request("https://bff.example.dev/v1/draft", {
        headers: { Origin: ORIGIN, "X-Client-Key": CLIENT_KEY },
      }),
      makeEnv(),
      ctx
    );
    expect(res.status).toBe(404);
  });
});

/* ---------- 正常系 ---------- */

describe("POST /v1/draft — 正常系", () => {
  it("DraftPayload を返す", async () => {
    const res = await worker.fetch(draftRequest(), makeEnv(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schemaVersion).toBe(1);
    expect(body.draft.title).toBe("豚バラ白菜のミルフィーユ蒸し");
    expect(body.draft.steps).toEqual(["白菜を切る。", "豚バラと重ねて蒸す。"]);
    expect(body.meta.cached).toBe(false);
    expect(body.meta.requestId).toBeTruthy();
    expect(body.meta.promptVersion).toBeTruthy();
  });

  it("Anthropic には temperature を渡さない（Sonnet 5 では 400 になる）", async () => {
    await worker.fetch(draftRequest(), makeEnv(), ctx);
    const params = createMock.mock.calls[0][0];
    expect(params.temperature).toBeUndefined();
    expect(params.top_p).toBeUndefined();
    expect(params.top_k).toBeUndefined();
  });

  it("ツール呼び出しを強制し、語彙を enum に注入している", async () => {
    await worker.fetch(draftRequest(), makeEnv(), ctx);
    const params = createMock.mock.calls[0][0];
    expect(params.tool_choice).toEqual({ type: "tool", name: "emit_recipe_draft" });
    expect(params.tools[0].input_schema.properties.protein.items.enum).toEqual(["豚肉", "鶏肉"]);
  });

  it("thinking は既定で disabled（max_tokens を推論に食われないため）", async () => {
    await worker.fetch(draftRequest(), makeEnv(), ctx);
    expect(createMock.mock.calls[0][0].thinking).toEqual({ type: "disabled" });
  });

  it("2回目は キャッシュから返る（AI は1回しか呼ばれない）", async () => {
    const env = makeEnv();
    await worker.fetch(draftRequest(), env, ctx);
    await Promise.all(waited);

    const res2 = await worker.fetch(draftRequest(), env, ctx);
    const body2 = await res2.json();
    expect(body2.meta.cached).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("?nocache=1 はキャッシュを迂回する", async () => {
    const env = makeEnv();
    await worker.fetch(draftRequest(), env, ctx);
    await Promise.all(waited);

    const req = new Request("https://bff.example.dev/v1/draft?nocache=1", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Client-Key": CLIENT_KEY },
      body: JSON.stringify({
        schemaVersion: 1,
        memo: "豚バラと白菜を重ねて蒸すだけ。ポン酢。10分、2人分",
        vocabulary: VOCAB,
        today: "2026-08-11",
      }),
    });
    const res = await worker.fetch(req, env, ctx);
    expect((await res.json()).meta.cached).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("語彙が変わるとキャッシュは効かない（tags.js に足したら再生成される）", async () => {
    const env = makeEnv();
    await worker.fetch(draftRequest(), env, ctx);
    await Promise.all(waited);

    const wider = { ...VOCAB, protein: [...VOCAB.protein, "ラム肉"] };
    await worker.fetch(draftRequest({ vocabulary: wider }), env, ctx);
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});

/* ---------- 異常系 ---------- */

describe("POST /v1/draft — 異常系", () => {
  it("memo も image も無ければ 400", async () => {
    const res = await worker.fetch(draftRequest({ memo: "" }), makeEnv(), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_REQUEST");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("壊れた JSON は 400", async () => {
    const req = new Request("https://bff.example.dev/v1/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Client-Key": CLIENT_KEY },
      body: "{ not json",
    });
    expect((await worker.fetch(req, makeEnv(), ctx)).status).toBe(400);
  });

  it("大きすぎる画像は 413", async () => {
    const big = "A".repeat(2_200_000);
    const res = await worker.fetch(
      draftRequest({ image: { mediaType: "image/jpeg", base64: big } }),
      makeEnv(),
      ctx
    );
    expect(res.status).toBe(413);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("tool_use が無ければ 422", async () => {
    createMock.mockResolvedValue({
      model: "claude-sonnet-5",
      stop_reason: "end_turn",
      usage: {},
      content: [{ type: "text", text: "すみません" }],
    });
    const res = await worker.fetch(draftRequest(), makeEnv(), ctx);
    expect(res.status).toBe(422);
  });

  it("refusal は 422 として扱う", async () => {
    createMock.mockResolvedValue({
      model: "claude-sonnet-5",
      stop_reason: "refusal",
      usage: {},
      content: [],
    });
    const res = await worker.fetch(draftRequest(), makeEnv(), ctx);
    expect(res.status).toBe(422);
  });

  it("content が欠けていても落ちない", async () => {
    createMock.mockResolvedValue({ model: "m", stop_reason: "end_turn", usage: {} });
    const res = await worker.fetch(draftRequest(), makeEnv(), ctx);
    expect(res.status).toBe(422);
  });

  it("正規化後に材料が空なら 422", async () => {
    const msg = goodMessage();
    msg.content[0].input.ingredients = [{ name: "  ", amount: "" }];
    createMock.mockResolvedValue(msg);
    const res = await worker.fetch(draftRequest(), makeEnv(), ctx);
    expect(res.status).toBe(422);
  });

  it("Anthropic が 5xx なら 502", async () => {
    createMock.mockRejectedValue(new FakeAPIError(500));
    const res = await worker.fetch(draftRequest(), makeEnv(), ctx);
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("UPSTREAM_ERROR");
  });

  it("Anthropic が接続エラーなら 504", async () => {
    createMock.mockRejectedValue(new FakeAPIConnectionError("timeout"));
    const res = await worker.fetch(draftRequest(), makeEnv(), ctx);
    expect(res.status).toBe(504);
    expect((await res.json()).error.code).toBe("UPSTREAM_TIMEOUT");
  });

  it("エラーレスポンスにも CORS ヘッダが付く（ブラウザ側で本文を読めるように）", async () => {
    const res = await worker.fetch(draftRequest({ memo: "" }), makeEnv(), ctx);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("API キーも共有キーもレスポンスに漏れない", async () => {
    const res = await worker.fetch(draftRequest(), makeEnv(), ctx);
    const text = await res.text();
    expect(text).not.toContain("sk-ant-test");
    expect(text).not.toContain(CLIENT_KEY);
  });
});

/* ---------- レート制限 ---------- */

describe("レート制限", () => {
  it("時間あたりの上限を超えたら 429 と Retry-After", async () => {
    const env = makeEnv({ HOURLY_REQUEST_LIMIT: "2" });
    await worker.fetch(draftRequest({ memo: "メモ1" }), env, ctx);
    await worker.fetch(draftRequest({ memo: "メモ2" }), env, ctx);
    const res = await worker.fetch(draftRequest({ memo: "メモ3" }), env, ctx);

    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("日次上限を超えたら 429", async () => {
    const env = makeEnv({ DAILY_REQUEST_LIMIT: "1" });
    await worker.fetch(draftRequest({ memo: "メモ1" }), env, ctx);
    const res = await worker.fetch(draftRequest({ memo: "メモ2" }), env, ctx);
    expect(res.status).toBe(429);
  });

  it("課金されないリクエスト（400）は日次上限を消費しない", async () => {
    const env = makeEnv({ DAILY_REQUEST_LIMIT: "1" });
    // 不正なリクエストを何度投げても、AI を呼んでいない以上は枠を食わない
    for (let i = 0; i < 5; i++) {
      const res = await worker.fetch(draftRequest({ memo: "" }), env, ctx);
      expect(res.status).toBe(400);
    }
    const ok = await worker.fetch(draftRequest(), env, ctx);
    expect(ok.status).toBe(200);
  });

  it("キャッシュヒットは日次上限を消費しない（AI を呼んでいないので）", async () => {
    const env = makeEnv({ DAILY_REQUEST_LIMIT: "1" });
    await worker.fetch(draftRequest(), env, ctx);
    await Promise.all(waited);

    const res = await worker.fetch(draftRequest(), env, ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).meta.cached).toBe(true);
  });

  it("KV が壊れていたら AI を呼ばずに 429（課金保護を優先）", async () => {
    const env = makeEnv({
      KV: {
        async get() {
          throw new Error("KV down");
        },
        async put() {
          throw new Error("KV down");
        },
      },
    });
    const res = await worker.fetch(draftRequest(), env, ctx);
    expect(res.status).toBe(429);
    expect(createMock).not.toHaveBeenCalled();
  });
});

/* ---------- 上流の切り分け（ログ） ---------- */

describe("上流エラーの切り分け", () => {
  let logs;
  beforeEach(() => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((line) => logs.push(JSON.parse(line)));
  });

  const upstreamLog = () => logs.find((l) => l.event === "draft.upstream_failed");

  it("APIキーが違う場合は auth と分かる（レスポンスには漏らさない）", async () => {
    createMock.mockRejectedValue(new FakeAPIError(401));
    const res = await worker.fetch(draftRequest(), makeEnv(), ctx);

    expect(res.status).toBe(502);
    expect(upstreamLog().reason).toBe("auth");
    expect(upstreamLog().upstreamStatus).toBe(401);
    expect(upstreamLog().stopReason).toBe("not_retryable");
    expect(upstreamLog().attempts).toBe(1);
    // クライアントには上流の事情を返さない
    expect(await res.text()).not.toContain("401");
  });

  it("Anthropic 側のレート制限は upstream_rate_limit と分かる", async () => {
    createMock.mockRejectedValue(new FakeAPIError(429));
    await worker.fetch(draftRequest(), makeEnv(), ctx);
    expect(upstreamLog().reason).toBe("upstream_rate_limit");
    // 429 はリトライ対象なので複数回試している
    expect(upstreamLog().attempts).toBeGreaterThan(1);
  });

  it("5xx はリトライしてから諦める", async () => {
    createMock.mockRejectedValue(new FakeAPIError(503));
    await worker.fetch(draftRequest(), makeEnv(), ctx);
    expect(upstreamLog().reason).toBe("other");
    expect(upstreamLog().attempts).toBe(3); // 初回 + リトライ2回
    expect(upstreamLog().stopReason).toBe("retries_exhausted");
  });

  it("400 のような回復不能なエラーはリトライしない", async () => {
    createMock.mockRejectedValue(new FakeAPIError(400));
    await worker.fetch(draftRequest(), makeEnv(), ctx);
    expect(upstreamLog().attempts).toBe(1);
    expect(upstreamLog().stopReason).toBe("not_retryable");
  });
});

/* ---------- 画像入力（UC-2 / UC-3） ---------- */

describe("画像入力", () => {
  const IMAGE = { mediaType: "image/jpeg", base64: "/9j/4AAQSkZJRg==" };

  const withImageKind = (kind, over = {}) => {
    const msg = goodMessage();
    Object.assign(msg.content[0].input, { imageKind: kind, ...over });
    return msg;
  };

  it("画像は text より前に置く（読み取り精度のため）", async () => {
    createMock.mockResolvedValue(withImageKind("dish"));
    await worker.fetch(draftRequest({ memo: "", image: IMAGE }), makeEnv(), ctx);

    const content = createMock.mock.calls[0][0].messages[0].content;
    expect(content[0].type).toBe("image");
    expect(content[0].source.media_type).toBe("image/jpeg");
    expect(content.at(-1).type).toBe("text");
  });

  it("画像のみなら inputKinds は image", async () => {
    createMock.mockResolvedValue(withImageKind("dish"));
    const res = await worker.fetch(draftRequest({ memo: "", image: IMAGE }), makeEnv(), ctx);
    expect((await res.json()).meta.inputKinds).toEqual(["image"]);
  });

  it("料理の写真だけなら分量・時間・人数を low にする", async () => {
    createMock.mockResolvedValue(withImageKind("dish"));
    const res = await worker.fetch(draftRequest({ memo: "", image: IMAGE }), makeEnv(), ctx);
    const body = await res.json();

    expect(body.meta.imageKind).toBe("dish");
    expect(body.confidence.ingredientAmounts).toBe("low");
    expect(body.confidence.timeMinutes).toBe("low");
    expect(body.confidence.servings).toBe("low");
    // 材料名と手順は残す（捨てると写真だけの入力で何も出なくなる）
    expect(body.confidence.ingredientNames).toBe("medium");
    expect(body.draft.ingredients.length).toBeGreaterThan(0);
  });

  it("手書きメモの写真なら分量を捨てない（紙には分量が書いてある）", async () => {
    createMock.mockResolvedValue(withImageKind("handwritten_note"));
    const res = await worker.fetch(draftRequest({ memo: "", image: IMAGE }), makeEnv(), ctx);
    const body = await res.json();

    expect(body.meta.imageKind).toBe("handwritten_note");
    // 読み違いはありうるので medium 止まり。ただし low には落とさない
    expect(body.confidence.ingredientAmounts).toBe("medium");
    expect(body.confidence.timeMinutes).toBe("medium");
    expect(body.draft.ingredients[0].amount).toBe("200g");
  });

  it("メモと画像の両方があればクリップしない", async () => {
    createMock.mockResolvedValue(withImageKind("dish"));
    const res = await worker.fetch(draftRequest({ image: IMAGE }), makeEnv(), ctx);
    expect((await res.json()).confidence.timeMinutes).toBe("high");
  });

  it("画像が無ければ imageKind は none", async () => {
    createMock.mockResolvedValue(withImageKind("dish")); // モデルが嘘をついても
    const res = await worker.fetch(draftRequest(), makeEnv(), ctx);
    expect((await res.json()).meta.imageKind).toBe("none");
  });

  it("imageKind が想定外の値でも other に丸める", async () => {
    createMock.mockResolvedValue(withImageKind("スクリーンショット"));
    const res = await worker.fetch(draftRequest({ memo: "", image: IMAGE }), makeEnv(), ctx);
    expect((await res.json()).meta.imageKind).toBe("other");
  });

  it("画像が違えばキャッシュは効かない", async () => {
    const env = makeEnv();
    createMock.mockResolvedValue(withImageKind("dish"));
    await worker.fetch(draftRequest({ memo: "", image: IMAGE }), env, ctx);
    await Promise.all(waited);

    const other = { mediaType: "image/jpeg", base64: "/9j/4AAQSkZJRgABAQ==" };
    await worker.fetch(draftRequest({ memo: "", image: other }), env, ctx);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("png / webp も受け付ける", async () => {
    createMock.mockResolvedValue(withImageKind("dish"));
    for (const mediaType of ["image/png", "image/webp"]) {
      const res = await worker.fetch(
        draftRequest({ memo: "", image: { mediaType, base64: "AAAA" } }),
        makeEnv(),
        ctx
      );
      expect(res.status).toBe(200);
    }
  });
});
