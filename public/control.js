// 管理画面
const C = window.DraftCore;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = (f) => (f ? `/images/${encodeURIComponent(f)}` : '');
const OVERLAY_URL = `${location.origin}/overlay`;

let S = null, canUndo = false, demo = false, ws = null, bgmList = [], overlay = { count: 0 };

/* ---------- 見た目(melta UI のクラス。色はアプリの金×焦げ茶) ---------- */
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50';
const BTN_PRIMARY = `inline-flex items-center justify-center h-11 px-4 text-[1rem] font-medium bg-primary-500 text-slate-900 rounded-lg hover:bg-primary-600 cursor-pointer disabled:opacity-40 disabled:cursor-default ${FOCUS}`;
const BTN_SUB = `inline-flex items-center justify-center h-11 px-4 text-[1rem] font-medium bg-[var(--bg-surface)] text-[var(--text-default)] border border-[var(--border-strong)] rounded-lg hover:bg-[var(--bg-page-alt)] cursor-pointer disabled:opacity-40 disabled:cursor-default ${FOCUS}`;
const BTN_ICON = `w-11 h-11 flex-none inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-page-alt)] hover:text-[var(--text-default)] cursor-pointer disabled:opacity-40 disabled:cursor-default ${FOCUS}`;
const CARD = 'bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] shadow-sm';
const INPUT = 'h-11 px-3 text-sm bg-[var(--bg-page)] text-[var(--text-default)] border border-[var(--border-strong)] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400/50 caret-primary-400';
const LABEL = 'block mb-1 text-xs text-[var(--text-muted)]';
const BADGE = {
  ok: 'bg-emerald-500/[.12] text-emerald-300', lot: 'bg-amber-500/[.12] text-amber-300', dup: 'bg-red-500/[.12] text-red-300',
  in: 'bg-primary-500/[.12] text-primary-300', wait: 'bg-[var(--bg-page-alt)] text-[var(--text-muted)]',
};
const badge = (k, t) => `<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${BADGE[k]}">${t}</span>`;
const svg = (d) => `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  up: svg('<path d="m18 15-6-6-6 6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  del: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  chevron: '<svg class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
};
// 画像を登録できる印(顔アイコンの右下のカメラ)
const CAM = '<span class="absolute -right-1 -bottom-1 w-5 h-5 inline-flex items-center justify-center rounded-full bg-primary-500 text-slate-900 ring-2 ring-[var(--bg-surface)]" aria-hidden="true"><svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/></svg></span>';
// 顔アイコン(画像がなければリーダー色の丸)。リーダー色はユーザーが決めるデータなので CSS 変数で渡す
const avatar = (icon, color, size = 'w-10 h-10') => {
  const lc = color ? `style="--lc:${esc(color)}"` : '';
  return icon
    ? `<img src="${img(icon)}" alt="" class="${size} flex-none rounded-full object-cover ${color ? 'ring-2 ring-[var(--lc)]' : ''}" ${lc}>`
    : `<span class="block ${size} flex-none rounded-full ${color ? 'bg-[var(--lc)]' : 'bg-[var(--bg-page-alt)]'}" ${lc} aria-hidden="true"></span>`;
};

/* ---------- 通信 ---------- */
function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => { $('conn').textContent = '● 接続中'; $('conn').className = 'text-xs text-emerald-300'; };
  ws.onclose = () => { $('conn').textContent = '× 切断（再接続中…）'; $('conn').className = 'text-xs text-red-300'; setTimeout(connect, 1000); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') { S = m.state; canUndo = m.canUndo; demo = !!m.demo; render(); }
    else if (m.type === 'presence') { overlay = m; renderOverlayStatus(); if (S) renderRun(); }
    else if (m.type === 'bgmList') { bgmList = m.list; if (S) renderAudio(); }
    else if (m.type === 'error') toast(m.message, true);
  };
}
const act = (action) => ws.send(JSON.stringify({ type: 'action', action }));
const TOAST = 'fixed left-1/2 bottom-6 -translate-x-1/2 z-20 px-4 py-3 rounded-lg shadow-xl text-sm border bg-[var(--bg-surface)]';
function toast(t, err) {
  const el = $('toast'); el.textContent = t;
  el.className = `${TOAST} ${err ? 'border-red-500/60 text-red-300' : 'border-[var(--border-strong)] text-[var(--text-heading)]'}`;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.className = TOAST + ' hidden'; }, err ? 6000 : 3000);
}

/* ---------- 配信画面(OBS / ブラウザ)が開いているか ---------- */
function renderOverlayStatus() {
  const o = overlay, el = $('overlay-st');
  const [text, cls] = !o.count ? ['× 配信画面が開いていません', 'text-red-300']
    : o.obs && o.hidden ? ['● OBS: 今のシーンには映っていません', 'text-amber-300']
    : o.obs ? ['● OBSで配信画面を表示中', 'text-emerald-300']
    : ['● ブラウザで配信画面を表示中', 'text-emerald-300'];
  el.textContent = text; el.className = `text-xs ${cls}`;
}

/* ---------- 抽選演出中は結果を伏せる ---------- */
const hiddenPick = (p) => S.lottery && !S.lottery.done && p.playerId === S.lottery.playerId && p.by === 'lottery';

/* ---------- 描画 ---------- */
// disabled には aria-disabled も付ける(melta の規範)
function setDisabled(el, v) { el.disabled = v; if (v) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled'); }
function show(el, v, display) { el.classList.toggle('hidden', !v); el.classList.toggle(display, v); }

function render() {
  $('title').textContent = S.title || 'ドラフト会議';
  document.title = `${S.title || 'ドラフト会議'} - ドラフト会議アプリ`;
  setDisabled($('undo'), !canUndo);
  document.querySelectorAll('[data-scene]').forEach((b) => {
    const on = b.dataset.scene === S.scene;
    b.setAttribute('aria-pressed', on);
    b.classList.toggle('bg-[var(--bg-page-alt)]', on); b.classList.toggle('text-[var(--text-heading)]', on);
    b.classList.toggle('text-[var(--text-muted)]', !on); b.classList.toggle('hover:text-[var(--text-default)]', !on);
  });
  show($('demo-banner'), demo, 'flex'); show($('demo-start'), !demo, 'flex');
  renderRun();
  renderRoster();
  renderAudio();
}

/* ---------- 次にやること ----------
 * 状態から「いま押すべき1つのボタン」を決める。押していけば
 * 指名入力 → 一斉公開 → (重複なら抽選 → ボードに戻して再指名 → 公開) → チーム表 → 次の巡 と進む */
const STEPS = ['指名を入力', '一斉公開', '抽選・再指名', 'チーム表', '次の巡へ'];
function nextStep() {
  const pend = C.pendingLeaders(S), confs = C.conflicts(S);
  const waiting = pend.filter((l) => !(S.noms[l.id] && S.noms[l.id].playerId));
  const toReveal = pend.filter((l) => S.noms[l.id] && S.noms[l.id].playerId && !S.noms[l.id].revealed);
  // この巡で一度でも公開したか(してあれば、いまの入力は再指名)
  const renom = S.picks.some((p) => p.round === S.round) || S.lotteries.some((x) => x.round === S.round);
  const L = S.lottery, name = (id) => esc(C.playerById(S, id)?.name), lname = (id) => esc(C.leaderById(S, id)?.name);
  const sub = [];
  if (demo && waiting.length) sub.push({ key: 'auto', label: 'おまかせ指名' });

  if (!S.leaders.length) return { step: -1, text: 'まず「登録」でリーダーと選手を登録してください', main: { key: 'roster', label: '登録へ' } };
  if (L && !L.done) return { step: 2, text: `<b>${name(L.playerId)}</b> の抽選を配信画面で演出中です`, main: { label: '演出中…', off: true } };
  if (L && L.done && S.scene === 'roulette') {
    const res = `<b>${name(L.playerId)}</b> は <b>${lname(L.winner)}</b> が交渉権確定`;
    // 重複が残っていれば、ボードに戻らず続けて次の抽選へ(再指名は全部の抽選のあと)
    if (confs.length) return { step: 2, text: `${res}。続けて <b>${name(confs[0].playerId)}</b> の重複を抽選します`, main: { key: 'draw', arg: confs[0].playerId, label: '次の抽選へ' }, sub: [{ key: 'board', label: '指名ボードに戻す' }] };
    return { step: 2, text: `${res}${waiting.length ? '。外れたリーダーの再指名に進みます' : ''}`, main: { key: 'board', label: '指名ボードに戻す' } };
  }
  // ピックアップ公開中: 1人ずつ「次へ」→ 全員出たら「一覧を表示」で指名ボードに戻して判定を見せる
  if (S.spot) {
    if (toReveal.length) return { step: renom ? 2 : 1, text: `ピックアップで公開しています（あと${toReveal.length}人）`, main: { key: 'spotNext', arg: toReveal[0].id, label: `次へ（${lname(toReveal[0].id)}）` }, sub: [{ key: 'reveal', label: '残りを一斉公開' }] };
    return { step: renom ? 2 : 1, text: '全員の指名が出ました。一覧を出して、確定と競合を見せます', main: { key: 'spotEnd', label: '一覧を表示' } };
  }
  if (confs.length && C.allRevealed(S)) {
    const c = confs[0];
    return { step: 2, text: `<b>${name(c.playerId)}</b> の指名が重複（${c.leaders.map(lname).join(' / ')}）。抽選で交渉権を決めます`, main: { key: 'draw', arg: c.playerId, label: '抽選する' } };
  }
  if (C.draftComplete(S)) {
    return S.scene === 'teams'
      ? { step: 5, text: `全${S.rounds}巡の指名が確定しました。おつかれさまでした` }
      : { step: 3, text: `全${S.rounds}巡の指名が確定しました。最終のチーム表を映しましょう`, main: { key: 'teams', label: 'チーム表を映す' } };
  }
  if (C.roundComplete(S)) {
    return S.scene === 'teams'
      ? { step: 4, text: `第${S.round}巡のチーム表を映しています。次は第${S.round + 1}巡です`, main: { key: 'nextRound', label: `第${S.round + 1}巡へ進む` } }
      : { step: 3, text: `第${S.round}巡の指名がすべて確定しました`, main: { key: 'teams', label: 'チーム表を映す' } };
  }
  const label = renom ? '再指名を公開' : '一斉公開';
  if (waiting.length) {
    if (S.scene !== 'board') sub.push({ key: 'board', label: '指名ボードを映す' });
    return { step: renom ? 2 : 0, text: `${renom ? '外れたリーダーの再指名' : '各リーダーの指名'}を下で入力してください（あと${waiting.length}人）`, main: { label, off: true }, sub };
  }
  if (toReveal.length) {
    // 1人ずつ公開もできる(並び順で次の人)
    const one = { key: 'revealOne', arg: toReveal[0].id, label: `1人ずつ公開（次: ${lname(toReveal[0].id)}）` };
    const spot = { key: 'spotNext', arg: toReveal[0].id, label: 'ピックアップで公開' };
    const partial = toReveal.length < pend.length;
    return partial
      ? { step: renom ? 2 : 1, text: `1人ずつ公開しています（あと${toReveal.length}人）`, main: { key: 'reveal', label: '残りを一斉公開' }, sub: [spot, one] }
      : { step: renom ? 2 : 1, text: `${renom ? '再指名' : '全員の指名'}がそろいました。配信画面で公開します`, main: { key: 'reveal', label }, sub: [spot, one] };
  }
  return { step: 0, text: '' };
}

function renderSteps(cur) {
  const check = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  $('steps').innerHTML = STEPS.map((t, i) => {
    const st = i < cur ? 'done' : i === cur ? 'now' : 'todo';
    const dot = st === 'done' ? `<span class="w-8 h-8 flex-none inline-flex items-center justify-center rounded-full bg-emerald-500/[.12] text-emerald-300">${check}<span class="sr-only">済み</span></span>`
      : st === 'now' ? `<span class="w-8 h-8 flex-none inline-flex items-center justify-center rounded-full bg-primary-500 text-slate-900 text-sm font-bold">${i + 1}</span>`
      : `<span class="w-8 h-8 flex-none inline-flex items-center justify-center rounded-full border border-[var(--border-strong)] text-[var(--text-muted)] text-sm">${i + 1}</span>`;
    const label = `<span class="text-sm whitespace-nowrap ${st === 'now' ? 'font-bold text-[var(--text-heading)]' : 'text-[var(--text-muted)]'}">${t}</span>`;
    const line = i < STEPS.length - 1 ? '<span class="h-px flex-1 min-w-4 bg-[var(--border-default)]" aria-hidden="true"></span>' : '';
    return `<li class="flex items-center gap-2 ${line ? 'flex-1' : ''}" ${st === 'now' ? 'aria-current="step"' : ''}>${dot}${label}${line}</li>`;
  }).join('');
}

function renderRun() {
  const confs = C.conflicts(S), done = C.draftComplete(S);
  $('round-title').textContent = done ? 'ドラフト終了' : `第${S.round}巡`;
  const n = nextStep();
  renderSteps(n.step);
  const btn = (b, cls) => `<button type="button" class="${cls}" ${b.key ? `data-next="${b.key}"` : ''} ${b.arg ? `data-arg="${b.arg}"` : ''} ${b.off ? 'disabled aria-disabled="true"' : ''}>${b.label}</button>`;
  const warn = overlay.count ? '' : '<p class="mt-2 text-sm text-red-300">配信画面が開いていません。OBSのブラウザソース（またはブラウザ）で配信画面を開くと演出が流れます。開いていない間は、抽選の結果がすぐに出ます。</p>';
  $('next').innerHTML = `<div class="min-w-0 flex-1 leading-normal"><p class="text-xs text-[var(--text-muted)]">次にやること</p>
    <p class="mt-1 text-lg text-[var(--text-heading)] [&_b]:text-primary-300">${n.text}</p>${warn}</div>
    <div class="flex flex-wrap gap-2">${(n.sub || []).map((b) => btn(b, BTN_SUB)).join('')}${n.main ? btn(n.main, BTN_PRIMARY.replace('h-11 px-4', 'h-12 px-6')) : ''}</div>`;

  // 重複の一覧(抽選は「次にやること」から順番に)
  $('conflicts').innerHTML = confs.map((c) => `<div class="flex flex-wrap items-center gap-4 p-4 bg-red-500/[.12] border border-red-500/40 rounded-lg">
    ${badge('dup', '重複')}<p class="text-base font-bold text-[var(--text-heading)]">${esc(C.playerById(S, c.playerId)?.name)}</p>
    <p class="text-sm">${c.leaders.map((id) => esc(C.leaderById(S, id)?.name)).join(' / ')} が競合</p></div>`).join('');

  // 各リーダーの指名
  const taken = C.pickedIds(S);
  const options = S.players.filter((p) => !taken.has(p.id));
  const picked = (id) => {
    const p = C.playerById(S, id);
    return `<div class="flex items-center gap-3 h-11">${avatar(p?.icon, null, 'w-9 h-9')}<p class="text-lg font-bold text-[var(--text-heading)] truncate">${esc(p?.name)}</p></div>`;
  };
  // 全員の指名がそろってから公開できる(先に1人だけ見せない)
  const pendAll = C.pendingLeaders(S).every((l) => S.noms[l.id] && S.noms[l.id].playerId);
  // 重複が残っている間・抽選の演出中は再指名を入れられない(全部の抽選のあとでまとめて)
  const blocked = confs.length > 0 || !!(S.lottery && !S.lottery.done);
  const inLot = (id) => !!(S.lottery && !S.lottery.done && S.lottery.leaders.includes(id));
  $('noms').innerHTML = S.leaders.map((l) => {
    const pick = C.pickOf(S, l.id, S.round), n = S.noms[l.id] || {};
    let body, st;
    if (pick && !hiddenPick(pick)) { body = picked(pick.playerId); st = badge(pick.by === 'lottery' ? 'lot' : 'ok', pick.by === 'lottery' ? '抽選で確定' : '確定'); }
    // 抽選の演出中は、当たり・外れどちらも同じ見た目にする(管理画面でも結果が先にわからないように)
    else if (pick || inLot(l.id)) { body = picked(S.lottery.playerId); st = badge('lot', '抽選中'); }
    else if (n.revealed) { body = picked(n.playerId); st = confs.some((c) => c.leaders.includes(l.id)) ? badge('dup', '重複') : badge('in', '公開済み'); }
    else if (blocked) { body = '<p class="flex items-center h-11 text-sm text-[var(--text-muted)]">ほかの重複の抽選が終わったら再指名します</p>'; st = badge('wait', '再指名待ち'); }
    else {
      const canReveal = n.playerId && pendAll;
      body = `<div class="flex gap-2"><div class="relative flex-1 min-w-0"><select data-nom="${l.id}" aria-label="${esc(l.name)} の指名" class="appearance-none w-full pl-3 pr-10 ${INPUT} cursor-pointer"><option value="">― 指名を選ぶ ―</option>${options.map((p) => `<option value="${p.id}" ${p.id === n.playerId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>${ICON.chevron}</div>${canReveal ? `<button type="button" class="${BTN_SUB} flex-none" data-next="revealOne" data-arg="${l.id}" aria-label="${esc(l.name)} の指名を公開">公開</button>` : ''}</div>`;
      st = n.playerId ? badge('in', '入力済み') : badge('wait', '未入力');
    }
    return `<div class="${CARD} p-4"><div class="flex items-center gap-3 mb-3">${avatar(l.icon, l.color)}
      <p class="min-w-0 text-base font-bold text-[var(--text-heading)] truncate">${esc(l.name)}</p>
      <div class="ml-auto">${st}</div></div>${body}</div>`;
  }).join('');

  // チーム
  $('teams').innerHTML = S.leaders.map((l) => {
    const team = C.teamOf(S, l.id).filter((p) => !hiddenPick(p));
    const rows = Array.from({ length: S.rounds }, (_, i) => {
      const p = team.find((t) => t.round === i + 1);
      return `<li class="flex items-center gap-2"><span class="w-10 flex-none text-xs text-[var(--text-muted)]">${i + 1}巡</span>${p ? `<span class="text-sm text-[var(--text-heading)] truncate">${esc(C.playerById(S, p.playerId)?.name)}</span>` : '<span class="text-sm text-[var(--text-muted)]">―</span>'}</li>`;
    }).join('');
    return `<div class="${CARD} p-4"><div class="flex items-center gap-3 mb-2">${avatar(l.icon, l.color, 'w-8 h-8')}<p class="min-w-0 text-sm font-bold text-[var(--text-heading)] truncate">${esc(l.name)}</p></div><ol class="flex flex-col">${rows}</ol></div>`;
  }).join('');
}

