// 管理画面
const C = window.DraftCore;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = (f) => (f ? `/images/${encodeURIComponent(f)}` : '');
const OVERLAY_URL = `${location.origin}/overlay`;

let remoteInfo = { on: false };
// 画面の状態: いまのタブ / 進行表の見せ方(edit 編集・live 本番) / 編集で選んでいる場面 / ドラフトのタブの見せ方(look 名前と見た目・setup 進め方) / 選手の絞り込み / 選んでいるチーム
const ui = { tab: 'prog', view: 'edit', selId: null, draftView: 'look', filter: 'all', search: '', leaderId: null };
let selectNewScene = 0; // 場面を足したとき、足した場面を選ぶための目印
let lib = null; // ドラフト(大会)の一覧と名簿(サーバーから)
let S = null, canUndo = false, undoCancelsLottery = false, demo = false, ws = null, bgmList = [], overlay = { count: 0 };

/* ---------- 見た目(melta UI のクラス。色はアプリの金×焦げ茶) ---------- */
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50';
const BTN_PRIMARY = `inline-flex items-center justify-center h-11 px-4 text-[1rem] font-medium bg-primary-500 text-slate-900 rounded-lg hover:bg-primary-600 cursor-pointer disabled:opacity-40 disabled:cursor-default ${FOCUS}`;
const BTN_SUB = `inline-flex items-center justify-center h-11 px-4 text-[1rem] font-medium bg-[var(--bg-surface)] text-[var(--text-default)] border border-[var(--border-strong)] rounded-lg hover:bg-[var(--bg-page-alt)] cursor-pointer disabled:opacity-40 disabled:cursor-default ${FOCUS}`;
const BTN_ICON = `w-11 h-11 flex-none inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-page-alt)] hover:text-[var(--text-default)] cursor-pointer disabled:opacity-40 disabled:cursor-default ${FOCUS}`;
const CARD = 'bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] shadow-sm';
const TEXTAREA = 'block w-full px-3 py-2 text-sm bg-[var(--bg-page)] text-[var(--text-default)] border border-[var(--border-strong)] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400/50 caret-primary-400';
const INPUT = 'h-11 px-3 text-sm bg-[var(--bg-page)] text-[var(--text-default)] border border-[var(--border-strong)] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400/50 caret-primary-400';
const LABEL = 'block mb-2 text-xs text-[var(--text-muted)]';
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
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
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
  ws.onopen = () => { $('conn').textContent = '● 接続中'; $('conn').className = 'sr-only'; };
  ws.onclose = () => { $('conn').textContent = '× 切断（再接続中…）'; $('conn').className = 'text-xs text-red-300 whitespace-nowrap'; setTimeout(connect, 1000); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') {
      S = m.state; canUndo = m.canUndo; undoCancelsLottery = !!m.undoCancelsLottery; demo = !!m.demo;
      const prog = C.programOf(S);
      if (selectNewScene && prog.length >= selectNewScene) { ui.selId = prog[prog.length - 2]?.id || null; selectNewScene = 0; }
      render();
    }
    else if (m.type === 'remote') { remoteInfo = m; renderRemote(); }
    else if (m.type === 'presence') { overlay = m; renderOverlayStatus(); if (S) renderRun(); }
    else if (m.type === 'bgmList') { bgmList = m.list; if (S) render(); }
    else if (m.type === 'library') { lib = m; if (S) { renderLibrary(); renderRosterDlg(); } }
    else if (m.type === 'error') toast(m.message, true);
  };
}
const act = (action) => ws.send(JSON.stringify({ type: 'action', action }));
const TOAST = 'fixed left-1/2 bottom-28 -translate-x-1/2 z-40 px-4 py-3 rounded-lg shadow-xl text-sm border bg-[var(--bg-surface)]';
function toast(t, err) {
  const el = $('toast'); el.textContent = t;
  el.className = `${TOAST} ${err ? 'border-red-500/60 text-red-300' : 'border-[var(--border-strong)] text-[var(--text-heading)]'}`;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.className = TOAST + ' hidden'; }, err ? 6000 : 3000);
}

