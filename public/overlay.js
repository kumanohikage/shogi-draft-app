// 配信画面(OBS のブラウザソースで読み込む)
const C = window.DraftCore;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = (f) => (f ? `/images/${encodeURIComponent(f)}` : '');
let S = null, ws = null, rouletteReady = false, lastSpin = null;

/* 1920×1080 の舞台を窓に合わせる */
function fit() {
  const k = Math.min(innerWidth / 1920, innerHeight / 1080);
  $('stage').style.transform = `translate(${(innerWidth - 1920 * k) / 2}px, ${(innerHeight - 1080 * k) / 2}px) scale(${k})`;
}
addEventListener('resize', fit); fit();

// 管理画面に「配信画面が開いている(OBS か ブラウザか、OBS で映っているか)」を知らせる
const obs = window.obsstudio;
const presence = { obs: !!obs, visible: null, active: null };
const sendPresence = () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'hello', role: 'overlay', ...presence })); };
if (obs) {
  addEventListener('obsSourceVisibleChanged', (e) => { presence.visible = !!e.detail.visible; sendPresence(); });
  addEventListener('obsSourceActiveChanged', (e) => { presence.active = !!e.detail.active; sendPresence(); });
}
function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = sendPresence;
  ws.onclose = () => setTimeout(connect, 1000);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') { S = m.state; render(); }
  };
}

const hiddenPick = (p) => S.lottery && !S.lottery.done && p.playerId === S.lottery.playerId && p.by === 'lottery';
// 指名ボードの列の数(リーダー最大12人)。6人までは今までどおり
const cols = (n) => (n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : n === 9 ? 3 : 4);
// 入りきらないときだけ縮める(6人の見た目は変えない)
function fitArea(el) {
  el.style.zoom = 1;
  const box = el.parentElement, cs = getComputedStyle(box);
  const w = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const h = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  el.style.zoom = Math.min(1, w / el.offsetWidth, h / el.offsetHeight);
}

const { SE, BGM } = window.OverlayAudio;
let first = true; // 開いた直後(OBS の読み込み時)は演出・効果音なしで今の状態を出す

function render() {
  for (const k of ['board', 'teams', 'roulette']) $('sc-' + k).classList.toggle('on', S.scene === k);
  const audio = Object.assign({}, C.DEFAULT_AUDIO, S.audio);
  SE.setVolume(audio.seVol / 100);
  BGM.update(audio, S.scene === 'roulette');
  const f = $('roulette').contentWindow;
  if (f) {
    f.postMessage({ type: 'volume', v: audio.rlVol / 70 }, '*'); // 70 で以前の 100 と同じ大きさ
    f.postMessage({ type: 'silence', on: S.scene !== 'roulette' }, '*');
  }
  renderBoard(); renderTeams(); playLottery(false);
  first = false;
}

/* ---------- 指名ボード ---------- */
let prevOpen = new Set(), prevStamp = new Set(), prevDup = new Set();
// 指名カード1枚(指名ボードとピックアップで共通)
// wait: 裏面の下の文字(指名待ち / 選択希望選手 など)
function cardHtml(l, playerId, stamp, dup, pop, wait = '指名待ち') {
  const p = playerId && C.playerById(S, playerId);
  return `<div class="card ${playerId ? 'open' : ''} ${dup ? 'dup' : ''}" data-id="${l.id}" style="--c:${esc(l.color)}"><div class="in">
      <div class="face front"><div class="head">${l.icon ? `<img src="${img(l.icon)}">` : '<span class="ava"></span>'}<div class="tn">${esc(l.name)}</div></div>
        <div class="nm">${p && p.icon ? `<img src="${img(p.icon)}">` : ''}<b>${esc(p ? p.name : '')}</b></div>
        ${stamp ? `<div class="stamp ${stamp} ${pop ? 'pop' : ''}">${stamp === 'ok' ? '交渉権確定' : '競合'}</div>` : ''}</div>
      <div class="face back"><div class="who">${l.icon ? `<img src="${img(l.icon)}">` : ''}${esc(l.name)}</div><div class="koma">指</div><div class="wait">${esc(wait)}</div></div>
    </div></div>`;
}
// めくる: 裏の状態から少し待って表へ(3D はめくっている間だけ)
function flipIn(c, delay, sound) {
  c.classList.remove('open'); c.classList.add('anim');
  setTimeout(() => { c.classList.add('open'); setTimeout(() => c.classList.remove('anim'), 900); if (sound) SE.flip(); }, delay);
}

