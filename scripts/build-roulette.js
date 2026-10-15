// Web版「将棋ドラフト抽選ルーレットDX」から、アプリ用の埋め込みルーレット(public/roulette.html)を作る
// 使い方: node scripts/build-roulette.js [Web版の index.html のパス]
// Web 版を更新したら、これを流し直せば演出の更新を取り込める
const fs = require('fs');
const path = require('path');

const src = process.argv[2] || path.join(__dirname, '../../draft-roulette/dev/index.html');
let s = fs.readFileSync(src, 'utf8');
const rep = (a, b) => {
  if (s.split(a).length !== 2) throw new Error('見つからない(または複数): ' + a.slice(0, 80));
  s = s.replace(a, b);
};

// 埋め込みモードの印と、画面のボタン類を消す
rep('</style>', `  /* アプリ埋め込み: 操作UIは出さない */
  #ui, #perftip, #devbadge, #pv, #pv-badge, #settings { display: none !important; }
  #result { cursor: default; }
</style>`);

// 抽選の勝者はアプリから受け取る(アプリ側で公平に抽選済み)
rep('  const winner = PREVIEW ? previewWinner(n) : Math.floor(Math.random() * n);',
  '  // 埋め込み: 勝者はアプリ(サーバー)が抽選済みのものを使う\n  const winner = EMBED.winner;');

// ネットが無くても動くように、フォントと3D表示(three.js)はアプリに同梱したものを読む(scripts/vendor.js)
rep("<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=Noto+Sans+JP:wght@700;900&display=swap\" rel=\"stylesheet\">", "<!-- フォントはアプリに同梱(ネットが無くても表示できる) -->\n<link href=\"vendor/fonts/dela-gothic-one/font.css\" rel=\"stylesheet\">\n<link href=\"vendor/fonts/noto-sans-jp/font.css\" rel=\"stylesheet\">");
rep('"three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"', '"three": "./vendor/three/build/three.module.js"');
rep('"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"', '"three/addons/": "./vendor/three/examples/jsm/"');

// 「ボタンを押せ」「連打」は出さない(配信画面は OBS の中なので主催者が触れない)
rep('  const push = chance(PUSH_RATE[heat]);', '  const push = false; // アプリ埋め込み: PUSH 演出なし');
rep('    plan.push = true; plan.mash = true; plan.heat = \'rainbow\';', '    plan.push = false; plan.mash = false; plan.heat = \'rainbow\';');

// 効果音の音量はアプリの「効果音」音量に合わせる(window.__embedVol: 0〜1)
// ほかの画面に切り替えたら音を消す(window.__embedSilent)
rep('      this.master.gain.value = 0.75;', '      this.master.gain.value = window.__embedSilent ? 0 : 0.75 * (window.__embedVol ?? 1);');

// 評価値バーの色は「人数が変わったとき」しか作り直されないので、同じ人数で別のリーダーになると前の色が残る。色が変わったら作り直す
rep('  if (track.children.length !== P.length) {\n    track.textContent = \'\';',
  '  const colorKey = P.map((_, i) => leaderColor(i)).join();\n  if (track.dataset.colors !== colorKey) {\n    track.dataset.colors = colorKey;\n    track.textContent = \'\';');

// 演出の指定: short = 短い抽選演出(一発決着)。zenkai は紹介動画の録画用
rep('  const plan = PREVIEW ? previewPlan(winner, n) : planDraft(winner, n);', "  const plan = EMBED.plan === 'zenkai' ? zenkaiPlan() : EMBED.plan === 'short' ? { ...zenkaiPlan(), zenkaiten: false, ippatsu: true, heat: 'normal', heatPath: ['normal'] } : PREVIEW ? previewPlan(winner, n) : planDraft(winner, n);");

// 結果が出たらアプリに知らせる
rep('  showResult(winner);\n', '  showResult(winner);\n  parent.postMessage({ type: \'roulette-done\', id: EMBED.id }, \'*\');\n');

// 画面クリック・キー操作で回したり閉じたりしない
rep("$('btn-spin').addEventListener('click', startSpin);", '');
rep("$('result').addEventListener('click', closeResult);", '');
rep("canvas.addEventListener('click', (e) => {", "canvas.addEventListener('click_disabled', (e) => {");
rep("window.addEventListener('keydown', (e) => {\n  if (!$('settings').classList.contains('hidden'))",
  "window.addEventListener('keydown_disabled', (e) => {\n  if (!$('settings').classList.contains('hidden'))");

// 設定をブラウザに保存しない(アプリの名簿を使う)
rep('function saveDraft() {', 'function saveDraft() {\n  return true;');

// アプリからの指示を受け取る
rep("const PREVIEW = new URLSearchParams(location.search).has('preview');", `const PREVIEW = false;
/* ---------- アプリ埋め込み ----------
 * setup: { pick, image, leaders:[名前], colors:[色] }
 * spin:  { id, winner(leaders の番号) }
 */
const EMBED = { id: null, winner: 0 };
let embedQueue = Promise.resolve();
window.addEventListener('message', (e) => {
  const m = e.data || {};
  embedQueue = embedQueue.then(async () => {
    if (m.type === 'setup') {
      if (isSpinning) return;
      closeResult();
      draft = { pick: m.pick, leaders: m.leaders, image: m.image || '', crop: { x: 0, y: 0, zoom: 1 }, colors: m.colors, imgBg: '' };
      await document.fonts.load("100px 'Dela Gothic One'", m.leaders.join('') + m.pick).catch(() => {});
      await loadDraftImage();
      glossCache.clear();
      setMode('light', true);
      warmGlossy();
    } else if (m.type === 'spin') {
      if (isSpinning) return;
      closeResult();
      EMBED.id = m.id; EMBED.winner = m.winner; EMBED.plan = m.plan || '';
      startSpin();
    } else if (m.type === 'volume') {
      window.__embedVol = m.v;
      if (sound.master && !window.__embedSilent) sound.master.gain.value = 0.75 * m.v;
    } else if (m.type === 'silence') {
      // ルーレット以外の画面のときは音を消す(演出はそのまま進む)。戻ったら音量を戻す
      if (!!m.on === !!window.__embedSilent) return;
      window.__embedSilent = !!m.on;
      if (sound.master && sound.ctx) {
        const g = sound.master.gain, t = sound.ctx.currentTime;
        g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(m.on ? 0 : 0.75 * (window.__embedVol ?? 1), t + 0.4);
      }
    } else if (m.type === 'reset') {
      if (!isSpinning) closeResult();
    }
  });
});`);

// 準備ができたら親に知らせる
rep('  requestAnimationFrame(frame);\n  checkPerf();', "  requestAnimationFrame(frame);\n  parent.postMessage({ type: 'roulette-ready' }, '*');");

const out = path.join(__dirname, '../public/roulette.html');
fs.writeFileSync(out, s);
console.log('wrote', out);
