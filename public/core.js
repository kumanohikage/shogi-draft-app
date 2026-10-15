// ドラフト会議の進行ロジック(サーバーと画面で共用)
// 状態は JSON。apply(state, action) が新しい状態を返す(元の状態は変更しない)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DraftCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uid = (p) => p + Math.random().toString(36).slice(2, 9);

  const LEADER_COLORS = ['#e0302c', '#1f63d6', '#22994a', '#8c3fbf', '#ec7a00', '#0a97a6', '#d81b72', '#7a5230', '#b89200', '#5b5bd6', '#6b8e23', '#5f6b7a'];
  const MAX_LEADERS = 12; // 配信画面に収まる上限(色も12色)

  function initialState() {
    return {
      version: 1,
      title: 'ドラフト会議',
      rounds: 3,
      leaders: [],          // { id, name, color, icon }  ※チーム名はドラフト後に決まるので持たない
      players: [],          // { id, name, icon }
      round: 1,             // 今の巡
      // 今の巡の指名: leaderId -> { playerId, revealed }
      noms: {},
      // 確定: [{ round, leaderId, playerId, by: 'single'|'lottery' }]
      picks: [],
      // 抽選の記録: [{ id, round, playerId, leaders:[ids], winner, at }]
      lotteries: [],
      // 抽選中: { id, playerId, leaders, winner, done }
      lottery: null,
      scene: 'board',       // 配信画面: 'board' | 'roulette' | 'teams' | 'blank'
      spot: null,           // ピックアップ公開中のリーダー(配信画面に1人だけ大きく出す)。null なら指名ボード
      audio: { ...DEFAULT_AUDIO },
    };
  }

  // ---------- 参照 ----------
  const leaderById = (s, id) => s.leaders.find((l) => l.id === id);
  const playerById = (s, id) => s.players.find((p) => p.id === id);
  const pickedIds = (s) => new Set(s.picks.map((p) => p.playerId));
  const pickOf = (s, leaderId, round) => s.picks.find((p) => p.leaderId === leaderId && p.round === round);
  const DEFAULT_AUDIO = { bgm: '', bgmOn: true, bgmVol: 30, seVol: 70, rlVol: 70 }; // bgm = bgm フォルダの曲のファイル名 / seVol = 指名ボード・チーム表の効果音 / rlVol = 抽選ルーレットの音
  const MAX_ROUNDS = 5; // チーム表が1画面に収まる上限
  const teamOf = (s, leaderId) => s.picks.filter((p) => p.leaderId === leaderId).sort((a, b) => a.round - b.round);

  // 公開済みで、まだ確定していない指名のうち、2人以上が同じ選手を指名しているもの
  function conflicts(s) {
    const byPlayer = {};
    for (const l of s.leaders) {
      const n = s.noms[l.id];
      if (!n || !n.playerId || !n.revealed || pickOf(s, l.id, s.round)) continue;
      (byPlayer[n.playerId] = byPlayer[n.playerId] || []).push(l.id);
    }
    return Object.entries(byPlayer).filter(([, ls]) => ls.length > 1).map(([playerId, leaders]) => ({ playerId, leaders }));
  }
  // この巡でまだ確定していないリーダー
  const pendingLeaders = (s) => s.leaders.filter((l) => !pickOf(s, l.id, s.round));
  const roundComplete = (s) => s.leaders.length > 0 && pendingLeaders(s).length === 0;
  const draftComplete = (s) => s.round >= s.rounds && roundComplete(s);

  // この巡の未確定の指名が全部公開されたか(1人ずつ公開の途中は false)
  const allRevealed = (s) => pendingLeaders(s).every((l) => s.noms[l.id] && s.noms[l.id].playerId && s.noms[l.id].revealed);

  // 単独指名(公開済み・重複なし)を確定する。1人ずつ公開の途中では確定しない(後から重複が出るかもしれないので)
  function confirmSingles(s) {
    if (!allRevealed(s)) return;
    const counts = {};
    for (const l of pendingLeaders(s)) {
      const n = s.noms[l.id];
      if (n && n.playerId && n.revealed) counts[n.playerId] = (counts[n.playerId] || 0) + 1;
    }
    for (const l of pendingLeaders(s)) {
      const n = s.noms[l.id];
      if (n && n.playerId && n.revealed && counts[n.playerId] === 1) s.picks.push({ round: s.round, leaderId: l.id, playerId: n.playerId, by: 'single' });
    }
  }

  // ---------- 操作 ----------
  // rng: 0〜1 の乱数(テストで差し替えられるように)
  function apply(state, action, rng = Math.random) {
    const s = clone(state);
    switch (action.type) {
      case 'setTitle': s.title = String(action.title || '').slice(0, 40); break;
      case 'setRounds': s.rounds = Math.max(1, Math.min(MAX_ROUNDS, action.rounds | 0)); break;

      case 'addLeader': {
        if (s.leaders.length >= MAX_LEADERS) throw new Error(`リーダーは${MAX_LEADERS}人までです`);
        const used = new Set(s.leaders.map((l) => l.color));
        s.leaders.push({ id: uid('L'), name: action.name || `リーダー${s.leaders.length + 1}`, color: action.color || LEADER_COLORS.find((c) => !used.has(c)) || '#888888', icon: action.icon || '' });
        break;
      }
      case 'updateLeader': { const l = leaderById(s, action.id); if (l) Object.assign(l, action.patch); break; }
      case 'removeLeader': s.leaders = s.leaders.filter((l) => l.id !== action.id); delete s.noms[action.id]; break;
      case 'moveLeader': {
        const i = s.leaders.findIndex((l) => l.id === action.id), j = i + action.dir;
        if (i >= 0 && j >= 0 && j < s.leaders.length) [s.leaders[i], s.leaders[j]] = [s.leaders[j], s.leaders[i]];
        break;
      }
      case 'addPlayers': for (const p of action.players) s.players.push({ id: uid('P'), name: p.name, icon: p.icon || '' }); break;
      case 'updatePlayer': { const p = playerById(s, action.id); if (p) Object.assign(p, action.patch); break; }
      case 'removePlayer': s.players = s.players.filter((p) => p.id !== action.id); break;
      case 'replaceRoster': // CSV 読み込み
        if (action.leaders && action.leaders.length > MAX_LEADERS) throw new Error(`リーダーは${MAX_LEADERS}人までです（CSVに${action.leaders.length}人います）`);
        if (action.leaders) s.leaders = action.leaders.map((l, i) => ({ id: uid('L'), name: l.name, color: l.color || LEADER_COLORS[i % LEADER_COLORS.length], icon: l.icon || '' }));
        if (action.players) s.players = action.players.map((p) => ({ id: uid('P'), name: p.name, icon: p.icon || '' }));
        break;

      case 'nominate': { // 公開前の指名を入れる/変える(空で取り消し)
        if (pickOf(s, action.leaderId, s.round)) break;
        const cur = s.noms[action.leaderId];
        if (cur && cur.revealed) break;
        // プロ野球のドラフトと同じく、この巡の重複を全部抽選してから、外れたリーダーがまとめて再指名する
        if (s.lottery && !s.lottery.done) throw new Error('抽選の演出が終わるまで待ってください');
        if (conflicts(s).length) throw new Error('残りの重複をすべて抽選してから再指名してください');
        if (action.playerId && pickedIds(s).has(action.playerId)) throw new Error('その選手はすでに指名が確定しています');
        s.noms[action.leaderId] = { playerId: action.playerId || null, revealed: false };
        break;
      }
      case 'reveal': { // 入力済みの指名を一斉公開 → 単独指名は確定。leaderId を付けると1人だけ公開
        const ids = action.leaderId ? [action.leaderId] : pendingLeaders(s).map((l) => l.id);
        for (const id of ids) { const n = s.noms[id]; if (n && n.playerId) n.revealed = true; }
        confirmSingles(s);
        s.scene = 'board'; // 公開はボードで見せる
        // spot: true なら、その人を配信画面に大きく出す(ピックアップ公開)
        s.spot = action.spot && action.leaderId ? action.leaderId : null;
        break;
      }
      case 'spotEnd': s.spot = null; break; // ピックアップ公開を終えて指名ボード(一覧)に戻す
      case 'drawLottery': { // 重複の抽選(結果はここで決める。演出は画面側)
        const c = conflicts(s).find((x) => x.playerId === action.playerId);
        if (!c) throw new Error('この選手の重複はありません');
        const winner = c.leaders[Math.floor(rng() * c.leaders.length)];
        s.lottery = { id: uid('R'), playerId: c.playerId, leaders: c.leaders, winner, done: false };
        s.lotteries.push({ id: s.lottery.id, round: s.round, playerId: c.playerId, leaders: c.leaders, winner, at: Date.now() });
        s.picks.push({ round: s.round, leaderId: winner, playerId: c.playerId, by: 'lottery' });
        // 外れたリーダーは再指名(指名を空に戻す)
        for (const id of c.leaders) if (id !== winner) s.noms[id] = { playerId: null, revealed: false };
        s.scene = 'roulette'; s.spot = null;
        break;
      }
      case 'lotteryDone': if (s.lottery && s.lottery.id === action.id) s.lottery.done = true; break;
      case 'nextRound':
        if (!roundComplete(s)) throw new Error('この巡はまだ全員の指名が確定していません');
        if (s.round >= s.rounds) throw new Error('最後の巡です');
        s.round += 1; s.noms = {}; s.lottery = null; s.scene = 'board'; s.spot = null;
        break;
      case 'setScene': s.scene = action.scene; break;
      // 音(BGM・効果音)の設定。「戻す」の対象外
      case 'setAudio': s.audio = Object.assign({}, DEFAULT_AUDIO, s.audio, action.patch); break;
      case 'resetDraft': s.round = 1; s.noms = {}; s.picks = []; s.lotteries = []; s.lottery = null; s.scene = 'board'; s.spot = null; break;
      default: throw new Error('不明な操作: ' + action.type);
    }
    return s;
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
  }
  const csvCell = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  // 書式: 種類,名前,色,画像ファイル  (種類 = リーダー / 選手)。旧書式(チーム名の列あり)も読める
  function rosterToCSV(s) {
    const lines = ['種類,名前,色,画像ファイル'];
    for (const l of s.leaders) lines.push(['リーダー', l.name, l.color, l.icon].map(csvCell).join(','));
    for (const p of s.players) lines.push(['選手', p.name, '', p.icon].map(csvCell).join(','));
    return lines.join('\r\n') + '\r\n';
  }
  function rosterFromCSV(text) {
    const rows = parseCSV(text.replace(/^﻿/, ''));
    const leaders = [], players = [];
    let old = false; // 旧書式: 種類,名前,チーム名,色,画像ファイル
    for (const r0 of rows) {
      const kind = r0[0];
      if (kind === '種類') { old = r0.includes('チーム名'); continue; }
      const r = old || r0.length >= 5 ? [r0[0], r0[1], r0[3], r0[4]] : r0;
      if (/^リーダー|^leader$/i.test(kind)) leaders.push({ name: r[1], color: /^#[0-9a-f]{6}$/i.test(r[2] || '') ? r[2] : '', icon: r[3] || '' });
      else if (/^選手|^player$/i.test(kind)) players.push({ name: r[1], icon: r[3] || '' });
    }
    return { leaders, players };
  }

  return { initialState, apply, conflicts, allRevealed, pendingLeaders, roundComplete, draftComplete, pickOf, teamOf, leaderById, playerById, pickedIds, rosterToCSV, rosterFromCSV, parseCSV, LEADER_COLORS, DEFAULT_AUDIO, MAX_ROUNDS, MAX_LEADERS };
}));
