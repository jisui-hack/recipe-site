/*
 * 料理写真をイラストに描き直す。Gemini の画像モデルを呼ぶ。
 *
 * プロンプトは vault の「X運用設計_料理イラスト.md」§4 をそのまま使っている。
 * **毎回同じ文を送ることが一発率＝費用を決める。** 気分で変えないこと。
 * 変えるときは PROMPT_VERSION を上げて、前後を比較できるようにする。
 *
 * 背景を「木目テーブルだけ」に描き直す仕様そのものが個人情報対策になっている
 * （部屋・窓の外・手・同席者・店の内装が消える）。切り抜き処理は別途不要。
 */

/** 設計書 §4 の固定プロンプト。1文字も変えずに送る */
export const ILLUSTRATE_PROMPT = `この写真の料理を、以下の仕様でイラストに描き直してください。
料理そのもの（具材の種類・個数・切り方・盛り付けの配置）は写真のとおりに保ち、
絵柄と背景だけを差し替えてください。

【画風】
アニメ調のデジタルペイント。セル塗りに近いが、food illustration として
質感は描き込む。彩度はやや高め。タレやオイルの照り、ごま・七味の粒、
野菜の断面の種まで丁寧に描く。写真的なボケは入れない。

【器】
白の無地の陶器。汁物・和え物は丸鉢、それ以外はオーバルの平皿。
器のフチは画面内に収め、切らない。

【背景】
明るいナチュラル材の木目テーブルのみ。木目は横方向に走らせる。
器と料理以外は一切置かない。箸・箸置き・布・小鉢・文字を描かない。

【視点・光】
斜め俯瞰 35〜45度。器は画面中央、上下に余白を取る。
光源は左上からの1つだけ。影は器の右下に柔らかく1つだけ落とす。

【比率】
16:9 の横長。

【描いてはいけないもの】
人物、手、指、部屋、壁、窓、キッチン、家具、他の食器、
ロゴ、パッケージ、文字、透かし、署名。`;

/** イラスト用のプロンプト版。上の文を変えたら必ず上げる */
export const ILLUSTRATE_PROMPT_VERSION = "2026-08-20.1";

/**
 * 使うモデル。2026-08-20 に Gemini API のモデル一覧で確認済み。
 *   gemini-3.1-flash-lite-image … Nano Banana 2 Lite（低遅延・低コスト）
 *   gemini-3.1-flash-image      … Nano Banana 2
 *
 * ただし Gemini のモデルIDは改版が早い（2.0 系は 2026-06-01 に停止済み）。
 * 404 が出たら reason: "unknown_model" としてログに出るので、
 * wrangler.toml の GEMINI_MODEL_LITE / _FLASH を差し替えれば直る。
 */
const DEFAULT_MODELS = {
  lite: "gemini-3.1-flash-lite-image",
  flash: "gemini-3.1-flash-image",
};

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** 全体デッドライン。画像生成は 8〜12 秒かかるのでテキストより長く取る */
export const IMAGE_DEADLINE_MS = 55_000;

export class IllustrateError extends Error {
  constructor(status, code, message, detail = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function modelId(env, kind) {
  if (kind === "flash") return env.GEMINI_MODEL_FLASH || DEFAULT_MODELS.flash;
  return env.GEMINI_MODEL_LITE || DEFAULT_MODELS.lite;
}

/**
 * 応答から画像を取り出す。
 * v1beta は要求を snake_case で受け、応答を camelCase で返すが、
 * 版によって揺れることがあるのでどちらでも拾えるようにしておく。
 */
export function extractImage(json) {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const p of parts) {
    const inline = p.inlineData ?? p.inline_data;
    const data = inline?.data;
    if (data) {
      return { base64: data, mediaType: inline.mimeType ?? inline.mime_type ?? "image/png" };
    }
  }
  return null;
}

/** 応答に画像が無いとき、理由を拾ってログに出せる形にする */
export function refusalReason(json) {
  const c = json?.candidates?.[0];
  const finish = c?.finishReason ?? c?.finish_reason;
  const blocked = json?.promptFeedback?.blockReason ?? json?.prompt_feedback?.block_reason;
  return blocked ? `blocked:${blocked}` : finish ? `finish:${finish}` : "no_image";
}

/**
 * 写真1枚をイラストにする。
 *
 * @param {object} env
 * @param {{ image: {mediaType: string, base64: string}, model: "lite"|"flash", deadlineAt: number }} args
 * @returns {Promise<{ base64: string, mediaType: string, model: string }>}
 */
export async function illustrate(env, { image, model, deadlineAt }) {
  const id = modelId(env, model);
  const remaining = deadlineAt - Date.now();
  if (remaining <= 2_000) {
    throw new IllustrateError(504, "UPSTREAM_TIMEOUT", "時間内に生成できませんでした", {
      reason: "no_budget",
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining - 500);

  let res;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(id)}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY ?? "",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: image.mediaType, data: image.base64 } },
              { text: ILLUSTRATE_PROMPT },
            ],
          },
        ],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    throw new IllustrateError(504, "UPSTREAM_TIMEOUT", "時間内に生成できませんでした", {
      reason: e?.name === "AbortError" ? "timeout" : "connection",
      model: id,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 404 はほぼモデルIDの改版。運用者がすぐ気づけるよう別扱いにする
    const reason = res.status === 404 ? "unknown_model" : res.status === 429 ? "upstream_rate_limit" : "http";
    throw new IllustrateError(502, "UPSTREAM_ERROR", "イラストの生成に失敗しました", {
      reason,
      model: id,
      upstreamStatus: res.status,
      // 本文は先頭だけ。画像も鍵も含まれない範囲に留める
      detail: body.slice(0, 200),
    });
  }

  const json = await res.json().catch(() => null);
  const out = extractImage(json);
  if (!out) {
    throw new IllustrateError(422, "ILLUSTRATE_FAILED", "画像を生成できませんでした", {
      reason: refusalReason(json),
      model: id,
    });
  }
  return { ...out, model: id };
}