function renderRoster() {
  if (document.activeElement && document.activeElement.closest('#tab-roster') && document.activeElement.matches('input[type=text],textarea')) return; // 入力中は描き直さない
  $('in-title').value = S.title; $('in-rounds').value = S.rounds;
  $('leaders').innerHTML = S.leaders.map((l, i) => `<div class="item ${CARD} flex flex-wrap items-end gap-4 px-4 py-3" data-id="${l.id}">
    <button type="button" data-icon="L" class="relative flex-none rounded-full cursor-pointer ${FOCUS}" aria-label="${esc(l.name)} の画像を${l.icon ? '変更' : '設定'}" title="クリック or 画像をドロップで${l.icon ? '変更' : '設定'}">${avatar(l.icon, l.color, 'w-11 h-11')}${CAM}</button>
    <div class="leading-normal"><label class="${LABEL}" for="ln-${l.id}">リーダー名</label><input id="ln-${l.id}" type="text" data-lf="name" value="${esc(l.name)}" class="w-48 ${INPUT}"></div>
    <div class="leading-normal"><label class="${LABEL}" for="lc-${l.id}">色</label><input id="lc-${l.id}" type="color" data-lf="color" value="${esc(l.color)}" class="block w-14 h-11 p-1 bg-[var(--bg-page)] border border-[var(--border-strong)] rounded-lg cursor-pointer ${FOCUS}"></div>
    <div class="ml-auto flex gap-1">
      <button type="button" class="${BTN_ICON}" data-move="-1" aria-label="上へ" ${i ? '' : 'disabled aria-disabled="true"'}>${ICON.up}</button>
      <button type="button" class="${BTN_ICON}" data-move="1" aria-label="下へ" ${i < S.leaders.length - 1 ? '' : 'disabled aria-disabled="true"'}>${ICON.down}</button>
      <button type="button" class="${BTN_ICON} hover:text-red-300" data-del-leader aria-label="${esc(l.name)} を削除">${ICON.del}</button>
    </div></div>`).join('') || '<p class="text-base text-[var(--text-muted)] text-center py-16">まだいません。「追加」で登録してください</p>';
  const taken = C.pickedIds(S);
  $('player-count').textContent = `${S.players.length}人`;
  $('leader-count').textContent = `${S.leaders.length} / ${C.MAX_LEADERS}人`;
  setDisabled($('add-leader'), S.leaders.length >= C.MAX_LEADERS);
  $('players').innerHTML = S.players.map((p) => `<div class="item ${CARD} flex items-center gap-2 p-2 ${taken.has(p.id) ? 'opacity-50' : ''}" data-id="${p.id}" title="${taken.has(p.id) ? '指名済み' : ''}">
    <button type="button" data-icon="P" class="relative flex-none rounded-full cursor-pointer ${FOCUS}" aria-label="${esc(p.name)} の画像を${p.icon ? '変更' : '設定'}" title="クリック or 画像をドロップで${p.icon ? '変更' : '設定'}">${avatar(p.icon, null, 'w-11 h-11')}${CAM}</button>
    <input type="text" data-pf="name" value="${esc(p.name)}" aria-label="選手名" class="min-w-0 flex-1 ${INPUT}">
    <button type="button" class="${BTN_ICON} hover:text-red-300" data-del-player aria-label="${esc(p.name)} を削除">${ICON.del}</button></div>`).join('')
    || '<p class="col-span-full text-base text-[var(--text-muted)] text-center py-16">まだいません。上の欄に名前を入れて「まとめて追加」</p>';
}

