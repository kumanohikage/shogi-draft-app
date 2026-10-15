// 管理画面
const C = window.DraftCore;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = (f) => (f ? `/images/${encodeURIComponent(f)}` : '');
const OVERLAY_URL = `${location.origin}/overlay`;

let remoteInfo = { on: false };
let S = null, canUndo = false, undoCancelsLottery = false, demo = false, ws = null, bgmList = [], overlay = { count: 0 };

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
    if (m.type === 'state') { S = m.state; canUndo = m.canUndo; undoCancelsLottery = !!m.undoCancelsLottery; demo = !!m.demo; render(); }
    else if (m.type === 'remote') { remoteInfo = m; renderRemote(); }
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
  renderLotteryLog();
  renderOptions();
  renderTimer();
}

/* ---------- 次にやること(flow.js と共用) ---------- */
const STEPS = DraftFlow.STEPS;
const nextStep = () => DraftFlow.nextStep(S, { demo });

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
  const btn = (b, cls) => `<button type="button" class="${cls}" ${b.key ? `data-next="${b.key}"` : ''} ${b.arg ? `data-arg="${b.arg}"` : ''} ${b.off ? 'disabled aria-disabled="true"' : ''} ${b.keys ? 'aria-keyshortcuts="Space" title="スペースキーでも押せます"' : ''}>${b.label}</button>`;
  const warn = overlay.count ? '' : '<p class="mt-2 text-sm text-red-300">配信画面が開いていません。OBSのブラウザソース（またはブラウザ）で配信画面を開くと演出が流れます。開いていない間は、抽選の結果がすぐに出ます。</p>';
  $('next').innerHTML = `<div class="min-w-0 flex-1 leading-normal"><p class="text-xs text-[var(--text-muted)]">次にやること</p>
    <p class="mt-1 text-lg text-[var(--text-heading)] [&_b]:text-primary-300">${n.text}</p>${warn}</div>
    <div class="flex flex-wrap gap-2">${(n.sub || []).map((b) => btn(b, BTN_SUB)).join('')}${n.main ? btn({ ...n.main, keys: true }, BTN_PRIMARY.replace('h-11 px-4', 'h-12 px-6')) : ''}</div>`;

  // 重複の一覧(抽選は「次にやること」から順番に)
  $('conflicts').innerHTML = confs.map((c) => `<div class="flex flex-wrap items-center gap-4 p-4 bg-red-500/[.12] border border-red-500/40 rounded-lg">
    ${badge('dup', '重複')}<p class="text-base font-bold text-[var(--text-heading)]">${esc(C.playerById(S, c.playerId)?.name)}</p>
    <p class="text-sm">${c.leaders.map((id) => esc(C.leaderById(S, id)?.name)).join(' / ')} が競合</p></div>`).join('');

  // 各リーダーの指名
  const taken = C.pickedIds(S);
  const options = S.players.filter((p) => !taken.has(p.id) && !p.absent);
  const picked = (id) => {
    const p = C.playerById(S, id);
    return `<div class="flex items-center gap-3 h-11">${avatar(p?.icon, null, 'w-9 h-9')}<p class="text-lg font-bold text-[var(--text-heading)] truncate">${esc(p?.name)}</p></div>`;
  };
  // 全員の指名がそろってから公開できる(先に1人だけ見せない)
  const pendAll = C.pendingLeaders(S).every((l) => S.noms[l.id] && S.noms[l.id].playerId);
  // 重複が残っている間・抽選の演出中は再指名を入れられない(全部の抽選のあとでまとめて)
  const blocked = confs.length > 0 || !!(S.lottery && !S.lottery.done);
  const turnNow = C.currentTurn(S);
  const inLot = (id) => !!(S.lottery && !S.lottery.done && S.lottery.leaders.includes(id));
  $('noms').innerHTML = S.leaders.map((l) => {
    const pick = C.pickOf(S, l.id, S.round), n = S.noms[l.id] || {};
    let body, st;
    if (pick && !hiddenPick(pick)) { body = picked(pick.playerId); st = badge(pick.by === 'lottery' ? 'lot' : 'ok', pick.by === 'lottery' ? '抽選で確定' : '確定'); }
    // 抽選の演出中は、当たり・外れどちらも同じ見た目にする(管理画面でも結果が先にわからないように)
    else if (pick || inLot(l.id)) { body = picked(S.lottery.playerId); st = badge('lot', '抽選中'); }
    else if (n.revealed) { body = picked(n.playerId); st = confs.some((c) => c.leaders.includes(l.id)) ? badge('dup', '重複') : badge('in', '公開済み'); }
    else if (turnNow && turnNow.id !== l.id) { body = '<p class="flex items-center h-11 text-sm text-[var(--text-muted)]">順番を待っています</p>'; st = badge('wait', '順番待ち'); }
    else if (blocked) { body = '<p class="flex items-center h-11 text-sm text-[var(--text-muted)]">ほかの重複の抽選が終わったら再指名します</p>'; st = badge('wait', '再指名待ち'); }
    else {
      const canReveal = n.playerId && pendAll && !turnNow;
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

// 抽選の記録(取り消し・リセットも残る)
function renderLotteryLog() {
  const log = S.lotteryLog || [];
  $('lottery-log-count').textContent = `（${log.filter((e) => e.id).length}件）`;
  const time = (t) => new Date(t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const name = (id) => esc(C.playerById(S, id)?.name || '（削除された選手）');
  const lname = (id) => esc(C.leaderById(S, id)?.name || '（削除されたリーダー）');
  $('lottery-log').innerHTML = log.length ? log.slice().reverse().map((e) => e.reset
    ? `<li class="flex items-center gap-3 py-2"><span class="w-20 flex-none text-xs text-[var(--text-muted)]">${time(e.at)}</span>${badge('wait', 'リセット')}<span class="text-sm text-[var(--text-muted)]">ドラフトを最初からにしました</span></li>`
    : `<li class="flex flex-wrap items-center gap-3 py-2"><span class="w-20 flex-none text-xs text-[var(--text-muted)]">${time(e.at)}</span>${e.canceledAt ? badge('dup', '取り消し') : badge('ok', '有効')}
      <span class="text-sm ${e.canceledAt ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-heading)]'}">第${e.round}巡 <b>${name(e.playerId)}</b>（${e.leaders.map(lname).join(' / ')}）→ <b>${lname(e.winner)}</b></span>
      ${e.canceledAt ? `<span class="text-xs text-red-300">${time(e.canceledAt)} に取り消し</span>` : ''}</li>`).join('')
    : '<li class="py-2 text-sm text-[var(--text-muted)]">まだ抽選はありません</li>';
}

function renderRoster() {
  if (document.activeElement && document.activeElement.closest('#tab-roster') && document.activeElement.matches('input[type=text],textarea')) return; // 入力中は描き直さない
  $('in-title').value = S.title; $('in-rounds').value = S.rounds;
  const started = C.draftStarted(S);
  $('leaders').innerHTML = S.leaders.map((l, i) => `<div class="item ${CARD} flex flex-wrap items-end gap-4 px-4 py-3" data-id="${l.id}">
    <button type="button" data-icon="L" class="relative flex-none rounded-full cursor-pointer ${FOCUS}" aria-label="${esc(l.name)} の画像を${l.icon ? '変更' : '設定'}" title="クリック or 画像をドロップで${l.icon ? '変更' : '設定'}">${avatar(l.icon, l.color, 'w-11 h-11')}${CAM}</button>
    <div class="leading-normal"><label class="${LABEL}" for="ln-${l.id}">リーダー名</label><input id="ln-${l.id}" type="text" data-lf="name" value="${esc(l.name)}" class="w-48 ${INPUT}"></div>
    <div class="leading-normal"><label class="${LABEL}" for="lc-${l.id}">色</label><input id="lc-${l.id}" type="color" data-lf="color" value="${esc(l.color)}" class="block w-14 h-11 p-1 bg-[var(--bg-page)] border border-[var(--border-strong)] rounded-lg cursor-pointer ${FOCUS}"></div>
    <div class="ml-auto flex gap-1">
      <button type="button" class="${BTN_ICON}" data-move="-1" aria-label="上へ" ${i && !started ? '' : 'disabled aria-disabled="true"'}>${ICON.up}</button>
      <button type="button" class="${BTN_ICON}" data-move="1" aria-label="下へ" ${i < S.leaders.length - 1 && !started ? '' : 'disabled aria-disabled="true"'}>${ICON.down}</button>
      <button type="button" class="${BTN_ICON} hover:text-red-300" data-del-leader aria-label="${esc(l.name)} を削除" ${started ? 'disabled aria-disabled="true" title="ドラフトの途中は削除できません"' : ''}>${ICON.del}</button>
    </div></div>`).join('') || '<p class="text-base text-[var(--text-muted)] text-center py-16">まだいません。「追加」で登録してください</p>';
  const taken = C.pickedIds(S);
  $('player-count').textContent = `${S.players.length}人`;
  $('leader-count').textContent = `${S.leaders.length} / ${C.MAX_LEADERS}人`;
  setDisabled($('add-leader'), S.leaders.length >= C.MAX_LEADERS);
  $('players').innerHTML = S.players.map((p) => `<div class="item ${CARD} flex items-start gap-2 p-2 ${taken.has(p.id) ? 'opacity-50' : ''}" data-id="${p.id}" title="${taken.has(p.id) ? '指名済み' : ''}">
    <button type="button" data-icon="P" class="relative flex-none rounded-full cursor-pointer ${FOCUS}" aria-label="${esc(p.name)} の画像を${p.icon ? '変更' : '設定'}" title="クリック or 画像をドロップで${p.icon ? '変更' : '設定'}">${avatar(p.icon, null, 'w-11 h-11')}${CAM}</button>
    <div class="min-w-0 flex-1 flex flex-col gap-1">
      <input type="text" data-pf="name" value="${esc(p.name)}" aria-label="選手名" class="w-full ${INPUT}">
      <input type="text" data-pf="note" value="${esc(p.note || '')}" aria-label="${esc(p.name)} のひとこと" placeholder="ひとこと（段位など）" maxlength="30" class="w-full ${INPUT}">
      ${p.absent ? `<span>${badge('dup', '欠場')}</span>` : ''}
    </div>
    ${taken.has(p.id) ? '' : started
      ? `<button type="button" class="${BTN_SUB} flex-none px-3 text-sm" data-absent aria-pressed="${!!p.absent}">${p.absent ? '欠場を取り消す' : '欠場にする'}</button>`
      : `<button type="button" class="${BTN_ICON} hover:text-red-300" data-del-player aria-label="${esc(p.name)} を削除">${ICON.del}</button>`}</div>`).join('')
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

$('undo').addEventListener('click', () => {
  if (undoCancelsLottery && !confirm('直前の抽選を取り消します。\n取り消したことは「抽選の記録」に残ります。よろしいですか？')) return;
  ws.send(JSON.stringify({ type: 'undo' }));
});
// 進行タブでは、スペースキーで「次にやること」のメインのボタン(オレンジ)を押せる。
// 文字の入力中・登録タブ・画像の調整中は何もしない(暴発しないように)。押しっぱなしの連打も無視
let lastSpace = 0;
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if ($('tab-run').classList.contains('hidden') || $('crop').open || $('remote-dlg').open) return;
  e.preventDefault(); // フォーカスのあるほかのボタンが押されたり、画面がスクロールしたりしないように
  if (e.repeat || Date.now() - lastSpace < 500) return;
  const b = document.querySelector('#next button.h-12');
  if (!b || b.disabled) return;
  lastSpace = Date.now();
  b.click();
});
window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.target.matches('input,textarea')) { e.preventDefault(); $('undo').click(); } });
document.querySelectorAll('[data-scene]').forEach((b) => b.addEventListener('click', () => act({ type: 'setScene', scene: b.dataset.scene })));
$('copy-url').addEventListener('click', async () => { try { await navigator.clipboard.writeText(OVERLAY_URL); toast(`コピーしました: ${OVERLAY_URL}`); } catch { toast(OVERLAY_URL); } });

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.nom !== undefined) { act({ type: 'nominate', leaderId: t.dataset.nom, playerId: t.value || null }); t.blur(); } // 選んだらフォーカスを外す(スペースで進められるように)
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
  else if (t.dataset.absent !== undefined) { const p = C.playerById(S, t.closest('.item').dataset.id); act({ type: 'updatePlayer', id: p.id, patch: { absent: !p.absent } }); }
  else if (t.dataset.reset !== undefined) { if (confirm('ドラフトを最初からやり直します。\n名簿・画像・音の設定はそのままで、指名と抽選の結果だけを消します。\n（「1つ戻す」で元に戻せます）')) { act({ type: 'resetDraft' }); toast('ドラフトを最初からにしました'); } }
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
  if (key === 'confirm') act({ type: 'confirmNoms' });
  else if (key === 'reveal') act({ type: 'reveal' });
  else if (key === 'revealOne') act({ type: 'reveal', leaderId: arg });
  else if (key === 'spotShow') act({ type: 'spotShow', leaderId: arg });
  else if (key === 'spotFlip') act({ type: 'reveal', leaderId: arg, spot: true });
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
  const free = S.players.filter((p) => !taken.has(p.id) && !p.absent);
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

