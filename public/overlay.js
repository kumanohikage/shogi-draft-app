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
// 管理画面の本番ビューに小さく出すプレビュー: 音を出さない・配信画面として数えない・抽選の完了を送らない
const PREVIEW = new URLSearchParams(location.search).has('preview');
const PREVIEW_NEXT = new URLSearchParams(location.search).get('preview') === 'next';
// 次のプレビュー: オレンジのボタンを押したあとの画面(押せないときは進行表の次の場面)
function nextView(s) {
  try {
    const n = window.DraftFlow.nextStep(s), a = n.main && !n.main.off && window.DraftFlow.actionFor(n.main.key, n.main.arg, s);
    if (a) { const v = C.apply(s, a, () => 0); v.lottery = v.lottery && { ...v.lottery, done: false }; return v; }
  } catch (e) { /* 進めない操作は、進行表の次の場面で */ }
  const prog = C.programOf(s), i = C.progIdxOf(s), g = prog[i], k = s.introIdx || 0;
  if (g && g.type === 'intro' && k < s.leaders.length - 1) return { ...s, introIdx: k + 1, scene: 'intro' };
  const n = prog[i + 1];
  if (!n) return { ...s, scene: 'blank' };
  const v = { ...s, progIdx: i + 1, introIdx: 0, spot: null, spotStand: false, lottery: null };
  v.scene = C.sceneForItem(v, n);
  return v;
}
const obs = window.obsstudio;
const presence = { obs: !!obs, visible: null, active: null };
const sendPresence = () => { if (!EXPORT && !PREVIEW && ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'hello', role: 'overlay', ...presence })); };
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
    if (m.type === 'state') { S = PREVIEW_NEXT ? nextView(m.state) : m.state; render(); }
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
  SE.setVolume(PREVIEW ? 0 : audio.seVol / 100);
  const drawing = S.scene === 'roulette' || (S.scene === 'lots' && S.lottery && S.lottery.phase === 'reveal');
  BGM.update(PREVIEW ? { ...audio, bgmOn: false } : { ...audio, bgm: C.sceneBgm(S) }, drawing);
  const f = $('roulette').contentWindow;
  if (f) {
    f.postMessage({ type: 'volume', v: PREVIEW ? 0 : audio.rlVol / 70 }, '*'); // 70 で以前の 100 と同じ大きさ
    f.postMessage({ type: 'silence', on: S.scene !== 'roulette' }, '*');
  }
  lots3dVolume(audio);
  renderBoard(); renderTeams(); renderWait(); renderTimer(); renderLogo(); renderSlide(); renderIntro(); renderRound(); renderAllIn(); renderLots(); playLottery(false);
  first = false;
}

/* ---------- 場面の切り替え ----------
 * 進行表の場面が変わったときだけ、設定のトランジションで切り替える(ドラフト中のボード・ルーレット・チーム表は一瞬で) */
