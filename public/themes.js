// 配信画面のテーマ(管理画面・配信画面・確認ページで共用)
// テーマで変わるのは配信画面だけ。3D の抽選(ルーレット・封筒・あみだ)はどのテーマでも同じ「光の世界」
//   css: themes/<id>.css(金はいまの見た目そのままなので無し) / bg: 3D の背景(bg3d.js。無ければ CSS の背景)
//   entry: 「抽選する」で光の世界へ入るときの切り替え = none | band(チームカラーの帯) | petals(花びら) | blackout(暗転) | shoji(障子)
//   teamColors: 配信画面の枠にリーダーの色を使う(くじの色を選ぶ画面ではいつも抑える)
//   words: 文言。{n} は巡の数
//   ready: 選べるテーマ(確認ページでは全部見られる)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DraftThemes = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const WORDS = {
    round: '第{n}巡', roundBand: '指名開始',
    board: '第{n}巡 指名選手', wait: '第{n}巡 指名中',
    allin: '入札完了', allinRenom: '再指名 入札完了',
    cardWait: '指名待ち', spotWait: '第{n}巡 選択希望選手',
    stampOk: '交渉権確定', stampDup: '競合',
    lots: '交渉権の抽選',
    teams: 'チーム編成（第{n}巡まで）', teamsDone: '全チーム決定',
  };
  const THEMES = {
    gold: { name: '金の後光', desc: '金色の放射線。にぎやかで明るい', ready: true, entry: 'none', teamColors: false },
  };
  const DEFAULT = 'gold';
  const themeOf = (id) => THEMES[id] || THEMES[DEFAULT];
  const idOf = (id) => (THEMES[id] ? id : DEFAULT);
  // 文言: テーマで決めていなければ共通
  const word = (id, key, n) => String((themeOf(id).words || {})[key] ?? WORDS[key] ?? key).replace(/\{n\}/g, n ?? '');
  return { THEMES, WORDS, DEFAULT, themeOf, idOf, word };
}));
