# recipe-ai-bff

「自炊の本棚」の**AIで下書き**機能のためのバックエンド（Cloudflare Workers）。

設計の背景は [`../docs/ai-draft-design.md`](../docs/ai-draft-design.md) にある。

## この BFF がやらないこと

**GitHub への書き込みは一切しない。** レシピのコミットは今まで通りブラウザが
GitHub Contents API を直接叩く。この BFF が書き込み権限を持たないからこそ、
プロンプトインジェクションが成功しても被害は「変な下書きが出る」で止まり、
認証を共有キー1本で済ませられる。ここを変えるとセキュリティ設計全体が崩れる。

## ⚠️ このリポジトリを iCloud 同期下に置かないこと

**現在の場所は `~/dev/recipe-site`。iCloud の外なので、以下の問題は起きない。**
`npm install` して `npm test` すればよく、特別な手順は要らない。

以前は Obsidian の vault（iCloud Drive 同期下）に置いていて、次の事故が繰り返し起きた。
**同じ場所に戻さないこと。**

| 症状 | 何が起きていたか |
|---|---|
| vitest が 16秒 → 240秒超で完走しない | iCloud が `node_modules` をクラウドへ退避（dataless）し、読み取りがダウンロード待ちで固まる |
| 大量の見覚えのない FAIL | iCloud が競合時に作る `node_modules 2` の中のテストを拾っていた |
| 直したのに再発する | `npm install` が symlink を実体ディレクトリに戻す。先に張っても無駄 |

回避策（`.nosync`、`~/.cache` への symlink）はどれも延命にしかならなかった。
**iCloud のツリーの外に出すのが唯一の解決だった。**

`npm test` の前には `scripts/check-node-modules.mjs` が走り、iCloud 同期下に
実体で置かれていればその場で止まる。いまの場所では素通りする。

> **端末を変えたら `node_modules` は入れ直す。** バイナリはCPUごとに違う
> （`@cloudflare/workerd-darwin-64` と `-arm64` は別物）。

## セットアップ

```bash
npm install
npm run setup
```

`npm run setup` が次を順にやる。何度実行しても壊れない（済んでいるものは飛ばす）。

1. Cloudflare へのログイン確認（未ログインならブラウザを開く）
2. KV 名前空間の作成と `wrangler.toml` への書き込み
3. Secrets の登録
   - `ANTHROPIC_API_KEY` … その場で貼り付ける。**スクリプトの中は通らず、
     `wrangler secret put` が端末から直接読んで Cloudflare に送る**
   - `CLIENT_SHARED_KEY` … 自動生成して登録し、最後に一度だけ表示する
   - `GEMINI_API_KEY` … 任意。イラスト化を使うときだけ（y/N で聞かれる）
4. デプロイ
5. `/v1/health` で疎通確認
6. ブラウザに入れる値（エンドポイントとクライアントキー）の表示

終わったら `add.html` の「AI下書きの設定」に表示された2つを入れる。

クライアントキーを控え忘れたら作り直せる（古いキーは使えなくなる）。

```bash
npm run setup -- --reset-client-key
```

### 手でやる場合

`npm run setup` が使えない環境なら、[`scripts/setup.sh`](scripts/setup.sh) の中身を
上から順に手で実行すればよい。特別なことはしていない。

### 許可する接続元

`wrangler.toml` の `ALLOWED_ORIGINS` に、`add.html` を開く URL の
**オリジンを完全一致で**書く（ワイルドカードは使わない）。
ここに無い URL からは 403 になる。

## 写真をイラストにする（任意）

X に出す画像を作る機能。`GEMINI_API_KEY` を登録すると使えるようになる。

```bash
npx wrangler secret put GEMINI_API_KEY
```

- **1枚 約5円。** 上限は `wrangler.toml` の `DAILY_IMAGE_LIMIT`（既定 30枚/日）と
  `HOURLY_IMAGE_LIMIT`（既定 10枚/時）。**テキストの枠とは別に数える**
- プロンプトは `src/illustrate.js` の `ILLUSTRATE_PROMPT`。vault の
  `X運用設計_料理イラスト.md` §4 と同じ。**変えたら `ILLUSTRATE_PROMPT_VERSION` を上げる**
  （一発率がそのまま費用なので、前後を比較できないと調整できない）
- モデルは `gemini-3.1-flash-lite-image`（既定）と `gemini-3.1-flash-image`。
  **2026-08-20 に Gemini API のモデル一覧で確認済み。** ただし改版が早いので、
  `unknown_model` がログに出たら `wrangler.toml` の
  `GEMINI_MODEL_LITE` / `_FLASH` を差し替える

鍵を登録しなければ、レシピの下書きだけが使える状態で動く。

## デプロイ後の確認

```bash
npm run smoke -- https://recipe-ai-bff.xxx.workers.dev クライアントキー
```

> `<キー>` のような山かっこは書かない。zsh がリダイレクトと解釈して
> `parse error near '\n'` になる。履歴に残したくなければ入力を促す形にする。
>
> ```bash
> read -s "KEY?クライアントキー: "; npm run smoke -- https://recipe-ai-bff.xxx.workers.dev "$KEY"
> ```

