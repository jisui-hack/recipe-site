# 自炊の本棚（レシピ共有サイト）

自分のレシピを蓄積し、知人に公開するためのシンプルな静的サイト。
**ビルド不要・フレームワーク不要・依存ライブラリ0**。表示はすべて JSON を fetch するだけ。

- 公開ルート: `/public`
- データ: `public/data/recipes/<id>.json`（1レシピ1ファイル）＋ `public/data/index.json`（軽量インデックス）
- バックエンド・DBなし。データはすべて Git 上のテキストで、履歴も残る。

## ローカルで動かす

```bash
npx serve public
```

`http://localhost:3000` を開く。（`python3 -m http.server 4174 --directory public` でも可）

※ `file://` で直接開くと fetch と ES モジュールが失敗します。必ず静的サーバー経由で開いてください。

## ディレクトリ構成

```
public/
  index.html          レシピ一覧（タイトル検索のみ）
  search.html         材料から探す（タグを選んで絞り込み）
  recipe.html         詳細（?id=<id>）
  add.html            投稿フォーム（管理用・サイト内からはリンクしない）
  assets/app.css      共通スタイル
  assets/tags.js      タグの語彙とイラスト（★ここだけ直せばタグを増やせる）
  assets/common.js    カード描画など共通部品
  assets/app.js       一覧
  assets/search.js    材料から探す
  assets/recipe.js    詳細表示（プレビューにも使う）
  assets/add.js       フォーム→GitHubコミット
  data/index.json     全レシピの軽量インデックス
  data/recipes/*.json レシピ本体
  data/images/*.jpg   サムネイル
scripts/reindex.mjs          index.json 再生成＋タグ検証（Node, 依存なし）
.github/workflows/site.yml   push時に index.json を再生成してから public/ を公開
```

JS は ES モジュール（`<script type="module">`）で、バンドルはしません。

## 公開の手順（GitHub Pages）

1. GitHub に **public** リポジトリを作り、このディレクトリを push する。
2. Settings → Pages → Build and deployment の Source を **GitHub Actions** にする。
3. `main` に push すると [`site.yml`](.github/workflows/site.yml) が
   `index.json` を再生成してから `public/` をそのまま配信する。
   数十秒後に `https://<owner>.github.io/<repo>/` で開ける。

> Pages の「Deploy from a branch」はフォルダに `/` か `/docs` しか選べず、`/public` を
> 指定できません。`public/` を公開ルートにするため、ビルドをしないアップロードだけの
> Actions ワークフローで配信しています。

## タグの設計

タグは3種類。**すべて任意**で、0個でも投稿できます。

| フィールド | 意味 | 例 |
|---|---|---|
| `protein` | 肉・魚・卵 | 牛肉 / 豚肉 / 鶏肉 / ひき肉 / ハム・ベーコン / 魚 / えび・いか・貝 / ツナ・缶詰 / 卵 |
| `plant` | 野菜・豆腐など | 玉ねぎ / にんじん / キャベツ / 葉物野菜 / 白菜 / ねぎ / じゃがいも / 大根 / トマト / なす / ピーマン / きのこ / もやし / ブロッコリー / とうもろこし / 豆腐・厚揚げ / 納豆・大豆 / わかめ・海藻 |
| `genre` | 味の系統 | 和風 / 洋風 / 中華風 / 韓国風 / エスニック |

- **調味料はタグにしません**（醤油・塩などは `ingredients` に分量付きで書くだけ）。
- 調理法のタグ（時短・丼など）も持ちません。
- 語彙は自由記述ではなく [`public/assets/tags.js`](public/assets/tags.js) の固定リストです。
  1つずつ簡単なSVGイラストを持たせているため、**タグを増やすときは tags.js に
  `{ name, icon }` を1行足すだけ**でフォーム・検索・詳細のすべてに反映されます。
- 語彙にない名前が入っていると `reindex` が失敗して教えてくれます（`index.json` は壊しません）。

`protein` と `plant` が「材料から探す」の検索対象、`genre` は表示のみです。

## データ形式

`public/data/recipes/<id>.json`:

```jsonc
{
  "id": "2026-0001-gyudon",   // <年>-<4桁連番>-<スラッグ>
  "title": "簡単10分 牛丼",
  "thumb": "data/images/2026-0001-gyudon.jpg", // 無ければ null（public からの相対パス）
  "timeMinutes": 10,
  "servings": 1,
  "ingredients": [{ "name": "牛こま肉", "amount": "150g" }],
  "steps": ["玉ねぎを薄切りにする。"],
  "protein": ["牛肉"],
  "plant": ["玉ねぎ"],
  "genre": ["和風"],
  "sourceUrl": null,          // note等の元記事URL。あれば詳細に「元記事を見る」が出る
  "createdAt": "2026-08-06",
  "notes": ""
}
```

`index.json` は上記から生成される要約（`id / title / thumb / timeMinutes / createdAt / protein / plant / genre`）。

## 画面

### レシピ一覧（`index.html`）

タイトルの部分一致検索と、新着順のカード一覧だけ。カードにはタグのイラストが並びます。

### 材料から探す（`search.html`）

「肉・魚・卵」「野菜・豆腐など」の2グループからタグを選びます（片方だけでも両方からでも可）。