let prevSpot = null, prevSpotOpen = false;
function renderBoard() {
  $('board-title').innerHTML = `${esc(S.title)}<small>第${S.round}巡 指名選手</small>`;
  const g = $('grid');
  g.style.gridTemplateColumns = `repeat(${cols(S.leaders.length)}, 520px)`;
  const dupIds = new Set(C.conflicts(S).flatMap((c) => c.leaders));
  // ピックアップ公開中は、後ろの指名ボードは裏のまま(切り替えの途中でも中身が見えないように)
  const spotting = !!S.spot, endingSpot = !!prevSpot && !spotting && !first;
  const open = new Set(), stamped = new Set(), dups = new Set();
  const html = S.leaders.map((l) => {
    const pick = C.pickOf(S, l.id, S.round);
    const n = S.noms[l.id] || {};
    let playerId = null, stamp = '', dup = false;
    // 抽選の演出が終わるまでは、外れたリーダーも「競合」のまま見せる(先に指名待ちに戻るとネタバレになる)
    const inLottery = S.lottery && !S.lottery.done && S.lottery.leaders.includes(l.id);
    if (pick && !hiddenPick(pick)) { playerId = pick.playerId; stamp = 'ok'; }
    else if (inLottery) { playerId = S.lottery.playerId; stamp = 'dup'; dup = true; }
    else if (pick || (n.revealed && n.playerId)) {
      playerId = pick ? pick.playerId : n.playerId;
      // 1人ずつ公開の途中で、まだ重複していないものはハンコなし
      if (dupIds.has(l.id) || pick) { stamp = 'dup'; dup = true; }
    }
    if (spotting && !prevOpen.has(l.id)) { playerId = null; stamp = ''; dup = false; }
    if (stamp === 'ok') stamped.add(l.id);
    if (stamp === 'dup') dups.add(l.id);
    if (playerId) open.add(l.id);
    const isNew = stamp && !first && !(stamp === 'ok' ? prevStamp : prevDup).has(l.id) && (prevOpen.has(l.id) || endingSpot);
    // 一覧に戻ったときの競合の光は、判定が出そろってから
    if (endingSpot && isNew) dup = false;
    return cardHtml(l, playerId, stamp, dup, isNew);
  }).join('');
  g.innerHTML = html;
  // ピックアップに入るときは、ボードを一瞬で消す(フェードの途中で見えないように)
  if (spotting && !prevSpot) { g.style.transition = 'none'; g.classList.add('hide'); void g.offsetWidth; g.style.transition = ''; }
  g.classList.toggle('hide', spotting);
  const onBoard = S.scene === 'board' && !first;
  // めくれる瞬間を見せるため、いったん閉じた状態で描いてから順にめくる(開いた直後・ピックアップの前後はめくらない)
  const newly = first || spotting || endingSpot ? [] : [...open].filter((id) => !prevOpen.has(id));
  const cardOf = (id) => g.querySelector(`.card[data-id="${id}"]`);
  newly.forEach((id) => { const c = cardOf(id); c.classList.remove('open'); c.classList.add('anim'); });
  // 大きさの計算は、めくる前の状態にしてから(先に計算すると、開いた状態から一度裏返る動きが出る)
  fitArea(g);
  newly.forEach((id, i) => flipIn(cardOf(id), 120 + i * 260, onBoard));
  const after = 120 + newly.length * 260 + 450;
  if (endingSpot) {
    // 結果発表: 一覧を出してから、確定・競合のハンコを1枚ずつ。競合の「ジャーン」は出そろってから1回だけ
    const order = S.leaders.map((l) => l.id).filter((id) => g.querySelector(`.card[data-id="${id}"] .stamp.pop`));
    order.forEach((id, k) => {
      const d = 700 + k * 450;
      g.querySelector(`.card[data-id="${id}"] .stamp.pop`).style.animationDelay = d + 'ms';
      if (onBoard) setTimeout(() => SE.stamp(), d);
    });
    const end = 700 + order.length * 450 + 300;
    setTimeout(() => {
      dups.forEach((id) => cardOf(id)?.classList.add('dup'));
      if (onBoard && dups.size) SE.conflict();
    }, end);
  } else if (!spotting) {
    // めくり終わったあとに、競合なら「ジャーン」、確定なら「ドン」
    const newDup = [...dups].some((id) => !prevDup.has(id));
    const newStamp = [...stamped].some((id) => !prevStamp.has(id));
    g.querySelectorAll('.stamp.pop').forEach((e) => { e.style.animationDelay = after + 'ms'; });
    if (onBoard && newDup) setTimeout(() => SE.conflict(), after);
    else if (onBoard && newStamp) setTimeout(() => SE.stamp(), after);
  }
  renderSpot(onBoard);
  // ピックアップ中は、ボードの「前回」を進めない(一覧に戻ったときに、まとめて新しいものとして扱う)
  if (!spotting) { prevOpen = open; prevStamp = stamped; prevDup = dups; }
  prevSpot = S.spot;
}

