// 配信画面のテーマ(管理画面・配信画面・確認ページで共用)
// テーマで変わるのは配信画面だけ。3D の抽選(ルーレット・封筒・あみだ)はどのテーマでも同じ「光の世界」
//   css: themes/<id>.css(金はいまの見た目そのままなので無し) / bg: 3D の背景(bg3d.js。無ければ CSS の背景)
//   entry: 「抽選する」で光の世界へ入るときの切り替え = none | band(チームカラーの帯) | petals(花びら) | blackout(暗転) | shoji(障子)
//   teamColors: 配信画面の枠にリーダーの色を使う(くじの色を選ぶ画面ではいつも抑える)
//   neutral: チームカラーを使わないときの枠の色
//   words: 文言。{n} は巡の数、{kn} は漢数字(第一巡)
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
    gold: { name: '金の後光', desc: '金色の放射線。にぎやかで明るい', ready: true, entry: 'none', teamColors: false, neutral: '#5b4632' },
    sports: { name: 'スポーツ中継', desc: '紺のスタジアムに斜めの帯。チームカラーで熱く', ready: false, css: true, bg: true, entry: 'band', teamColors: true, neutral: '#1f3c88' },
    draft: { name: 'ドラフト会議', desc: '白と紺の会見場。明朝の指名カードで厳かに', ready: false, css: true, bg: true, entry: 'blackout', teamColors: false, neutral: '#1b2a4e',
      words: { board: '第{n}巡 選択希望選手' } },
    sakura: { name: '桜', desc: '舞い散る花びら。やわらかい桜色', ready: false, css: true, bg: true, entry: 'petals', teamColors: false, neutral: '#d9577f' },
    title: { name: 'タイトル戦', desc: '夜の対局室に金の粉。筆と明朝の和の装い', ready: false, css: true, bg: true, entry: 'shoji', teamColors: false, neutral: '#8a2b1f',
      words: { round: '第{kn}巡', board: '第{kn}巡 指名', wait: '第{kn}巡 指名中', spotWait: '第{kn}巡 選択希望選手', teams: '陣容（第{kn}巡まで）', teamsDone: '全陣容決定' } },
  };
  const DEFAULT = 'gold';
  const themeOf = (id) => THEMES[id] || THEMES[DEFAULT];
  const idOf = (id) => (THEMES[id] ? id : DEFAULT);
  // 文言: テーマで決めていなければ共通
  const KANJI = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const word = (id, key, n) => String((themeOf(id).words || {})[key] ?? WORDS[key] ?? key).replace(/\{n\}/g, n ?? '').replace(/\{kn\}/g, KANJI[n] ?? n ?? '');
  return { THEMES, WORDS, DEFAULT, themeOf, idOf, word };
}));