/* ---------- スマホ操作 ---------- */
function renderRemote() {
  const r = remoteInfo;
  $('remote-label').textContent = r.on ? `スマホ操作: オン（${r.clients}台）` : 'スマホ操作';
  $('remote-body').innerHTML = r.on
    ? `<div class="flex gap-4 items-start">
        <div class="w-44 h-44 flex-none p-2 bg-white rounded-lg [&_svg]:w-full [&_svg]:h-full" role="img" aria-label="スマホ操作の QR コード">${r.qr || ''}</div>
        <div class="min-w-0 flex flex-col gap-2">
          <p class="text-sm">${badge('ok', 'オン')} <span class="ml-1">つながっている端末: <b class="text-[var(--text-heading)]">${r.clients}台</b></span></p>
          <button type="button" data-remote="renew" class="inline-flex items-center justify-center h-11 px-4 text-[1rem] font-medium bg-[var(--bg-surface)] text-[var(--text-default)] border border-[var(--border-strong)] rounded-lg hover:bg-[var(--bg-page-alt)] cursor-pointer disabled:opacity-40 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50" title="鍵を作り直します。いまつながっている端末は切れます">鍵を作り直す</button>
          <button type="button" data-remote="off" class="inline-flex items-center justify-center h-11 px-4 text-[1rem] font-medium bg-[var(--bg-surface)] text-[var(--text-default)] border border-[var(--border-strong)] rounded-lg hover:bg-[var(--bg-page-alt)] cursor-pointer disabled:opacity-40 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50">オフにする</button>
        </div>
      </div>
      ${r.urls && r.urls.length ? '' : '<p class="mt-3 text-sm text-red-300">Wi-Fi などのネットワークが見つかりません</p>'}`
    : `<p class="text-sm">いまはオフです。オンにすると QR コードが出ます。</p><button type="button" data-remote="on" class="mt-3 inline-flex items-center justify-center h-11 px-4 text-[1rem] font-medium bg-primary-500 text-slate-900 rounded-lg hover:bg-primary-600 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50">オンにする</button>`;
}
$('remote-open').addEventListener('click', () => { renderRemote(); $('remote-dlg').showModal(); });
$('remote-close').addEventListener('click', () => $('remote-dlg').close());
$('remote-dlg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remote]');
  if (b) ws.send(JSON.stringify({ type: 'remote', cmd: b.dataset.remote }));
});