// ピックアップ: 1人のカードを裏のまま大きく出す → 管理画面で「めくる」を押したらめくれる
function renderSpot(onBoard) {
  const sp = $('spot');
  sp.classList.toggle('on', !!S.spot);
  if (!S.spot) { prevSpotOpen = false; return; }
  const l = C.leaderById(S, S.spot), n = S.noms[S.spot] || {};
  if (!l) return;
  const isOpen = !!n.revealed;
  if (S.spot !== prevSpot) {
    // 次の人: 裏のカードを出す(もうめくってあれば表で)
    // ピックアップは指名が済んでいるので、裏はプロ野球の読み上げと同じ「第◯巡 選択希望選手」
    sp.innerHTML = `<div class="spotcard">${cardHtml(l, isOpen ? n.playerId : null, '', false, false, `第${S.round}巡 選択希望選手`)}</div>`;
    sp.querySelector('.spotcard').classList.add('enter');
  } else if (isOpen && !prevSpotOpen) {
    // めくる
    sp.querySelector('.spotcard').innerHTML = cardHtml(l, n.playerId, '', false, false);
    if (!first) flipIn(sp.querySelector('.card'), 0, onBoard);
  }
  prevSpotOpen = isOpen;
}

/* ---------- チーム表 ---------- */
let prevPicks = new Set();
function renderTeams() {
  $('teams-title').innerHTML = `${esc(S.title)}<small>${C.draftComplete(S) ? '全チーム決定' : `チーム編成（第${S.round}巡まで）`}</small>`;
  const t = $('teams');
  const n = S.leaders.length;
  t.style.gridTemplateColumns = `repeat(${n <= 6 ? n : Math.ceil(n / 2)}, 280px)`;
  const now = new Set();
  // 新しく入った名前は、チーム表を映したときに順にポンと出す
  const isNew = (key) => !first && S.scene === 'teams' && !prevPicks.has(key);
  let k = 0;
  t.innerHTML = S.leaders.map((l) => {
    const team = C.teamOf(S, l.id).filter((p) => !hiddenPick(p));
    const rows = Array.from({ length: S.rounds }, (_, i) => {
      const p = team.find((x) => x.round === i + 1);
      if (!p) return `<li class="empty"><span class="r">${i + 1}巡</span>―</li>`;
      const key = `${l.id}:${p.playerId}`; now.add(key);
      const pl = C.playerById(S, p.playerId);
      const d = isNew(key) ? k++ : -1;
      return `<li class="${d >= 0 ? 'new' : ''}" ${d >= 0 ? `style="animation-delay:${0.3 + d * 0.15}s"` : ''}><span class="r">${i + 1}巡</span>${pl && pl.icon ? `<img src="${img(pl.icon)}">` : ''}${esc(pl ? pl.name : '')}</li>`;
    }).join('');
    return `<div class="team" style="--c:${esc(l.color)}"><div class="th">${l.icon ? `<img src="${img(l.icon)}">` : '<span class="ava"></span>'}<div class="tn">${esc(l.name)}</div></div><ol>${rows}</ol></div>`;
  }).join('');
  for (let i = 0; i < k; i++) setTimeout(() => SE.pop(), 300 + i * 150);
  fitArea(t);
  if (first || S.scene === 'teams') prevPicks = now;
}

/* ---------- 抽選ルーレット ---------- */
function playLottery(force) {
  const L = S.lottery;
  if (!L || !rouletteReady || S.scene !== 'roulette') return;
  if (!force && (lastSpin === L.id || L.done)) return;
  lastSpin = L.id;
  const p = C.playerById(S, L.playerId);
  const leaders = L.leaders.map((id) => C.leaderById(S, id));
  const f = $('roulette').contentWindow;
  f.postMessage({ type: 'setup', pick: p ? p.name : '', image: p && p.icon ? img(p.icon) : '', leaders: leaders.map((l) => l.name), colors: leaders.map((l) => l.color) }, '*');
  setTimeout(() => f.postMessage({ type: 'spin', id: L.id, winner: L.leaders.indexOf(L.winner), plan: window.__recPlan || '' }, '*') /* __recPlan: 紹介動画の録画用 */, 700);
}
addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.type === 'roulette-ready') { rouletteReady = true; if (S) playLottery(false); }
  else if (m.type === 'roulette-done' && S && S.lottery && m.id === S.lottery.id && !S.lottery.done) ws.send(JSON.stringify({ type: 'action', action: { type: 'lotteryDone', id: m.id } }));
});

connect();