/* ---------- 操作 ---------- */
function selectTab(name) {
  document.querySelectorAll('.tab').forEach((x) => {
    const on = x.dataset.tab === name;
    x.setAttribute('aria-selected', on);
    x.classList.toggle('text-primary-400', on); x.classList.toggle('border-primary-400', on);
    x.classList.toggle('text-[var(--text-muted)]', !on); x.classList.toggle('border-transparent', !on); x.classList.toggle('hover:text-[var(--text-default)]', !on);
  });
  document.querySelectorAll('.tab-body').forEach((x) => x.classList.toggle('hidden', x.id !== 'tab-' + name));
  if (S) render();
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
selectTab('run');

$('undo').addEventListener('click', () => ws.send(JSON.stringify({ type: 'undo' })));
window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.target.matches('input,textarea')) { e.preventDefault(); $('undo').click(); } });
document.querySelectorAll('[data-scene]').forEach((b) => b.addEventListener('click', () => act({ type: 'setScene', scene: b.dataset.scene })));
$('copy-url').addEventListener('click', async () => { try { await navigator.clipboard.writeText(OVERLAY_URL); toast(`コピーしました: ${OVERLAY_URL}`); } catch { toast(OVERLAY_URL); } });

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.nom !== undefined) act({ type: 'nominate', leaderId: t.dataset.nom, playerId: t.value || null });
  else if (t.dataset.lf) act({ type: 'updateLeader', id: t.closest('.item').dataset.id, patch: { [t.dataset.lf]: t.value } });
  else if (t.dataset.pf) act({ type: 'updatePlayer', id: t.closest('.item').dataset.id, patch: { [t.dataset.pf]: t.value } });
  else if (t.id === 'in-title') act({ type: 'setTitle', title: t.value });
  else if (t.id === 'in-rounds') act({ type: 'setRounds', rounds: +t.value });
});
document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.next) doNext(t.dataset.next, t.dataset.arg);
  else if (t.dataset.move) act({ type: 'moveLeader', id: t.closest('.item').dataset.id, dir: +t.dataset.move });
  else if (t.dataset.delLeader !== undefined) { if (confirm('このリーダーを削除しますか？')) act({ type: 'removeLeader', id: t.closest('.item').dataset.id }); }
  else if (t.dataset.delPlayer !== undefined) act({ type: 'removePlayer', id: t.closest('.item').dataset.id });
  else if (t.dataset.icon) pickImage(t.dataset.icon, t.closest('.item').dataset.id);
});
$('add-leader').addEventListener('click', () => act({ type: 'addLeader' }));
$('add-players').addEventListener('click', () => {
  const names = $('bulk-players').value.split('\n').map((v) => v.trim()).filter(Boolean);
  if (!names.length) return;
  act({ type: 'addPlayers', players: names.map((name) => ({ name })) });
  $('bulk-players').value = '';
});