/* ---------- 進め方の設定 ---------- */
const optionsOf = () => C.optionsOf(S);
const setOption = (patch) => act({ type: 'setOption', patch });
function renderOptions() {
  const o = optionsOf();
  // 巡ごとの指名のしかた
  const modes = $('round-modes');
  if (!modes.contains(document.activeElement)) {
    modes.innerHTML = Array.from({ length: S.rounds }, (_, i) => {
      const m = o.roundModes[i] || 'bid';
      return `<div class="relative"><label class="sr-only" for="rm-${i}">第${i + 1}巡の指名のしかた</label><select id="rm-${i}" data-round-mode="${i}" class="appearance-none w-44 pl-3 pr-10 ${INPUT} cursor-pointer"><option value="bid" ${m === 'bid' ? 'selected' : ''}>第${i + 1}巡: 一斉入札</option><option value="order" ${m === 'order' ? 'selected' : ''}>第${i + 1}巡: 順番指名</option></select>${ICON.chevron}</div>`;
    }).join('');
  }
  for (const [id, v] of [['opt-order', o.orderStyle], ['opt-lottery', o.lotteryStyle], ['opt-timer', o.timerSec]]) if (document.activeElement !== $(id)) $(id).value = v;
  $('opt-timershow').checked = !!o.timerShow;
  $('wait-img').classList.toggle('hidden', !o.waitImage);
  if (o.waitImage) $('wait-img').src = img(o.waitImage);
  setDisabled($('wait-clear'), !o.waitImage);
}
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.roundMode !== undefined) {
    const m = [...optionsOf().roundModes]; m[+t.dataset.roundMode] = t.value;
    setOption({ roundModes: Array.from({ length: S.rounds }, (_, i) => m[i] || 'bid') });
  } else if (t.id === 'opt-order') setOption({ orderStyle: t.value });
  else if (t.id === 'opt-lottery') setOption({ lotteryStyle: t.value });
  else if (t.id === 'opt-timer') setOption({ timerSec: Math.max(10, Math.min(3600, +t.value || 120)) });
  else if (t.id === 'opt-timershow') setOption({ timerShow: t.checked });
});
$('wait-pick').addEventListener('click', () => { $('wait-file').value = ''; $('wait-file').click(); });
$('wait-clear').addEventListener('click', () => setOption({ waitImage: '' }));
$('wait-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f || !IMG_EXT[f.type]) return toast('PNG / JPEG / GIF / WebP の画像を選んでください', true);
  try { setOption({ waitImage: await upload(`wait_${Date.now()}${IMG_EXT[f.type]}`, f) }); } catch (err) { toast(err.message, true); }
});

