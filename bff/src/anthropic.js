/*
 * Anthropic Messages API の呼び出し。
 *
 * ここの要点は「全体デッドラインを1つ持ち、残り時間をリトライに配分する」こと。
 * 各試行に固定タイムアウトを与えて回数だけ制限すると、最悪ケースの合計が
 * クライアントの AbortController より長くなり、誰も待っていないリクエストに
 * 課金し続けることになる。
 */

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, TOOL_NAME } from "./prompt.js";

/** Worker 側の全体デッドライン。クライアントの 30 秒より必ず短くする */
export const DEADLINE_MS = 24_000;
/** 1試行に与える上限 */
const ATTEMPT_MAX_MS = 20_000;
/** これを下回ったらリトライしない（1試行分の余地がない） */
const RETRY_FLOOR_MS = 7_000;
const BACKOFF_MS = [800, 2_500];

export class UpstreamError extends Error {
  /**
   * @param status クライアントに返す HTTP ステータス
   * @param code   クライアントに返すエラーコード
   * @param detail ログ用の内訳。クライアントには返さない（上流の事情を漏らさない）
   */
  constructor(status, code, message, detail = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function isRetryable(err) {
  if (err instanceof Anthropic.APIConnectionError) return true; // タイムアウトを含む
  const status = err?.status;
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status < 600);
}

/**
 * @param {object} env Worker の環境変数
 * @param {{ tool: object, messages: object[], deadlineAt: number }} args
 */
export async function callAnthropic(env, { tool, messages, deadlineAt }) {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    maxRetries: 0, // リトライは自前で予算管理する
  });

  const params = {
    model: env.MODEL || "claude-sonnet-5",
    max_tokens: Number(env.MAX_TOKENS) || 2048,
    // Claude Sonnet 5 は temperature / top_p / top_k を受け付けない（400 になる）。
    // 出力のばらつきは effort とプロンプトで調整する。
    thinking: { type: env.THINKING === "adaptive" ? "adaptive" : "disabled" },
    output_config: { effort: env.EFFORT || "low" },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        // tools → system の順にレンダリングされるので、ここに置くと
        // ツール定義ごとキャッシュされる（同一メモの作り直しや連投で効く）
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [tool],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages,
  };

  let lastError = null;
  let attempts = 0;
  let stopReason = "deadline"; // なぜループを抜けたか。ログの切り分けに使う

  for (let attempt = 0; ; attempt++) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 1_000) break;

    attempts++;
    try {
      const message = await client.messages.create(params, {
        timeout: Math.min(remaining - 500, ATTEMPT_MAX_MS),
        maxRetries: 0,
      });
      return message;
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) {
        stopReason = "not_retryable";
        break;
      }

      const backoff = BACKOFF_MS[attempt];
      if (backoff == null) {
        stopReason = "retries_exhausted";
        break;
      }
      // バックオフ後に1試行ぶんの余裕が残らないなら、待つだけ無駄
      if (deadlineAt - Date.now() - backoff < RETRY_FLOOR_MS) {
        stopReason = "budget_exhausted";
        break;
      }
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  const upstreamStatus = lastError?.status ?? null;
  const detail = { attempts, stopReason, upstreamStatus };

  if (lastError instanceof Anthropic.APIConnectionError) {
    throw new UpstreamError(504, "UPSTREAM_TIMEOUT", "AI の応答が時間内に返りませんでした", {
      ...detail,
      reason: "connection",
    });
  }
  if (upstreamStatus === 401 || upstreamStatus === 403) {
    // 運用者にだけ分かるようにする。クライアントには 502 の一般的な文言しか返さない
    throw new UpstreamError(502, "UPSTREAM_ERROR", "AI の認証設定に問題があります", {
      ...detail,
      reason: "auth",
    });
  }
  if (upstreamStatus === 429) {
    throw new UpstreamError(502, "UPSTREAM_ERROR", "AI 側のレート制限に達しました", {
      ...detail,
      reason: "upstream_rate_limit",
    });
  }
  throw new UpstreamError(502, "UPSTREAM_ERROR", "AI の呼び出しに失敗しました", {
    ...detail,
    reason: "other",
  });
}

/**
 * tool_use ブロックの input を取り出す。
 * stop_reason を先に見るのが重要で、refusal のときは content が空になりうるし、
 * max_tokens のときは tool_use の JSON が途中で切れている。
 */
export function extractToolInput(message) {
  if (message?.stop_reason === "refusal") {
    return { ok: false, reason: "refusal" };
  }
  // content が無い形のレスポンスもありうる。ここで落ちると 502 になってしまい、
  // 「AI が下書きを作れなかった（422）」と区別がつかなくなる
  const content = Array.isArray(message?.content) ? message.content : [];
  const block = content.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
  if (!block) {
    return {
      ok: false,
      reason: message?.stop_reason === "max_tokens" ? "truncated" : "no_tool_use",
    };
  }
  return { ok: true, input: block.input };
}
