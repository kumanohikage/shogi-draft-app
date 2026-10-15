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
const EXPORT = new URLSearchParams(location.search).get('export'); // 画像の書き出し用
const obs = window.obsstudio;
const presence = { obs: !!obs, visible: null, active: null };
const sendPresence = () => { if (!EXPORT && ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'hello', role: 'overlay', ...presence })); };
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
  const scene = EXPORT || S.scene;
  renderLook();
  sceneSwitch(scene);
  if (EXPORT) { document.querySelectorAll('.scene').forEach((e) => { e.style.transition = 'none'; }); renderBoard(); renderTeams(); return; }
  const audio = Object.assign({}, C.DEFAULT_AUDIO, S.audio);
  SE.setVolume(audio.seVol / 100);
  BGM.update(audio, S.scene === 'roulette');
  const f = $('roulette').contentWindow;
  if (f) {
    f.postMessage({ type: 'volume', v: audio.rlVol / 70 }, '*'); // 70 で以前の 100 と同じ大きさ
    f.postMessage({ type: 'silence', on: S.scene !== 'roulette' }, '*');
  }
  renderBoard(); renderTeams(); renderWait(); renderTimer(); renderLogo(); renderSlide(); renderIntro(); playLottery(false);
  first = false;
}

/* ---------- 場面の切り替え ----------
 * 進行表の場面が変わったときだけ、設定のトランジションで切り替える(ドラフト中のボード・ルーレット・チーム表は一瞬で) */
const SCENES = ['board', 'teams', 'roulette', 'wait', 'logo', 'slide', 'intro'];
let shown = null, prevProg = null, transBusy = false;
function showScene(scene) { shown = scene; for (const k of SCENES) $('sc-' + k).classList.toggle('on', scene === k); }
function sceneSwitch(scene) {
  const prog = C.progIdxOf(S), progChanged = prevProg !== null && prog !== prevProg;
  prevProg = prog;
  if (transBusy) return; // 切り替えの途中: 入れ替えるときに最新の場面を出す
  const o = C.optionsOf(S);
  // 動画は先に読み込んでおく(押してから待たないように)
  const v = $('trans-video');
  if (o.transition === 'video' && o.transVideo && !v.src.endsWith(encodeURIComponent(o.transVideo))) v.src = img(o.transVideo);
  if (EXPORT || first || !progChanged || scene === shown || o.transition === 'none') return showScene(scene);
  runTransition(o);
}
const cur = () => EXPORT || S.scene;
const later = (ms) => new Promise((r) => setTimeout(r, ms));
async function runTransition(o) {
  transBusy = true;
  const ms = Math.round((o.transSec || 0.6) * 1000);
  // 出ていく場面は写しを取って、それを動かす(本物はすぐ次の内容に描き変わるので)
  const orig = shown && $('sc-' + shown);
  let ghost = null;
  if (orig && shown !== 'roulette') {
    ghost = orig.cloneNode(true);
    ghost.removeAttribute('id'); ghost.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
    orig.parentNode.insertBefore(ghost, orig);
  }
  const swap = () => { if (ghost) { ghost.remove(); ghost = null; } showScene(cur()); };
  showScene(null); if (ghost) ghost.classList.add('on');
  try {
    if (o.transition === 'fadeBlack' || o.transition === 'fadeWhite') {
      // 色で覆ってから入れ替えて、また開ける(半透明で重ねないので透けない)
      const t = $('trans');
      t.style.background = o.transition === 'fadeWhite' ? '#fff' : '#000';
      t.style.transition = `opacity ${ms / 2}ms ease-in`; t.style.opacity = 1;
      await later(ms / 2);
      swap();
      t.style.transition = `opacity ${ms / 2}ms ease-out`; t.style.opacity = 0;
      await later(ms / 2);
    } else if (o.transition === 'slide' || o.transition === 'wipe') {
      const next = cur(), to = $('sc-' + next);
      if (!to) return swap(); // 何も出さない場面へ
      const ease = 'cubic-bezier(.6,0,.3,1)';
      to.classList.add('on', 't-top');
      to.style.animation = `${o.transition === 'slide' ? 'tSlideIn' : 'tWipe'} ${ms}ms ${ease} both`;
      if (ghost && o.transition === 'slide') ghost.style.animation = `tSlideOut ${ms}ms ${ease} both`;
      await later(ms);
      to.style.animation = ''; to.classList.remove('t-top');
      swap();
    } else if (o.transition === 'video' && o.transVideo) {
      // 動画を流して、決めた秒数(なければ長さの半分)で後ろの場面を入れ替える
      const v = $('trans-video');
      if (!v.src.endsWith(encodeURIComponent(o.transVideo))) v.src = img(o.transVideo);
      if (!(v.duration > 0)) await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 3000); });
      if (!(v.duration > 0)) return swap(); // 読めない動画は切り替えだけ
      const cut = o.transCut > 0 ? Math.min(o.transCut, v.duration) : v.duration / 2;
      v.currentTime = 0; v.volume = Math.min(1, Object.assign({}, C.DEFAULT_AUDIO, S.audio).seVol / 100);
      v.style.display = 'block';
      await v.play().catch(() => {});
      await later(cut * 1000);
      swap();
      await new Promise((r) => { if (v.ended) r(); v.onended = r; setTimeout(r, Math.max(0, (v.duration - cut) * 1000 + 500)); });
      v.style.display = 'none'; v.pause();
    } else swap();
  } finally {
    if (ghost) ghost.remove();
    transBusy = false;
    if (shown !== cur()) showScene(cur()); // 切り替えの途中でまた場面が変わっていたら合わせる
  }
}

