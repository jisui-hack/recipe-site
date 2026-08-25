#!/usr/bin/env bash
#
# recipe-ai-bff の初回デプロイを一通りやる。
#
#   ./scripts/setup.sh
#
# やること: Cloudflare へのログイン確認 → KV 名前空間の作成 → Secrets の登録
#           → デプロイ → 疎通確認 → フロントに入れる値の表示
#
# 何度実行しても壊れないようにしてある（作成済みのものは飛ばす）。
#
# ★ ANTHROPIC_API_KEY はこのスクリプトの中を通らない。
#   wrangler secret put が端末から直接読み取り、Cloudflare に送る。
#   ファイルにも変数にも残さない。

set -euo pipefail
cd "$(dirname "$0")/.."

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
step() { printf "\n%s▶ %s%s\n" "$BOLD" "$1" "$OFF"; }
ok()   { printf "  %s✓%s %s\n" "$GREEN" "$OFF" "$1"; }
warn() { printf "  %s!%s %s\n" "$YELLOW" "$OFF" "$1"; }
die()  { printf "\n%s✗ %s%s\n" "$RED" "$1" "$OFF" >&2; exit 1; }

WRANGLER="npx --no-install wrangler"
PLACEHOLDER="REPLACE_WITH_YOUR_KV_NAMESPACE_ID"

RESET_CLIENT_KEY=false
for arg in "$@"; do
  case "$arg" in
    --reset-client-key) RESET_CLIENT_KEY=true ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "知らない引数です: $arg" ;;
  esac
done

# ---------------------------------------------------------------- 前提の確認

step "前提を確認"

[ -d node_modules ] || die "npm install を先に実行してください（node_modules がありません）"
ok "依存あり"

# vault（iCloud 同期下）に node_modules の実体があると、
# ファイルがクラウドへ退避されて読み取りが固まる。README 冒頭を参照。
#
# npm install は symlink を実体ディレクトリに戻してしまう。警告だけ出しても
# 毎回踏むので、ここで黙って直す。中身はそのまま移すだけで再インストールは不要。
if [ ! -L node_modules ] && [[ "$(pwd -P)" == *"/Mobile Documents/"* ]]; then
  CACHE="$HOME/.cache/recipe-site-bff/node_modules"
  warn "node_modules が iCloud 同期下にあります。外へ移します"
  rm -rf "$CACHE"
  mkdir -p "$(dirname "$CACHE")"
  mv node_modules "$CACHE"
  ln -s "$CACHE" node_modules
  ok "$CACHE へ移して symlink を張りました"
fi

if ! $WRANGLER whoami >/dev/null 2>&1; then
  warn "Cloudflare にログインしていません。ブラウザを開きます"
  $WRANGLER login || die "ログインに失敗しました"
fi
ok "Cloudflare: $($WRANGLER whoami 2>/dev/null | grep -oE '[^ ]+@[^ ]+' | head -1 || echo 'ログイン済み')"

# ---------------------------------------------------------------- KV 名前空間

step "KV 名前空間"

if grep -q "$PLACEHOLDER" wrangler.toml; then
  echo "  作成します…"
  CREATE_OUT="$($WRANGLER kv namespace create RECIPE_AI_BFF 2>&1)" || {
    echo "$CREATE_OUT" >&2
    die "KV 名前空間を作成できませんでした"
  }
  # 出力から 32 桁の16進 id を拾う
  KV_ID="$(printf '%s' "$CREATE_OUT" | grep -oE '[0-9a-f]{32}' | head -1)"
  [ -n "$KV_ID" ] || { echo "$CREATE_OUT" >&2; die "出力から id を取り出せませんでした。手で wrangler.toml に書いてください"; }

  cp wrangler.toml wrangler.toml.bak
  # BSD/GNU どちらの sed でも動く形にする
  sed "s/$PLACEHOLDER/$KV_ID/" wrangler.toml > wrangler.toml.tmp && mv wrangler.toml.tmp wrangler.toml
  ok "作成して wrangler.toml に書き込みました（id=$KV_ID / 旧ファイルは wrangler.toml.bak）"
else
  ok "設定済み（id=$(grep -A2 'kv_namespaces' wrangler.toml | grep -oE '[0-9a-f]{32}' | head -1)）"
fi

# ---------------------------------------------------------------- Secrets

step "Secrets"

# secret list が失敗したときに '[]' で代用すると「未登録」と誤判定し、
# 登録済みのキーを上書きさせてしまう。失敗はここで止める。
if ! EXISTING="$($WRANGLER secret list 2>&1)"; then
  echo "$EXISTING" >&2
  die "登録済みの Secret を確認できませんでした。上のエラーを解消してから再実行してください"
fi

if printf '%s' "$EXISTING" | grep -q "ANTHROPIC_API_KEY"; then
  ok "ANTHROPIC_API_KEY は登録済み（変えたい場合は wrangler secret put ANTHROPIC_API_KEY）"
