/* レシピ一覧：タイトル・材料名で検索、並び順の切り替え */

import { byNewest, byShortest, loadIndex, matchesQuery, renderCard } from "./common.js";

const state = { index: [], query: "", sort: "new" };

function render() {
  const list = state.index
    .filter((r) => matchesQuery(r, state.query))
    .sort(state.sort === "time" ? byShortest : byNewest);

  document.getElementById("list-heading").textContent = state.query
    ? `検索結果（${list.length}件）`
    : `レシピ一覧（${list.length}件）`;

  const status = document.getElementById("status");
  status.hidden = list.length > 0;
  status.textContent = "見つかりませんでした。";

  document.getElementById("card-list").replaceChildren(...list.map((r) => renderCard(r)));
}

/** 将来のnote連携用フック（初期は何もしない） */
function renderNoteFeed() {}

async function main() {
  const status = document.getElementById("status");
  try {
    state.index = (await loadIndex()).sort(byNewest);
    if (!state.index.length) {
      status.textContent = "まだレシピがありません。";
      return;
    }
    document.getElementById("search").addEventListener("input", (e) => {
      state.query = e.target.value;
      render();
    });
    for (const radio of document.querySelectorAll('input[name="sort"]')) {
      radio.addEventListener("change", () => {
        state.sort = radio.value;
        render();
      });
    }
    render();
    renderNoteFeed();
  } catch (err) {
    status.textContent = `読み込みに失敗しました: ${err.message}`;
  }
}

main();
