/*
 * デプロイしようとしている中身が、公開したい状態かを確かめる。
 *
 * **実際にこれで事故を起こした。** 機能ブランチで PR を出したあと、
 * 別作業のために main へ切り替えて deploy したところ、
 * まだ main に入っていなかったプロンプトの変更が本番から消えた。
 * 「テストが通る」ことと「公開してよい中身である」ことは別。
 *
 * 止めるのは3つだけ。
 *   1. main 以外にいる（機能ブランチのまま出そうとしている）
 *   2. origin/main より遅れている（誰かの変更を巻き戻す）
 *   3. コミットしていない変更がある（手元だけの状態を出してしまう）
 *
 * 意図してやるなら DEPLOY_ANYWAY=1 を付ける。
 */

import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

if (process.env.DEPLOY_ANYWAY === "1") {
  console.log("! DEPLOY_ANYWAY=1 が指定されているので確認を飛ばします");
  process.exit(0);
}

const problems = [];

let branch = "";
try {
  branch = git("rev-parse", "--abbrev-ref", "HEAD");
} catch {
  console.log("! git の外なので確認を飛ばします");
  process.exit(0);
}

if (branch !== "main") {
  problems.push(`いま ${branch} にいます。本番に出すのは main の中身にしてください。`);
}

try {
  execFileSync("git", ["fetch", "--quiet", "origin", "main"], { stdio: "ignore" });
  const behind = Number(git("rev-list", "--count", "HEAD..origin/main"));
  if (behind > 0) {
    problems.push(`origin/main より ${behind} コミット遅れています。git pull してください。`);
  }
} catch {
  console.log("! origin を確認できませんでした（オフライン？）。先へ進みます");
}

const dirty = git("status", "--porcelain");
if (dirty) {
  const files = dirty.split("\n").slice(0, 5).map((l) => "    " + l.trim());
  problems.push(`コミットしていない変更があります。\n${files.join("\n")}`);
}

if (problems.length) {
  console.error("\n✗ この状態でデプロイすると、公開中の動きが意図せず変わります。\n");
  for (const p of problems) console.error("  - " + p);
  console.error(`
  直してから、もう一度:
    git switch main && git pull && npm run deploy

  分かったうえで出すなら:
    DEPLOY_ANYWAY=1 npm run deploy
`);
  process.exit(1);
}

console.log(`✓ main / origin/main と同じ / 未コミットなし`);