// 制限時間: 残りは「終わる時刻」から計算して、0.25秒ごとに表示を更新
const fmt = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
function timerLeft() {
  const t = S.timer || {}, o = optionsOf();
  if (t.endsAt) return Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000));
  return t.left ?? o.timerSec;
}
function renderTimer() {
  if (!S) return;
  const t = S.timer || {}, left = timerLeft(), running = !!t.endsAt && left > 0;
  $('timer-left').textContent = fmt(left);
  $('timer-left').className = `min-w-[4.5rem] text-2xl font-bold tabular-nums ${t.endsAt && left === 0 ? 'text-red-300' : 'text-[var(--text-heading)]'}`;
  setDisabled($('timer-start'), running);
  setDisabled($('timer-stop'), !running);
  $('timer-start').textContent = t.left != null && !t.endsAt ? '続きから' : 'スタート';
  $('timer-note').textContent = t.endsAt && left === 0 ? '時間になりました' : optionsOf().timerShow ? '配信画面にも出ます' : '配信画面には出しません（登録タブで変えられます）';
}
setInterval(renderTimer, 250);
$('timer-start').addEventListener('click', () => act({ type: 'timer', cmd: 'start' }));
$('timer-stop').addEventListener('click', () => act({ type: 'timer', cmd: 'stop' }));
$('timer-reset').addEventListener('click', () => act({ type: 'timer', cmd: 'reset' }));

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
