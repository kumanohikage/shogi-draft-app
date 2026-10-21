// スマホ操作画面(同じ Wi-Fi のスマホから、進行・配信画面の切り替え・指名の入力・タイマー・戻す)
const C = window.DraftCore, F = window.DraftFlow;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let S = null, ws = null, canUndo = false, undoCancelsLottery = false, demo = false;

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50';
const BTN_PRIMARY = `inline-flex items-center justify-center w-full min-w-0 h-14 px-4 whitespace-nowrap text-lg font-bold bg-primary-500 text-slate-900 rounded-lg active:bg-primary-600 cursor-pointer disabled:opacity-40 disabled:cursor-default ${FOCUS}`;
const BTN_SUB = `inline-flex items-center justify-center w-full min-w-0 h-11 px-4 whitespace-nowrap text-[1rem] font-medium bg-[var(--bg-surface)] text-[var(--text-default)] border border-[var(--border-strong)] rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-default ${FOCUS}`;
const INPUT = 'h-11 px-3 text-base bg-[var(--bg-page)] text-[var(--text-default)] border border-[var(--border-strong)] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400/50';
const BADGE = { ok: 'bg-emerald-500/[.12] text-emerald-300', lot: 'bg-amber-500/[.12] text-amber-300', dup: 'bg-red-500/[.12] text-red-300', in: 'bg-primary-500/[.12] text-primary-300', wait: 'bg-[var(--bg-page-alt)] text-[var(--text-muted)]' };
const badge = (k, t) => `<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${BADGE[k]}">${t}</span>`;
const SCENES = [['round', '巡の見出し'], ['board', '指名ボード'], ['roulette', '抽選'], ['teams', 'チーム表'], ['wait', '待ち時間'], ['blank', '出さない']];