else
  echo ""
  echo "  ${BOLD}Anthropic の API キーを貼り付けてください${OFF}"
  echo "  ${DIM}Anthropic Console の API Keys で発行できます（platform.claude.com）${OFF}"
  echo "  ${DIM}入力はこの端末から Cloudflare に直接送られ、どこにも保存されません${OFF}"
  echo ""
  $WRANGLER secret put ANTHROPIC_API_KEY || die "API キーの登録に失敗しました"

  # 空のまま Enter を押しても wrangler は成功扱いで空の値を登録する。
  # そうなると Worker は 401 を返し続け、原因が分かりにくい。ここで弾く。
  if ! $WRANGLER secret list 2>/dev/null | grep -q "ANTHROPIC_API_KEY"; then
    die "API キーが登録されていません。空のまま Enter を押していないか確認してください"
  fi
  ok "登録しました"
fi

CLIENT_KEY=""
if printf '%s' "$EXISTING" | grep -q "CLIENT_SHARED_KEY" && [ "$RESET_CLIENT_KEY" = false ]; then
  ok "CLIENT_SHARED_KEY は登録済み"
  warn "値は取り出せません。入れ直すなら ./scripts/setup.sh --reset-client-key"
else
  [ "$RESET_CLIENT_KEY" = true ] && warn "クライアントキーを作り直します（古いキーは使えなくなります）"
  CLIENT_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
  printf '%s' "$CLIENT_KEY" | $WRANGLER secret put CLIENT_SHARED_KEY || die "クライアントキーの登録に失敗しました"
  ok "生成して登録しました"
fi

if printf '%s' "$EXISTING" | grep -q "GEMINI_API_KEY"; then
  ok "GEMINI_API_KEY は登録済み（イラスト化が使えます）"
else
  echo ""
  echo "  ${BOLD}Gemini の API キー（写真をイラストにする機能。任意）${OFF}"
  echo "  ${DIM}使わないなら空のまま Enter。あとから wrangler secret put GEMINI_API_KEY で足せます${OFF}"
  echo "  ${DIM}1枚 約5円。上限は wrangler.toml の DAILY_IMAGE_LIMIT（既定30枚/日）${OFF}"
  echo ""
  printf "  登録しますか？ [y/N]: "
  read -r ANS
  if [ "$ANS" = "y" ] || [ "$ANS" = "Y" ]; then
    $WRANGLER secret put GEMINI_API_KEY || warn "登録に失敗しました。あとから足せます"
  else
    warn "飛ばしました。イラスト化は使えません（レシピの下書きは使えます）"
  fi
fi

# ---------------------------------------------------------------- 接続元

step "許可する接続元"
grep -E '^ALLOWED_ORIGINS' wrangler.toml | sed 's/^/  /'
echo "  ${DIM}add.html を開く URL のオリジンが含まれていることを確認してください${OFF}"
echo "  ${DIM}（含まれていないと 403 になります。wrangler.toml を直して再デプロイ）${OFF}"

# ---------------------------------------------------------------- デプロイ

step "デプロイ"
DEPLOY_OUT="$($WRANGLER deploy 2>&1)" || { echo "$DEPLOY_OUT" >&2; die "デプロイに失敗しました"; }
printf '%s\n' "$DEPLOY_OUT" | grep -E "Uploaded|Deployed|https://" | sed 's/^/  /'

WORKER_URL="$(printf '%s' "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)"
[ -n "$WORKER_URL" ] || warn "URL を取り出せませんでした。上の出力から拾ってください"

# ---------------------------------------------------------------- 疎通確認

if [ -n "$WORKER_URL" ]; then
  step "疎通確認"
  ORIGIN="$(grep -E '^ALLOWED_ORIGINS' wrangler.toml | sed 's/.*= *"//; s/".*//' | cut -d, -f1)"
  # 初回デプロイ直後は workers.dev のサブドメインがまだ引けず、
  # Cloudflare が error code 1104 を返す。数十秒で通るので待って試し直す。
  HEALTH=""
  for i in 1 2 3 4 5 6; do
    HEALTH="$(curl -s --max-time 15 -H "Origin: $ORIGIN" "$WORKER_URL/v1/health" || true)"
    printf '%s' "$HEALTH" | grep -q '"ok":true' && break
    [ "$i" = 1 ] && echo "  ${DIM}反映を待っています（初回は1分ほどかかることがあります）…${OFF}"
    sleep 10
  done

  if printf '%s' "$HEALTH" | grep -q '"ok":true'; then
    ok "$HEALTH"
    printf '%s' "$HEALTH" | grep -q '"hasApiKey":true' || warn "API キーが Worker から見えていません"
  else
    warn "health がまだ返りません: ${HEALTH:-（応答なし）}"
    warn "デプロイ自体は終わっています。1〜2分おいて npm run smoke で試してください"
  fi
fi

# ---------------------------------------------------------------- 仕上げ

step "ブラウザ側の設定"
cat <<EOF

  add.html を開いて「AI下書きの設定」に次を入れてください。

    エンドポイント: ${BOLD}${WORKER_URL:-<デプロイ出力の URL>}/v1/draft${OFF}
EOF
if [ -n "$CLIENT_KEY" ]; then
  cat <<EOF
    クライアントキー: ${BOLD}${CLIENT_KEY}${OFF}

  ${YELLOW}このキーが表示されるのはこの一度だけです。${OFF}
  ${DIM}控え忘れたら ./scripts/setup.sh --reset-client-key で作り直せます。${OFF}
EOF
else
  echo "    クライアントキー: 登録済みのものを使ってください"
fi

cat <<EOF

  動作確認:
    ${DIM}./scripts/smoke.sh ${WORKER_URL:-<URL>} <クライアントキー>${OFF}

EOF
