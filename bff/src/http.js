/* CORS とレスポンス組み立て */

/**
 * 許可オリジンの判定。ワイルドカードは使わない。
 * OPTIONS も本リクエストも同じ関数を通す（プリフライトだけ素通しにしない）。
 */
export function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  const list = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(origin);
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Client-Key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function preflight(origin, env) {
  if (!isAllowedOrigin(origin, env)) {
    // 許可外オリジンにはCORSヘッダを返さない。ブラウザ側で失敗する
    return new Response(null, { status: 403 });
  }
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export function ok(payload, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin),
      ...extraHeaders,
    },
  });
}

export function err(status, code, requestId, origin, extra = {}) {
  const messages = {
    INVALID_REQUEST: "リクエストの内容が正しくありません",
    UNAUTHORIZED: "クライアントキーが正しくありません",
    FORBIDDEN_ORIGIN: "許可されていない接続元です",
    PAYLOAD_TOO_LARGE: "画像が大きすぎます",
    EXTRACTION_FAILED: "メモから下書きを作れませんでした",
    RATE_LIMITED: "利用回数の上限に達しました",
    UPSTREAM_ERROR: "AI の呼び出しに失敗しました",
    UPSTREAM_TIMEOUT: "AI の応答が時間内に返りませんでした",
    NOT_FOUND: "エンドポイントがありません",
  };

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  // 許可外オリジンには CORS ヘッダを付けない（403 の意味がなくなるため）
  if (origin) Object.assign(headers, corsHeaders(origin));
  if (extra.retryAfterSec) headers["Retry-After"] = String(extra.retryAfterSec);

  const body = {
    error: {
      code,
      message: extra.detail ? `${messages[code] ?? code}: ${extra.detail}` : (messages[code] ?? code),
      requestId,
      ...(extra.retryAfterSec ? { retryAfterSec: extra.retryAfterSec } : {}),
    },
  };
  return new Response(JSON.stringify(body), { status, headers });
}

/** タイミング差でキーを推測されないように定数時間で比較する */
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