let boot = null;
function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => { $('conn').textContent = '● 接続中'; $('conn').className = 'text-xs text-emerald-300'; };
  ws.onclose = () => { $('conn').textContent = '× 切断（再接続中…）'; $('conn').className = 'text-xs text-red-300'; setTimeout(connect, 1500); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'boot') { if (boot && boot !== m.id) location.reload(); boot = m.id; return; } // アプリが起動し直したら、新しい画面を読み込む
    if (m.type === 'state') { S = m.state; canUndo = m.canUndo; undoCancelsLottery = !!m.undoCancelsLottery; demo = !!m.demo; render(); }
    else if (m.type === 'error') toast(m.message);
  };
}
const act = (action) => ws.send(JSON.stringify({ type: 'action', action }));
function toast(t) { const el = $('toast'); el.textContent = t; el.className = 'fixed left-4 right-4 bottom-[calc(96px+env(safe-area-inset-bottom))] z-30 px-4 py-3 rounded-lg shadow-xl text-sm border border-red-500/60 bg-[var(--bg-surface)] text-red-300'; clearTimeout(toast.t); toast.t = setTimeout(() => { el.className = 'hidden'; }, 5000); }
function setDisabled(el, v) { el.disabled = v; if (v) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled'); }

// ボタンの文字は改行しない。入りきらないときは、入る大きさまで文字を小さくする(いちばん小さくて6割)
function fitButtons() {
  document.querySelectorAll('button').forEach((b) => {
    b.style.fontSize = '';
    const w = b.clientWidth; if (!w) return;
    const jc = b.style.justifyContent; b.style.justifyContent = 'flex-start'; // 真ん中寄せだと、はみ出した分を測れないので
    const cs = getComputedStyle(b), pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), sw = b.scrollWidth;
    b.style.justifyContent = jc;
    if (sw <= w + 1) return;
    const base = parseFloat(cs.fontSize);
    b.style.fontSize = Math.max(base * 0.6, base * ((w - pad) / (sw - pad)) * 0.97) + 'px';
  });
}
addEventListener('resize', () => { if (S) fitButtons(); });
document.fonts.ready.then(() => { if (S) fitButtons(); });
function render() {
  $('title').textContent = S.title || 'ドラフト会議';
  const done = C.draftComplete(S);
  const item = C.progItem(S), inDraft = !item || item.type === 'draft';
  const prog = C.programOf(S), pi = C.progIdxOf(S);
  const isIntro = item && item.type === 'intro', k = Math.min(S.introIdx || 0, S.leaders.length - 1), l = isIntro ? S.leaders[k] : null;
  $('scene-pos').textContent = `いまの場面（${pi + 1} / ${prog.length}）`;
  $('round-title').textContent = !inDraft ? (l ? `${item.label}　${l.name}` : item.label) : done ? 'ドラフト終了' : `ドラフト　第${S.round}巡`;
  const nl = isIntro ? S.leaders[k + 1] : null, ng = prog[pi + 1];
  $('up-next').textContent = `次: ${nl ? nl.name : ng ? ng.label : '（最後の場面）'}`;
  const memo = [l && l.introMemo ? `${l.name}: ${l.introMemo}` : '', item && item.memo ? item.memo : ''].filter(Boolean).join('\n');
  $('memo').textContent = memo || '（なし）';
  $('memo').classList.toggle('text-[var(--text-muted)]', !memo);
  const n = F.nextStep(S, { demo });
  $('step-label').textContent = n.step >= 0 && n.step < F.STEPS.length ? F.STEPS[n.step] : '';
  const btn = (b, cls) => `<button type="button" class="${cls}" ${b.key ? `data-next="${b.key}"` : ''} ${b.arg ? `data-arg="${b.arg}"` : ''} ${b.off ? 'disabled aria-disabled="true"' : ''}>${b.label}</button>`;
  $('next').innerHTML = n.text || '';
  // 下のバー: オレンジの左に「前の場面へ」(パソコンと同じ。操作の取り消しはパソコンの Ctrl+Z)。ほかのサブ(おまかせ指名はお試しのときだけ)はその上に
  const subs = (n.sub || []).filter((b) => b.key !== 'auto' || demo);
  $('subs').innerHTML = (n.choices ? `<div class="grid grid-cols-3 gap-2">${n.choices.map((b) => `<button type="button" data-next="${b.key}" data-arg="${b.arg}" class="${BTN_SUB} gap-2" ${b.off ? 'disabled aria-disabled="true"' : ''} aria-label="${b.label}を選ぶ"><span class="w-5 h-5 rounded-md bg-[var(--lc)]" style="--lc:${b.color}" aria-hidden="true"></span>${b.label}</button>`).join('')}</div>` : '') + subs.map((b) => btn(b, BTN_SUB)).join('');
  const main = n.main ? btn({ ...n.main, label: n.main.busy ? '演出中…' : n.main.label }, BTN_PRIMARY) : `<p class="h-14 flex-1 flex items-center justify-center text-sm text-[var(--text-muted)]">${n.step >= 5 ? 'ドラフト終了' : '待っています'}</p>`;
  $('bar').innerHTML = `<div class="flex gap-2"><button type="button" data-next="progPrev" class="${BTN_SUB.replace('w-full min-w-0 h-11', 'flex-none h-14')} gap-1 px-3" ${C.progIdxOf(S) > 0 ? '' : 'disabled aria-disabled="true"'} aria-label="前の場面へ"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>前の場面へ</button><div class="flex-1 min-w-0">${main}</div></div>`;
  $('scenes').innerHTML = SCENES.map(([k, t]) => `<button type="button" data-scene="${k}" aria-pressed="${S.scene === k || (k === 'roulette' && S.scene === 'lots')}" class="h-11 px-2 rounded-lg text-sm font-medium border cursor-pointer ${FOCUS} ${S.scene === k || (k === 'roulette' && S.scene === 'lots') ? 'bg-[var(--bg-page-alt)] border-primary-400 text-[var(--text-heading)]' : 'bg-[var(--bg-surface)] border-[var(--border-default)] text-[var(--text-muted)]'}">${t}</button>`).join('');
  renderNoms();
  renderTimer();
  fitButtons();
}