// お試しモード(本番とは別のデータで、ダミーの名簿を使う)
const sendMode = (mode, fresh) => ws.send(JSON.stringify({ type: 'mode', mode, fresh }));
$('demo-enter').addEventListener('click', () => { sendMode('demo'); selectTab('run'); toast('お試しモードを始めました（本番のデータはそのまま残っています）'); });
$('demo-exit').addEventListener('click', () => { sendMode('real'); toast('本番のデータに戻りました'); });
$('demo-reset').addEventListener('click', () => { if (confirm('お試しの進行をすべて消して、最初からにしますか？')) sendMode('demo', true); });
// 「次にやること」のボタン
function doNext(key, arg) {
  if (key === 'reveal') act({ type: 'reveal' });
  else if (key === 'revealOne') act({ type: 'reveal', leaderId: arg });
  else if (key === 'spotNext') act({ type: 'reveal', leaderId: arg, spot: true });
  else if (key === 'spotEnd') act({ type: 'spotEnd' });
  else if (key === 'draw') act({ type: 'drawLottery', playerId: arg });
  else if (key === 'board' || key === 'teams') act({ type: 'setScene', scene: key });
  else if (key === 'nextRound') act({ type: 'nextRound' });
  else if (key === 'roster') selectTab('roster');
  else if (key === 'auto') autoNominate();
}
// おまかせ指名(お試し専用): 空いている指名をランダムに入れる。上位の選手に寄せて、ときどき重複が起きるようにする
function autoNominate() {
  const taken = C.pickedIds(S);
  const free = S.players.filter((p) => !taken.has(p.id));
  const hot = free.slice(0, 3);
  for (const l of C.pendingLeaders(S)) {
    if (S.noms[l.id] && S.noms[l.id].playerId) continue;
    const pool = Math.random() < 0.4 && hot.length ? hot : free;
    const p = pool[Math.floor(Math.random() * pool.length)];
    if (p) act({ type: 'nominate', leaderId: l.id, playerId: p.id });
  }
}

