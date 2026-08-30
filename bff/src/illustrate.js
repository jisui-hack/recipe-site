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
/**
 * 画風の指定。写真から描き直す場合とレシピから描き起こす場合で共有する。
 * **共有させているのは、2つの入口で絵柄が食い違うと本棚が揃わないため。**
 * 設計書 §4 の文面をそのまま使う。変えるときは PROMPT_VERSION を上げる。
 */
const STYLE_SPEC = `【画風】
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

/** 設計書 §4 の固定プロンプト（写真から描き直す）。1文字も変えずに送る */
export const ILLUSTRATE_PROMPT = `この写真の料理を、以下の仕様でイラストに描き直してください。
料理そのもの（具材の種類・個数・切り方・盛り付けの配置）は写真のとおりに保ち、
絵柄と背景だけを差し替えてください。

${STYLE_SPEC}`;

/**
 * 写真が無いときに、レシピの文面から描き起こす。
 *
 * 写真経路との違いは冒頭の一段落だけで、画風・器・背景・視点は同じものを送る。
 * **「実際に作った1皿」ではなく「この料理の一般的な盛り付け」を描かせる。**
 * 手元に無いものを写真のように装わせないため、盛り付けの創作は最小限に寄せる。
 */
/**
 * 皿の上で姿が見えないもの。**具材として渡すと、姿を与えて描いてしまう。**
 * 実際に「山椒」を渡したら青唐辛子が4本描かれた。
 *
 * にんにく・生姜・ねぎ・ごまは切り方によって見えるので入れない。
 * ここは「溶けて色と照りになるもの」だけ。
 */
/** 皿の上にも味にも出ないもの。渡す意味がない */
const IGNORED = ["水", "お湯", "湯"];

const SEASONINGS = [
  "塩", "こしょう", "コショウ", "胡椒", "砂糖", "味の素",
  "醤油", "しょうゆ", "みりん", "酒", "酢", "みそ", "味噌",
  "油", "バター", "マヨネーズ", "ケチャップ", "ソース", "ポン酢", "めんつゆ",
  "だし", "出汁", "コンソメ", "鶏がら",
  "カレー粉", "山椒", "七味", "一味", "はちみつ", "蜂蜜",
  "片栗粉", "小麦粉",
];

function isSeasoning(name) {
  return SEASONINGS.some((s) => name.includes(s));
}

function isIgnored(name) {
  return IGNORED.some((s) => name === s || name.startsWith(s));
}

/**
 * 材料を「皿に見える具材」と「味つけ」に分ける。
 *
 * 分ける理由は2つ。
 *   1. 調味料を具材として渡すと姿を与えて描く（山椒 → 青唐辛子）
 *   2. 具材には切り方を添えたい。「ごぼう」だけだと輪切りになる。
 *      分量欄に「薄めの細切り」と書いてあるので、それを渡す
 */
export function splitIngredients(ingredients) {
  const solid = [];
  const seasoning = [];

  for (const raw of ingredients ?? []) {
    const item = typeof raw === "string" ? { name: raw, amount: "" } : (raw ?? {});
    const name = String(item.name ?? "").trim();
    if (!name || isIgnored(name)) continue;

    if (isSeasoning(name)) {
      seasoning.push(name);
    } else {
      const amount = String(item.amount ?? "").trim();
      solid.push(amount ? `${name} ${amount}` : name);
    }
  }
  return { solid, seasoning };
}

/**
 * 手順から切り方だけ拾う。
 *
 * **切り方は分量欄ではなく手順に書かれていることが多い。**
 * 「ごぼう」とだけ渡したら輪切りで描かれた。実際のレシピには
 * 「ごぼうを薄めの細切りにする」と書いてある。ここが伝わらないと形が変わる。
 *
 * 手順を丸ごと渡すと調理工程の絵になりかねないので、切る話だけに絞る。
 */
const CUT_WORDS = /(切り|切る|そぎ|ささがき|みじん|千切|細切|薄切|ざく切|乱切|輪切|くし形|ちぎ|すりおろ|おろす)/;

/**
 * **文単位で拾う。** 手順1行には切り方のあとに別の話が続くことが多い
 * （「ごぼうを薄めの細切りにする。冷凍ごぼうがあれば代用してもよい。」）。
 * 行ごと渡すと、関係ない文まで絵の材料にしてしまう。
 */
export function cutHints(steps, max = 2) {
  const hits = [];
  for (const step of steps ?? []) {
    for (const sentence of String(step ?? "").split(/(?<=。)/)) {
      const t = sentence.trim();
      if (t && CUT_WORDS.test(t)) hits.push(t);
      if (hits.length >= max) return hits;
    }
  }
  return hits;
}

export function buildRecipePrompt({ title, ingredients, steps }) {
  const { solid, seasoning } = splitIngredients(ingredients);
  const cuts = cutHints(steps);

  const blocks = [`【描く料理】\n${title}`];

  if (solid.length) {
    // 分量欄に切り方が書いてあることが多い。それが伝わらないと形が変わる
    blocks.push(`【皿に見える具材】\n${solid.join("\n")}`);
  }
  if (cuts.length) {
    blocks.push(`【切り方】\n${cuts.join("\n")}`);
  }
  if (seasoning.length) {
    blocks.push(
      `【味つけ】\n${seasoning.join("、")}\n` +
        "味つけは色と照りにだけ反映してください。粒・実・さやなどの姿では描かないでください。"
    );
  }

  return `次の料理を、以下の仕様でイラストに描いてください。

${blocks.join("\n\n")}

材料から素直に想像できる、ごく一般的な盛り付けにしてください。
**上に挙げていないものを足さないでください。**
凝った飾り付け、添え物、ソースの模様は加えないでください。

${STYLE_SPEC}`;
}


/** イラスト用のプロンプト版。上の文を変えたら必ず上げる */
export const ILLUSTRATE_PROMPT_VERSION = "2026-08-30.1";

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
/**
 * 写真から描き直す（image）か、レシピから描き起こす（recipe）。
 * どちらか一方が必ず入る前提で、入口（index.js）が保証している。
 */
export async function illustrate(env, { image, recipe, model, deadlineAt }) {
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
            parts: image
              ? [
                  { inline_data: { mime_type: image.mediaType, data: image.base64 } },
                  { text: ILLUSTRATE_PROMPT },
                ]
              : [{ text: buildRecipePrompt(recipe) }],
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