/* ---------- 配信画面(OBS / ブラウザ)が開いているか ---------- */
function renderOverlayStatus() {
  const o = overlay, el = $('overlay-st');
  const [text, cls, tip] = !o.count ? ['× 配信画面なし', 'text-red-300', 'OBS のブラウザソース（またはブラウザ）で配信画面を開いてください']
    : o.obs && o.hidden ? ['● 映っていません', 'text-amber-300', 'OBS の今のシーンには、配信画面が映っていません']
    : o.obs ? ['● 表示中', 'text-emerald-300', 'OBS で配信画面を表示しています']
    : ['● 表示中', 'text-emerald-300', 'ブラウザで配信画面を表示しています'];
  el.textContent = text; el.className = `whitespace-nowrap text-xs ${cls}`; el.title = tip; // 詳しくはマウスを乗せると出る
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
  $('undo').classList.add('hidden'); // 取り消しは Ctrl+Z だけ(ボタンは出さない)
  document.querySelectorAll('[data-scene]').forEach((b) => {
    const on = b.dataset.scene === S.scene || (b.dataset.scene === 'roulette' && S.scene === 'lots');
    b.setAttribute('aria-pressed', on);
    b.classList.toggle('bg-[var(--bg-page-alt)]', on); b.classList.toggle('text-[var(--text-heading)]', on);
    b.classList.toggle('text-[var(--text-muted)]', !on); b.classList.toggle('hover:text-[var(--text-default)]', !on);
  });
  show($('demo-banner'), demo, 'flex'); show($('demo-enter'), !demo && ui.view !== 'live', 'inline-flex');
  document.querySelectorAll('[data-mode]').forEach((b) => {
    const on = b.dataset.mode === ui.view;
    b.setAttribute('aria-pressed', on);
    b.classList.toggle('bg-primary-500', on && on === (b.dataset.mode === 'live')); b.classList.toggle('text-slate-900', on && b.dataset.mode === 'live');
    b.classList.toggle('bg-[var(--bg-page-alt)]', on && b.dataset.mode === 'edit'); b.classList.toggle('text-[var(--text-heading)]', on && b.dataset.mode === 'edit');
    b.classList.toggle('text-[var(--text-muted)]', !on);
  });
  renderProg();
  renderLeaders();
  renderPlayers();
  renderAudio();
  renderLotteryLog();
  renderOptions();
  renderShow();
  renderDraftTab();
  renderLibrary();
  renderRosterDlg();
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

/* ---------- 進行表 ----------
 * 編集: 左に場面の一覧、右に選んだ場面(ドラフトは本番の操作。進め方はドラフトのタブ)
 * 本番: 左に映している場面、右に「次にやること」と「メモ」、その下に次の場面。番組の中身と設定は触れない */
const TYPE_LABEL = C.PROGRAM_TYPES;
const typeLabel = (g) => { const sl = g.type === 'slide' ? C.slideById(S, g.slideId) : null; return sl ? (sl.kind === 'image' ? '画像の資料' : '文字の資料') : TYPE_LABEL[g.type]; };
const selItem = () => { const prog = C.programOf(S); return prog.find((g) => g.id === ui.selId) || C.progItem(S) || prog[0]; };
function renderProg() {
  const live = ui.view === 'live';
  $('prog-edit').classList.toggle('hidden', live); $('prog-live').classList.toggle('hidden', !live);
  $('tabs').classList.toggle('hidden', live); show($('live-head'), live, 'flex');
  const cur = C.progItem(S), sel = live ? cur : selItem(), isDraft = sel && sel.type === 'draft';
  // ドラフトの場面の「本番」と、制限時間は、編集と本番で同じものを置き場所だけ変えて使う
  const dl = $('draft-live'), tr = $('timer-row');
  if (live) {
    if (cur && cur.type === 'draft') { if (dl.parentElement !== $('live-main')) $('live-main').appendChild(dl); dl.classList.remove('hidden'); }
    else if (dl.parentElement !== $('scene-pane')) $('scene-pane').appendChild(dl);
    if (tr.parentElement !== $('live-timer')) $('live-timer').appendChild(tr);
  } else {
    if (dl.nextElementSibling !== $('scene-edit')) $('scene-pane').insertBefore(dl, $('scene-edit'));
    if (tr.parentElement !== $('round-summary').parentElement) $('round-summary').parentElement.appendChild(tr);
  }
  renderRun();
  if (live) renderLive(cur);
  else {
    renderRail(sel);
    renderFirstRun();
    renderSceneHead(sel);
    renderSceneEdit(sel);
    dl.classList.toggle('hidden', !isDraft);
    $('round-edit').classList.remove('hidden');
  }
}
function renderRail(sel) {
  const prog = C.programOf(S), cur = C.progIdxOf(S);
  $('prog-rail').innerHTML = prog.map((g, i) => {
    const on = g.id === sel.id, now = i === cur, done = i < cur;
    return `<li data-drag-id="${g.id}" draggable="true" title="ドラッグで順番を変える（Alt+↑↓ でも）" class="flex items-center gap-1 rounded-lg">${GRIP}<button type="button" data-sel="${g.id}" ${on ? 'aria-current="true"' : ''} class="flex-1 min-w-0 min-h-11 flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm border cursor-pointer ${FOCUS} ${on ? 'border-primary-500 bg-primary-500/[.12] text-[var(--text-heading)] font-bold' : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-page-alt)] ' + (done ? 'text-[var(--text-muted)]' : 'text-[var(--text-default)]')}">
      <span class="w-5 flex-none text-xs tabular-nums text-[var(--text-muted)]">${done ? '✓' : i + 1}</span><span class="min-w-0 flex-1 truncate">${esc(g.label)}</span>
      ${g.bgm && g.bgm !== '-' ? `<span class="flex-none text-xs text-primary-300" title="BGM: ${esc(g.bgm)}" aria-label="BGM あり">♪</span>` : ''}${now ? '<span class="flex-none px-2 rounded-full text-[11px] font-bold bg-red-500/[.12] text-red-300">映している</span>' : `<span class="flex-none text-[11px] text-[var(--text-muted)]">${esc(typeLabel(g))}</span>`}</button></li>`;
  }).join('');
  refocusDrag($('prog-rail'));
}
sortable($('prog-rail'), (id, to) => act({ type: 'reorderProgram', id, to }));
// はじめて(名簿が空): 何から始めるか
function renderFirstRun() {
  const el = $('first-run'), empty = !S.leaders.length || !S.players.length;
  show(el, empty && !demo, 'flex');
  if (!empty || demo) return;
  const step = (n, text, done, btn) => `<div class="flex items-center gap-3 min-h-11 px-3 py-2 rounded-lg border border-[var(--border-default)]"><span class="w-7 h-7 flex-none inline-flex items-center justify-center rounded-full text-sm font-bold ${done ? 'bg-emerald-500/[.12] text-emerald-300' : 'border border-[var(--border-strong)] text-[var(--text-muted)]'}">${done ? '✓' : n}</span><span class="flex-1 text-sm ${done ? 'text-[var(--text-muted)]' : 'text-[var(--text-heading)]'}">${text}</span>${btn}</div>`;
  el.innerHTML = `<h2 class="text-base font-bold text-[var(--text-heading)]">はじめに</h2>
    ${step(1, 'チームを作る（リーダーを決める）', S.leaders.length > 0, `<button type="button" data-goto="leaders" class="${BTN_SUB}">チームへ</button>`)}
    ${step(2, 'エントリー選手を登録する', S.players.length > 0, `<button type="button" data-goto="players" class="${BTN_SUB}">選手へ</button>`)}
    ${step(3, 'ドラフト名と見た目・進め方を決める', false, `<button type="button" data-goto="draft" class="${BTN_SUB}">ドラフトへ</button>`)}
    ${step(4, 'OBS に配信画面を追加する', overlay.count > 0, `<button type="button" data-copy-url class="${BTN_SUB}">URL をコピー</button>`)}
    ${step(5, 'お試しで一通り動かしてみる', false, `<button type="button" data-demo class="${BTN_SUB}">お試しを始める</button>`)}`;
}
// 選んだ場面の見出し: 種類・名前・外す・映す(並べ替えは左の一覧をドラッグ)
function renderSceneHead(g) {
  const el = $('scene-head');
  if (el.contains(document.activeElement) && document.activeElement.matches('input')) return;
  const prog = C.programOf(S), i = prog.indexOf(g), cur = C.progIdxOf(S);
  el.dataset.progId = g.id;
  el.innerHTML = `${badge(g.type === 'draft' ? 'in' : 'wait', esc(typeLabel(g)))}
    <label class="sr-only" for="pl-${g.id}">場面の名前</label><input id="pl-${g.id}" type="text" data-prog-label="${g.id}" value="${esc(g.label)}" maxlength="20" class="w-56 ${INPUT}">
    <div class="ml-auto flex items-center gap-1">
      <button type="button" class="${BTN_ICON} hover:text-red-300" data-prog-del aria-label="${esc(g.label)} を外す" ${g.type === 'draft' ? 'disabled aria-disabled="true" title="ドラフトは外せません"' : ''}>${ICON.del}</button>
      <button type="button" data-prog-go="${i}" class="${BTN_SUB} ml-2" ${i === cur ? 'disabled aria-disabled="true"' : ''}>${i === cur ? '映しています' : 'この場面を映す'}</button>
    </div>`;
}
// ドラフト以外の場面の中身(＋全場面の自分用メモ)
function renderSceneEdit(g) {
  const el = $('scene-edit');
  if (el.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
  const sl = g.type === 'slide' ? C.slideById(S, g.slideId) : null;
  let body = '';
  if (sl && sl.kind === 'text') {
    body = `<div class="grid grid-cols-[1fr_2fr] gap-4">
      <div class="leading-normal"><label class="${LABEL}" for="st-${sl.id}">見出し</label><input id="st-${sl.id}" type="text" data-slide="${sl.id}" data-slide-f="title" value="${esc(sl.title)}" class="w-full ${INPUT}"></div>
      <div class="leading-normal"><div class="flex items-end justify-between gap-2"><label class="${LABEL}" for="sl-${sl.id}">箇条書き</label>${sl.rules || sl.id === 'S_draft' ? `<button type="button" data-slide-rules="${sl.id}" class="mb-2 text-xs font-medium text-primary-300 hover:underline cursor-pointer ${FOCUS}">今の進め方で自動入力</button>` : ''}</div><textarea id="sl-${sl.id}" rows="${Math.max(4, (sl.lines || []).length)}" data-slide="${sl.id}" data-slide-f="lines" class="${TEXTAREA}">${esc((sl.lines || []).join('\n'))}</textarea></div></div>`;
  } else if (sl && sl.kind === 'image') {
    const fit = sl.fit === 'full' ? 'full' : 'card';
    const fitBtn = (k, t) => `<button type="button" data-slide-fit="${k}" aria-pressed="${fit === k}" class="relative after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 h-9 px-4 rounded-md text-sm font-medium cursor-pointer ${FOCUS} ${fit === k ? 'bg-[var(--bg-page-alt)] text-[var(--text-heading)]' : 'text-[var(--text-muted)]'}">${t}</button>`;
    body = `<div class="leading-normal"><span class="${LABEL}">出し方</span><div class="inline-flex p-1 gap-1 rounded-lg bg-[var(--bg-page)] border border-[var(--border-strong)]" role="group" aria-label="画像の出し方" data-slide-id="${sl.id}">${fitBtn('card', '枠つき（見出しの下に）')}${fitBtn('full', '画面いっぱい')}</div></div>
      <div class="flex items-center gap-3">${sl.image ? `<img src="${img(sl.image)}" alt="" class="w-64 aspect-video object-contain rounded-lg bg-[var(--bg-page)] border border-[var(--border-default)]">` : '<span class="text-sm text-[var(--text-muted)]">画像がまだありません</span>'}<button type="button" data-pick="slide:${sl.id}" class="${BTN_SUB}">画像を選ぶ</button></div>`;
  } else if (g.type === 'intro') {
    body = `<p class="text-sm text-[var(--text-muted)]">リーダーを1人ずつ、立ち絵と名前の帯で出します。紹介文と紹介のメモはここでも直せます。</p>
      <ol class="flex flex-col gap-2">${S.leaders.map((l) => `<li class="item flex flex-wrap items-center gap-3 p-3 ${CARD}" data-id="${l.id}">${avatar(l.icon, l.color)}<b class="w-32 truncate text-sm text-[var(--text-heading)]">${esc(l.name)}</b>
        <label class="sr-only" for="ii-${l.id}">${esc(l.name)} の紹介文</label><input id="ii-${l.id}" type="text" data-lf="intro" value="${esc(l.intro || '')}" placeholder="紹介文（配信に出る）" maxlength="30" class="w-56 ${INPUT}">
        <label class="sr-only" for="im-${l.id}">${esc(l.name)} の紹介のメモ</label><input id="im-${l.id}" type="text" data-lf="introMemo" value="${esc(l.introMemo || '')}" placeholder="紹介のメモ（自分用）" class="flex-1 min-w-48 ${INPUT}"></li>`).join('')}</ol>`;
  } else if (g.type === 'logo') body = '<p class="text-sm text-[var(--text-muted)]">大会のロゴ（なければ大会名）を大きく出します。</p>';
  else if (g.type === 'final') body = '<p class="text-sm text-[var(--text-muted)]">最終のチーム表を出します。</p>';
  else if (g.type === 'blank') body = '<p class="text-sm text-[var(--text-muted)]">配信画面に何も出しません。</p>';
  // その場面の BGM(同じ曲が続く場面では止めずにそのまま流れる)
  const names = g.bgm && g.bgm !== '-' && !bgmList.includes(g.bgm) ? [...bgmList, g.bgm] : bgmList;
  const bgmSel = `<div class="leading-normal"><label class="${LABEL}" for="pb-${g.id}">BGM</label><div class="relative w-80"><select id="pb-${g.id}" data-prog-bgm="${g.id}" class="appearance-none w-full pl-3 pr-10 ${INPUT} cursor-pointer">
      <option value="" ${!g.bgm ? 'selected' : ''}>設定なし</option><option value="-" ${g.bgm === '-' ? 'selected' : ''}>BGM なし</option>
      ${names.map((nm) => `<option value="${esc(nm)}" ${nm === g.bgm ? 'selected' : ''}>♪ ${esc(nm.replace(/\.[^.]+$/, ''))}${bgmList.includes(nm) ? '' : '（見つかりません）'}</option>`).join('')}</select>${ICON.chevron}</div></div>`;
  const memo = `<div class="leading-normal"><label class="${LABEL}" for="pm-${g.id}">メモ（自分用。配信には出ません）</label><textarea id="pm-${g.id}" rows="6" data-prog-memo="${g.id}" placeholder="話すこと・台本など" class="${TEXTAREA} resize-y">${esc(g.memo || '')}</textarea></div>`;
  // ドラフトの場面は、本番の操作の下に BGM とメモを折りたたんで(本番の画面は指名に集中)
  el.innerHTML = g.type === 'draft' ? `<details class="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl"><summary class="px-4 py-3 text-base font-bold text-[var(--text-heading)] cursor-pointer">BGM とメモ</summary><div class="px-4 pb-4 flex flex-col gap-4">${bgmSel + memo}</div></details>` : body + bgmSel + memo;
}
// 本番ビュー: 映している場面・次にやること・メモ・次の場面
let previewOn = false;
function renderLive(cur) {
  const prog = C.programOf(S), i = C.progIdxOf(S), n = nextStep();
  $('live-pos').textContent = `${i + 1} / ${prog.length}`;
  const isDraft = cur && cur.type === 'draft', isIntro = cur && cur.type === 'intro';
  const k = Math.min(S.introIdx || 0, S.leaders.length - 1), l = isIntro ? S.leaders[k] : null;
  $('live-title').textContent = !cur ? '' : isDraft ? cur.label : isIntro && l ? `${cur.label}　${k + 1} / ${S.leaders.length}　${l.name}` : cur.label;
  $('live-preview').classList.toggle('hidden', !!isDraft);
  if (!previewOn) { $('preview-frame').src = '/overlay?preview=1'; $('next-frame').src = '/overlay?preview=next'; previewOn = true; requestAnimationFrame(fitPreview); }
  $('round-edit').classList.add('hidden'); // 本番では設定に行かない
  $('live-next').innerHTML = n.text || '';
  const memo = [l && l.introMemo ? `${l.name}: ${l.introMemo}` : '', cur && cur.memo ? cur.memo : ''].filter(Boolean).join('\n');
  if ($('live-memo').dataset.text !== memo) { $('live-memo').style.height = ''; $('live-memo').dataset.text = memo; }
  $('live-memo').textContent = memo || '（メモはありません）';
  $('live-memo').classList.toggle('text-[var(--text-muted)]', !memo);
  const nl = isIntro ? S.leaders[k + 1] : null, ng = prog[i + 1];
  const m = n.main && !n.main.off ? n.main.label.replace(/<[^>]+>/g, '') : '';
  $('live-upnext').textContent = m ? `（${m} を押したあと）` : nl ? nl.name : ng ? ng.label : '（最後の場面です）';
  $('next-preview').classList.toggle('hidden', !nl && !ng);
}
function fitPreview() {
  for (const [box, fr] of [['live-preview', 'preview-frame'], ['next-preview', 'next-frame']]) $(fr).style.transform = `scale(${$(box).clientWidth / 1920})`;
}
// メモの文字の大きさと、右の列の幅(この画面だけの好み。ブラウザに覚えておく)
const pref = { get: (k, d) => { try { return +localStorage.getItem(k) || d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
let memoSize = pref.get('memoSize', 18), sideW = pref.get('sideW', 420);
const applyPrefs = () => { $('live-memo').style.setProperty('--memo', memoSize + 'px'); $('prog-live').style.setProperty('--side', sideW + 'px'); $('live-split').setAttribute('aria-valuenow', sideW); fitPreview(); };
applyPrefs();
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-memo-size]');
  if (!b) return;
  memoSize = Math.max(12, Math.min(48, memoSize + 2 * +b.dataset.memoSize)); pref.set('memoSize', memoSize); applyPrefs();
});
{
  const sp = $('live-split'); let drag = null;
  sp.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, w: sideW }; sp.setPointerCapture(e.pointerId); });
  sp.addEventListener('pointermove', (e) => { if (!drag) return; sideW = Math.max(300, Math.min(760, drag.w - (e.clientX - drag.x))); applyPrefs(); });
  sp.addEventListener('pointerup', () => { if (drag) pref.set('sideW', sideW); drag = null; });
  sp.addEventListener('keydown', (e) => { const d = { ArrowLeft: 20, ArrowRight: -20 }[e.key]; if (!d) return; e.preventDefault(); sideW = Math.max(300, Math.min(760, sideW + d)); pref.set('sideW', sideW); applyPrefs(); });
}
addEventListener('resize', () => { if (ui.view === 'live') fitPreview(); });
function setView(v) {
  ui.view = v;
  if (v === 'live') selectTab('prog');
  else { $('preview-frame').src = 'about:blank'; $('next-frame').src = 'about:blank'; previewOn = false; }
  render();
  if (v === 'live') requestAnimationFrame(fitPreview);
}