/* ---------- 画像の登録と調整 ----------
 * クリック or ドラッグ＆ドロップ → 調整画面(位置と大きさ) → 丸く切り抜いた画像を保存。
 * 元の画像(iconSrc)と調整(iconCrop)も残すので、あとから調整し直せる */
const IMG_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const VIEW = 320, OUT = 512; // 調整画面の大きさ / 保存する画像の大きさ(px)
const crop = { kind: '', id: '', img: null, src: '', file: null, x: 0, y: 0, zoom: 1 };
const entity = (kind, id) => (kind === 'L' ? C.leaderById(S, id) : C.playerById(S, id));

// file を渡すとその画像で、渡さなければ今の画像(なければファイル選択)で開く
function openCrop(kind, id, file) {
  const e = entity(kind, id);
  Object.assign(crop, { kind, id, img: null, file: null, src: '' });
  $('crop-title').textContent = `${e?.name || ''} の画像`;
  const src = e && (e.iconSrc || e.icon);
  drawCrop();
  if (!$('crop').open) $('crop').showModal();
  if (file) setCropFile(file);
  else if (src) loadCrop(img(src), null, src, e.iconCrop || { x: 0, y: 0, zoom: 1 });
  else pickCropFile();
}
function loadCrop(url, file, src, c = { x: 0, y: 0, zoom: 1 }) {
  const im = new Image();
  im.onload = () => { Object.assign(crop, { img: im, file, src, x: c.x * VIEW, y: c.y * VIEW, zoom: c.zoom }); $('crop-zoom').value = crop.zoom; drawCrop(); };
  im.onerror = () => toast('画像を読み込めませんでした', true);
  im.src = url;
}
function setCropFile(f) {
  if (!f || !IMG_EXT[f.type]) return toast('PNG / JPEG / GIF / WebP の画像を選んでください', true);
  loadCrop(URL.createObjectURL(f), f, '');
}
function pickCropFile() { $('img-file').value = ''; $('img-file').click(); }
$('img-file').addEventListener('change', (e) => setCropFile(e.target.files[0]));

