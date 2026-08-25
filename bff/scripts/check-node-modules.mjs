/*
 * node_modules が iCloud 同期下に実体で置かれていないかを見る。
 *
 * これを置いている理由: 同じ事故が4回起きたから。
 * iCloud はしばらく触られていないファイルをクラウドへ退避する（dataless）。
 * node_modules がその対象になると、require のたびにダウンロード待ちが入り、
 * vitest が 16秒 → 240秒超になって「原因不明で固まる」ように見える。
 * 症状が出るのは退避されたあとなので、実体で置かれた時点で止めるのが早い。
 */

import { lstatSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// vault のパスには空白が入る。pathname だと %20 のままになるので fileURLToPath を使う
const path = fileURLToPath(new URL("../node_modules", import.meta.url));

let stat;
try {
  stat = lstatSync(path);
} catch {
  console.error("node_modules がありません。npm install を実行してください。");
  process.exit(1);
}

// symlink なら中身は iCloud の外。実体ディレクトリで、かつ iCloud 配下ならまずい。
if (!stat.isSymbolicLink() && realpathSync(path).includes("/Mobile Documents/")) {
  console.error(`
✗ node_modules が iCloud 同期下に実体で置かれています。

  そのままだと iCloud がファイルをクラウドへ退避し、テストが理由もなく固まります。
  次で iCloud の外へ移してください（再インストールは不要）。

    mkdir -p ~/.cache/recipe-site-bff
    mv node_modules ~/.cache/recipe-site-bff/node_modules
    ln -s ~/.cache/recipe-site-bff/node_modules node_modules

  詳しくは README 冒頭。
`);
  process.exit(1);
}
