/*
 * KV ベースのレート制限。
 *
 * 2層ある:
 *   - 時間あたり / フィンガープリント … 誤操作と連打の抑制。KV 障害時は fail-open
 *   - 日次 / グローバル              … 課金の最終ストッパー。KV 障害時は fail-closed
 *
 * **呼ぶ位置が重要**: この関数は「これから Anthropic を呼ぶ」と決まった直後にだけ
 * 呼ぶ。入力エラー（400/413）やキャッシュヒットで消費してしまうと、
 * 一度も課金していないのに「課金の上限」に達することになり、名前と挙動が食い違う。
 *
 * 日次だけ fail-closed なので、KV が落ちると AI 機能は止まる。
 * 既存の投稿フォームは影響を受けないので、課金保護を優先してこの挙動にしている。
 *
 * read → write が原子的でないため同時実行でわずかに数え漏らすが、
 * 単一利用者の想定では実害がない。
 */

const HOUR = 3600;
const DAY = 86400;

async function bump(kv, key, ttl) {
  const current = Number((await kv.get(key)) ?? 0);
  const next = current + 1;
  await kv.put(key, String(next), { expirationTtl: ttl });
  return next;
}

/**
 * 枠を1つ消費する。Anthropic を呼ぶ直前に1回だけ呼ぶこと。
 * @returns {{ ok: boolean, retryAfterSec?: number, scope?: string }}
 */
export async function consumeRateLimit(kv, fingerprint, env) {
  const now = Date.now();
  const hourBucket = Math.floor(now / (HOUR * 1000));
  const dayBucket = Math.floor(now / (DAY * 1000));

  const hourlyLimit = Number(env.HOURLY_REQUEST_LIMIT) || 20;
  const dailyLimit = Number(env.DAILY_REQUEST_LIMIT) || 100;

  // 日次・グローバル（fail-closed）
  try {
    const daily = await bump(kv, `rl:d:${dayBucket}`, DAY);
    if (daily > dailyLimit) {
      return {
        ok: false,
        scope: "daily",
        retryAfterSec: Math.max(1, Math.ceil((dayBucket + 1) * DAY - now / 1000)),
      };
    }
  } catch {
    // KV が読めないと課金上限を守れない。AI を呼ばずに止める
    return { ok: false, scope: "kv_unavailable", retryAfterSec: 60 };
  }

  // 時間あたり・フィンガープリント単位（fail-open）
  try {
    const hourly = await bump(kv, `rl:h:${fingerprint}:${hourBucket}`, HOUR);
    if (hourly > hourlyLimit) {
      return {
        ok: false,
        scope: "hourly",
        retryAfterSec: Math.max(1, Math.ceil((hourBucket + 1) * HOUR - now / 1000)),
      };
    }
  } catch {
    /* KV が不調でも時間制限はスキップして続行する */
  }

  return { ok: true };
}

/**
 * 画像生成の枠。テキストとは別に数える。
 *
 * 1枚 約¥5 でテキストの倍近く、しかも合言葉が漏れたときの被害が
 * そのまま請求額になる。**上限は必ず入れる**（設計書の判断どおり 1日30枚）。
 */
export async function consumeImageQuota(kv, fingerprint, env) {
  const now = Date.now();
  const dayBucket = Math.floor(now / (DAY * 1000));
  const hourBucket = Math.floor(now / (HOUR * 1000));
  const dailyLimit = Number(env.DAILY_IMAGE_LIMIT) || 30;
  const hourlyLimit = Number(env.HOURLY_IMAGE_LIMIT) || 10;

  try {
    const daily = await bump(kv, `il:d:${dayBucket}`, DAY);
    if (daily > dailyLimit) {
      return {
        ok: false,
        scope: "daily_image",
        retryAfterSec: Math.max(1, Math.ceil((dayBucket + 1) * DAY - now / 1000)),
        count: daily - 1,
      };
    }
    const hourly = await bump(kv, `il:h:${fingerprint}:${hourBucket}`, HOUR);
    if (hourly > hourlyLimit) {
      return {
        ok: false,
        scope: "hourly_image",
        retryAfterSec: Math.max(1, Math.ceil((hourBucket + 1) * HOUR - now / 1000)),
        count: daily,
      };
    }
    return { ok: true, count: daily };
  } catch {
    // 上限を守れないなら生成しない。画像は1枚あたりが高い
    return { ok: false, scope: "kv_unavailable", retryAfterSec: 60 };
  }
}
