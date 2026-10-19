// テーマの確認ページ: 配信画面の全部の場面を、ダミーの大会で順に出す(サーバーの状態は使わない・変えない)
// ?theme=<id> テーマ / ?mini 管理画面のテーマ選びに小さく出す(抽選の 3D なし・音なし・自動で回り続ける)
const C = window.DraftCore, T = window.DraftThemes;
const q = new URLSearchParams(location.search);
const MINI = q.has('mini');
const $ = (id) => document.getElementById(id);
// bare: 見出しや操作を出さない(画面を撮るとき)
if (MINI || q.has('bare')) document.body.classList.add('mini');

// 名前はどれも架空
const LEADERS = [['飛鳥 りく', '飛鳥'], ['角田 みお', '角田'], ['金森 はる', '金森'], ['銀河 そう', '銀河'], ['桂 なぎ', '桂'], ['香月 ゆい', '香月']];
const PLAYERS = ['香川 あおい', '桂木 ひかる', '銀山 ゆう', '金田 みこと', '飛田 そら', '角谷 れん', '王寺 あおい', '歩坂 ひかる', '香川 ゆう', '桂木 そら', '銀山 れん', '金田 あおい'];
const NOTES = ['初段', '居飛車党', '振り飛車党', '二段', '1級', '四間飛車', '三段', '角換わり', '相掛かり', '中飛車', '2級', '矢倉'];

let seed = 7;
const rng = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const A = (s, a) => C.apply(s, a, rng);

// 場面の台本: [名前, 状態を作る関数, 見せる秒数]
function script(themeId, lot) {
  seed = 7;
  let s = C.initialState();
  s.title = 'お試しドラフト会議';
  for (const [name, short] of LEADERS) s = A(s, { type: 'addLeader', name });
  s.leaders.forEach((l, i) => { l.short = LEADERS[i][1]; l.intro = ['前期王者', '初参加', '居飛車の鬼', '振り飛車一筋', '', 'リベンジに燃える'][i]; });
  s = A(s, { type: 'addPlayers', players: PLAYERS.map((name, i) => ({ name, note: NOTES[i] })) });
  s = A(s, { type: 'setOption', patch: { theme: themeId, lotteryModes: [lot, lot, lot], flowWait: false, flowStand: false, timerShow: true } });
  s.audio = Object.assign({}, s.audio, { bgm: '' });
  const P = s.players.map((p) => p.id), L = s.leaders.map((l) => l.id);
  const steps = [];
  const at = (name, sec, fn) => { s = fn(s); steps.push([name, s, sec]); };
  const prog = (type) => C.programOf(s).findIndex((g) => g.type === type);
  at('オープニング', 3, (x) => A(x, { type: 'progGo', idx: 0 }));
  at('資料', 3.5, (x) => A(x, { type: 'progGo', idx: 2 }));
  at('リーダー紹介', 3, (x) => A(x, { type: 'progGo', idx: prog('intro') }));
  at('巡の見出し', 3.5, (x) => A(x, { type: 'progGo', idx: prog('draft') }));
  at('指名ボード', 3, (x) => A(x, { type: 'roundStart' }));
  at('入札完了', 3, (x) => {
    // 1人目と2人目が同じ選手を指名(競合)。ほかは別々
    L.forEach((id, i) => { x = A(x, { type: 'nominate', leaderId: id, playerId: P[i === 1 ? 0 : i] }); });
    return A(x, { type: 'confirmNoms' });
  });
  at('一斉公開', 4.5, (x) => A(x, { type: 'reveal' }));
  if (!MINI) {
    at('くじの色を選ぶ', 2.5, (x) => A(x, { type: 'drawLottery', playerId: P[0] }));
    at('くじの色を選ぶ', 1.4, (x) => A(x, { type: 'lotPick', lot: 1 }));
    at('くじの色を選ぶ', 2, (x) => A(x, { type: 'lotPick', lot: 0 }));
    at('抽選', lot === 'wheel' ? 14 : lot === 'amida' ? 16 : 13, (x) => A(x, lot === 'wheel' ? { type: 'lotSpin' } : { type: 'lotOpen' }));
    at('抽選の結果', 3, (x) => { x = A(x, { type: 'lotteryDone', id: x.lottery.id }); return A(x, { type: 'setScene', scene: 'board' }); });
  }
  at('チーム表', 4, (x) => A(x, { type: 'setScene', scene: 'teams' }));
  at('エンディング', 3, (x) => A(x, { type: 'progGo', idx: prog('final') + 1 }));
  return steps;
}

let steps = [], idx = 0, timer = null, playing = true;
const themeSel = $('theme'), lotSel = $('lot');
themeSel.innerHTML = Object.entries(T.THEMES).map(([id, t]) => `<option value="${id}">${t.name}${t.ready ? '' : '（試作）'}</option>`).join('');
themeSel.value = T.idOf(q.get('theme'));
if (q.get('lot')) lotSel.value = q.get('lot');
$('sound').checked = q.has('sound');

function load() {
  const p = new URLSearchParams({ theme: themeSel.value });
  const src = `overlay.html?mock&theme=${themeSel.value}${$('sound').checked ? '&sound' : ''}${MINI ? '&lite' : ''}`;
  history.replaceState(null, '', `?${p}${MINI ? '&mini' : ''}${q.has('bare') ? '&bare' : ''}&lot=${lotSel.value}${$('sound').checked ? '&sound' : ''}`);
  steps = script(themeSel.value, lotSel.value);
  $('steps').innerHTML = steps.map(([name], i) => (i && steps[i - 1][0] === name ? '' : `<button type="button" data-i="${i}">${name}</button>`)).join('');
  $('ov').onload = () => go(0);
  $('ov').src = src;
}
function go(i) {
  clearTimeout(timer);
  idx = (i + steps.length) % steps.length;
  // 頭に戻るときは配信画面を開き直す(前の回の演出を残さない)
  if (idx === 0 && i !== 0) return load();
  $('ov').contentWindow.postMessage({ type: 'mock-state', state: steps[idx][1] }, '*');
  document.querySelectorAll('#steps button').forEach((b) => b.setAttribute('aria-pressed', String(steps[+b.dataset.i][0] === steps[idx][0])));
  if (playing) timer = setTimeout(() => go(idx + 1), steps[idx][2] * 1000);
}
$('steps').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) go(+b.dataset.i); });
$('play').addEventListener('click', () => { playing = !playing; $('play').setAttribute('aria-pressed', String(playing)); if (playing) go(idx + 1); else clearTimeout(timer); });
themeSel.addEventListener('change', load); lotSel.addEventListener('change', load); $('sound').addEventListener('change', load);

function fit() { const v = $('view'), k = v.clientWidth / 1920; $('ov').style.transform = `scale(${k})`; if (!document.body.classList.contains('mini')) v.style.height = `${1080 * k}px`; }
addEventListener('resize', fit); fit();
load();