// 画像がはみ出さないように位置を抑える(丸の中に空きができない)
function cropScale() { const { img: im } = crop; return Math.max(VIEW / im.naturalWidth, VIEW / im.naturalHeight) * crop.zoom; }
function clampCrop() {
  const s = cropScale(), mx = Math.max(0, (crop.img.naturalWidth * s - VIEW) / 2), my = Math.max(0, (crop.img.naturalHeight * s - VIEW) / 2);
  crop.x = Math.min(mx, Math.max(-mx, crop.x)); crop.y = Math.min(my, Math.max(-my, crop.y));
}
function paint(ctx, size) {
  const k = size / VIEW, s = cropScale() * k, w = crop.img.naturalWidth * s, h = crop.img.naturalHeight * s;
  ctx.drawImage(crop.img, size / 2 + crop.x * k - w / 2, size / 2 + crop.y * k - h / 2, w, h);
}
function drawCrop() {
  const cv = $('crop-canvas'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, VIEW, VIEW);
  setDisabled($('crop-save'), !crop.img); setDisabled($('crop-zoom'), !crop.img);
  if (!crop.img) return;
  clampCrop(); paint(ctx, VIEW);
  // 丸の外を暗くして、切り抜かれる範囲を見せる
  ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.rect(0, 0, VIEW, VIEW); ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 2, 0, Math.PI * 2, true); ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 2, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
}
// ドラッグで位置、ホイールとつまみで大きさ、矢印キーでも動かせる
{
  const cv = $('crop-canvas'); let drag = null;
  cv.addEventListener('pointerdown', (e) => { if (!crop.img) return; drag = { x: e.clientX - crop.x * (cv.clientWidth / VIEW), y: e.clientY - crop.y * (cv.clientWidth / VIEW) }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; const k = VIEW / cv.clientWidth; crop.x = (e.clientX - drag.x) * k; crop.y = (e.clientY - drag.y) * k; drawCrop(); });
  cv.addEventListener('pointerup', () => { drag = null; });
  cv.addEventListener('wheel', (e) => { if (!crop.img) return; e.preventDefault(); crop.zoom = Math.min(5, Math.max(1, crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))); $('crop-zoom').value = crop.zoom; drawCrop(); }, { passive: false });
  cv.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[e.key];
    if (!d || !crop.img) return; e.preventDefault(); crop.x += d[0]; crop.y += d[1]; drawCrop();
  });
  $('crop-zoom').addEventListener('input', (e) => { crop.zoom = +e.target.value; drawCrop(); });
  $('crop-pick').addEventListener('click', pickCropFile);
  $('crop-cancel').addEventListener('click', () => $('crop').close());
  $('crop-close').addEventListener('click', () => $('crop').close());
  $('crop').addEventListener('dragover', (e) => e.preventDefault());
  $('crop').addEventListener('drop', (e) => { e.preventDefault(); setCropFile(e.dataTransfer.files[0]); });
}
const upload = async (name, body) => {
  const r = await fetch(`/api/upload?name=${encodeURIComponent(name)}`, { method: 'POST', body });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).name;
};
async function saveCrop() {
  if (!crop.img) return;
  const { kind, id } = crop, stamp = `${kind}_${id}_${Date.now()}`;
  try {
    // 元の画像(新しく選んだときだけ送る)と、丸く切り抜く前の正方形の画像
    const src = crop.file ? await upload(`${stamp}_orig${IMG_EXT[crop.file.type]}`, crop.file) : crop.src;
    const cv = document.createElement('canvas'); cv.width = cv.height = OUT;
    paint(cv.getContext('2d'), OUT);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    const icon = await upload(`${stamp}.png`, blob);
    act({ type: kind === 'L' ? 'updateLeader' : 'updatePlayer', id, patch: { icon, iconSrc: src, iconCrop: { x: crop.x / VIEW, y: crop.y / VIEW, zoom: crop.zoom } } });
    $('crop').close();
  } catch (err) { toast(err.message, true); }
}
$('crop-save').addEventListener('click', saveCrop);
function pickImage(kind, id) { openCrop(kind, id); }
// 顔アイコンの上に画像ファイルを落としても、調整画面を開く
const dropTarget = (e) => e.target.closest && e.target.closest('[data-icon]');
document.addEventListener('dragover', (e) => { if (dropTarget(e)) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  const t = dropTarget(e);
  if (!t) return;
  e.preventDefault();
  openCrop(t.dataset.icon, t.closest('.item').dataset.id, e.dataTransfer.files[0]);
});

