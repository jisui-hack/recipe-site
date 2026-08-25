/* Workers の crypto.subtle を使う小さなハッシュ関数群 */

const encoder = new TextEncoder();

export async function sha256Hex(input) {
  const data = typeof input === "string" ? encoder.encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function shortHash(input, length = 8) {
  return (await sha256Hex(input)).slice(0, length);
}

/** キーの順序に依存しない語彙のハッシュ。タグを1件足すと必ず変わる */
export async function hashVocabulary(vocabulary) {
  const canonical = Object.keys(vocabulary)
    .sort()
    .map((k) => `${k}:${[...vocabulary[k]].sort().join(",")}`)
    .join("|");
  return shortHash(canonical);
}
