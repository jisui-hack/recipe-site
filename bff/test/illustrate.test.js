/*
 * /v1/illustrate。Gemini は fetch ごと差し替える。
 * ここで守りたいのは「上限を超えたら呼ばない」「鍵を漏らさない」
 * 「モデルIDが変わったと分かる」の3つ。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractImage, refusalReason, ILLUSTRATE_PROMPT } from "../src/illustrate.js";

// Anthropic SDK は使わないが、index.js が import するのでモックしておく
const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    constructor() { this.messages = { create: createMock }; }
  }
  FakeAnthropic.APIConnectionError = class extends Error {};
  FakeAnthropic.APIError = class extends Error {};
  return { default: FakeAnthropic };
});

const { default: worker } = await import("../src/index.js");

const KEY = "test-client-key-0123456789abcdef";
const ORIGIN = "https://jisui-hack.github.io";
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function fakeKV() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.get(k) ?? null; },
    async put(k, v) { store.set(k, v); },
  };
}

function makeEnv(over = {}) {
  return {
    ALLOWED_ORIGINS: ORIGIN,
    CLIENT_SHARED_KEY: KEY,
    ANTHROPIC_API_KEY: "sk-ant-test",
    GEMINI_API_KEY: "gemini-secret-key",
    KV: fakeKV(),
    ...over,
  };
}

const ctx = { waitUntil: () => {} };

function req(body = {}, headers = {}) {
  return new Request("https://bff.example.dev/v1/illustrate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Client-Key": KEY, ...headers },
    body: JSON.stringify({ schemaVersion: 1, image: { mediaType: "image/jpeg", base64: PIXEL }, ...body }),
  });
}

const geminiOk = () => ({
  ok: true,
  json: async () => ({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PIXEL } }] } }],
  }),
});

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(geminiOk());
  globalThis.fetch = fetchMock;
});

describe("応答の読み取り", () => {
  it("camelCase でも snake_case でも画像を拾う", () => {
    const camel = { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AAA" } }] } }] };
    const snake = { candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/png", data: "BBB" } }] } }] };
    expect(extractImage(camel)).toEqual({ base64: "AAA", mediaType: "image/png" });
    expect(extractImage(snake)).toEqual({ base64: "BBB", mediaType: "image/png" });
  });

  it("画像が無ければ null", () => {
    expect(extractImage({ candidates: [{ content: { parts: [{ text: "むり" }] } }] })).toBeNull();
    expect(extractImage(null)).toBeNull();
  });

  it("断られた理由を拾える", () => {
    expect(refusalReason({ promptFeedback: { blockReason: "SAFETY" } })).toBe("blocked:SAFETY");
    expect(refusalReason({ candidates: [{ finishReason: "RECITATION" }] })).toBe("finish:RECITATION");
  });
});

describe("固定プロンプト", () => {
  it("設計書の要点が入っている（勝手に変えると一発率が落ちる）", () => {
    for (const key of ["木目テーブル", "16:9", "斜め俯瞰", "白の無地", "描いてはいけないもの"]) {
      expect(ILLUSTRATE_PROMPT).toContain(key);
    }
  });

  it("そのまま Gemini に送られる", async () => {
    await worker.fetch(req(), makeEnv(), ctx);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.contents[0].parts[1].text).toBe(ILLUSTRATE_PROMPT);
    expect(body.contents[0].parts[0].inline_data.data).toBe(PIXEL);
  });
});

describe("正常系", () => {
  it("画像を返す", async () => {
    const res = await worker.fetch(req(), makeEnv(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.image.base64).toBe(PIXEL);
    expect(body.meta.todayCount).toBe(1);
    expect(body.meta.dailyLimit).toBe(30);
  });

  it("既定は lite、指定すれば flash", async () => {
    await worker.fetch(req(), makeEnv(), ctx);
    expect(fetchMock.mock.calls[0][0]).toContain("flash-lite-image");

    fetchMock.mockClear();
    await worker.fetch(req({ model: "flash" }), makeEnv(), ctx);
    expect(fetchMock.mock.calls[0][0]).toContain("gemini-3.1-flash-image");
  });

  it("モデルIDは環境変数で差し替えられる（改版に追随するため）", async () => {
    await worker.fetch(req(), makeEnv({ GEMINI_MODEL_LITE: "gemini-9-future" }), ctx);
    expect(fetchMock.mock.calls[0][0]).toContain("gemini-9-future");
  });

  it("Gemini の鍵はヘッダで送り、応答には出さない", async () => {
    const res = await worker.fetch(req(), makeEnv(), ctx);
    expect(fetchMock.mock.calls[0][1].headers["x-goog-api-key"]).toBe("gemini-secret-key");
    expect(await res.text()).not.toContain("gemini-secret-key");
  });
});

describe("入口の守り", () => {
  it("許可外オリジンは 403 で Gemini を呼ばない", async () => {
    const res = await worker.fetch(req({}, { Origin: "https://evil.example.com" }), makeEnv(), ctx);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("キー違いは 401", async () => {
    const res = await worker.fetch(req({}, { "X-Client-Key": "wrong" }), makeEnv(), ctx);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("画像が無ければ 400", async () => {
    const bad = new Request("https://bff.example.dev/v1/illustrate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Client-Key": KEY },
      body: JSON.stringify({ schemaVersion: 1 }),
    });
    expect((await worker.fetch(bad, makeEnv(), ctx)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("対応外の形式は 400", async () => {
    const res = await worker.fetch(req({ image: { mediaType: "image/gif", base64: PIXEL } }), makeEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it("大きすぎる画像は 413", async () => {
    const res = await worker.fetch(
      req({ image: { mediaType: "image/jpeg", base64: "A".repeat(6_000_000) } }),
      makeEnv(),
      ctx
    );
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("上限（1枚 約¥5 なのでここが要）", () => {
  it("日次上限を超えたら Gemini を呼ばない", async () => {
    const env = makeEnv({ DAILY_IMAGE_LIMIT: "2" });
    await worker.fetch(req(), env, ctx);
    await worker.fetch(req(), env, ctx);
    fetchMock.mockClear();

    const res = await worker.fetch(req(), env, ctx);
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("時間あたりの上限もある", async () => {
    const env = makeEnv({ HOURLY_IMAGE_LIMIT: "1" });
    await worker.fetch(req(), env, ctx);
    expect((await worker.fetch(req(), env, ctx)).status).toBe(429);
  });

  it("テキストの枠とは別に数える", async () => {
    const env = makeEnv({ DAILY_REQUEST_LIMIT: "1", DAILY_IMAGE_LIMIT: "5" });
    await worker.fetch(req(), env, ctx);
    await worker.fetch(req(), env, ctx);
    // 画像を2枚使ってもテキストの枠は減っていない
    expect(env.KV.store.get("rl:d:" + Math.floor(Date.now() / 86400000))).toBeUndefined();
  });

  it("KV が壊れていたら生成しない（上限を守れないため）", async () => {
    const env = makeEnv({ KV: { async get() { throw new Error("down"); }, async put() { throw new Error("down"); } } });
    const res = await worker.fetch(req(), env, ctx);
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("上流の失敗", () => {
  let logs;
  beforeEach(() => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((l) => logs.push(JSON.parse(l)));
  });
  const failLog = () => logs.find((l) => l.event === "illustrate.failed");

  it("404 は unknown_model と分かる（モデルIDの改版に気づける）", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => "not found" });
    const res = await worker.fetch(req(), makeEnv(), ctx);
    expect(res.status).toBe(502);
    expect(failLog().reason).toBe("unknown_model");
    expect(failLog().model).toContain("flash-lite-image");
  });

  it("Gemini のレート制限も切り分けられる", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => "" });
    await worker.fetch(req(), makeEnv(), ctx);
    expect(failLog().reason).toBe("upstream_rate_limit");
  });

  it("画像が返らなければ 422 で理由を残す", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ promptFeedback: { blockReason: "SAFETY" } }),
    });
    const res = await worker.fetch(req(), makeEnv(), ctx);
    expect(res.status).toBe(422);
    expect(failLog().reason).toBe("blocked:SAFETY");
  });

  it("失敗してもレスポンスに上流の事情を出さない", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => "model gemini-x not found" });
    const text = await (await worker.fetch(req(), makeEnv(), ctx)).text();
    expect(text).not.toContain("gemini-x");
    expect(text).not.toContain("404");
  });

  it("ログに画像本体を残さない（サイズだけ）", async () => {
    await worker.fetch(req(), makeEnv(), ctx);
    const done = logs.find((l) => l.event === "illustrate.completed");
    expect(done.inBytes).toBeGreaterThan(0);
    expect(JSON.stringify(done)).not.toContain(PIXEL);
  });
});
