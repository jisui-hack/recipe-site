#!/usr/bin/env node
/*
 * ホーム画面用のアイコンを作る。
 *
 *   node tools/make-icons.mjs
 *
 * **依存を増やさないために PNG を直接書いている。**
 * 画像ライブラリを1つ入れると、そのために npm install が要るようになる。
 * 描くのは皿1枚だけなので、それに見合わない。
 *
 * 色はサイトのパレット（app.css）と同じもの。
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../public/assets");

const BG = [0xf7, 0xf3, 0xe6]; // --bg クリーム
const PLATE = [0x2c, 0x6e, 0x4f]; // --accent 深緑
const RIM = [0xef, 0xe7, 0xd3]; // --surface-warm

/** 円の内側か。境目は少し滑らかにする（ジャギーが目立つので） */
function coverage(dx, dy, r) {
  const d = Math.hypot(dx, dy);
  if (d <= r - 0.5) return 1;
  if (d >= r + 0.5) return 0;
  return r + 0.5 - d;
}

function mix(base, over, a) {
  return base.map((c, i) => Math.round(c * (1 - a) + over[i] * a));
}

function render(size) {
  const c = size / 2 - 0.5;
  const outer = size * 0.42; // 皿
  const inner = size * 0.30; // 内側のふち
  const px = [];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      let color = BG;
      color = mix(color, PLATE, coverage(dx, dy, outer));
      color = mix(color, RIM, coverage(dx, dy, inner));
      px.push(color);
    }
  }
  return px;
}

/* ---------- PNG を組み立てる ---------- */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 2; // トゥルーカラー
  // 10..12 は圧縮/フィルタ/インタレース。すべて 0

  // 各行の先頭にフィルタ種別のバイトが要る（0 = なし）
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixels[y * size + x];
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [180, 192, 512]) {
  const file = join(OUT, `icon-${size}.png`);
  writeFileSync(file, png(size, render(size)));
  console.log(`${file} を作りました`);
}