function renderRun() {
  const confs = C.conflicts(S), done = C.draftComplete(S);
  $('round-title').textContent = done ? 'ドラフト終了' : `第${S.round}巡`;
  // この巡の設定の1行の要約(変更は「⚙ 進め方」で)
  const wn = C.waitImagesOf(S).length, wi = Math.min(S.waitIdx || 0, Math.max(0, wn - 1));
  $('round-summary').textContent = `第${S.round}巡: ${C.roundMode(S) === 'order' ? '順番指名' : '一斉入札'} ・ 待ち時間の画像 ${wn ? (S.scene === 'wait' ? `${wi + 1} / ${wn}枚目` : `${wn}枚`) : 'なし'}`;
  const n = nextStep();
  renderSteps(n.step);
  const btn = (b, cls) => `<button type="button" class="${cls}" ${b.key ? `data-next="${b.key}"` : ''} ${b.arg ? `data-arg="${b.arg}"` : ''} ${b.off ? 'disabled aria-disabled="true"' : ''} ${b.keys ? 'aria-keyshortcuts="Space" title="スペースキーでも押せます"' : ''}>${b.label}</button>`;
  const warn = overlay.count ? '' : '<p class="mt-2 text-sm text-red-300">配信画面が開いていません。OBSのブラウザソース（またはブラウザ）で配信画面を開くと演出が流れます。開いていない間は、抽選の結果がすぐに出ます。</p>';
  $('next').innerHTML = `<div class="min-w-0 flex-1 leading-normal">${ui.view === 'live' ? warn : `<p class="text-xs text-[var(--text-muted)]">次にやること</p>
    <div class="mt-1 text-lg text-[var(--text-heading)] [&_b]:text-primary-300">${n.text}</div>${warn}`}</div>
    <div class="flex flex-wrap items-center gap-2">${(n.choices || []).map((b) => `<button type="button" data-next="${b.key}" data-arg="${b.arg}" class="${BTN_SUB} gap-2 pl-3 min-w-[96px]" ${b.off ? 'disabled aria-disabled="true"' : ''} aria-label="${b.label}を選ぶ"><span class="w-5 h-5 rounded-md bg-[var(--lc)] ring-1 ring-white/30" style="--lc:${b.color}" aria-hidden="true"></span>${b.label}</button>`).join('')}${(n.sub || []).map((b) => btn(b, BTN_SUB)).join('')}
      <button type="button" data-next="progPrev" class="${BTN_SUB} gap-2 pl-3" ${C.progIdxOf(S) > 0 ? '' : 'disabled aria-disabled="true"'} title="進行表の1つ前の場面に戻ります(操作の取り消しは Ctrl+Z)"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>前の場面へ</button>
      ${n.main ? btn({ ...n.main, label: n.main.busy ? '演出中…' : n.main.label, keys: true }, BTN_PRIMARY.replace('h-11 px-4', 'h-12 min-w-[184px] px-6')) : ''}</div>`;

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
      <p class="min-w-0 leading-tight"><b class="block text-base text-[var(--text-heading)] truncate">${esc(C.teamLabel(S, l))}</b><span class="block text-xs text-[var(--text-muted)] truncate">${esc(l.name)}</span></p>
      <div class="ml-auto">${st}</div></div>${body}</div>`;
  }).join('');

  // チーム
  $('teams').innerHTML = S.leaders.map((l) => {
    const team = C.teamOf(S, l.id).filter((p) => !hiddenPick(p));
    const rows = Array.from({ length: S.rounds }, (_, i) => {
      const p = team.find((t) => t.round === i + 1);
      return `<li class="flex items-center gap-2"><span class="w-10 flex-none text-xs text-[var(--text-muted)]">${i + 1}巡</span>${p ? `<span class="text-sm text-[var(--text-heading)] truncate">${esc(C.playerById(S, p.playerId)?.name)}</span>` : '<span class="text-sm text-[var(--text-muted)]">―</span>'}</li>`;
    }).join('');
    return `<div class="${CARD} p-4"><div class="flex items-center gap-3 mb-2">${avatar(l.icon, l.color, 'w-8 h-8')}<p class="min-w-0 text-sm font-bold text-[var(--text-heading)] truncate">${esc(C.teamLabel(S, l))}</p></div><ol class="flex flex-col">${rows}</ol></div>`;
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
      <span class="text-sm ${e.canceledAt ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-heading)]'}">第${e.round}巡 <b>${name(e.playerId)}</b>（${e.leaders.map(lname).join(' / ')}）→ <b>${lname(e.winner)}</b></span>${e.picks ? `<span class="text-xs text-[var(--text-muted)]">${e.leaders.map((id) => `${esc(e.lots[e.picks[id]])}→${lname(id)}`).join(' / ')}（当たり ${esc(e.lots[e.winLot])}）</span>` : ''}
      ${e.canceledAt ? `<span class="text-xs text-red-300">${time(e.canceledAt)} に取り消し</span>` : ''}</li>`).join('')
    : '<li class="py-2 text-sm text-[var(--text-muted)]">まだ抽選はありません</li>';
}

/* ---------- ドラッグで並べ替え(進行表の場面・チーム) ----------
 * 行(data-drag-id、draggable)をつかんで、落とした位置へ。キーボードは行のボタンで Alt+↑↓ */
let dragFocus = null; // キーボードで動かしたあと、同じ行にフォーカスを戻す
function sortable(list, onMove) {
  let from = null;
  const rows = () => [...list.querySelectorAll('[data-drag-id]')];
  const mark = (r, v) => { r.style.boxShadow = v ? `0 ${v === 'after' ? 3 : -3}px 0 0 var(--color-primary-500, #e0a526)` : ''; r.dataset.drop = v || ''; };
  const clear = () => rows().forEach((r) => { mark(r, ''); r.style.opacity = ''; });
  list.addEventListener('dragstart', (e) => {
    const r = e.target.closest('[data-drag-id]'); if (!r || r.getAttribute('draggable') !== 'true') return;
    from = r.dataset.dragId; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', from); r.style.opacity = '.5';
  });
  list.addEventListener('dragover', (e) => {
    const r = from && e.target.closest('[data-drag-id]'); if (!r) return;
    e.preventDefault(); const b = r.getBoundingClientRect();
    rows().forEach((x) => x !== r && mark(x, '')); mark(r, e.clientY > b.top + b.height / 2 ? 'after' : 'before');
  });
  list.addEventListener('drop', (e) => {
    if (!from) return; e.preventDefault();
    const r = e.target.closest('[data-drag-id]'), ids = rows().map((x) => x.dataset.dragId), i = ids.indexOf(from);
    if (r && i >= 0) { const k = ids.indexOf(r.dataset.dragId), to = r.dataset.drop === 'after' ? (k >= i ? k : k + 1) : (k > i ? k - 1 : k); if (to !== i) onMove(from, to); }
    clear(); from = null;
  });
  list.addEventListener('dragend', () => { clear(); from = null; });
  list.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const r = e.target.closest('[data-drag-id]'); if (!r || r.getAttribute('draggable') !== 'true') return;
    e.preventDefault();
    const ids = rows().map((x) => x.dataset.dragId), to = ids.indexOf(r.dataset.dragId) + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= ids.length) return;
    dragFocus = r.dataset.dragId; onMove(r.dataset.dragId, to);
  });
}
const refocusDrag = (list) => { if (!dragFocus) return; const b = list.querySelector(`[data-drag-id="${dragFocus}"] button`); dragFocus = null; if (b) b.focus(); };
const GRIP = '<span class="flex-none text-[var(--text-muted)] cursor-grab" aria-hidden="true"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>';

