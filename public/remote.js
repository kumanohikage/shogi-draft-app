// スマホ操作画面(同じ Wi-Fi のスマホから、進行・配信画面の切り替え・指名の入力・タイマー・戻す)
const C = window.DraftCore, F = window.DraftFlow;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let S = null, ws = null, canUndo = false, undoCancelsLottery = false, demo = false;

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50';
const BTN_PRIMARY = `inline-flex items-center justify-center w-full h-14 px-4 text-lg font-bold bg-primary-500 text-slate-900 rounded-lg active:bg-primary-600 cursor-pointer disabled:opacity-40 disabled:cursor-default ${FOCUS}`;
const BTN_SUB = `inline-flex items-center justify-center w-full h-11 px-4 text-[1rem] font-medium bg-[var(--bg-surface)] text-[var(--text-default)] border border-[var(--border-strong)] rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-default ${FOCUS}`;
const INPUT = 'h-11 px-3 text-base bg-[var(--bg-page)] text-[var(--text-default)] border border-[var(--border-strong)] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400/50';
const BADGE = { ok: 'bg-emerald-500/[.12] text-emerald-300', lot: 'bg-amber-500/[.12] text-amber-300', dup: 'bg-red-500/[.12] text-red-300', in: 'bg-primary-500/[.12] text-primary-300', wait: 'bg-[var(--bg-page-alt)] text-[var(--text-muted)]' };
const badge = (k, t) => `<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${BADGE[k]}">${t}</span>`;
const SCENES = [['board', '指名ボード'], ['roulette', '抽選'], ['teams', 'チーム表'], ['wait', '待ち時間'], ['blank', '出さない']];

