/*
 * recipe-ai-bff — 「自炊の本棚」の AI 下書き用 BFF
 *
 * 責務: 認証 / レート制限 / キャッシュ / Anthropic 呼び出し / 出力の検証と正規化
 * 責務でないこと: GitHub への書き込み。ここは絶対にやらない。
 *   この BFF が書き込み権限を持たないからこそ、プロンプトインジェクションの
 *   被害上限が「変な下書きが出る」で止まり、認証を共有キーで済ませられる。
 */

import { callAnthropic, DEADLINE_MS, extractToolInput, UpstreamError } from "./anthropic.js";
import { hashVocabulary, sha256Hex, shortHash } from "./hash.js";
import { err, isAllowedOrigin, ok, preflight, timingSafeEqual } from "./http.js";
import { normalizeDraft } from "./normalize.js";
import { buildMessages, buildTool } from "./prompt.js";
import { consumeImageQuota, consumeRateLimit } from "./ratelimit.js";
import { PROMPT_VERSION } from "./schema.js";
import {
  IMAGE_DEADLINE_MS,
  ILLUSTRATE_PROMPT_VERSION,
  IllustrateError,
  illustrate,
} from "./illustrate.js";
import { ValidationError, validateRequest } from "./validate.js";

const CACHE_TTL_SEC = 86_400;

function log(entry) {
  // メモ本文は絶対に出さない。長さとハッシュだけ。
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

async function clientFingerprint(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  // IP だけだとモバイル回線で共有されうるのでキーと混ぜる
  return shortHash(`${ip}|${env.CLIENT_SHARED_KEY ?? ""}`, 16);
}

async function buildCacheKey(body, env) {
  const imageHash = body.image ? await shortHash(body.image.base64, 16) : "-";
  const vocabHash = await hashVocabulary(body.vocabulary);
  const model = env.MODEL || "claude-sonnet-5";
  const knobs = `${env.THINKING || "disabled"}/${env.EFFORT || "low"}`;
  const raw = [body.memo, imageHash, vocabHash, PROMPT_VERSION, model, knobs].join("|");
  return `draft:${(await sha256Hex(raw)).slice(0, 32)}`;
}

async function handleDraft(request, env, ctx, { requestId, origin }) {
  const startedAt = Date.now();
  const deadlineAt = startedAt + DEADLINE_MS;

  let body;
  try {
    body = validateRequest(await request.json());
  } catch (e) {
    if (e instanceof ValidationError && e.tooLarge) {
      return err(413, "PAYLOAD_TOO_LARGE", requestId, origin);
    }
    const detail = e instanceof ValidationError ? e.message : "JSON を解析できませんでした";
    return err(400, "INVALID_REQUEST", requestId, origin, { detail });
  }

  const memoHash = body.memo ? await shortHash(body.memo) : "-";
  const vocabularyHash = await hashVocabulary(body.vocabulary);
  const cacheKey = await buildCacheKey(body, env);
  const noCache = new URL(request.url).searchParams.has("nocache");

  if (!noCache) {
    try {
      const hit = await env.KV.get(cacheKey, "json");
      if (hit) {
        log({
          requestId,
          event: "draft.cache_hit",
          inputKinds: body.inputKinds,
          memoLength: body.memo.length,
          memoHash,
          promptVersion: PROMPT_VERSION,
        });
        return ok({ ...hit, meta: { ...hit.meta, cached: true, requestId } }, origin);
      }
    } catch {
      /* キャッシュが読めなくても本処理は続ける */
    }
  }

  // ここまで来て初めて Anthropic を呼ぶことが確定する。
  // 入力エラーやキャッシュヒットで枠を消費すると、一度も課金していないのに
  // 「課金の上限」に達することになる
  const rl = await consumeRateLimit(env.KV, await clientFingerprint(request, env), env);
  if (!rl.ok) {
    log({ requestId, event: "draft.rate_limited", scope: rl.scope });
    return err(429, "RATE_LIMITED", requestId, origin, { retryAfterSec: rl.retryAfterSec });
  }

  let message;
  try {
    message = await callAnthropic(env, {
      tool: buildTool(body.vocabulary),
      messages: buildMessages(body),
      deadlineAt,
    });
  } catch (e) {
    const upstream = e instanceof UpstreamError ? e : null;
    // 上流の内訳はログにだけ残す。レスポンスには一般的な文言しか返さない。
    // これが無いと「APIキーが違う」と「Anthropic が落ちている」を切り分けられない
    log({
      requestId,
      event: "draft.upstream_failed",
      code: upstream?.code ?? "UPSTREAM_ERROR",
      reason: upstream?.detail?.reason ?? "unknown",
      upstreamStatus: upstream?.detail?.upstreamStatus ?? null,
      attempts: upstream?.detail?.attempts ?? 0,
      stopReason: upstream?.detail?.stopReason ?? "unknown",
      latencyMs: Date.now() - startedAt,
    });
    return err(upstream?.status ?? 502, upstream?.code ?? "UPSTREAM_ERROR", requestId, origin);
  }

  const extracted = extractToolInput(message);
  if (!extracted.ok) {
    log({ requestId, event: "draft.extraction_failed", reason: extracted.reason });
    return err(422, "EXTRACTION_FAILED", requestId, origin, {
      detail:
        extracted.reason === "truncated"
          ? "出力が長すぎて途中で切れました"
          : extracted.reason === "refusal"
            ? "この内容には回答できませんでした"
            : undefined,
    });
  }

  const payload = normalizeDraft(extracted.input, {
    vocabulary: body.vocabulary,
    inputKinds: body.inputKinds,
    memo: body.memo,
    meta: {
      model: message.model,
      tokensIn: message.usage?.input_tokens ?? 0,
      tokensOut: message.usage?.output_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
      cached: false,
      requestId,
      vocabularyHash,
      promptVersion: PROMPT_VERSION,
    },
  });

  if (!payload) {
    log({ requestId, event: "draft.extraction_failed", reason: "empty_after_normalize" });
    return err(422, "EXTRACTION_FAILED", requestId, origin, {
      detail: "材料か手順を読み取れませんでした",
    });
  }

  ctx.waitUntil(
    env.KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SEC }).catch(() => {})
  );

  log({
    requestId,
    event: "draft.completed",
    inputKinds: body.inputKinds,
    memoLength: body.memo.length,
    memoHash,
    model: payload.meta.model,
    tokensIn: payload.meta.tokensIn,
    tokensOut: payload.meta.tokensOut,
    cacheReadTokens: message.usage?.cache_read_input_tokens ?? 0,
    latencyMs: payload.meta.latencyMs,
    cached: false,
    vocabularyHash,
    promptVersion: PROMPT_VERSION,
    result: {
      ingredients: payload.draft.ingredients.length,
      steps: payload.draft.steps.length,
      lowConfidenceFields: Object.entries(payload.confidence)
        .filter(([, v]) => v === "low")
        .map(([k]) => k),
    },
  });

  return ok(payload, origin);
}