/* ---------- チーム: 一覧と、選んだ1チームのパネル ----------
 * パネル = チーム(名前・色・ロゴ) / リーダー(顔・名前・略称・立ち絵・紹介文) / メンバー(リーダー＋ドラフトの結果) */
function renderLeaders() {
  const started = C.draftStarted(S);
  $('leader-count').textContent = `${S.leaders.length} / ${C.MAX_LEADERS}チーム`;
  setDisabled($('add-leader'), S.leaders.length >= C.MAX_LEADERS);
  if (!S.leaders.some((l) => l.id === ui.leaderId)) ui.leaderId = S.leaders[0]?.id || null;
  $('leaders').innerHTML = S.leaders.map((l) => {
    const on = l.id === ui.leaderId;
    return `<li class="item flex items-center gap-2 rounded-xl" data-id="${l.id}" data-drag-id="${l.id}" draggable="${!started}" ${started ? 'title="ドラフトの途中は順番を変えられません"' : 'title="ドラッグで順番を変える（Alt+↑↓ でも）"'}>${started ? '' : GRIP}<button type="button" data-leader-sel="${l.id}" ${on ? 'aria-current="true"' : ''} class="flex-1 min-w-0 min-h-14 flex items-center gap-3 px-3 py-2 rounded-xl border text-left cursor-pointer ${FOCUS} ${on ? 'border-primary-500 bg-primary-500/[.12]' : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-page-alt)]'}">
      ${l.teamLogo ? `<img src="${img(l.teamLogo)}" alt="" class="w-10 h-10 flex-none rounded-lg object-contain bg-[var(--bg-page)]">` : avatar(l.icon, l.color)}<span class="min-w-0 flex-1"><b class="block truncate text-base text-[var(--text-heading)]">${esc(C.teamLabel(S, l))}</b><span class="block truncate text-xs text-[var(--text-muted)]">リーダー ${esc(l.name || '未定')}</span></span>
      ${badge(l.stand ? 'ok' : 'wait', l.stand ? '立ち絵あり' : '立ち絵なし')}</button></li>`;
  }).join('') || '<li class="text-base text-[var(--text-muted)] text-center py-16">まだありません。「チームを足す」で作ってください</li>';
  refocusDrag($('leaders'));
  renderLeaderPanel(started);
}
sortable($('leaders'), (id, to) => act({ type: 'reorderLeaders', id, to }));
// 立ち絵の位置と大きさ: 配信画面と同じ見え方(帯の位置の目安つき)。ドラッグで位置、つまみで大きさ
const stand = { x: 0, y: 0, k: 1, drag: null, ro: null };
function drawStand() {
  const box = $('stand-box'); if (!box || !box.clientWidth) return; // 見えていないとき(タブの裏)は描かない。見えたら ResizeObserver で描く
  $('stand-stage').style.transform = `scale(${box.clientWidth / 1920})`;
  $('stand-img').style.transform = `translateX(calc(-50% + ${stand.x}px)) translateY(${stand.y}px) scale(${stand.k})`;
}
function initStand(l) {
  Object.assign(stand, { x: +l.standX || 0, y: +l.standY || 0, k: +l.standScale || 1, drag: null });
  if (stand.ro) stand.ro.disconnect();
  const box = $('stand-box'); if (!box) return;
  stand.ro = new ResizeObserver(drawStand); stand.ro.observe(box);
  drawStand();
  const save = () => act({ type: 'updateLeader', id: l.id, patch: { standX: Math.round(stand.x), standY: Math.round(stand.y), standScale: Math.round(stand.k * 100) / 100 } });
  box.addEventListener('pointerdown', (e) => { stand.drag = { x: e.clientX, y: e.clientY, sx: stand.x, sy: stand.y }; box.setPointerCapture(e.pointerId); });
  box.addEventListener('pointermove', (e) => { const d = stand.drag; if (!d) return; const k = 1920 / box.clientWidth; stand.x = d.sx + (e.clientX - d.x) * k; stand.y = d.sy + (e.clientY - d.y) * k; drawStand(); });
  box.addEventListener('pointerup', () => { if (stand.drag) save(); stand.drag = null; });
  $('stand-scale').addEventListener('input', (e) => { stand.k = +e.target.value; drawStand(); });
  $('stand-scale').addEventListener('change', save);
  $('stand-reset').addEventListener('click', () => { Object.assign(stand, { x: 0, y: 0, k: 1 }); $('stand-scale').value = 1; drawStand(); save(); });
}
function renderLeaderPanel(started) {
  const el = $('leader-panel'), l = C.leaderById(S, ui.leaderId);
  if (el.contains(document.activeElement) && document.activeElement.matches('input') || stand.drag) return; // 入力中・調整中は描き直さない
  show(el, !!l, 'flex');
  if (!l) return;
  el.className = el.className.replace(/\bitem\b/, '').trim() + ' item';
  el.dataset.id = l.id;
  const team = C.teamOf(S, l.id).filter((p) => !hiddenPick(p));
  el.innerHTML = `<div class="flex flex-col gap-3">
      <span class="text-xs font-bold text-[var(--text-muted)]">チーム</span>
      <div class="flex items-end gap-2">
        <div class="flex-1 min-w-0"><label class="${LABEL}" for="lt-${l.id}">チーム名</label><input id="lt-${l.id}" type="text" data-lf="teamName" value="${esc(l.teamName || '')}" placeholder="${esc((C.optionsOf(S).teamPrefix || '') + C.shortName(l))}" maxlength="16" class="w-full ${INPUT}"></div>
        <div><label class="${LABEL}" for="lc-${l.id}">色</label><input id="lc-${l.id}" type="color" data-lf="color" value="${esc(l.color)}" class="block w-14 h-11 p-1 bg-[var(--bg-page)] border border-[var(--border-strong)] rounded-lg cursor-pointer ${FOCUS}"></div></div>
      <div class="flex items-center gap-2"><span class="text-xs text-[var(--text-muted)]">ロゴ</span>${l.teamLogo ? `<img src="${img(l.teamLogo)}" alt="" class="w-11 h-11 object-contain rounded-lg bg-[var(--bg-page)] border border-[var(--border-default)]">` : ''}<button type="button" data-pick="teamLogo:${l.id}" class="${BTN_SUB} px-3">${l.teamLogo ? '変更' : '選ぶ'}</button>${l.teamLogo ? `<button type="button" data-team-logo-clear="${l.id}" class="${BTN_SUB} px-3">外す</button>` : ''}</div>
    </div>
    <div class="flex flex-col gap-3 pt-4 border-t border-[var(--border-default)]">
      <div class="flex items-center"><span class="text-xs font-bold text-[var(--text-muted)]">リーダー</span><button type="button" data-set-leader="${l.id}" class="ml-auto h-11 px-2 text-sm font-medium text-primary-300 hover:underline cursor-pointer ${FOCUS}" title="前のドラフトに出た人から選びます">名簿から選び直す</button></div>
      <div class="flex items-center gap-3">
        <button type="button" data-icon="L" class="relative flex-none rounded-full cursor-pointer ${FOCUS}" aria-label="${esc(l.name)} の顔の画像を${l.icon ? '変更' : '設定'}" title="クリック or 画像をドロップ">${avatar(l.icon, l.color, 'w-14 h-14')}${CAM}</button>
        <div class="flex-1 min-w-0 flex gap-2">
          <div class="flex-1 min-w-0"><label class="${LABEL}" for="n-${l.id}">名前</label><input id="n-${l.id}" type="text" data-lf="name" value="${esc(l.name)}" class="w-full ${INPUT}"></div>
          <div class="w-28"><label class="${LABEL}" for="s-${l.id}">略称</label><input id="s-${l.id}" type="text" data-lf="short" value="${esc(l.short || '')}" placeholder="${esc(l.name)}" maxlength="12" class="w-full ${INPUT}"></div></div></div>
      <div class="leading-normal"><span class="${LABEL}">立ち絵</span>
        ${l.stand ? `<div id="stand-box" class="relative w-full aspect-video overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-page-alt)] cursor-move touch-none" title="ドラッグで位置を動かす">
          <div id="stand-stage" class="absolute left-0 top-0 w-[1920px] h-[1080px] origin-top-left pointer-events-none" style="transform:scale(0)">
            <img id="stand-img" src="${img(l.stand)}" alt="" class="absolute left-1/2 bottom-0 h-[1000px] max-w-[1400px] object-contain object-bottom origin-bottom">
            <span class="absolute left-1/2 bottom-[70px] -translate-x-1/2 w-[1000px] h-[130px] rounded-md bg-amber-400/80" aria-hidden="true"></span>
          </div></div>
        <div class="flex items-center gap-2 mt-2"><label class="text-xs text-[var(--text-muted)]" for="stand-scale">大きさ</label><input id="stand-scale" type="range" min="0.4" max="2.5" step="0.01" value="${+l.standScale || 1}" class="flex-1 h-11 accent-primary-500 cursor-pointer"><button type="button" id="stand-reset" class="${BTN_SUB} px-3 text-sm">元に戻す</button></div>` : ''}
        <div class="flex items-end gap-2 mt-2"><button type="button" data-pick="stand:${l.id}" class="${BTN_SUB}">${l.stand ? '変更' : '選ぶ'}</button>${l.stand ? `<button type="button" data-stand-clear="${l.id}" class="${BTN_SUB}">外す</button>` : ''}</div></div>
      <div><label class="${LABEL}" for="i-${l.id}">紹介文</label><input id="i-${l.id}" type="text" data-lf="intro" value="${esc(l.intro || '')}" placeholder="立ち絵の帯に出ます" maxlength="30" class="w-full ${INPUT}"></div>
      <div><label class="${LABEL}" for="m-${l.id}">紹介のメモ（自分用）</label><input id="m-${l.id}" type="text" data-lf="introMemo" value="${esc(l.introMemo || '')}" class="w-full ${INPUT}"></div>
    </div>
    <div class="leading-normal pt-4 border-t border-[var(--border-default)]"><span class="text-xs font-bold text-[var(--text-muted)]">メンバー</span><ol class="flex flex-col gap-1 mt-2">
      ${Array.from({ length: S.rounds }, (_, i) => { const p = team.find((t) => t.round === i + 1), pl = p && C.playerById(S, p.playerId); return `<li class="flex items-center gap-2 text-sm"><span class="w-10 text-xs text-[var(--text-muted)]">${i + 1}巡</span>${pl ? `<span class="text-[var(--text-heading)]">${esc(pl.name)}</span>` : '<span class="text-[var(--text-muted)]">―</span>'}</li>`; }).join('')}</ol></div>
    <div class="flex"><button type="button" class="ml-auto ${BTN_SUB} text-red-300" data-del-leader ${started ? 'disabled aria-disabled="true" title="ドラフトの途中は外せません"' : ''}>チームを外す</button></div>`;
  initStand(l);
}