// 指名: 公開前の人だけ選べる(管理画面と同じ決まり)
function renderNoms() {
  if (document.activeElement && document.activeElement.matches('#noms select')) return; // 選んでいる途中は描き直さない
  const taken = C.pickedIds(S), options = S.players.filter((p) => !taken.has(p.id) && !p.absent);
  const confs = C.conflicts(S), turn = C.currentTurn(S);
  const blocked = confs.length > 0 || !!(S.lottery && !S.lottery.done);
  const hidden = (p) => S.lottery && !S.lottery.done && p.playerId === S.lottery.playerId && p.by === 'lottery';
  const inLot = (id) => !!(S.lottery && !S.lottery.done && S.lottery.leaders.includes(id));
  const pname = (id) => esc(C.playerById(S, id)?.name);
  $('noms').innerHTML = S.leaders.map((l) => {
    const pick = C.pickOf(S, l.id, S.round), n = S.noms[l.id] || {};
    let body, st;
    if (pick && !hidden(pick)) { body = `<p class="truncate text-sm font-bold text-[var(--text-heading)]">${pname(pick.playerId)}</p>`; st = badge(pick.by === 'lottery' ? 'lot' : 'ok', pick.by === 'lottery' ? '抽選で確定' : '確定'); }
    else if (pick || inLot(l.id)) { body = `<p class="truncate text-sm font-bold text-[var(--text-heading)]">${pname(S.lottery.playerId)}</p>`; st = badge('lot', '抽選中'); }
    else if (n.revealed) { body = `<p class="truncate text-sm font-bold text-[var(--text-heading)]">${pname(n.playerId)}</p>`; st = confs.some((c) => c.leaders.includes(l.id)) ? badge('dup', '重複') : badge('in', '公開済み'); }
    else if (turn && turn.id !== l.id) { body = ''; st = badge('wait', '順番待ち'); }
    else if (blocked) { body = '<p class="text-sm text-[var(--text-muted)]">ほかの重複の抽選のあとで再指名</p>'; st = badge('wait', '再指名待ち'); }
    else {
      body = `<select data-nom="${l.id}" aria-label="${esc(l.name)} の指名" class="w-full ${INPUT}"><option value="">― 選ぶ ―</option>${options.map((p) => `<option value="${p.id}" ${p.id === n.playerId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
      st = n.playerId ? badge('in', '入力済み') : badge('wait', '未入力');
    }
    return `<div class="min-w-0 flex flex-col gap-1.5 p-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl">
      <div class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 flex-none rounded-full bg-[var(--lc)]" style="--lc:${esc(l.color)}" aria-hidden="true"></span><p class="min-w-0 flex-1 text-sm font-bold text-[var(--text-heading)] truncate">${esc(C.shortName(l))}</p></div><div>${st}</div>${body}</div>`;
  }).join('');
}

// 制限時間
function renderTimer() {
  if (!S) return;
  const t = S.timer || {}, sec = C.optionsOf(S).timerSec;
  const left = t.endsAt ? Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000)) : t.left ?? sec;
  $('timer-left').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('timer-left').classList.toggle('text-red-300', !!t.endsAt && left === 0);
  setDisabled($('timer-start'), !!t.endsAt && left > 0);
  setDisabled($('timer-stop'), !(t.endsAt && left > 0));
}
setInterval(renderTimer, 250);
// 演出が終わったら、オレンジを押せるように描き直す
let wasBusy = false;
setInterval(() => { if (!S) return; const busy = !!S.busyUntil && S.busyUntil > Date.now(); if (wasBusy && !busy) render(); wasBusy = busy; }, 200);
// おまかせ指名(お試し専用): 空いている指名をランダムに。上位の選手に寄せて、ときどき重複が起きるように(管理画面と同じ)
function autoNominate() {
  const taken = C.pickedIds(S), free = S.players.filter((p) => !taken.has(p.id) && !p.absent), hot = free.slice(0, 3);
  for (const l of C.pendingLeaders(S)) {
    if (S.noms[l.id] && S.noms[l.id].playerId) continue;
    const pool = Math.random() < 0.4 && hot.length ? hot : free;
    const p = pool[Math.floor(Math.random() * pool.length)];
    if (p) act({ type: 'nominate', leaderId: l.id, playerId: p.id });
  }
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const key = b.dataset.next, arg = b.dataset.arg;
  if (b.dataset.scene) act({ type: 'setScene', scene: b.dataset.scene });
  else if (key && DraftFlow.actionFor(key, arg, S)) act(DraftFlow.actionFor(key, arg, S));
  else if (key === 'roster') toast('名簿の登録はパソコンのアプリで行ってください');
  else if (key === 'auto') autoNominate();
  else if (b.id === 'timer-start') act({ type: 'timer', cmd: 'start' });
  else if (b.id === 'timer-stop') act({ type: 'timer', cmd: 'stop' });
  else if (b.id === 'timer-reset') act({ type: 'timer', cmd: 'reset' });
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.nom !== undefined) { act({ type: 'nominate', leaderId: t.dataset.nom, playerId: t.value || null }); t.blur(); }
});

connect();