/* ---------- 指名ボード ---------- */
let prevOpen = new Set(), prevStamp = new Set(), prevDup = new Set();
// 指名カード1枚(指名ボードとピックアップで共通)
// wait: 裏面の下の文字(指名待ち / 選択希望選手 など)
function cardHtml(l, playerId, stamp, dup, pop, wait = '指名待ち') {
  const p = playerId && C.playerById(S, playerId);
  return `<div class="card ${playerId ? 'open' : ''} ${dup ? 'dup' : ''}" data-id="${l.id}" style="--c:${esc(l.color)}"><div class="in">
      <div class="face front"><div class="head">${l.icon ? `<img src="${img(l.icon)}">` : '<span class="ava"></span>'}<div class="tn">${esc(C.teamLabel(S, l))}</div></div>
        <div class="nm">${p && p.icon ? `<img src="${img(p.icon)}">` : ''}<div class="nmt"><b>${esc(p ? p.name : '')}</b>${p && p.note ? `<small>${esc(p.note)}</small>` : ''}</div></div>
        ${stamp ? `<div class="stamp ${stamp} ${pop ? 'pop' : ''}">${stamp === 'ok' ? '交渉権確定' : '競合'}</div>` : ''}</div>
      <div class="face back"><div class="who">${l.icon ? `<img src="${img(l.icon)}">` : ''}${esc(C.teamLabel(S, l))}</div><div class="koma">指</div><div class="wait">${esc(wait)}</div></div>
    </div></div>`;
}
// めくる: 裏の状態から少し待って表へ(3D はめくっている間だけ)
function flipIn(c, delay, sound) {
  c.classList.remove('open'); c.classList.add('anim');
  setTimeout(() => { c.classList.add('open'); setTimeout(() => c.classList.remove('anim'), 900); if (sound) SE.flip(); }, delay);
}