/* ---------- 選手: 状態で絞り込む一覧。カードの中でそのまま直す ---------- */
function renderPlayers() {
  if (document.activeElement && document.activeElement.closest('#players') && document.activeElement.matches('input')) return; // 入力中は描き直さない
  const started = C.draftStarted(S), taken = C.pickedIds(S);
  const teamOfPlayer = (id) => { const p = S.picks.find((x) => x.playerId === id && !hiddenPick(x)); return p ? C.leaderById(S, p.leaderId) : null; };
  const stateOf = (p) => (p.absent ? 'absent' : taken.has(p.id) ? 'picked' : 'free');
  const count = { all: S.players.length, free: 0, picked: 0, absent: 0 };
  S.players.forEach((p) => count[stateOf(p)]++);
  $('player-count').textContent = `${S.players.length}人`;
  const FILTERS = [['all', 'すべて'], ['free', '未指名'], ['picked', '確定'], ['absent', '欠場']];
  $('player-filter').innerHTML = FILTERS.map(([k, t]) => `<button type="button" data-filter="${k}" aria-pressed="${ui.filter === k}" class="relative after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 h-9 px-3 rounded-md text-sm font-medium cursor-pointer ${FOCUS} ${ui.filter === k ? 'bg-[var(--bg-page-alt)] text-[var(--text-heading)]' : 'text-[var(--text-muted)]'}">${t} ${count[k]}</button>`).join('');
  const q = ui.search.trim();
  const list = S.players.filter((p) => (ui.filter === 'all' || stateOf(p) === ui.filter) && (!q || p.name.includes(q)));
  $('players').innerHTML = list.map((p) => {
    const tl = teamOfPlayer(p.id);
    return `<div class="item ${CARD} flex items-start gap-2 p-2" data-id="${p.id}">
    <button type="button" data-icon="P" class="relative flex-none rounded-full cursor-pointer ${FOCUS}" aria-label="${esc(p.name)} の画像を${p.icon ? '変更' : '設定'}" title="クリック or 画像をドロップで${p.icon ? '変更' : '設定'}">${avatar(p.icon, null, 'w-11 h-11')}${CAM}</button>
    <div class="min-w-0 flex-1 flex flex-col gap-1">
      <input type="text" data-pf="name" value="${esc(p.name)}" aria-label="選手名" class="w-full ${INPUT}">
      <input type="text" data-pf="note" value="${esc(p.note || '')}" aria-label="${esc(p.name)} のひとこと" placeholder="ひとこと（段位など）" maxlength="30" class="w-full ${INPUT}">
      ${p.absent ? `<span>${badge('dup', '欠場')}</span>` : tl ? `<span>${badge('ok', esc(C.teamLabel(S, tl)))}</span>` : ''}
    </div>
    ${taken.has(p.id) ? '' : started
      ? `<button type="button" class="${BTN_ICON} ${p.absent ? 'hover:text-primary-300' : 'hover:text-red-300'}" data-absent aria-pressed="${!!p.absent}" aria-label="${esc(p.name)} を${p.absent ? '欠場から戻す' : '欠場にする'}" title="${p.absent ? '欠場から戻す' : '欠場にする'}">${p.absent ? ICON.undo : ICON.x}</button>`
      : `<button type="button" class="${BTN_ICON} hover:text-red-300" data-del-player aria-label="${esc(p.name)} を削除">${ICON.del}</button>`}</div>`;
  }).join('') || `<p class="col-span-full text-base text-[var(--text-muted)] text-center py-16">${S.players.length ? '当てはまる選手はいません' : 'まだいません。上の欄に名前を入れて「まとめて追加」'}</p>`;
}

/* ---------- ドラフト: 名前と見た目 / ⚙ 進め方 ---------- */
function renderDraftTab() {
  document.querySelectorAll('[data-draft-view]').forEach((b) => { const on = b.dataset.draftView === ui.draftView; b.setAttribute('aria-pressed', on); b.classList.toggle('bg-[var(--bg-page-alt)]', on); b.classList.toggle('text-[var(--text-heading)]', on); b.classList.toggle('text-[var(--text-muted)]', !on); });
  $('draft-look').classList.toggle('hidden', ui.draftView !== 'look');
  $('draft-setup').classList.toggle('hidden', ui.draftView !== 'setup');
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-draft-view],[data-set-leader]');
  if (!t) return;
  if (t.dataset.draftView) { ui.draftView = t.dataset.draftView; renderDraftTab(); syncThemePreviews(); }
  else if (t.dataset.setLeader) openRosterDlg('setLeader', t.dataset.setLeader);
});

/* ---------- 操作 ---------- */
function selectTab(name) {
  ui.tab = name;
  document.querySelectorAll('.tab').forEach((x) => {
    const on = x.dataset.tab === name;
    x.setAttribute('aria-selected', on);
    x.classList.toggle('text-primary-400', on); x.classList.toggle('border-primary-400', on);
    x.classList.toggle('text-[var(--text-muted)]', !on); x.classList.toggle('border-transparent', !on); x.classList.toggle('hover:text-[var(--text-default)]', !on);
  });
  document.querySelectorAll('.tab-body').forEach((x) => x.classList.toggle('hidden', x.id !== 'tab-' + name));
  if (typeof syncThemePreviews === 'function' && $('themes').dataset.key) syncThemePreviews();
  if (S) render();
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
selectTab('prog');

document.addEventListener('click', (e) => { if (e.target.closest('[data-undo]')) $('undo').click(); });
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
  if ($('tab-prog').classList.contains('hidden') || $('crop').open || $('remote-dlg').open || $('roster-dlg').open || !$('audio-pop').classList.contains('hidden')) return;
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
  else if (t.dataset.delLeader !== undefined) { if (confirm('このリーダーを削除しますか？')) act({ type: 'removeLeader', id: t.closest('.item').dataset.id }); }
  else if (t.dataset.delPlayer !== undefined) act({ type: 'removePlayer', id: t.closest('.item').dataset.id });
  else if (t.dataset.absent !== undefined) { const p = C.playerById(S, t.closest('.item').dataset.id); act({ type: 'updatePlayer', id: p.id, patch: { absent: !p.absent } }); }
  else if (t.dataset.reset !== undefined) { if (confirm('ドラフトを最初からやり直します。\n名簿・画像・音の設定はそのままで、指名と抽選の結果だけを消します。\n（「1つ戻す」で元に戻せます）')) { act({ type: 'resetDraft' }); toast('ドラフトを最初からにしました'); } }
  else if (t.dataset.icon) pickImage(t.dataset.icon, t.closest('.item').dataset.id);
});
$('add-leader').addEventListener('click', () => act({ type: 'addLeader' }));
// 進行表・リーダー・選手の画面の操作
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-sel],[data-leader-sel],[data-filter],[data-goto],[data-copy-url],[data-demo],[data-mode],#round-edit');
  if (!t) return;
  if (t.dataset.sel) { ui.selId = t.dataset.sel; render(); }
  else if (t.dataset.leaderSel) { ui.leaderId = t.dataset.leaderSel; render(); }
  else if (t.dataset.filter) { ui.filter = t.dataset.filter; render(); }
  else if (t.dataset.goto) selectTab(t.dataset.goto);
  else if (t.dataset.copyUrl !== undefined) $('copy-url').click();
  else if (t.dataset.demo !== undefined) $('demo-enter').click();
  else if (t.id === 'round-edit') { ui.draftView = 'setup'; selectTab('draft'); document.querySelector(`[data-round-row="${S.round}"]`)?.scrollIntoView({ block: 'center' }); } // 進め方はドラフトのタブ
  else if (t.dataset.mode) { if (t.dataset.mode !== ui.view) setView(t.dataset.mode); }
});
$('player-search').addEventListener('input', (e) => { ui.search = e.target.value; renderPlayers(); });
// 音: ヘッダーから開く小さな窓
$('audio-open').addEventListener('click', (e) => { e.stopPropagation(); const p = $('audio-pop'), open = p.classList.contains('hidden'); p.classList.toggle('hidden', !open); $('audio-open').setAttribute('aria-expanded', open); });
document.addEventListener('click', (e) => { if (!e.target.closest('#audio-pop') && !e.target.closest('#audio-open')) { $('audio-pop').classList.add('hidden'); $('audio-open').setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', (e) => {
  // 本番モードは Esc で編集に戻る(開いている窓があれば、そちらを先に閉じる)
  if (e.key === 'Escape' && ui.view === 'live' && $('audio-pop').classList.contains('hidden') && !$('crop').open && !$('remote-dlg').open && !e.target.closest('input, textarea, select')) setView('edit');
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('audio-pop').classList.add('hidden'); $('audio-open').setAttribute('aria-expanded', 'false'); } });
$('add-players').addEventListener('click', () => {
  // 1行に1人。「名前,ひとこと」のようにカンマ(またはタブ)で区切ると、ひとことも入る(表計算ソフトから2列を貼り付けてもよい)
  const players = $('bulk-players').value.split('\n').map((v) => v.trim()).filter(Boolean).map((line) => {
    const [name, ...rest] = line.split(/[,，\t]/);
    return { name: name.trim(), note: rest.join(' ').trim() };
  }).filter((p) => p.name);
  if (!players.length) return;
  act({ type: 'addPlayers', players });
  $('bulk-players').value = '';
});

