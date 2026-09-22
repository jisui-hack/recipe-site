/*
 * 材料の分類。**画像生成と下書きの整形で同じ判定を使う。**
 *
 * 別々に持つと「イラストでは調味料扱い、下書きでは具材扱い」のように
 * 食い違う。1か所にまとめておく。
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

/**
 * 末尾で見るもの。
 * 「オリーブオイル」「ごま油」「カレールー」を落としたいが、
 * 部分一致だと「オイルサーディン」「ブルーベリー」まで巻き込む。
 */
const SEASONING_SUFFIX = ["油", "オイル", "ルー", "ルウ"];

/** 溶けて色と照りになるもの。皿の上で姿を持たない */
export function isSeasoning(name) {
  const n = String(name ?? "").trim();
  return (
    SEASONINGS.some((s) => n.includes(s)) ||
    SEASONING_SUFFIX.some((s) => n.endsWith(s))
  );
}

export function isIgnored(name) {
  const n = String(name ?? "").trim();
  return IGNORED.some((s) => n === s || n.startsWith(s));
}

/**
 * 調味料に分量の指定が無いときの既定。
 * 「醤油」だけで分量が空だと、投稿フォームで空欄のまま残り、
 * 見た目にも「書き忘れ」に見える。家庭料理では「適量」が普通の答え。
 */
export const DEFAULT_SEASONING_AMOUNT = "適量";