let prevSpot = null, prevSpotOpen = false;
function renderBoard() {
  $('board-title').innerHTML = titleHtml(`第${S.round}巡 指名選手`);
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
let prevStandKey = '', spotCardFor = null; // spotCardFor: いま大きいカードを出しているリーダー
function renderSpot(onBoard) {
  const sp = $('spot'), stand = $('stand');
  const showStand = !!S.spot && !!S.spotStand && !(S.noms[S.spot] || {}).revealed;
  const sk = showStand ? S.spot : '';
  if (sk !== prevStandKey) {
    const l = showStand && C.leaderById(S, S.spot);
    stand.innerHTML = l ? standHtml(l, `第${S.round}巡 選択希望選手`) : '';
    // 指名発表の前の立ち絵は動きなしで出す
    prevStandKey = sk;
  }
  stand.classList.toggle('on', showStand);
  $('sc-board').classList.toggle('standon', showStand);
  sp.classList.toggle('on', !!S.spot && !showStand);
  if (showStand) { spotCardFor = null; prevSpotOpen = false; return; } // 立ち絵のあとにカードを出すときは、新しく出す扱い
  if (!S.spot) { spotCardFor = null; prevSpotOpen = false; return; }
  const l = C.leaderById(S, S.spot), n = S.noms[S.spot] || {};
  if (!l) return;
  const isOpen = !!n.revealed;
  if (S.spot !== spotCardFor) {
    spotCardFor = S.spot;
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

/* ---------- 見た目(背景・ロゴ)と、番組の場面(ロゴ・資料・リーダー紹介) ---------- */
// 見出し: ロゴがあればロゴ、なければ大会名の文字
function titleHtml(small) {
  const o = C.optionsOf(S);
  return `${C.useLogo(S) ? `<img class="logo" src="${img(o.logoImage)}" alt="${esc(S.title)}">` : esc(S.title)}${small ? `<small>${esc(small)}</small>` : ''}`;
}
function renderLook() {
  const o = C.optionsOf(S), st = $('stage');
  st.classList.toggle('hasbg', !!o.bgImage);
  st.style.setProperty('--bgimg', o.bgImage ? `url("${img(o.bgImage)}")` : 'none');
}
function renderLogo() {
  const o = C.optionsOf(S);
  $('logo-big').innerHTML = C.useLogo(S) ? `<img src="${img(o.logoImage)}" alt="${esc(S.title)}">` : `<b>${esc(S.title)}</b>`;
}
// 資料: 進行表のいまの場面の資料(文字 or 画像)
let prevSlideKey = '';
function renderSlide() {
  const g = C.progItem(S), sl = g && g.type === 'slide' ? C.slideById(S, g.slideId) : null;
  const key = JSON.stringify(sl);
  if (key === prevSlideKey) return;
  prevSlideKey = key;
  if (!sl) { $('slide-title').innerHTML = ''; $('slide-body').innerHTML = ''; return; }
  if (sl.kind === 'image') {
    $('slide-title').innerHTML = '';
    $('slide-body').innerHTML = sl.image ? `<div class="slideimg"><img src="${img(sl.image)}" alt=""></div>` : '';
  } else {
    $('slide-title').innerHTML = titleHtml('');
    $('slide-body').innerHTML = `<div class="slidebox"><h2>${esc(sl.title)}</h2><ul>${(sl.lines || []).filter((x) => x.trim()).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    fitSlide();
    document.fonts.ready.then(fitSlide); // フォントの読み込みで大きさが変わるので、読み込み後にもう一度
  }
}
// 文字の資料: パネルに入りきらないときは、入るまで文字を少しずつ縮める(半分まで)
function fitSlide() {
  const box = document.querySelector('#slide-body .slidebox');
  if (!box) return;
  let k = 1;
  box.style.setProperty('--k', k);
  while (box.scrollHeight > box.clientHeight + 1 && k > 0.5) { k = Math.round((k - 0.04) * 100) / 100; box.style.setProperty('--k', k); }
}
// 立ち絵＋名前の帯(＋紹介文 / 「第◯巡 選択希望選手」)。立ち絵が無ければアイコンを大きく丸で
// 帯の名前: リーダー紹介はフルネーム、ほかは「チーム＋略称」
function standHtml(l, tag, full) {
  return `<div class="standwrap" style="--c:${esc(l.color)}">
    ${l.stand ? `<img class="stand" src="${img(l.stand)}" alt="">` : `<img class="standicon" src="${l.icon ? img(l.icon) : ''}" alt="">`}
    ${tag ? `<div class="tag">${esc(tag)}</div>` : ''}
    <div class="band">${esc(full ? l.name : C.teamLabel(S, l))}</div></div>`;
}
let prevIntro = '';
function renderIntro() {
  const l = S.leaders[Math.min(S.introIdx || 0, S.leaders.length - 1)];
  const key = l ? JSON.stringify([l, C.optionsOf(S).teamPrefix]) : '';
  if (key === prevIntro) return;
  prevIntro = key;
  $('intro-body').innerHTML = l ? standHtml(l, l.intro || '', true) : '';
  const w = $('intro-body').querySelector('.standwrap');
  if (w && !first && S.scene === 'intro') w.classList.add('enter'); // リーダー紹介は1人ずつ下から出す
}

/* ---------- 待ち時間・制限時間 ---------- */
function renderWait() {
  const o = C.optionsOf(S);
  $('wait-title').innerHTML = titleHtml(`第${S.round}巡 指名中`);
  const list = C.waitImagesOf(S), f = list[Math.min(S.waitIdx || 0, list.length - 1)];
  $('wait-img').setAttribute('src', f ? img(f) : '');
}
function renderTimer() {
  if (!S) return;
  const o = C.optionsOf(S), t = S.timer || {};
  const left = t.endsAt ? Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000)) : t.left ?? o.timerSec;
  const active = !!t.endsAt || t.left != null; // 動いている or 止めてある
  const text = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const end = !!t.endsAt && left === 0;
  for (const el of [$('board-timer'), $('wait-timer')]) {
    el.textContent = text;
    el.classList.toggle('on', o.timerShow && active && !S.spot);
    el.classList.toggle('end', end);
  }
}
setInterval(renderTimer, 250);

/* ---------- チーム表 ---------- */
let prevPicks = new Set();
function renderTeams() {
  $('teams-title').innerHTML = titleHtml(C.draftComplete(S) ? '全チーム決定' : `チーム編成（第${S.round}巡まで）`);
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
    return `<div class="team" style="--c:${esc(l.color)}"><div class="th">${l.icon ? `<img src="${img(l.icon)}">` : '<span class="ava"></span>'}<div class="tn">${esc(C.teamLabel(S, l))}</div></div><ol>${rows}</ol></div>`;
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
  f.postMessage({ type: 'setup', pick: p ? p.name : '', image: p && p.icon ? img(p.icon) : '', leaders: leaders.map((l) => C.teamLabel(S, l)), colors: leaders.map((l) => l.color) }, '*');
  setTimeout(() => f.postMessage({ type: 'spin', id: L.id, winner: L.leaders.indexOf(L.winner), plan: window.__recPlan || (C.optionsOf(S).lotteryStyle === 'short' ? 'short' : '') }, '*') /* __recPlan: 紹介動画の録画用 */, 700);
}
addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.type === 'roulette-ready') { rouletteReady = true; if (S) playLottery(false); }
  else if (m.type === 'roulette-done' && S && S.lottery && m.id === S.lottery.id && !S.lottery.done) ws.send(JSON.stringify({ type: 'action', action: { type: 'lotteryDone', id: m.id } }));
});

connect();