// お試しモード(本番とは別のデータで、ダミーの名簿を使う)
const sendMode = (mode, fresh) => ws.send(JSON.stringify({ type: 'mode', mode, fresh }));
$('demo-enter').addEventListener('click', () => { sendMode('demo'); selectTab('prog'); toast('お試しモードを始めました（もとのデータはそのまま残っています）'); });
$('demo-exit').addEventListener('click', () => { sendMode('real'); toast('お試しをやめて、もとのデータに戻りました'); });
$('demo-reset').addEventListener('click', () => { if (confirm('お試しの進行をすべて消して、最初からにしますか？')) sendMode('demo', true); });
// 「次にやること」のボタン
function doNext(key, arg) {
  if (key === 'roster') return selectTab('leaders');
  if (key === 'auto') return autoNominate();
  const a = DraftFlow.actionFor(key, arg, S); // 押したボタン → サーバーへ送る操作(スマホと共通)
  if (a) act(a);
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
document.querySelectorAll('[data-csv-out]').forEach((b) => b.addEventListener('click', () => {
  const blob = new Blob(['﻿' + C.rosterToCSV(S)], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'draft-roster.csv'; a.click();
}));
document.querySelectorAll('[data-csv-in]').forEach((b) => b.addEventListener('click', () => { $('csv-file').value = ''; $('csv-file').click(); }));
$('csv-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const r = C.rosterFromCSV(await f.text());
  if (!r.leaders.length && !r.players.length) return toast('読み込める行がありませんでした', true);
  if (S.picks.length && !confirm('ドラフトの記録が残っています。名簿を置き換えると記録と合わなくなります。続けますか？')) return;
  act({ type: 'replaceRoster', leaders: r.leaders.length ? r.leaders : undefined, players: r.players.length ? r.players : undefined });
  toast(`リーダー${r.leaders.length}人・選手${r.players.length}人を読み込みました`);
});

/* ---------- ドラフトのタブ: 名前と見た目 ---------- */
// 番組の CSV(名前・進め方・見た目・進行表)
$('show-csv-out').addEventListener('click', () => {
  const blob = new Blob(['\uFEFF' + C.showToCSV(S)], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'draft-show.csv'; a.click();
});
$('show-csv-in').addEventListener('click', () => { $('show-csv-file').value = ''; $('show-csv-file').click(); });
$('show-csv-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const r = C.showFromCSV(await f.text());
  if (r.title == null && r.rounds == null && !Object.keys(r.options).length && !r.program) return toast('読み込める行がありませんでした', true);
  if (r.program && !confirm('進行表と資料を CSV の内容に置き換えますか？')) return;
  act({ type: 'replaceShow', ...r });
  toast('番組の設定を読み込みました');
});
function renderShow() {
  const o = optionsOf();
  for (const [key, id] of [['bgImage', 'bg-thumb'], ['logoImage', 'logo-thumb']]) {
    $(id).classList.toggle('hidden', !o[key]);
    if (o[key]) $(id).src = img(o[key]);
    const clear = document.querySelector(`[data-look-clear="${key}"]`);
    if (clear) setDisabled(clear, !o[key]);
  }
  // 大会名の表示: 文字 / ロゴ画像(ロゴ画像のときだけ画像を選ぶ)
  const mode = o.titleMode || (o.logoImage ? 'logo' : 'text');
  document.querySelectorAll('[data-title-mode]').forEach((b) => {
    const on = b.dataset.titleMode === mode;
    b.setAttribute('aria-pressed', on);
    b.classList.toggle('bg-[var(--bg-page-alt)]', on); b.classList.toggle('text-[var(--text-heading)]', on);
    b.classList.toggle('text-[var(--text-muted)]', !on);
  });
  $('logo-f').classList.toggle('hidden', mode !== 'logo');
  if (document.activeElement !== $('in-title')) $('in-title').value = S.title;
  // 場面の切り替え: 動画のときは動画と入れ替える秒数、ほかは長さ
  $('opt-trans').value = o.transition;
  // 花吹雪・帯・障子・暗転は長さが決まっているので、長さの欄は出さない
  $('trans-sec-f').classList.toggle('hidden', ['none', 'video', 'petals', 'band', 'shoji', 'blackout'].includes(o.transition));
  // 抽選に入るとき: 先頭は「テーマのおすすめ（いまのテーマの切り替え）」
  const rec = C.LOT_ENTRIES[TH.themeOf(o.theme).entry] || 'なし';
  $('opt-lotentry').innerHTML = Object.entries(C.LOT_ENTRIES).map(([k, v]) => `<option value="${k}">${k ? v : `${v}（${rec}）`}</option>`).join('');
  $('opt-lotentry').value = o.lotEntry || '';
  $('trans-video-f').classList.toggle('hidden', o.transition !== 'video');
  $('trans-cut-f').classList.toggle('hidden', o.transition !== 'video');
  if (document.activeElement !== $('opt-transsec')) $('opt-transsec').value = o.transSec;
  if (document.activeElement !== $('opt-transcut')) $('opt-transcut').value = o.transCut || '';
  if (document.activeElement !== $('opt-fade')) $('opt-fade').value = o.fadeSec;
  $('opt-leadercolors').checked = !!o.leaderColors;
  renderThemes(o);
  $('trans-video-name').textContent = o.transVideo || 'まだありません';
  if (document.activeElement !== $('in-rounds')) $('in-rounds').value = S.rounds;
  for (const k of ['flowRound', 'flowWait', 'flowAllIn', 'flowStand', 'flowTeams']) $('opt-' + k).checked = !!o[k];
}
// 画像を選ぶ: 背景・ロゴ / 立ち絵 / 画像の資料 で共通の入力
let pickTarget = null;
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-slide-fit],[data-title-mode],[data-slide-rules],[data-look-pick],[data-look-clear],[data-pick],[data-stand-clear],[data-team-logo-clear],[data-prog-add],[data-prog-del],[data-prog-go],#prog-reset');
  if (!t) return;
  if (t.dataset.slideFit) act({ type: 'updateSlide', id: t.closest('[data-slide-id]').dataset.slideId, patch: { fit: t.dataset.slideFit } });
  else if (t.dataset.titleMode) setOption({ titleMode: t.dataset.titleMode });
  else if (t.dataset.slideRules) {
    const sl = C.slideById(S, t.dataset.slideRules), lines = C.ruleLines(S);
    if ((sl.lines || []).some((x) => x.trim()) && !confirm('いまの箇条書きを、今の進め方から作った文に置き換えますか？')) return;
    act({ type: 'updateSlide', id: sl.id, patch: { lines } });
  } else if (t.dataset.lookPick) { pickTarget = { kind: 'look', key: t.dataset.lookPick }; $('look-file').value = ''; $('look-file').click(); }
  else if (t.dataset.lookClear) setOption({ [t.dataset.lookClear]: '' });
  else if (t.dataset.pick) { const [kind, id] = t.dataset.pick.split(':'); pickTarget = { kind, id }; $('look-file').value = ''; $('look-file').click(); }
  else if (t.dataset.standClear) act({ type: 'updateLeader', id: t.dataset.standClear, patch: { stand: '' } });
  else if (t.dataset.teamLogoClear) act({ type: 'updateLeader', id: t.dataset.teamLogoClear, patch: { teamLogo: '' } });
  else if (t.dataset.progAdd) {
    const k = t.dataset.progAdd;
    if (k === 'text' || k === 'image') act({ type: 'addSlide', kind: k, toProgram: true, at: C.programOf(S).length - 1 });
    else act({ type: 'addProgram', item: { type: k }, at: C.programOf(S).length - 1 });
    selectNewScene = C.programOf(S).length;
  } else if (t.dataset.progDel !== undefined) {
    const g = C.programOf(S).find((x) => x.id === t.closest('[data-prog-id]').dataset.progId);
    if (!confirm(`「${g.label}」を進行表から外しますか？${g.type === 'slide' ? '\n(資料の中身も消えます)' : ''}`)) return;
    ui.selId = null;
    act(g.type === 'slide' ? { type: 'removeSlide', id: g.slideId } : { type: 'removeProgram', id: g.id });
  } else if (t.dataset.progGo) act({ type: 'progGo', idx: +t.dataset.progGo });
  else if (t.id === 'prog-reset') { if (confirm('進行表をひな形に戻しますか？\n（足した資料は進行表から外れます）')) act({ type: 'resetProgram' }); }
});
$('look-file').addEventListener('change', async (e) => {
  const f = e.target.files[0], tg = pickTarget;
  if (!f || !tg) return;
  if (!IMG_EXT[f.type]) return toast('PNG / JPEG / GIF / WebP の画像を選んでください', true);
  try {
    const name = await upload(`${tg.kind}_${tg.key || tg.id}_${Date.now()}${IMG_EXT[f.type]}`, f);
    if (tg.kind === 'look') setOption(tg.key === 'logoImage' ? { logoImage: name, titleMode: 'logo' } : { [tg.key]: name });
    else if (tg.kind === 'stand') act({ type: 'updateLeader', id: tg.id, patch: { stand: name } });
    else if (tg.kind === 'teamLogo') act({ type: 'updateLeader', id: tg.id, patch: { teamLogo: name } });
    else if (tg.kind === 'slide') act({ type: 'updateSlide', id: tg.id, patch: { image: name } });
  } catch (err) { toast(err.message, true); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'opt-trans') setOption({ transition: t.value });
  else if (t.id === 'opt-bgmotion') setOption({ bgMotion: t.checked });
  else if (t.id === 'opt-lotentry') setOption({ lotEntry: t.value });
  else if (t.id === 'opt-transsec') setOption({ transSec: Math.max(0.2, Math.min(3, +t.value || 0.6)) });
  else if (t.id === 'opt-transcut') setOption({ transCut: Math.max(0, +t.value || 0) });
  else if (t.id === 'opt-fade') setOption({ fadeSec: Math.max(0, Math.min(2, +t.value || 0)) });
  else if (/^opt-flow/.test(t.id)) setOption({ [t.id.slice(4)]: t.checked });
  else if (t.dataset.progLabel) act({ type: 'updateProgram', id: t.dataset.progLabel, patch: { label: t.value.trim() || '（名前なし）' } });
  else if (t.dataset.progMemo) act({ type: 'updateProgram', id: t.dataset.progMemo, patch: { memo: t.value } });
  else if (t.dataset.progBgm) act({ type: 'updateProgram', id: t.dataset.progBgm, patch: { bgm: t.value } });
  else if (t.dataset.slide) act({ type: 'updateSlide', id: t.dataset.slide, patch: t.dataset.slideF === 'lines' ? { lines: t.value.split('\n') } : { title: t.value } });
});