function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => { $('conn').textContent = '● 接続中'; $('conn').className = 'text-xs text-emerald-300'; };
  ws.onclose = () => { $('conn').textContent = '× 切断（再接続中…）'; $('conn').className = 'text-xs text-red-300'; setTimeout(connect, 1500); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') { S = m.state; canUndo = m.canUndo; undoCancelsLottery = !!m.undoCancelsLottery; demo = !!m.demo; render(); }
    else if (m.type === 'error') toast(m.message);
  };
}
const act = (action) => ws.send(JSON.stringify({ type: 'action', action }));
function toast(t) { const el = $('toast'); el.textContent = t; el.className = 'fixed left-4 right-4 bottom-[calc(96px+env(safe-area-inset-bottom))] z-30 px-4 py-3 rounded-lg shadow-xl text-sm border border-red-500/60 bg-[var(--bg-surface)] text-red-300'; clearTimeout(toast.t); toast.t = setTimeout(() => { el.className = 'hidden'; }, 5000); }
function setDisabled(el, v) { el.disabled = v; if (v) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled'); }

function render() {
  $('title').textContent = S.title || 'ドラフト会議';
  const done = C.draftComplete(S);
  $('round-title').textContent = done ? 'ドラフト終了' : `第${S.round}巡`;
  const n = F.nextStep(S, { demo });
  $('step-label').textContent = n.step >= 0 && n.step < F.STEPS.length ? F.STEPS[n.step] : '';
  const btn = (b, cls) => `<button type="button" class="${cls}" ${b.key ? `data-next="${b.key}"` : ''} ${b.arg ? `data-arg="${b.arg}"` : ''} ${b.off ? 'disabled aria-disabled="true"' : ''}>${b.label}</button>`;
  $('next').innerHTML = `<p class="text-xs text-[var(--text-muted)]">次にやること</p>
    <div class="text-base text-[var(--text-heading)] leading-normal [&_b]:text-primary-300">${n.text}</div>
    ${(n.sub || []).filter((b) => b.key !== 'auto').map((b) => btn(b, BTN_SUB)).join('')}`;
  // メインのボタン(オレンジ)は画面の下に固定。押すことがないときは説明だけ
  $('bar').innerHTML = n.main ? btn(n.main, BTN_PRIMARY) : `<p class="h-14 flex items-center justify-center text-sm text-[var(--text-muted)]">${n.step >= 5 ? 'ドラフト終了' : '待っています'}</p>`;
  const wn = C.waitImagesOf(S).length, wi = Math.min(S.waitIdx || 0, Math.max(0, wn - 1));
  $('wait-ctl').classList.toggle('hidden', !wn);
  $('wait-pos').textContent = wn ? `${wi + 1} / ${wn}` : '';
  setDisabled(document.querySelector('[data-wait-step="-1"]'), wi <= 0);
  setDisabled(document.querySelector('[data-wait-step="1"]'), wi >= wn - 1);
  $('scenes').innerHTML = SCENES.map(([k, t]) => `<button type="button" data-scene="${k}" aria-pressed="${S.scene === k}" class="h-11 px-2 rounded-lg text-sm font-medium border cursor-pointer ${FOCUS} ${S.scene === k ? 'bg-[var(--bg-page-alt)] border-primary-400 text-[var(--text-heading)]' : 'bg-[var(--bg-surface)] border-[var(--border-default)] text-[var(--text-muted)]'}">${t}</button>`).join('');
  renderNoms();
  setDisabled($('undo'), !canUndo);
  renderTimer();
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
    if (pick && !hidden(pick)) { body = `<p class="text-base font-bold text-[var(--text-heading)]">${pname(pick.playerId)}</p>`; st = badge(pick.by === 'lottery' ? 'lot' : 'ok', pick.by === 'lottery' ? '抽選で確定' : '確定'); }
    else if (pick || inLot(l.id)) { body = `<p class="text-base font-bold text-[var(--text-heading)]">${pname(S.lottery.playerId)}</p>`; st = badge('lot', '抽選中'); }
    else if (n.revealed) { body = `<p class="text-base font-bold text-[var(--text-heading)]">${pname(n.playerId)}</p>`; st = confs.some((c) => c.leaders.includes(l.id)) ? badge('dup', '重複') : badge('in', '公開済み'); }
    else if (turn && turn.id !== l.id) { body = ''; st = badge('wait', '順番待ち'); }
    else if (blocked) { body = '<p class="text-sm text-[var(--text-muted)]">ほかの重複の抽選のあとで再指名</p>'; st = badge('wait', '再指名待ち'); }
    else {
      body = `<select data-nom="${l.id}" aria-label="${esc(l.name)} の指名" class="w-full ${INPUT}"><option value="">― 指名を選ぶ ―</option>${options.map((p) => `<option value="${p.id}" ${p.id === n.playerId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
      st = n.playerId ? badge('in', '入力済み') : badge('wait', '未入力');
    }
    return `<div class="flex flex-col gap-2 p-3 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl">
      <div class="flex items-center gap-2"><span class="w-3 h-3 flex-none rounded-full bg-[var(--lc)]" style="--lc:${esc(l.color)}" aria-hidden="true"></span><p class="min-w-0 flex-1 text-sm font-bold text-[var(--text-heading)] truncate">${esc(l.name)}</p>${st}</div>${body}</div>`;
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

document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const key = b.dataset.next, arg = b.dataset.arg;
  if (b.dataset.scene) act({ type: 'setScene', scene: b.dataset.scene });
  else if (b.dataset.waitStep) act({ type: 'waitShow', idx: Math.max(0, (S.waitIdx || 0) + +b.dataset.waitStep) });
  else if (key === 'confirm') act({ type: 'confirmNoms' });
  else if (key === 'reveal') act({ type: 'reveal' });
  else if (key === 'revealOne') act({ type: 'reveal', leaderId: arg });
  else if (key === 'spotShow') act({ type: 'spotShow', leaderId: arg });
  else if (key === 'spotFlip') act({ type: 'reveal', leaderId: arg, spot: true });
  else if (key === 'spotEnd') act({ type: 'spotEnd' });
  else if (key === 'draw') act({ type: 'drawLottery', playerId: arg });
  else if (key === 'board' || key === 'teams') act({ type: 'setScene', scene: key });
  else if (key === 'nextRound') act({ type: 'nextRound' });
  else if (key === 'roster') toast('名簿の登録はパソコンのアプリで行ってください');
  else if (b.id === 'timer-start') act({ type: 'timer', cmd: 'start' });
  else if (b.id === 'timer-stop') act({ type: 'timer', cmd: 'stop' });
  else if (b.id === 'timer-reset') act({ type: 'timer', cmd: 'reset' });
  else if (b.id === 'undo') {
    if (undoCancelsLottery && !confirm('直前の抽選を取り消します。取り消したことは「抽選の記録」に残ります。よろしいですか？')) return;
    ws.send(JSON.stringify({ type: 'undo' }));
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.nom !== undefined) { act({ type: 'nominate', leaderId: t.dataset.nom, playerId: t.value || null }); t.blur(); }
});

connect();
