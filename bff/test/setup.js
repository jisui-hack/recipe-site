/*
 * jsdom 環境の補完。
 * add.js は起動時に localStorage を読む（GitHub 設定の復元）ので、
 * jsdom 側で用意されない場合に備えて最小限の実装を入れておく。
 */

if (typeof globalThis.localStorage === "undefined" || globalThis.localStorage == null) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => void store.set(String(k), String(v)),
    removeItem: (k) => void store.delete(String(k)),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
}