// 切り替えの動画(WebM / MP4)
$('trans-video-pick').addEventListener('click', () => { $('trans-video-file').value = ''; $('trans-video-file').click(); });
$('trans-video-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const ext = { 'video/webm': '.webm', 'video/mp4': '.mp4' }[f.type];
  if (!ext) return toast('WebM か MP4 の動画を選んでください', true);
  try { setOption({ transVideo: await upload(`trans_${Date.now()}${ext}`, f) }); } catch (err) { toast(err.message, true); }
});

/* ---------- テーマ ---------- */
// 選べるテーマ(と、いま使っているテーマ)を、動く小さな画面つきで並べる。小さな画面は「名前と見た目」を開いているときだけ動かす
const TH = window.DraftThemes;
function renderThemes(o) {
  // 試作のテーマも選べる(確かめて良かったものを正式に。試作には印)
  const cur = TH.idOf(o.theme), ids = Object.keys(TH.THEMES);
  const box = $('themes'), key = ids.join(',');
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = ids.map((id) => { const t = TH.THEMES[id]; return `<button type="button" role="radio" data-theme="${id}" class="w-72 flex flex-col text-left rounded-xl border-2 overflow-hidden cursor-pointer ${FOCUS}">
      <span class="block w-full aspect-video bg-black"><iframe data-src="/theme-check.html?theme=${id}&mini" title="${esc(t.name)} の見本" tabindex="-1" class="block w-full h-full pointer-events-none border-0"></iframe></span>
      <span class="block px-3 py-2"><b class="block text-sm text-[var(--text-heading)]">${esc(t.name)}${t.ready ? '' : ' <span class="text-xs font-medium text-[var(--text-muted)]">（試作）</span>'}</b><span class="block text-xs text-[var(--text-muted)]">${esc(t.desc || '')}</span></span></button>`; }).join('');
  }
  box.querySelectorAll('[data-theme]').forEach((b) => {
    const on = b.dataset.theme === cur;
    b.setAttribute('aria-checked', on);
    b.classList.toggle('border-primary-500', on); b.classList.toggle('border-[var(--border-default)]', !on);
  });
  syncThemePreviews();
  $('theme-check').href = `/theme-check.html?theme=${cur}`;
  // 背景の上の動き: 3D の背景があるテーマで、自分の背景画像を入れているときだけ
  show($('bgmotion-f'), !!TH.themeOf(cur).bg && !!o.bgImage, 'flex');
  $('opt-bgmotion').checked = o.bgMotion !== false;
}
function syncThemePreviews() {
  $('themes').querySelectorAll('iframe').forEach((f) => { const want = ui.tab === 'draft' && ui.draftView === 'look' ? f.dataset.src : ''; if ((f.getAttribute('src') || '') !== want) { if (want) f.src = want; else f.removeAttribute('src'); } });
}
$('themes').addEventListener('click', (e) => { const b = e.target.closest('[data-theme]'); if (b) setOption({ theme: b.dataset.theme }); });

/* ---------- ドラフトの切り替え ----------
 * 初期リリースは「ドラフト」を1つの単位に見せる(中では大会とドラフトが同時にできる)。左上 = 最近のドラフト・新しいドラフト・すべてのドラフト */
const sendLib = (cmd, extra) => ws.send(JSON.stringify(Object.assign({ type: 'library', cmd }, extra)));
const fmtDate = (t) => { const d = new Date(t); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
const ROLE = { leader: 'リーダー', player: '選手', staff: '運営' };
function renderLibrary() {
  if (!lib) return;
  const curT = lib.tournaments.find((t) => t.id === lib.current);
  $('tour-switch-label').textContent = `ドラフト: ${curT ? curT.title : S.title}`;
  setDisabled($('tour-switch'), ui.view === 'live'); // 本番の間は切り替えない
  // 左上の小さな一覧: 最近のドラフト(5つまで)
  $('tour-menu').innerHTML = `<p class="px-1 text-xs text-[var(--text-muted)]">最近のドラフト</p>
    ${lib.tournaments.slice(0, 5).map((t) => { const on = t.id === lib.current; return `<button type="button" ${on ? 'disabled aria-disabled="true" aria-current="true"' : `data-tour-open="${t.id}"`} class="w-full min-h-11 flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm border cursor-pointer ${FOCUS} ${on ? 'border-primary-500 bg-primary-500/[.12] font-bold text-[var(--text-heading)]' : 'border-[var(--border-default)] hover:bg-[var(--bg-page-alt)]'}"><span class="min-w-0 flex-1 truncate">${esc(t.title)}</span>${on ? badge('in', '開いている') : ''}</button>`; }).join('')}
    <div class="flex flex-col gap-2 pt-1"><button type="button" data-lib-open data-lib-new class="${BTN_SUB} w-full whitespace-nowrap text-sm">＋ 新しいドラフト</button><button type="button" data-lib-open class="${BTN_SUB} w-full whitespace-nowrap text-sm">すべてのドラフト</button></div>`;
  // すべてのドラフト
  $('tours').innerHTML = lib.tournaments.map((t) => {
    const on = t.id === lib.current;
    return `<div class="flex items-center gap-3 min-h-14 px-3 py-2 rounded-xl border ${on ? 'border-primary-500 bg-primary-500/[.12]' : 'border-[var(--border-default)] bg-[var(--bg-surface)]'}">
      <span class="min-w-0 flex-1"><b class="block truncate text-base text-[var(--text-heading)]">${esc(t.title)}</b><span class="text-xs text-[var(--text-muted)]">${fmtDate(t.createdAt)}・チーム${t.teams}・選手${t.players}</span></span>
      ${on ? badge('in', '開いている') : `<button type="button" class="${BTN_SUB}" data-tour-open="${t.id}">開く</button><button type="button" class="${BTN_ICON} hover:text-red-300" data-tour-del="${t.id}" aria-label="${esc(t.title)} を削除">${ICON.del}</button>`}</div>`;
  }).join('');
}
$('tour-switch').addEventListener('click', (e) => { e.stopPropagation(); const m = $('tour-menu'), open = m.classList.contains('hidden'); m.classList.toggle('hidden', !open); $('tour-switch').setAttribute('aria-expanded', open); });
document.addEventListener('click', (e) => { if (!e.target.closest('#tour-menu') && !e.target.closest('#tour-switch')) { $('tour-menu').classList.add('hidden'); $('tour-switch').setAttribute('aria-expanded', 'false'); } });
$('lib-close').addEventListener('click', () => $('lib-dlg').close());
$('tour-new').addEventListener('click', () => {
  sendLib('create', { title: $('new-tour-title').value.trim() || '新しいドラフト' });
  $('new-tour-title').value = ''; $('lib-dlg').close(); selectTab('leaders');
  toast('新しいドラフトを作りました。前のドラフトに出た人は「名簿から」で入れられます');
});
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tour-open],[data-tour-del],[data-lib-open],[data-roster-add]');
  if (!t) return;
  if (t.dataset.tourOpen) { sendLib('open', { id: t.dataset.tourOpen }); $('tour-menu').classList.add('hidden'); if ($('lib-dlg').open) $('lib-dlg').close(); toast('ドラフトを切り替えました'); }
  else if (t.dataset.tourDel) { const x = lib.tournaments.find((y) => y.id === t.dataset.tourDel); if (confirm(`「${x.title}」を削除しますか？\n（データフォルダの trash に残ります）`)) sendLib('remove', { id: x.id }); }
  else if (t.dataset.libOpen !== undefined) { $('tour-menu').classList.add('hidden'); if (!$('lib-dlg').open) $('lib-dlg').showModal(); if (t.dataset.libNew !== undefined) $('new-tour-title').focus(); }
  else if (t.dataset.rosterAdd) openRosterDlg(t.dataset.rosterAdd);
});