/* ---------- POST /v1/illustrate ---------- */

const ILLUSTRATE_MAX_BYTES = 4_000_000; // 元写真。draft より大きめに許す

/**
 * レシピ経路の入力を整える。
 *
 * この文字列は画像生成プロンプトに埋め込まれるので、**素通しにしない。**
 * 改行と制御文字を落とし、長さを絞る（指示文に見える行を混ぜられないため）。
 * 語彙の検証まではしない。ここは絵柄の材料であって、コミットされる値ではない。
 */
const RECIPE_TITLE_MAX = 60;
const RECIPE_INGREDIENT_MAX = 30;
const RECIPE_INGREDIENT_COUNT = 12;

function cleanLine(value, max) {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeRecipeInput(raw) {
  const title = cleanLine(raw.title, RECIPE_TITLE_MAX);
  if (!title) return null;
  const ingredients = Array.isArray(raw.ingredients)
    ? raw.ingredients
        .map((v) => cleanLine(v, RECIPE_INGREDIENT_MAX))
        .filter(Boolean)
        .slice(0, RECIPE_INGREDIENT_COUNT)
    : [];
  return { title, ingredients };
}

function base64Bytes(b64) {
  const clean = b64.replace(/\s/g, "");
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

async function handleIllustrate(request, env, ctx, { requestId, origin }) {
  const startedAt = Date.now();
  const deadlineAt = startedAt + IMAGE_DEADLINE_MS;

  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, "INVALID_REQUEST", requestId, origin, { detail: "JSON を解析できませんでした" });
  }

  if (body?.schemaVersion !== 1) {
    return err(400, "INVALID_REQUEST", requestId, origin, { detail: "schemaVersion は 1 のみ" });
  }
  // 入口は2つ。写真から描き直すか、レシピの文面から描き起こすか。
  // どちらか一方だけ。両方来たら意図が読めないので弾く。
  const image = body.image ?? null;
  const hasImage = Boolean(image && typeof image.base64 === "string" && image.base64);
  const hasRecipe = Boolean(body.recipe && typeof body.recipe === "object");

  if (hasImage === hasRecipe) {
    return err(400, "INVALID_REQUEST", requestId, origin, {
      detail: hasImage ? "image と recipe は同時に指定できません" : "image か recipe が必要です",
    });
  }

  let recipe = null;
  if (hasImage) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(image.mediaType)) {
      return err(400, "INVALID_REQUEST", requestId, origin, { detail: "対応していない画像形式です" });
    }
    if (base64Bytes(image.base64) > ILLUSTRATE_MAX_BYTES) {
      return err(413, "PAYLOAD_TOO_LARGE", requestId, origin);
    }
  } else {
    recipe = normalizeRecipeInput(body.recipe);
    if (!recipe) {
      return err(400, "INVALID_REQUEST", requestId, origin, { detail: "recipe.title が必要です" });
    }
  }

  const model = body.model === "flash" ? "flash" : "lite";

  // 画像は1枚が高い。呼ぶと決まってから枠を消費する
  const rl = await consumeImageQuota(env.KV, await clientFingerprint(request, env), env);
  if (!rl.ok) {
    log({ requestId, event: "illustrate.rate_limited", scope: rl.scope });
    return err(429, "RATE_LIMITED", requestId, origin, { retryAfterSec: rl.retryAfterSec });
  }

  let out;
  try {
    out = await illustrate(env, {
      image: hasImage ? { ...image, base64: image.base64.replace(/\s/g, "") } : null,
      recipe,
      model,
      deadlineAt,
    });
  } catch (e) {
    const up = e instanceof IllustrateError ? e : null;
    log({
      requestId,
      event: "illustrate.failed",
      source: hasImage ? "photo" : "recipe",
      code: up?.code ?? "UPSTREAM_ERROR",
      reason: up?.detail?.reason ?? "unknown",
      model: up?.detail?.model ?? null,
      upstreamStatus: up?.detail?.upstreamStatus ?? null,
      latencyMs: Date.now() - startedAt,
    });
    return err(up?.status ?? 502, up?.code ?? "UPSTREAM_ERROR", requestId, origin);
  }

  log({
    requestId,
    event: "illustrate.completed",
    source: hasImage ? "photo" : "recipe",
    model: out.model,
    promptVersion: ILLUSTRATE_PROMPT_VERSION,
    inBytes: hasImage ? base64Bytes(image.base64) : 0,
    outBytes: base64Bytes(out.base64),
    latencyMs: Date.now() - startedAt,
    todayCount: rl.count,
  });

  return ok(
    {
      schemaVersion: 1,
      image: { mediaType: out.mediaType, base64: out.base64 },
      meta: {
        model: out.model,
        promptVersion: ILLUSTRATE_PROMPT_VERSION,
        latencyMs: Date.now() - startedAt,
        todayCount: rl.count,
        dailyLimit: Number(env.DAILY_IMAGE_LIMIT) || 30,
        requestId,
      },
    },
    origin
  );
}

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    const origin = request.headers.get("Origin") ?? "";
    const url = new URL(request.url);

    // プリフライトもオリジン検証を通す。ここを素通しにすると
    // 「ワイルドカード禁止」という方針が形だけになる
    if (request.method === "OPTIONS") return preflight(origin, env);

    if (!isAllowedOrigin(origin, env)) {
      return err(403, "FORBIDDEN_ORIGIN", requestId, "");
    }

    if (url.pathname === "/v1/health") {
      return ok(
        {
          ok: true,
          promptVersion: PROMPT_VERSION,
          model: env.MODEL || "claude-sonnet-5",
          hasApiKey: Boolean(env.ANTHROPIC_API_KEY),
          hasGeminiKey: Boolean(env.GEMINI_API_KEY),
        },
        origin
      );
    }

    const isDraft = url.pathname === "/v1/draft";
    const isIllustrate = url.pathname === "/v1/illustrate";
    if ((!isDraft && !isIllustrate) || request.method !== "POST") {
      return err(404, "NOT_FOUND", requestId, origin);
    }

    // Secret 未設定のまま公開しても素通りしないよう、先に落とす
    const sharedKey = env.CLIENT_SHARED_KEY ?? "";
    if (sharedKey.length < 16) {
      log({ requestId, event: "config.missing_client_key" });
      return err(401, "UNAUTHORIZED", requestId, origin);
    }
    if (!timingSafeEqual(request.headers.get("X-Client-Key") ?? "", sharedKey)) {
      return err(401, "UNAUTHORIZED", requestId, origin);
    }

    try {
      return isIllustrate
        ? await handleIllustrate(request, env, ctx, { requestId, origin })
        : await handleDraft(request, env, ctx, { requestId, origin });
    } catch (e) {
      log({ requestId, event: "draft.unhandled", message: String(e?.message ?? e) });
      return err(502, "UPSTREAM_ERROR", requestId, origin);
    }
  },
};
