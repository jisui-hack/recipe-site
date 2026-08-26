/**
 * タグの語彙とイラストの一元管理。
 *
 * レシピJSONにはここの `name`（日本語）をそのまま入れる。
 *   "protein": ["牛肉"], "plant": ["玉ねぎ"], "genre": ["和風"]
 *
 * 画面（一覧・材料から探す・詳細・投稿フォーム）と scripts/reindex.mjs の
 * タグ検証がこのファイルを共有する。タグを増やすときはここに1行足すだけでよい。
 */

/** 24x24 の簡単なイラスト。色は食材そのものの色で固定する。 */
const svg = (body) => `<svg class="tag-icon" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const TAG_GROUPS = [
  {
    key: "protein",
    label: "肉・魚・卵",
    hint: "肉・魚・卵から",
    tags: [
      {
        name: "牛肉",
        icon: svg(`<path d="M3.5 10c1.2-4.3 6-6.3 10.2-4.4C18 7.5 20.2 12 19 15.6c-1.2 3.4-5.5 4.4-9 3.2C6 17.5 2.4 14 3.5 10z" fill="#b23b34"/><path d="M9.6 9.3c2-1 4 .2 4.7 2.3.7 2-.3 3.8-2.3 3.7-2-.1-3.8-1.4-4.1-3.2-.2-1.3.3-2.3 1.7-2.8z" fill="#f2dcd6"/>`),
      },
      {
        name: "豚肉",
        icon: svg(`<path d="M3.6 12.6c-.6-3.9 2.7-7 7-7.2 4.6-.2 8.4 2.6 8.8 6.3.4 3.8-2.8 6.7-7.2 6.9-4.6.2-8.1-2.2-8.6-6z" fill="#e08a92"/><path d="M6.5 10.5h11" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M7.5 14.4h9" stroke="#c96a75" stroke-width="1.4" stroke-linecap="round"/>`),
      },
      {
        name: "鶏肉",
        icon: svg(`<path d="M14.6 4.2c3 1.2 4.6 4.6 3.6 7.7-.9 2.9-3.8 4.6-6.6 4.2l-2.2 3.3a2 2 0 0 1-3.4-2.1l2.1-3.4c-1.4-2.5-.9-5.8 1.4-7.7 1.4-1.2 3.4-1.6 5.1-1z" fill="#e8b878"/><path d="M6.6 16.2l-2 3.1" stroke="#f4e7d2" stroke-width="2" stroke-linecap="round"/>`),
      },
      {
        name: "ひき肉",
        icon: svg(`<path d="M4 14.5c0-3.6 3.6-6.5 8-6.5s8 2.9 8 6.5-3.6 4.5-8 4.5-8-.9-8-4.5z" fill="#c0574d"/><g fill="#8f3a33"><circle cx="8.5" cy="13" r="1.1"/><circle cx="12" cy="15.4" r="1.1"/><circle cx="15.6" cy="12.8" r="1.1"/><circle cx="11.6" cy="11.4" r="1"/></g>`),
      },
      {
        name: "ハム・ベーコン",
        icon: svg(`<rect x="3" y="6" width="18" height="12" rx="3" fill="#e9909a"/><path d="M3.4 9.5h17.2M3.4 14.5h17.2" stroke="#fbe3e1" stroke-width="2.2" stroke-linecap="round"/>`),
      },
      {
        name: "魚",
        icon: svg(`<path d="M2.6 12c3-4.2 7.2-6 11-5.2 3 .6 5.4 2.6 6.6 5.2-1.2 2.6-3.6 4.6-6.6 5.2-3.8.8-8-1-11-5.2z" fill="#7fb6d9"/><path d="M20.2 12l3.2-3v6l-3.2-3z" fill="#5f96bb"/><circle cx="7.4" cy="10.8" r="1.2" fill="#123"/>`),
      },
      {
        name: "えび・いか・貝",
        icon: svg(`<path d="M18.5 5.5c-6 0-10.5 3.2-10.5 7.4 0 3 2.2 5.1 5.2 5.1 2.3 0 4-1.2 4-2.9 0-1.4-1-2.3-2.4-2.3-1 0-1.8.5-1.8 1.3" fill="none" stroke="#ef8354" stroke-width="2.6" stroke-linecap="round"/><path d="M18.6 5.4l2.6-1.6M18.6 5.4l1 3" stroke="#ef8354" stroke-width="1.6" stroke-linecap="round"/>`),
      },
      {
        name: "ツナ・缶詰",
        icon: svg(`<rect x="4" y="7" width="16" height="11" rx="2" fill="#b9c3cc"/><rect x="4" y="7" width="16" height="3.4" rx="1.7" fill="#dde4ea"/><path d="M7.5 13.6h9" stroke="#8e9aa5" stroke-width="1.6" stroke-linecap="round"/>`),
      },
      {
        name: "卵",
        icon: svg(`<ellipse cx="12" cy="13" rx="7.5" ry="6.2" fill="#fdfaf2" stroke="#dcd3b8" stroke-width="1"/><circle cx="12" cy="12.6" r="3.2" fill="#f5b52c"/>`),
      },
    ],
  },
  {
    key: "plant",
    label: "野菜・豆腐など",
    hint: "野菜・豆腐などから",
    tags: [
      {
        name: "玉ねぎ",
        icon: svg(`<path d="M12 6c3.4 1.6 5.5 4.3 5.5 7.2 0 3.2-2.5 5.6-5.5 5.6s-5.5-2.4-5.5-5.6C6.5 10.3 8.6 7.6 12 6z" fill="#e3c88f"/><path d="M12 7.5v10M9.2 8.8c-.8 2.6-.8 6.2 0 8.6M14.8 8.8c.8 2.6.8 6.2 0 8.6" stroke="#c6a464" stroke-width="1"/><path d="M12 6c-.6-1.4-1.6-2.2-2.6-2.6M12 6c.6-1.4 1.6-2.2 2.6-2.6" stroke="#7fa05a" stroke-width="1.6" stroke-linecap="round" fill="none"/>`),
      },
      {
        name: "にんじん",
        icon: svg(`<path d="M8.6 9.4c1.6-1.6 4-1.6 5.6 0l4.4 8.8-8.8-4.4c-1.6-1.6-1.6-2.8-1.2-4.4z" fill="#ef8b3c"/><path d="M15.6 8.4l2.6-2.6M14.6 7.6c.4-2 1.6-3.2 3.2-3.6M16.6 9.6c2-.4 3.2-1.6 3.6-3.2" stroke="#5f9146" stroke-width="1.8" stroke-linecap="round"/>`),
      },
      {
        name: "キャベツ",
        icon: svg(`<circle cx="12" cy="12.6" r="8" fill="#a8ce7b"/><path d="M12 4.6c-3 2.4-4.6 5.4-4.6 8 0 3 2 5.4 4.6 6.6" fill="none" stroke="#7fae54" stroke-width="1.3"/><path d="M12 4.6c3 2.4 4.6 5.4 4.6 8 0 3-2 5.4-4.6 6.6" fill="none" stroke="#7fae54" stroke-width="1.3"/><circle cx="12" cy="12.6" r="2.4" fill="#d6e9bd"/>`),
      },
      {
        name: "葉物野菜",
        icon: svg(`<path d="M12 20V9" stroke="#c8dca4" stroke-width="2" stroke-linecap="round"/><path d="M12 12C9 12 6 9.6 5.4 5.6 9.4 5 12 7.8 12 12z" fill="#5f9146"/><path d="M12 12c3 0 6-2.4 6.6-6.4C14.6 5 12 7.8 12 12z" fill="#7fae54"/>`),
      },
      {
        name: "白菜",
        icon: svg(`<path d="M12 4c3.6 1.6 5.6 5 5.6 9 0 4-2.4 6.4-5.6 6.4S6.4 17 6.4 13c0-4 2-7.4 5.6-9z" fill="#eef3d8" stroke="#b9cd85" stroke-width="1"/><path d="M12 4.6c-1.8 2.8-2.6 6-2.6 9 0 2.4.6 4.4 1.6 5.6M12 4.6c1.8 2.8 2.6 6 2.6 9 0 2.4-.6 4.4-1.6 5.6" fill="none" stroke="#a8c46c" stroke-width="1.2"/>`),
      },
      {
        name: "ねぎ",
        icon: svg(`<path d="M9 21c-1.6 0-2.6-1.2-2.6-2.8 0-1.8 1-3 2.6-3s2.6 1.2 2.6 3S10.6 21 9 21z" fill="#f2f5e6" stroke="#cbd8a8" stroke-width="1"/><path d="M9.6 15.6L15 4.2M11.4 16.4L17 5.6" stroke="#5f9146" stroke-width="2.2" stroke-linecap="round"/>`),
      },
      {
        name: "じゃがいも",
        icon: svg(`<path d="M4.4 13.4c-.8-3.6 2-6.6 6-7.2 4.4-.7 8.4 1.4 9.2 4.8.8 3.6-2 6.8-6 7.4-4.2.6-8.4-1.4-9.2-5z" fill="#d3a86a"/><g fill="#a97f45"><ellipse cx="9" cy="11" rx="1.2" ry=".8"/><ellipse cx="14.4" cy="13.8" rx="1.2" ry=".8"/><ellipse cx="12.6" cy="9.6" rx="1" ry=".7"/></g>`),
      },
      {
        name: "大根",
        icon: svg(`<path d="M13.6 8.4c2.6 2.6 2.4 6.6-.6 8.8-2.4 1.8-5.6 1.4-7.2-.8-1.4-2-.6-4.8 1.6-6.4 2.2-1.6 4.6-2.6 6.2-1.6z" fill="#f4f6f2" stroke="#c4cdc0" stroke-width="1"/><path d="M14 8l4-4M15 9.4c1.6-.6 2.6-1.8 3-3.4M12.6 6.8c.6-1.8 1.8-3 3.4-3.4" stroke="#5f9146" stroke-width="1.8" stroke-linecap="round"/>`),
      },
      {
        name: "ごぼう",
        icon: svg(`<path d="M5.4 19.6c-.6-.6-.5-1.4.2-2.1L14.8 8c1.1-1.1 2.4-1.7 3.4-1.4 1 .3 1.3 1.3.9 2.4-.4 1-1.2 1.9-2.2 2.6L7.5 20c-.8.5-1.6.3-2.1-.4z" fill="#8a5a34"/><path d="M12.6 10.6l-3.1-1M15.2 8.2l-1-3M9.6 13.6l-3.2.6" stroke="#a9743f" stroke-width="1.3" stroke-linecap="round" fill="none"/><path d="M18.4 6.4c.5-1.3 1.4-2.2 2.6-2.6" stroke="#5f9146" stroke-width="1.8" stroke-linecap="round" fill="none"/>`),
      },
      {
        name: "れんこん",
        icon: svg(`<circle cx="12" cy="12.4" r="8" fill="#f2e9d4" stroke="#cbb98d" stroke-width="1"/><g fill="#d9c9a3"><circle cx="12" cy="8.2" r="1.5"/><circle cx="15.6" cy="10.3" r="1.5"/><circle cx="15.6" cy="14.5" r="1.5"/><circle cx="12" cy="16.6" r="1.5"/><circle cx="8.4" cy="14.5" r="1.5"/><circle cx="8.4" cy="10.3" r="1.5"/><circle cx="12" cy="12.4" r="1.6"/></g>`),
      },
      {
        name: "かぼちゃ",
        icon: svg(`<path d="M12 7.4c3.8 0 6.8 2.6 6.8 6s-3 6-6.8 6-6.8-2.6-6.8-6 3-6 6.8-6z" fill="#3f7a45"/><path d="M9.3 8.4c-.8 1.5-1.2 3.1-1.2 5s.4 3.5 1.2 5M14.7 8.4c.8 1.5 1.2 3.1 1.2 5s-.4 3.5-1.2 5" stroke="#2f5f34" stroke-width="1.1" fill="none"/><path d="M12 7.4V4.8" stroke="#8a7440" stroke-width="1.8" stroke-linecap="round"/>`),
      },
      {
        name: "ズッキーニ",
        icon: svg(`<path d="M17.4 6.2c1.2 1.2 1.2 3.1 0 4.3l-7 7c-1.2 1.2-3.1 1.2-4.3 0s-1.2-3.1 0-4.3l7-7c1.2-1.2 3.1-1.2 4.3 0z" fill="#4f8f3f"/><path d="M14.6 6.8l-8 8" stroke="#7bb765" stroke-width="1.2" stroke-linecap="round"/><path d="M17.8 5.8l1.8-1.8" stroke="#5f9146" stroke-width="1.8" stroke-linecap="round"/>`),
      },
      {
        name: "トマト",
        icon: svg(`<circle cx="12" cy="13.4" r="7" fill="#d94f3d"/><path d="M12 6.4l-2.6-2M12 6.4l2.6-2M12 6.4v2.4M8.6 7.6c1 1.2 2.2 1.8 3.4 1.8s2.4-.6 3.4-1.8" stroke="#5f9146" stroke-width="1.6" stroke-linecap="round" fill="none"/><path d="M9 11.4c.4-1.2 1.2-2 2.2-2.4" stroke="#f0a094" stroke-width="1.4" stroke-linecap="round"/>`),
      },
      {
        name: "なす",
        icon: svg(`<path d="M17.4 8.6c2 2.6 1 6.6-2.2 9-3 2.2-6.8 1.8-8.4-.8-1.6-2.6-.2-6.2 3-8.4 3-2 6-2 7.6.2z" fill="#7b4fa0"/><path d="M16 7.6l2.6-2.8M14.2 7c-.2-1.6.4-3 1.6-3.8" stroke="#5f9146" stroke-width="1.8" stroke-linecap="round"/>`),
      },
      {
        name: "ピーマン",
        icon: svg(`<path d="M6 12.6C6 9.4 8.6 7.4 12 7.4s6 2 6 5.2c0 3.6-2.6 6.6-6 6.6s-6-3-6-6.6z" fill="#4f9c4f"/><path d="M12 7.4V5.2" stroke="#3d7a3d" stroke-width="2" stroke-linecap="round"/><path d="M9.4 9.6c-.6 1.6-.6 3.6 0 5.2" stroke="#7cc47c" stroke-width="1.4" stroke-linecap="round"/>`),
      },
      {
        name: "きのこ",
        icon: svg(`<path d="M4.6 11.6C4.6 7.8 8 5.4 12 5.4s7.4 2.4 7.4 6.2c0 1-.8 1.4-2 1.4H6.6c-1.2 0-2-.4-2-1.4z" fill="#b5714a"/><path d="M10 13v4.6c0 1.2.8 2 2 2s2-.8 2-2V13z" fill="#e6d4bd"/>`),
      },
      {
        name: "もやし",
        icon: svg(`<g fill="none" stroke="#cfd9b4" stroke-width="2" stroke-linecap="round"><path d="M5 18c3-1 5.4-4 6-8"/><path d="M9 19c3.4-1 6-4.4 6.6-9"/><path d="M13 19.4c3-1.4 5-4.4 5.4-8.4"/></g><g fill="#d9e6b6"><circle cx="11.4" cy="9.4" r="1.6"/><circle cx="16" cy="9.6" r="1.6"/><circle cx="19" cy="10.4" r="1.4"/></g>`),
      },
      {
        name: "ブロッコリー",
        icon: svg(`<path d="M10.6 13h2.8v6a1.4 1.4 0 0 1-2.8 0z" fill="#a8ce7b"/><path d="M6.4 11.6c-1.2-2.4.4-4.8 2.6-5 .6-1.8 3-2.6 4.6-1.4 2-.8 4.2.6 4.2 2.8 1.8.8 2 3.4.2 4.6-1 .8-8.8 1-10.4.4-.6-.2-1-.8-1.2-1.4z" fill="#4f9c4f"/>`),
      },
      {
        name: "とうもろこし",
        icon: svg(`<path d="M12 4.4c2.6 1.4 4 4.4 4 7.6s-1.4 6.2-4 7.6c-2.6-1.4-4-4.4-4-7.6s1.4-6.2 4-7.6z" fill="#f2c33c"/><g stroke="#d9a41f" stroke-width=".9"><path d="M10 6.6v10.8M12 5.4v13.2M14 6.6v10.8M8.6 9h6.8M8.4 12h7.2M8.6 15h6.8"/></g>`),
      },
      {
        name: "豆腐・厚揚げ",
        icon: svg(`<path d="M4 9.4l8-3.4 8 3.4-8 3.6z" fill="#fdfbee" stroke="#ddd5b4" stroke-width=".9" stroke-linejoin="round"/><path d="M4 9.4v5.2l8 3.6v-5.2z" fill="#f2eedb"/><path d="M20 9.4v5.2l-8 3.6v-5.2z" fill="#e6e0c6"/>`),
      },
      {
        name: "納豆・大豆",
        icon: svg(`<rect x="4.6" y="8" width="14.8" height="10" rx="2" fill="#e8dcc0"/><g fill="#8a6b3a"><ellipse cx="9" cy="12" rx="1.8" ry="1.4"/><ellipse cx="13.2" cy="13.6" rx="1.8" ry="1.4"/><ellipse cx="16.4" cy="11.2" rx="1.8" ry="1.4"/><ellipse cx="10.6" cy="15.4" rx="1.6" ry="1.2"/></g>`),
      },
      {
        name: "わかめ・海藻",
        icon: svg(`<path d="M12 20c-.6-4 .6-7 2.4-9.4 1.4-1.8 3.2-2.8 5-3-.6 3.4-2 5.6-3.6 7-1.4 1.2-2.8 1.8-3.8 2" fill="#2f7d64"/><path d="M12 20c-1.4-3.6-3.4-5.6-5.2-6.8-1.4-1-2.8-1.4-4-1.4 1.4 3 3 4.8 4.6 5.8 1.4.8 2.8 1.2 3.6 1.4" fill="#46997c"/>`),
      },
    ],
  },
  {
    key: "genre",
    label: "ジャンル",
    hint: "味の系統",
    tags: [
      {
        name: "和風",
        icon: svg(`<circle cx="12" cy="12" r="8" fill="#fdfaf2"/><circle cx="12" cy="12" r="4.4" fill="#d94f3d"/>`),
      },
      {
        name: "洋風",
        icon: svg(`<path d="M7 4v7a2 2 0 0 0 4 0V4M9 11v9" stroke="#8a97a3" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M16.4 4c1.6 0 2.6 2 2.6 5s-1 4-2.6 4V4z" fill="#8a97a3"/><path d="M16.4 12v8" stroke="#8a97a3" stroke-width="1.8" stroke-linecap="round"/>`),
      },
      {
        name: "中華風",
        icon: svg(`<path d="M3 10h18c0 4.4-4 7.6-9 7.6S3 14.4 3 10z" fill="#c8541f"/><path d="M20.4 10.6l2.4-2.4" stroke="#8a4418" stroke-width="1.8" stroke-linecap="round"/><path d="M8 8.6c0-1.4 1-2.2 1-3.2M12 8.2c0-1.6 1-2.4 1-3.6M16 8.6c0-1.4 1-2.2 1-3.2" stroke="#e0a06c" stroke-width="1.4" stroke-linecap="round" fill="none"/>`),
      },
      {
        name: "韓国風",
        icon: svg(`<path d="M6 13.4c0-3.4 2.6-6 6-6s6 2.6 6 6c0 1-.6 1.6-1.6 1.6H7.6c-1 0-1.6-.6-1.6-1.6z" fill="#d93b3b"/><path d="M4.6 16.6h14.8" stroke="#8f2020" stroke-width="2" stroke-linecap="round"/><path d="M12 7.4V4.6" stroke="#5f9146" stroke-width="1.8" stroke-linecap="round"/>`),
      },
      {
        name: "エスニック",
        icon: svg(`<circle cx="12" cy="12.6" r="7.4" fill="#e6a72c"/><path d="M8.4 12.6c0-2 1.6-3.6 3.6-3.6s3.6 1.6 3.6 3.6" fill="none" stroke="#a86f14" stroke-width="1.6" stroke-linecap="round"/><g fill="#7d4f10"><circle cx="9.6" cy="15.4" r="1"/><circle cx="14.4" cy="15.4" r="1"/><circle cx="12" cy="16.4" r="1"/></g>`),
      },
    ],
  },
];

/** グループのキー → グループ */
export const GROUP_BY_KEY = new Map(TAG_GROUPS.map((g) => [g.key, g]));

/** "protein" + "牛肉" → タグ定義（未知なら undefined） */
export function findTag(groupKey, name) {
  return GROUP_BY_KEY.get(groupKey)?.tags.find((t) => t.name === name);
}

/** レシピ1件が持つ全タグを [{groupKey, tag}] で返す（未知の名前は捨てる） */
export function tagsOf(recipe) {
  const out = [];
  for (const group of TAG_GROUPS) {
    for (const name of recipe[group.key] ?? []) {
      const tag = findTag(group.key, name);
      if (tag) out.push({ groupKey: group.key, tag });
    }
  }
  return out;
}

/** 材料から探す画面で使うグループ（ジャンルは検索対象にしない） */
export const SEARCHABLE_GROUPS = TAG_GROUPS.filter((g) => g.key !== "genre");