// 名簿から選ぶ: 名簿(前のドラフトに出た人)を全員並べる。このドラフトにもういる人は、理由を出して選べなくする。mode = player(選手を足す) / leader(リーダーを選んでチームを足す) / setLeader(このチームのリーダーを替える)
const rosterSel = { role: 'player', ids: new Set(), q: '', teamId: null };
function openRosterDlg(role, teamId) {
  Object.assign(rosterSel, { role, ids: new Set(), q: '', teamId: teamId || null });
  $('roster-search').value = '';
  $('roster-title').textContent = role === 'setLeader' ? 'リーダーを名簿から選ぶ' : role === 'leader' ? '名簿からリーダーを選んで、チームを足す' : '名簿から選手を追加';
  $('roster-dlg').showModal();
  renderRosterDlg();
}
function renderRosterDlg() {
  if (!lib || !$('roster-dlg').open) return;
  const inL = new Set(S.leaders.map((l) => l.personId)), inP = new Set(S.players.map((p) => p.id));
  const why = (id) => (inL.has(id) ? 'このドラフトのリーダー' : inP.has(id) ? 'このドラフトの選手' : '');
  const single = rosterSel.role === 'setLeader';
  const list = lib.roster.filter((p) => !rosterSel.q || p.name.includes(rosterSel.q)).sort((a, b) => !!why(a.id) - !!why(b.id));
  $('roster-list').innerHTML = list.map((p) => {
    const last = p.uses[p.uses.length - 1], no = why(p.id);
    return `<li class="flex items-center gap-3 min-h-14 px-2 rounded-lg ${no ? 'opacity-60' : 'hover:bg-[var(--bg-page-alt)]'}">
      <label class="flex-1 min-w-0 flex items-center gap-3 ${no ? '' : 'cursor-pointer'}"><input type="${single ? 'radio' : 'checkbox'}" name="roster-pick" data-roster-pick="${p.id}" ${rosterSel.ids.has(p.id) ? 'checked' : ''} ${no ? 'disabled aria-disabled="true"' : ''} class="w-5 h-5 accent-primary-500">${avatar(p.icon, null)}
        <span class="min-w-0"><b class="block truncate text-[var(--text-heading)]">${esc(p.name)}</b><span class="block truncate text-xs text-[var(--text-muted)]">${no ? `いま${no}` : last ? `${esc(last.title)}（${ROLE[last.role] || ''}）${p.uses.length > 1 ? ` ほか${p.uses.length - 1}件` : ''}` : 'まだどのドラフトにも出ていません'}</span></span></label></li>`;
  }).join('') || `<li class="py-10 px-4 text-center text-[var(--text-muted)]">${lib.roster.length ? '見つかりません' : '名簿はまだ空です。前のドラフトに出た人が、ここに並びます'}</li>`;
  $('roster-count').textContent = rosterSel.ids.size && !single ? `${rosterSel.ids.size}人を選択中` : '';
  $('roster-ok').textContent = single ? 'リーダーにする' : '追加';
  setDisabled($('roster-ok'), !rosterSel.ids.size);
}
$('roster-search').addEventListener('input', (e) => { rosterSel.q = e.target.value.trim(); renderRosterDlg(); });
$('roster-list').addEventListener('change', (e) => {
  const id = e.target.dataset.rosterPick; if (!id) return;
  if (rosterSel.role === 'setLeader') rosterSel.ids = new Set([id]);
  else if (e.target.checked) rosterSel.ids.add(id); else rosterSel.ids.delete(id);
  renderRosterDlg();
});
$('roster-ok').addEventListener('click', () => {
  if (rosterSel.role === 'setLeader') { sendLib('setLeader', { id: rosterSel.teamId, personId: [...rosterSel.ids][0] }); toast('リーダーを替えました'); }
  else { sendLib('addPeople', { role: rosterSel.role, ids: [...rosterSel.ids] }); toast(`${rosterSel.ids.size}${rosterSel.role === 'leader' ? 'チーム' : '人'}を足しました`); }
  $('roster-dlg').close();
});

/* ---------- スマホ操作 ---------- */
function renderRemote() {
  const r = remoteInfo;
  $('remote-label').textContent = r.on ? `スマホ: オン（${r.clients}台）` : 'スマホ';
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
  // 順番指名の巡が1つもなければ、順番の設定は使わない
  setDisabled($('opt-order'), !o.roundModes.slice(0, S.rounds).includes('order'));
  for (const [id, v] of [['opt-order', o.orderStyle], ['opt-lottery', o.lotteryStyle], ['opt-timer', o.timerSec]]) if (document.activeElement !== $(id)) $(id).value = v;
  $('opt-timershow').checked = !!o.timerShow;
  $('opt-timerauto').checked = !!o.timerAuto;
  // 巡: 1行に1巡(指名のしかた＋待ち時間の画像)
  const rows = $('round-rows');
  if (rows.contains(document.activeElement) && document.activeElement.matches('select')) return;
  const map = o.waitImages || {};
  rows.innerHTML = Array.from({ length: S.rounds }, (_, i) => {
    const r = i + 1, m = o.roundModes[i] || 'bid', list = map[r] || [], lm = C.lotteryModeOf(S, r);
    const now = r === S.round;
    return `<div class="flex flex-wrap items-center gap-3 p-3 ${CARD} ${now ? 'border-primary-500/60' : ''}" data-round-row="${r}"><b class="w-16 flex-none text-base text-[var(--text-heading)]">第${r}巡</b>
      <div class="relative"><label class="sr-only" for="rm-${i}">第${r}巡の指名のしかた</label><select id="rm-${i}" data-round-mode="${i}" class="appearance-none w-36 pl-3 pr-10 ${INPUT} cursor-pointer"><option value="bid" ${m === 'bid' ? 'selected' : ''}>一斉入札</option><option value="order" ${m === 'order' ? 'selected' : ''}>順番指名</option></select>${ICON.chevron}</div>
      <span class="text-xs text-[var(--text-muted)]">抽選</span><div class="relative"><label class="sr-only" for="lm-${i}">第${r}巡の抽選の方式</label><select id="lm-${i}" data-lot-mode="${i}" ${m === 'order' ? 'disabled title="順番指名の巡は重複しないので抽選はありません"' : ''} class="appearance-none w-52 pl-3 pr-10 ${INPUT} cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">${Object.entries(C.LOTTERY_LABEL).map(([k, v]) => `<option value="${k}" ${lm === k ? 'selected' : ''}>${v}</option>`).join('')}</select>${ICON.chevron}</div>
      <span class="text-xs text-[var(--text-muted)]">待ち時間の画像</span>
      ${list.map((f, k) => `<span class="relative"><img src="${img(f)}" alt="第${r}巡の${k + 1}枚目" class="w-24 h-14 object-contain rounded-lg bg-[var(--bg-page)] border border-[var(--border-default)]"><span class="absolute left-1 top-1 px-1.5 rounded bg-black/70 text-xs text-white">${k + 1}</span>
        <button type="button" data-wait-del="${r}:${k}" aria-label="第${r}巡の${k + 1}枚目を外す" class="absolute -right-2 -top-2 w-7 h-7 inline-flex items-center justify-center rounded-full bg-[var(--bg-page-alt)] border border-[var(--border-strong)] text-[var(--text-default)] cursor-pointer ${FOCUS}"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></span>`).join('')}
      <button type="button" data-wait-add="${r}" class="${BTN_SUB}">画像を追加</button>${now ? '<span class="ml-auto text-xs text-primary-300">いまの巡</span>' : ''}</div>`;
  }).join('');
}
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.roundMode !== undefined) {
    const m = [...optionsOf().roundModes]; m[+t.dataset.roundMode] = t.value;
    setOption({ roundModes: Array.from({ length: S.rounds }, (_, i) => m[i] || 'bid') });
  } else if (t.dataset.lotMode !== undefined) {
    // 抽選の方式(巡ごと)
    const lm = Array.from({ length: S.rounds }, (_, i) => C.lotteryModeOf(S, i + 1)); lm[+t.dataset.lotMode] = t.value;
    setOption({ lotteryModes: lm });
  } else if (t.id === 'opt-order') setOption({ orderStyle: t.value });
  else if (t.id === 'opt-lottery') setOption({ lotteryStyle: t.value });
  else if (t.id === 'opt-leadercolors') setOption({ leaderColors: t.checked });
  else if (t.id === 'opt-timer') setOption({ timerSec: Math.max(10, Math.min(3600, +t.value || 300)) });
  else if (t.id === 'opt-timershow') setOption({ timerShow: t.checked });
  else if (t.id === 'opt-timerauto') setOption({ timerAuto: t.checked });
});
// 待ち時間の画像: 巡ごとに追加(複数まとめて選べる)・外す
let waitRound = 1;
const setWaitList = (r, list) => { const m = { ...(optionsOf().waitImages || {}) }; m[r] = list; setOption({ waitImages: m }); };
document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-wait-add]'), del = e.target.closest('[data-wait-del]');
  if (add) { waitRound = +add.dataset.waitAdd; $('wait-file').value = ''; $('wait-file').click(); }
  else if (del) { const [r, k] = del.dataset.waitDel.split(':').map(Number); setWaitList(r, (optionsOf().waitImages[r] || []).filter((_, i) => i !== k)); }
});
$('wait-file').addEventListener('change', async (e) => {
  const files = [...e.target.files].filter((f) => IMG_EXT[f.type]);
  if (!files.length) return toast('PNG / JPEG / GIF / WebP の画像を選んでください', true);
  try {
    const names = [];
    for (const [i, f] of files.entries()) names.push(await upload(`wait_${waitRound}_${Date.now()}_${i}${IMG_EXT[f.type]}`, f));
    setWaitList(waitRound, [...(optionsOf().waitImages[waitRound] || []), ...names]);
  } catch (err) { toast(err.message, true); }
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
  $('timer-note').textContent = t.endsAt && left === 0 ? '時間になりました' : optionsOf().timerShow ? '配信画面にも出ます' : '配信画面には出しません';
}
setInterval(renderTimer, 250);
let wasBusy = false;
setInterval(() => { if (!S) return; const busy = !!S.busyUntil && S.busyUntil > Date.now(); if (wasBusy && !busy) renderRun(); wasBusy = busy; }, 200);
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
  // 場面で曲を決めているときは、そちらが流れる
  const sb = C.progItem(S)?.bgm;
  if (bgmList.length && sb) { $('bgm-hint').textContent = sb === '-' ? 'いまの場面は「BGM なし」に決めています（進行表の場面の設定）。' : `いまの場面は「${sb.replace(/\.[^.]+$/, '')}」が流れます（進行表の場面の設定）。`; return; }
  $('bgm-hint').textContent = bgmList.length
    ? '抽選の演出の間は BGM がゆっくり消え、ほかの画面に戻るとゆっくり戻ります。'
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
fetch('/api/bgm').then((r) => r.json()).then((l) => { bgmList = l; if (S) render(); }).catch(() => {});

$('toast').className = TOAST + ' hidden';
connect();