CORS・認証・入力検証を一通り叩いたあと、**実際に下書きを1件生成して**
中身（タイトル・材料・タグ・確信度・トークン数・概算費用）を表示する。
sourceUrl の捏造や手順の整形漏れもその場で指摘する。

AI を呼びたくないときは `--no-ai` を付ける。

```bash
npm run smoke -- https://recipe-ai-bff.xxx.workers.dev クライアントキー --no-ai
```

## ローカル開発

```bash
cp .dev.vars.example .dev.vars   # 値を入れる
npm run dev                       # http://localhost:8787
```

疎通確認:

```bash
curl -H "Origin: http://localhost:3000" http://localhost:8787/v1/health
```

`Origin` ヘッダは必須（許可リストと完全一致）。付けないと 403 になる。

## テスト

```bash
npm test
```

Vitest で 186 件（10ファイル / 約15秒）。4層ある。

| 層 | ファイル | 何を見るか |
|---|---|---|
| 単体 | `validate` / `normalize` / `prompt` / `vocabulary` / `illustrate` | 各モジュールの入出力 |
| Worker 結合 | `worker.test.js` | 認証の順序、CORS、キャッシュ、**レート制限を消費する位置**、上流エラーの切り分け（Anthropic / Gemini はモック） |
| フロント結合 | `mapper.test.js` / `ai-draft.test.js` / `x-post.test.js` | 実物の `add.html` を jsdom に読み込み、**AI が失敗したときにフォームを壊さないこと**を含めて検証 |
| 出口 | `commit-shape.test.js` | AI の下書きが**実際にコミットされる JSON** になったとき `reindex.mjs` を通るか |

単体テストだけでは組み合わせの不具合が1つも取れなかったので、
**単体以外の3層を消さないこと。**

`npm test` の前に `scripts/check-node-modules.mjs` が走り、
`node_modules` が iCloud 同期下に戻っていたらその場で止まる（下記の事故の再発防止）。

## 評価（ゴールデンセット）

```bash
BFF_ENDPOINT=http://localhost:8787/v1/draft BFF_KEY=クライアントキー npm run eval
```

プロンプトや `PROMPT_VERSION` を変えたら回す。**「うまくいかなかったメモ」を
そのまま `eval/cases/` に足していく運用にすると、評価セットが自然に育つ。**

## 調整ポイント

| 変数 | 既定 | 効果 |
|---|---|---|
| `EFFORT` | `low` | 上げると賢くなるが遅く・高くなる（`medium` / `high`） |
| `THINKING` | `disabled` | `adaptive` にすると推論が入る。`max_tokens` は thinking と出力の合計に効くので、上げるなら `MAX_TOKENS` も上げる |
| `MODEL` | `claude-sonnet-5` | — |
| `HOURLY_REQUEST_LIMIT` | `20` | 時間あたり / フィンガープリント |
| `DAILY_REQUEST_LIMIT` | `100` | 日次・全体。**課金の最終ストッパー** |

> `temperature` / `top_p` / `top_k` は指定しない。Claude Sonnet 5 は
> 非既定のサンプリングパラメータを受け付けず 400 になる。

## 困ったときに見るところ

上流が失敗したときのログには切り分け用の内訳が入っている。
**レスポンスには一般的な文言しか返らない**ので、原因はログで見る。

```jsonc
{"event":"draft.upstream_failed","reason":"auth","upstreamStatus":401, ...}
```

| `reason` | 意味 | 対処 |
|---|---|---|
| `auth` | `ANTHROPIC_API_KEY` が違う・失効した | `wrangler secret put ANTHROPIC_API_KEY` |
| `upstream_rate_limit` | Anthropic 側のレート制限 | 時間をおく。頻発するなら利用枠を確認 |
| `connection` | 応答が時間内に返らなかった | 一時的なら再試行。続くなら `EFFORT` を下げる |
| `other` | それ以外 | `upstreamStatus` を見る |

イラスト化（`illustrate.failed`）:

| `reason` | 意味 | 対処 |
|---|---|---|
| `unknown_model` | **Gemini のモデルIDが変わった** | `wrangler.toml` の `GEMINI_MODEL_LITE` / `_FLASH` を差し替え |
| `upstream_rate_limit` | **たいてい無料枠のまま。** Gemini の画像生成は課金が要る | キーが属する Google Cloud プロジェクトに請求先を紐づける。AI Studio はキーごとに専用プロジェクトを作ることがあり、**別プロジェクトに請求先を付けても通らない**。待っても直らない |
| `blocked:*` / `finish:*` | 生成を断られた | 別の写真で試す |
| `timeout` | 55秒以内に返らなかった | もう一度。続くなら `lite` を使う |

`{"event":"config.missing_client_key"}` が出ていたら `CLIENT_SHARED_KEY` が未設定。

## 運用上の注意

- **KV が落ちると AI 機能は止まる。** 日次カウンタが読めないと課金保護が効かないため、
  そこだけ fail-closed にしている。既存の投稿フォームは影響を受けない。
- ログにメモ本文は出さない（長さとハッシュのみ）。`promptVersion` を必ず載せているので、
  プロンプト変更前後の品質を後から比較できる。