- **いずれか使う（既定）**: 選んだ素材のどれかを使うレシピ。一致数が多い順 → 所要時間が短い順。
- **これだけで作れる**: レシピの素材タグがすべて選択に収まるもの。調味料はタグにしていないので、
  「選んだ素材だけで組み立てられるレシピ」がそのまま残ります。
- 選択状態は `sessionStorage` に保存され、詳細ページから戻っても保持されます。

### 追加（`add.html`）

**サイト内からはリンクしていません**（誰でも追加できてしまうため）。
URL を直接開いて使います。`<meta name="robots" content="noindex, nofollow">` も付けています。

> これは導線を消しているだけで、アクセス制限ではありません。書き込みには本人のトークンが
> 必要なので他人は投稿できませんが、フォーム自体は URL を知っていれば誰でも開けます。

## レシピを追加する

### A. フォームから（スマホ可）

1. `https://<owner>.github.io/<repo>/add.html` を開く。
2. 「GitHub 設定」を開いて入力し、保存する（初回のみ）。
   - オーナー / リポジトリ名 / ブランチ（GitHub Pages 上なら自動で埋まる）
   - アクセストークン: **Fine-grained PAT**
     - Repository access: このリポジトリだけに限定
     - Repository permissions → **Contents: Read and write** のみ
     - 有効期限を設定する
3. フォームを入力（タグはチップをタップして選ぶ）→「プレビュー」→「投稿する」。
4. 次の3ファイルが順にコミットされる。
   - `public/data/images/<id>.jpg`（画像を選んだときだけ）
   - `public/data/recipes/<id>.json`
   - `public/data/index.json`（更新）
5. GitHub Pages への反映まで数十秒。

**トークンの扱い**: トークンは投稿する本人のブラウザの `localStorage` にだけ保存されます。
リポジトリやコードには含まれません。共有PCでは使わないでください。不要になったら
「トークンを削除」ボタン、または GitHub 側で失効させてください。

投稿の途中で失敗した場合は、どこまで成功したかが進捗欄に表示され、
「失敗したところから再実行」で続きから再開できます（Contents API は複数ファイルを
1コミットにまとめられないため、3ファイルを逐次コミットしています）。

画像はコミット前にブラウザ内で縮小されます（長辺1024px / JPEG品質0.8 / 目標150KB以下）。
画像なしでも投稿でき、その場合は一覧に 🍳 のプレースホルダが出ます。

#### AIで下書き（任意）

メモ書きや料理写真から、フォームの全項目を埋めた下書きを作れます。
使うには [`bff/`](bff/README.md) を Cloudflare Workers にデプロイして、
`add.html` の「AI下書きの設定」に URL とキーを入れてください。

- **AI は下書きを作るだけで、投稿はしません。** これまで通り人が確認して「投稿する」を押します。
- 未設定でも、BFF が落ちていても、**フォームは今まで通り手入力で使えます。**
- 設計の詳細は [`docs/ai-draft-design.md`](docs/ai-draft-design.md)。

### B. 手でJSONを置く

`public/data/recipes/<id>.json` を追加して push すれば OK。
GitHub Actions（`site.yml`）が `index.json` を作り直してコミットし、
そのまま公開まで済ませるので、インデックスを手で直す必要はありません。

手元で作り直したいときは:

```bash
node scripts/reindex.mjs
```

`id` はファイル名と一致させてください。不一致・壊れたJSON・語彙にないタグがあると
reindex は中断し、`index.json` は書き換えません。

## 今後の拡張余地（未実装）

- **PWA化**: `manifest.json` + Service Worker で `index.html` / CSS / JS / `index.json` を
  キャッシュすれば、2回目以降は即表示・オフラインでも動く。
- **note連携**: `assets/app.js` の `renderNoteFeed()` が空のフックとして置いてある。
  note の RSS（`https://note.com/<user>/rss`）を並べる想定。CORSで直接取得できない場合は
  GitHub Actions で定期取得して `data/note.json` にキャッシュする。
- **ジャンルでの絞り込み**: `genre` は今は表示のみ。検索に使うなら `search.js` の
  `SEARCHABLE_GROUPS` に含めるだけで動く。
- **原子コミット**: Git Data API（blobs → tree → commit → update ref）で3ファイルを1コミットに。
- **トークンを持たない投稿**: GitHub Issue Forms + Actions で、Issue入力から JSON を生成する方式。

## 動作確認の手順

1. `npx serve public` を起動する。
2. `/index.html` … 検索ボックスとカード一覧（新着順）。カードにタグのイラストが並ぶ。
   「丼」と入力すると牛丼・親子丼だけになる。
3. `/search.html` … 「肉・魚・卵」「野菜・豆腐など」のチップが並ぶ。
   「玉ねぎ」をタップ → 牛丼と親子丼。さらに「卵」を足すと親子丼が上（2つ一致）に来る。
   「これだけで作れる」に切り替えると、選んだ素材だけで作れるものに絞られる。
4. カードをクリック → `/recipe.html?id=<id>` … タグがグループごとにイラスト付きで出る。
   存在しないIDでは「見つかりませんでした。」。
5. `/add.html` … 空のまま「投稿する」で必須項目のエラー。タグは0個でも投稿できる。
   「プレビュー」で詳細ページと同じ見た目が出る。
6. ヘッダーに「＋追加」が無いこと。ブラウザ幅 375px で横スクロールが発生しないこと。
7. `node scripts/reindex.mjs` … `index.json` が再生成され、2回実行しても差分が出ない。
   語彙にないタグを書くと失敗する。