const SCENES = ['board', 'teams', 'roulette', 'wait', 'logo', 'slide', 'intro', 'round', 'allin', 'lots'];
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
  if (EXPORT || PREVIEW || first || scene === shown) return showScene(scene);
  // 進行表の場面が変わったら設定のトランジション、それ以外(ボード ⇔ チーム表 など)は短いフェード
  if (progChanged && o.transition !== 'none') return runTransition(o);
  if (o.fadeSec > 0) return runTransition({ ...o, transition: 'fade', transSec: o.fadeSec });
  showScene(scene);
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
    } else if (o.transition === 'fade') {
      // 次の場面を上に重ねて浮かび上がらせる(下の場面は最後まで出したままなので透けない)
      const to = $('sc-' + cur());
      if (to) { to.classList.add('on', 't-top'); to.style.animation = `tFadeIn ${ms}ms ease both`; await later(ms); to.style.animation = ''; to.classList.remove('t-top'); }
      else if (ghost) { ghost.style.animation = `tFadeOut ${ms}ms ease both`; await later(ms); } // 何も出さない: 消えていく
      swap();
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
      v.currentTime = 0; v.volume = PREVIEW ? 0 : Math.min(1, Object.assign({}, C.DEFAULT_AUDIO, S.audio).seVol / 100); v.muted = PREVIEW;
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
const NEUTRAL = '#5b4632';
const lc = (l) => (C.optionsOf(S).leaderColors ? l.color : NEUTRAL);
function cardHtml(l, playerId, stamp, dup, pop, wait = '指名待ち') {
  const p = playerId && C.playerById(S, playerId);
  return `<div class="card ${playerId ? 'open' : ''} ${dup ? 'dup' : ''}" data-id="${l.id}" style="--c:${esc(lc(l))}"><div class="in">
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
    const full = sl.fit === 'full';
    $('slide-title').innerHTML = full ? '' : titleHtml('');
    $('slide-body').innerHTML = !sl.image ? '' : full ? `<div class="slideimg"><img src="${img(sl.image)}" alt=""></div>` : `<div class="slidecard"><img src="${img(sl.image)}" alt=""></div>`;
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
  return `<div class="standwrap" style="--c:${esc(lc(l))}">
    ${l.stand ? `<img class="stand" src="${img(l.stand)}" alt="" style="--sk:${+l.standScale || 1};--sx:${+l.standX || 0}px;--sy:${+l.standY || 0}px">` : `<img class="standicon" src="${l.icon ? img(l.icon) : ''}" alt="">`}
    ${tag ? `<div class="tag">${esc(tag)}</div>` : ''}
    <div class="band">${esc(full ? l.name : C.teamLabel(S, l))}</div></div>`;
}
// 出揃いました: 一斉入札で全員の指名がそろった(再指名のときは「再指名」)
let prevAllInKey = '';
function renderAllIn() {
  const renom = S.picks.some((p) => p.round === S.round) || S.lotteries.some((x) => x.round === S.round);
  $('allin-head').innerHTML = titleHtml('');
  $('allin-sub').textContent = `第${S.round}巡 ${renom ? '再指名' : '選択希望選手'}`;
  const key = S.scene === 'allin' ? `${S.round}:${S.confirmedKey}` : '';
  if (key && key !== prevAllInKey && !first) { const b = $('allin-big'); b.classList.remove('enter'); void b.offsetWidth; b.classList.add('enter'); }
  prevAllInKey = key;
}
// 巡の見出し: 「第◯巡」と指名のしかた
let prevRoundKey = '';
function renderRound() {
  const o = C.optionsOf(S), order = C.roundMode(S) === 'order';
  $('round-head').innerHTML = titleHtml('');
  $('round-no').textContent = `第${S.round}巡`;
  $('round-mode').textContent = order ? `順番指名（${o.orderStyle === 'waiver' ? 'ウェーバー' : 'スネーク'}）` : '一斉入札';
  const key = S.scene === 'round' ? `${S.round}` : '';
  if (key && key !== prevRoundKey && !first) { const b = $('round-big'); b.classList.remove('enter'); void b.offsetWidth; b.classList.add('enter'); }
  prevRoundKey = key;
}
let prevIntro = '', prevIntroOn = false;
function renderIntro() {
  const l = S.leaders[Math.min(S.introIdx || 0, S.leaders.length - 1)];
  const key = l ? JSON.stringify([l, C.optionsOf(S).teamPrefix]) : '';
  const entering = S.scene === 'intro' && !prevIntroOn; // リーダー紹介に入った瞬間(最初の人)も演出する
  prevIntroOn = S.scene === 'intro';
  if (key === prevIntro && !entering) return;
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
    // 指名を待っている間だけ出す(公開の結果・抽選・チーム表では消す)
    const nominating = C.pendingLeaders(S).some((l) => !(S.noms[l.id] || {}).revealed);
    el.classList.toggle('on', o.timerShow && active && !S.spot && nominating);
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
    return `<div class="team" style="--c:${esc(lc(l))}"><div class="th">${l.icon ? `<img src="${img(l.icon)}">` : '<span class="ava"></span>'}<div class="tn">${esc(C.teamLabel(S, l))}</div></div><ol>${rows}</ol></div>`;
  }).join('');
  for (let i = 0; i < k; i++) setTimeout(() => SE.pop(), 300 + i * 150);
  fitArea(t);
  if (first || S.scene === 'teams') prevPicks = now;
}

/* ---------- くじ: 選ぶ → 封筒を開ける / あみだをたどる ----------
 * くじは番号順に並べる。選んだリーダーの名前をくじの下に出す。開けるのは選んだ順(リーダーの並び順) */
let lotsPrev = { id: null, picked: 0, opened: 0, phase: '' };
function renderLots() {
  const L = S.lottery;
  if (!L || !L.lots) { if (lotsPrev.id) { $('lots-body').innerHTML = ''; lotsPrev = { id: null, picked: 0, opened: 0, phase: '' }; } return; }
  const p = C.playerById(S, L.playerId);
  const owner = (i) => L.leaders.find((id) => L.picks[id] === i);
  const picked = Object.keys(L.picks).length, fresh = lotsPrev.id !== L.id;
  const live = S.scene === 'lots' && !first;
  $('lots-title').innerHTML = titleHtml('交渉権の抽選');
  $('lots-head').innerHTML = `${p && p.icon ? `<img src="${img(p.icon)}" alt="">` : ''}<span class="pn">${esc(p ? p.name : '')}</span><span class="pk">${L.leaders.length}チームが競合</span>`;
  // 下の帯: いま選ぶ人 / 開ける人 / 結果
  const who = L.leaders.find((id) => L.picks[id] == null);
  const team = (id) => esc(C.teamLabel(S, C.leaderById(S, id)));
  // 3D(封筒・あみだ): 選ぶまではルーレットと同じ「くじの色」を選ぶ画面。抽選が始まったら 3D の画面に任せる(プレビューでは軽い 2D のまま)
  const fx3 = !PREVIEW && C.optionsOf(S).lotFx !== '2d' && (L.mode === 'envelope' || L.mode === 'amida');
  const verb = L.mode === 'amida' && !fx3 ? 'あみだくじ' : L.mode === 'envelope' && !fx3 ? '封筒' : 'くじの色';
  $('lots-note').innerHTML = L.phase === 'pick' ? `${team(who)} が${verb}を選んでいます`
    : L.done && L.mode !== 'wheel' ? `${team(L.winner)} が交渉権を獲得`
    : L.phase === 'ready' ? (L.mode === 'wheel' ? 'ルーレットを回します' : fx3 ? (L.mode === 'amida' ? 'あみだくじで抽選します' : '封筒で抽選します') : `選んだ順に${L.mode === 'amida' ? 'たどります' : '開けます'}`)
    : L.mode === 'amida' ? `${team(L.leaders[L.opened - 1])} のくじをたどっています` : `${team(L.leaders[L.opened - 1])} の封筒`;
  const use3d = fx3 && L.phase === 'reveal';
  if (!use3d && lots3dReady) $('lots3d').contentWindow.postMessage({ type: 'lots-reset' }, '*');
  for (const id of ['lots-title', 'lots-head', 'lots-body', 'lots-note']) $(id).style.display = use3d ? 'none' : '';
  $('lots3d').style.display = use3d ? 'block' : 'none';
  if (use3d) {
    if (!$('lots3d').getAttribute('src')) $('lots3d').setAttribute('src', 'lots3d.html');
    lots3dSend({ id: L.id, mode: L.mode, lots: L.lots, owners: L.lots.map((_, i) => (owner(i) ? C.teamLabel(S, C.leaderById(S, owner(i))) : null)),
      order: L.leaders.map((id) => L.picks[id]), opened: L.opened, done: L.done, winLot: L.winLot, amida: L.amida,
      player: { name: p ? p.name : '', icon: p && p.icon ? img(p.icon) : '' }, note: $('lots-note').textContent });
    lotsPrev = { id: L.id, picked, opened: L.opened, phase: L.phase };
    return;
  }
  if (L.mode === 'amida' && !fx3) renderAmida(L, owner, live, fresh);
  else {
    const isEnv = L.mode === 'envelope' && !fx3;
    // 開けた封筒: 選んだ順で opened 人目まで
    const openedSet = new Set(L.leaders.slice(0, L.opened));
    $('lots-body').innerHTML = `<div class="lots">${L.lots.map((x, i) => {
      const o = owner(i), late = isEnv && L.done && o && !openedSet.has(o); // 当たりのあと、残りもまとめて開く
      const isOpen = isEnv && o && (openedSet.has(o) || late), win = isOpen && o === L.winner;
      const justPicked = live && o && !fresh && picked > lotsPrev.picked && L.picks[L.leaders[picked - 1]] === i && L.phase !== 'ready';
      const justOpened = live && isOpen && o === L.leaders[L.opened - 1] && L.opened > lotsPrev.opened;
      return `<div class="lot ${isEnv ? 'env' : ''} ${o ? 'taken' : ''} ${justPicked ? 'pop' : ''} ${win ? 'win' : ''}" style="--lc:${x.color}">
        <div class="face">${'①②③④⑤⑥⑦⑧⑨⑩⑪⑫'[i]}${isOpen ? `<div class="res ${win ? 'win' : 'lose'} ${justOpened ? 'anim' : late && live && L.opened > lotsPrev.opened ? 'late' : ''}">${win ? '交渉権確定' : '外れ'}</div>` : ''}</div>
        <div class="cl">${esc(x.label)}</div><div class="nm">${o ? team(o) : '？'}</div></div>`;
    }).join('')}</div>`;
    if (live && L.opened > lotsPrev.opened) { SE.flip(); if (L.done) setTimeout(() => SE.win(), 450); }
    else if (live && picked > lotsPrev.picked) SE.pop();
  }
  lotsPrev = { id: L.id, picked, opened: L.opened, phase: L.phase };
}
// あみだくじ: 上にくじ(色＋番号)と選んだ人。横線は開けるまで隠す。たどった線は選んだ人のくじの色
function renderAmida(L, owner, live, fresh) {
  const n = L.lots.length, W = Math.min(1500, n * 300), H = 330, top = 20, bot = H - 20;
  const xs = Array.from({ length: n }, (_, i) => (n === 1 ? W / 2 : 60 + i * ((W - 120) / (n - 1))));
  const rows = L.amida.rungs.length, ys = Array.from({ length: rows }, (_, r) => top + (r + 1) * ((bot - top) / (rows + 1)));
  const path = (lane) => { let x = lane; const pts = [[xs[x], top - 10]]; L.amida.rungs.forEach((row, r) => { const y = ys[r]; if (row.includes(x)) { pts.push([xs[x], y], [xs[x + 1], y]); x++; } else if (row.includes(x - 1)) { pts.push([xs[x], y], [xs[x - 1], y]); x--; } }); pts.push([xs[x], bot + 10]); return { pts, end: x }; };
  const len = (pts) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
  const opened = L.leaders.slice(0, L.opened);
  const traces = opened.map((id, k) => { const lane = L.picks[id], { pts, end } = path(lane); return { id, lane, pts, end, len: len(pts), last: k === opened.length - 1 }; });
  const ends = new Map(traces.map((t) => [t.end, t]));
  const svg = `<svg width="${W}" height="${H + 130}" viewBox="0 -10 ${W} ${H + 130}">
    ${xs.map((x) => `<line x1="${x}" y1="${top - 10}" x2="${x}" y2="${bot + 10}" stroke="#fffaf0" stroke-width="10" stroke-linecap="round"/>`).join('')}
    ${L.amida.rungs.map((row, r) => row.map((i) => `<line x1="${xs[i]}" y1="${ys[r]}" x2="${xs[i + 1]}" y2="${ys[r]}" stroke="#fffaf0" stroke-width="10" stroke-linecap="round"/>`).join('')).join('')}
    ${traces.map((t) => `<polyline class="trace ${t.last && live && L.opened > lotsPrev.opened ? 'anim' : ''}" points="${t.pts.map((p) => p.join(',')).join(' ')}" stroke="${L.lots[t.lane].color}" style="--len:${t.len};stroke-dasharray:${t.len}"/>`).join('')}
    ${xs.map((x, i) => { const t = ends.get(i), hit = t && t.id === L.winner; return `<g transform="translate(${x},${bot + 66})"><circle r="50" fill="${t ? (hit ? '#ffd54a' : '#e9e4dc') : '#3a2410'}" stroke="#fff" stroke-width="5"/><text y="16" text-anchor="middle" font-family="Noto Sans JP" font-weight="900" font-size="${hit ? 26 : 40}" fill="${t ? (hit ? '#a3150f' : '#6a6258') : '#f3d27a'}">${t ? (hit ? '当たり' : '×') : '？'}</text></g>`; }).join('')}
  </svg>`;
  const heads = L.lots.map((x, i) => { const o = owner(i); return `<div style="position:absolute;left:${xs[i] - 110}px;top:0;width:220px;display:flex;flex-direction:column;align-items:center;gap:10px"><div class="cl" style="background:${x.color};color:#fff;font:900 34px 'Noto Sans JP';padding:6px 22px;border-radius:999px">${esc(x.label)}</div><div class="nm" style="font:900 30px 'Noto Sans JP';padding:2px 16px;border-radius:10px;${o ? 'background:#fffaf0;color:#2a1606' : 'color:#fff'}">${o ? esc(C.teamLabel(S, C.leaderById(S, o))) : '？'}</div></div>`; }).join('');
  $('lots-body').innerHTML = `<div class="amida" style="width:${W}px;padding-top:130px">${heads}${svg}<div class="cover ${L.phase === 'reveal' ? 'off' : ''}">？</div></div>`;
  if (live && L.opened > lotsPrev.opened) { SE.flip(); if (L.done) setTimeout(() => SE.win(), 2600); }
  else if (live && Object.keys(L.picks).length > lotsPrev.picked) SE.pop();
}

// 3D のくじの画面へ状態を送る(読み込みが終わるまでは取っておく)
let lots3dReady = false, lots3dPending = null;
function lots3dSend(data) { if (lots3dReady) $('lots3d').contentWindow.postMessage({ type: 'lots', data }, '*'); else lots3dPending = data; }
// 3D の画面の音量(ルーレットと同じ音量の設定)。抽選の画面以外では消す
function lots3dVolume(audio) { if (!lots3dReady) return; const f = $('lots3d').contentWindow; f.postMessage({ type: 'volume', v: PREVIEW ? 0 : audio.rlVol / 70 }, '*'); f.postMessage({ type: 'silence', on: S.scene !== 'lots' }, '*'); }
addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.type === 'lots3d-ready') { lots3dReady = true; if (S) lots3dVolume(Object.assign({}, C.DEFAULT_AUDIO, S.audio)); if (lots3dPending) { lots3dSend(lots3dPending); lots3dPending = null; } }
  // 3D の演出が終わった: 決着(ルーレットの roulette-done と同じ)
  else if (m.type === 'lots3d-done' && !PREVIEW && S && S.lottery && m.id === S.lottery.id && !S.lottery.done) ws.send(JSON.stringify({ type: 'action', action: { type: 'lotteryDone', id: m.id } }));
  // 3D の画面からの効果音(音量・プレビューの無音はこちらで)
  else if (m.type === 'lots-sfx' && !PREVIEW && S && S.scene === 'lots' && SE[m.name]) SE[m.name]();
});

/* ---------- 抽選ルーレット ---------- */
function playLottery(force) {
  const L = S.lottery;
  if (!L || !rouletteReady || S.scene !== 'roulette' || PREVIEW_NEXT) return; // 次のプレビューでは抽選を回さない(結果が先に見えないように)
  if (!force && (lastSpin === L.id || L.done)) return;
  lastSpin = L.id;
  const p = C.playerById(S, L.playerId);
  const leaders = L.leaders.map((id) => C.leaderById(S, id));
  const f = $('roulette').contentWindow;
  const wheel = L.mode === 'wheel';
  const owner = (i) => C.leaderById(S, L.leaders.find((id) => L.picks[id] === i));
  const names = wheel ? L.lots.map((x, i) => C.teamLabel(S, owner(i))) : leaders.map((l) => C.teamLabel(S, l));
  const colors = wheel ? L.lots.map((x) => x.color) : leaders.map((l) => lc(l));
  f.postMessage({ type: 'setup', pick: p ? p.name : '', image: p && p.icon ? img(p.icon) : '', leaders: names, colors }, '*');
  setTimeout(() => f.postMessage({ type: 'spin', id: L.id, winner: wheel ? L.winLot : L.leaders.indexOf(L.winner), plan: window.__recPlan || (C.optionsOf(S).lotteryStyle === 'short' ? 'short' : '') }, '*') /* __recPlan: 紹介動画の録画用 */, 700);
}
addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.type === 'roulette-ready') { rouletteReady = true; if (S) playLottery(false); }
  else if (m.type === 'roulette-done' && !PREVIEW && S && S.lottery && m.id === S.lottery.id && !S.lottery.done) ws.send(JSON.stringify({ type: 'action', action: { type: 'lotteryDone', id: m.id } }));
});

connect();
