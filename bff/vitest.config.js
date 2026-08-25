import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.js"],
    // iCloud は同期が競合すると「node_modules 2」のような複製を作る。
    // 既定の除外は "node_modules" しか見ないので、複製の中のテストを拾って
    // 大量に FAIL する。番号付きもまとめて外す。
    exclude: ["**/node_modules/**", "**/node_modules [0-9]*/**", "**/dist/**", "**/.wrangler/**"],
    // jsdom のテストは beforeEach で add.js / ai-mapper.js を動的 import する。
    // キャッシュが冷えている初回はここが既定の 10 秒を超えることがある。
    hookTimeout: 30_000,
    testTimeout: 15_000,
    environmentOptions: {
      // localStorage は opaque origin では使えない。add.js が設定の読み書きに使うので
      // 実際のページと同じような URL を与えておく
      jsdom: { url: "http://localhost:3000/add.html" },
    },
  },
});