// CSV
$('csv-out').addEventListener('click', () => {
  const blob = new Blob(['﻿' + C.rosterToCSV(S)], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'draft-roster.csv'; a.click();
});
$('csv-in').addEventListener('click', () => { $('csv-file').value = ''; $('csv-file').click(); });
$('csv-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const r = C.rosterFromCSV(await f.text());
  if (!r.leaders.length && !r.players.length) return toast('読み込める行がありませんでした', true);
  if (S.picks.length && !confirm('ドラフトの記録が残っています。名簿を置き換えると記録と合わなくなります。続けますか？')) return;
  act({ type: 'replaceRoster', leaders: r.leaders.length ? r.leaders : undefined, players: r.players.length ? r.players : undefined });
  toast(`リーダー${r.leaders.length}人・選手${r.players.length}人を読み込みました`);
});

/* ---------- 音(BGM・効果音) ---------- */
const audioOf = () => Object.assign({}, C.DEFAULT_AUDIO, S.audio);
const setAudio = (patch) => act({ type: 'setAudio', patch });
function renderAudio() {
  const a = audioOf(), sel = $('bgm-track');
  if (document.activeElement !== sel) {
    const names = a.bgm && !bgmList.includes(a.bgm) ? [...bgmList, a.bgm] : bgmList;
    sel.innerHTML = '<option value="">（なし）</option>' + names.map((n) => `<option value="${esc(n)}" ${n === a.bgm ? 'selected' : ''}>${esc(n.replace(/.[^.]+$/, ''))}${bgmList.includes(n) ? '' : '（見つかりません）'}</option>`).join('');
  }
  $('bgm-toggle').innerHTML = a.bgmOn
    ? '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>BGMを止める'
    : '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>BGMを流す';
  setDisabled($('bgm-toggle'), !a.bgm);
  for (const [id, v] of [['bgm-vol', a.bgmVol], ['se-vol', a.seVol], ['rl-vol', a.rlVol]]) {
    if (document.activeElement !== $(id)) $(id).value = v;
    $(id + '-v').textContent = v;
  }
  $('bgm-hint').textContent = bgmList.length
    ? '抽選ルーレットの間は BGM がゆっくり消え、ほかの画面に戻るとゆっくり戻ります。'
    : '曲がまだありません。「曲を追加」で音声ファイルを選ぶか、メニューの「ファイル → BGMフォルダを開く」に入れてください。';
}
$('bgm-track').addEventListener('change', (e) => setAudio({ bgm: e.target.value, bgmOn: true }));
$('bgm-toggle').addEventListener('click', () => setAudio({ bgmOn: !audioOf().bgmOn }));
for (const [id, key] of [['bgm-vol', 'bgmVol'], ['se-vol', 'seVol'], ['rl-vol', 'rlVol']]) {
  $(id).addEventListener('input', (e) => { $(id + '-v').textContent = e.target.value; setAudio({ [key]: +e.target.value }); });
}
$('bgm-add').addEventListener('click', () => { $('bgm-file').value = ''; $('bgm-file').click(); });
$('bgm-file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  for (const f of files) {
    const r = await fetch(`/api/bgm?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
    if (!r.ok) return toast(await r.text(), true);
  }
  if (files.length) toast(`${files.length}曲を追加しました`);
});
fetch('/api/bgm').then((r) => r.json()).then((l) => { bgmList = l; if (S) renderAudio(); }).catch(() => {});

$('toast').className = TOAST + ' hidden';
connect();
