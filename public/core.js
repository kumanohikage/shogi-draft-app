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
      players: [],          // { id, name, icon, note(ひとこと), absent(欠場) }
      round: 1,             // 今の巡
      // 今の巡の指名: leaderId -> { playerId, revealed }
      noms: {},
      // 確定: [{ round, leaderId, playerId, by: 'single'|'lottery' }]
      picks: [],
      // 抽選の記録: [{ id, round, playerId, leaders:[ids], winner, at }]
      lotteries: [],
      // 抽選中: { id, playerId, leaders, winner, done }
      lottery: null,
      scene: 'logo',        // 配信画面: 'logo' | 'slide' | 'intro' | 'wait' | 'board' | 'roulette' | 'teams' | 'blank'(新しく始めるときは進行表の最初=オープニング)
      spot: null,           // ピックアップ公開中のリーダー(配信画面に1人だけ大きく出す)。null なら指名ボード
      audio: { ...DEFAULT_AUDIO },
      options: { ...DEFAULT_OPTIONS },
      // 抽選の記録(取り消した抽選も残す。「1つ戻す」でも消えない): [{ id, round, playerId, leaders, winner, at, canceledAt? }]
      lotteryLog: [],
      // 指名の制限時間: endsAt(終わる時刻 ms) / left(止めたときの残り秒)
      timer: { endsAt: null, left: null },
      // 資料(文字 or 画像)と、番組の進行表。progIdx = いま進行表の何番目か / introIdx = リーダー紹介の何人目か
      slides: defaultSlides(),
      program: null, // null のときはひな形(programOf)
      progIdx: 0,
      introIdx: 0,
      spotStand: false, // ピックアップで、カードの前に立ち絵を出しているところ
    };
  }

  // ---------- 資料と進行表 ----------
  // ひな形の資料(大会説明・ドラフト説明)。中身はあとで書き換える前提
  function defaultSlides() {
    return [
      { id: 'S_about', kind: 'text', title: '大会について', lines: ['（ここに大会の説明を書きます）'], image: '' },
      { id: 'S_draft', kind: 'text', title: 'ドラフト指名について', lines: ['各チーム、巡の数だけ指名する', '指名が重複したときは抽選になる', '交渉権を得られなかったチームのみ、もう一度指名する', '全チームが確定してから、次の巡へ進む'], image: '' },
    ];
  }
  // 進行表の場面: logo(ロゴを大きく) / slide(資料) / intro(リーダー紹介) / draft(ドラフト) / final(最終チーム表) / blank(何も出さない)
  const PROGRAM_TYPES = { logo: 'ロゴ', slide: '資料', intro: 'リーダー紹介', draft: 'ドラフト', final: '最終チーム表', blank: '何も出さない' };
  function defaultProgram() {
    return [
      { id: 'G_open', type: 'logo', label: 'オープニング' },
      { id: 'G_about', type: 'slide', slideId: 'S_about', label: '大会説明' },
      { id: 'G_rule', type: 'slide', slideId: 'S_draft', label: 'ドラフト説明' },
      { id: 'G_intro', type: 'intro', label: 'リーダー紹介' },
      { id: 'G_draft', type: 'draft', label: 'ドラフト' },
      { id: 'G_final', type: 'final', label: '最終チーム表' },
      { id: 'G_end', type: 'logo', label: 'エンディング' },
    ];
  }
  const programOf = (s) => s.program || defaultProgram();
  // 前の版のデータ(進行表が無い)は、ドラフトの場面から始める
  const progIdxOf = (s) => (s.progIdx ?? Math.max(0, programOf(s).findIndex((g) => g.type === 'draft')));
  const progItem = (s) => programOf(s)[progIdxOf(s)] || null;
  const slideById = (s, id) => (s.slides || []).find((x) => x.id === id);
  // 名前の帯: 「チーム」＋リーダー名
  const teamLabel = (s, l) => (optionsOf(s).teamPrefix || '') + (l ? l.name : '');
  // 進行表の場面に入ったときに出す配信画面
  function sceneForItem(s, g) {
    if (!g) return s.scene;
    if (g.type === 'draft') {
      const fresh = s.round === 1 && !s.picks.length && !Object.values(s.noms).some((n) => n.playerId);
      return fresh && optionsOf(s).flowWait ? 'wait' : 'board';
    }
    return { logo: 'logo', slide: 'slide', intro: 'intro', final: 'teams', blank: 'blank' }[g.type] || s.scene;
  }

  // ---------- 参照 ----------
  const leaderById = (s, id) => s.leaders.find((l) => l.id === id);
  const playerById = (s, id) => s.players.find((p) => p.id === id);
  const pickedIds = (s) => new Set(s.picks.map((p) => p.playerId));
  const pickOf = (s, leaderId, round) => s.picks.find((p) => p.leaderId === leaderId && p.round === round);
  const DEFAULT_AUDIO = { bgm: '', bgmOn: true, bgmVol: 30, seVol: 70, rlVol: 70 }; // bgm = bgm フォルダの曲のファイル名 / seVol = 指名ボード・チーム表の効果音 / rlVol = 抽選ルーレットの音
  const MAX_ROUNDS = 5; // チーム表が1画面に収まる上限
  // 進め方の設定。roundModes[巡-1] = 'bid'(一斉入札) | 'order'(順番指名)。orderStyle: 'snake'(順番指名の巡ごとに逆順) | 'waiver'(毎回同じ順)
  // lotteryStyle: 'full' | 'short'(短い抽選演出)。timerSec: 制限時間(秒)。timerShow: 配信画面にタイマーを出すか。waitImage: 待ち時間画面の画像
  // waitImages: { 巡: [画像ファイル名, ...] } 待ち時間画面で出す画像(詰将棋の問題 → 答え など)。waitImage は前の版の1枚だけの設定(全部の巡で使う)
  // 見た目: bgImage(全画面の背景) / logoImage(大会ロゴ) / teamPrefix(名前の帯の「チーム」)
  // 各巡の流れ: flowWait(巡のはじめに待ち時間画面) / flowTeams(巡の終わりにチーム表) / flowStand(ピックアップの前に立ち絵)
  const DEFAULT_OPTIONS = { roundModes: [], orderStyle: 'snake', lotteryStyle: 'full', timerSec: 300, timerShow: true, waitImages: {}, waitImage: '',
    bgImage: '', logoImage: '', teamPrefix: 'チーム', flowWait: true, flowTeams: true, flowStand: true };
  const waitImagesOf = (s, r = s.round) => { const o = optionsOf(s); const list = (o.waitImages || {})[r]; return list && list.length ? list : o.waitImage ? [o.waitImage] : []; };
  const optionsOf = (s) => Object.assign({}, DEFAULT_OPTIONS, s.options);
  const roundMode = (s, r = s.round) => optionsOf(s).roundModes[r - 1] || 'bid';
  // 順番指名の巡の順番: 登録順。スネークなら、順番指名の巡を数えて奇数回目は逆順
  function turnOrder(s, r = s.round) {
    const o = optionsOf(s);
    let k = 0; for (let i = 1; i < r; i++) if (roundMode(s, i) === 'order') k++;
    return o.orderStyle === 'snake' && k % 2 === 1 ? [...s.leaders].reverse() : [...s.leaders];
  }
  // 順番指名でいま指名する人(この巡でまだ確定していない、順番の最初の人)
  const currentTurn = (s) => (roundMode(s) === 'order' ? turnOrder(s).find((l) => !pickOf(s, l.id, s.round)) || null : null);
  // 公開前の確認に使う「いまの指名の組み合わせ」。指名が変わると変わる(=確認し直し)
  const confirmKey = (s) => JSON.stringify([s.round, pendingLeaders(s).map((l) => [l.id, s.noms[l.id]?.playerId || null])]);
  // ドラフトが始まっているか(指名か確定が1つでもある)
  const draftStarted = (s) => s.picks.length > 0 || s.round > 1 || Object.values(s.noms).some((n) => n.playerId);
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
      case 'removeLeader':
        if (draftStarted(s)) throw new Error('ドラフトの途中はリーダーを削除できません');
        s.leaders = s.leaders.filter((l) => l.id !== action.id); delete s.noms[action.id]; break;
      case 'moveLeader': {
        const i = s.leaders.findIndex((l) => l.id === action.id), j = i + action.dir;
        if (i >= 0 && j >= 0 && j < s.leaders.length) [s.leaders[i], s.leaders[j]] = [s.leaders[j], s.leaders[i]];
        break;
      }
      case 'addPlayers': for (const p of action.players) s.players.push({ id: uid('P'), name: p.name, icon: p.icon || '', note: p.note || '' }); break;
      case 'updatePlayer': { const p = playerById(s, action.id); if (p) Object.assign(p, action.patch); break; }
      case 'removePlayer':
        if (draftStarted(s)) throw new Error('ドラフトの途中は選手を削除できません（欠場にしてください）');
        s.players = s.players.filter((p) => p.id !== action.id); break;
      case 'replaceRoster': // CSV 読み込み
        if (action.leaders && action.leaders.length > MAX_LEADERS) throw new Error(`リーダーは${MAX_LEADERS}人までです（CSVに${action.leaders.length}人います）`);
        if (action.leaders) s.leaders = action.leaders.map((l, i) => ({ id: uid('L'), name: l.name, color: l.color || LEADER_COLORS[i % LEADER_COLORS.length], icon: l.icon || '', stand: l.stand || '', intro: l.intro || '' }));
        if (action.players) s.players = action.players.map((p) => ({ id: uid('P'), name: p.name, icon: p.icon || '', note: p.note || '' }));
        break;

      case 'nominate': { // 公開前の指名を入れる/変える(空で取り消し)
        if (pickOf(s, action.leaderId, s.round)) break;
        const cur = s.noms[action.leaderId];
        if (cur && cur.revealed) break;
        // プロ野球のドラフトと同じく、この巡の重複を全部抽選してから、外れたリーダーがまとめて再指名する
        if (s.lottery && !s.lottery.done) throw new Error('抽選の演出が終わるまで待ってください');
        if (conflicts(s).length) throw new Error('残りの重複をすべて抽選してから再指名してください');
        if (action.playerId && pickedIds(s).has(action.playerId)) throw new Error('その選手はすでに指名が確定しています');
        if (action.playerId && playerById(s, action.playerId)?.absent) throw new Error('その選手は欠場です');
        const turn = currentTurn(s);
        if (turn && turn.id !== action.leaderId) throw new Error('順番指名です。いまは ' + turn.name + ' の番です');
        s.noms[action.leaderId] = { playerId: action.playerId || null, revealed: false };
        break;
      }
      case 'reveal': { // 入力済みの指名を一斉公開 → 単独指名は確定。leaderId を付けると1人だけ公開
        const ids = action.leaderId ? [action.leaderId] : pendingLeaders(s).map((l) => l.id);
        for (const id of ids) { const n = s.noms[id]; if (n && n.playerId) n.revealed = true; }
        if (roundMode(s) === 'order') {
          // 順番指名は公開した時点で確定(すでに確定した選手は選べないので重複しない)
          for (const id of ids) { const n = s.noms[id]; if (n && n.revealed && !pickOf(s, id, s.round)) s.picks.push({ round: s.round, leaderId: id, playerId: n.playerId, by: 'order' }); }
        } else confirmSingles(s);
        s.scene = 'board'; s.spotStand = false; // 公開はボードで見せる
        // spot: true なら、その人を配信画面に大きく出す(ピックアップ公開)
        s.spot = action.spot && action.leaderId ? action.leaderId : null;
        break;
      }
      // ピックアップ公開: spotShow でその人のカードを裏のまま大きく出す → reveal(spot: true) でめくる → spotEnd で一覧へ
      case 'spotShow': s.spot = action.leaderId; s.spotStand = false; s.scene = 'board'; break;
      case 'spotStand': s.spot = action.leaderId; s.spotStand = true; s.scene = 'board'; break; // カードの前に立ち絵
      case 'spotEnd': s.spot = null; s.spotStand = false; break;
      // ---------- 資料 ----------
      case 'addSlide': {
        const id = uid('S');
        s.slides = [...(s.slides || []), { id, kind: action.kind === 'image' ? 'image' : 'text', title: action.kind === 'image' ? '画像の資料' : '新しい資料', lines: [], image: '' }];
        if (action.toProgram) { s.program = [...programOf(s)]; s.program.splice(action.at ?? s.program.length, 0, { id: uid('G'), type: 'slide', slideId: id, label: action.kind === 'image' ? '画像の資料' : '新しい資料' }); }
        break;
      }
      case 'updateSlide': { const x = slideById(s, action.id); if (x) Object.assign(x, action.patch); break; }
      case 'removeSlide':
        s.slides = (s.slides || []).filter((x) => x.id !== action.id);
        s.program = programOf(s).filter((g) => g.slideId !== action.id);
        s.progIdx = Math.min(progIdxOf(s), s.program.length - 1);
        break;
      // ---------- 進行表 ----------
      case 'addProgram': {
        if (!PROGRAM_TYPES[action.item?.type] || action.item.type === 'draft') throw new Error('この場面は足せません');
        s.program = [...programOf(s)];
        s.program.splice(action.at ?? s.program.length, 0, { id: uid('G'), label: PROGRAM_TYPES[action.item.type], ...action.item });
        break;
      }
      case 'updateProgram': { s.program = programOf(s).map((g) => (g.id === action.id ? { ...g, ...action.patch, id: g.id, type: g.type } : g)); break; }
      case 'removeProgram': {
        const g = programOf(s).find((x) => x.id === action.id);
        if (!g) break;
        if (g.type === 'draft') throw new Error('ドラフトの場面は外せません');
        const i = programOf(s).indexOf(g);
        s.program = programOf(s).filter((x) => x.id !== action.id);
        if (progIdxOf(s) > i) s.progIdx = progIdxOf(s) - 1;
        s.progIdx = Math.min(progIdxOf(s), s.program.length - 1);
        break;
      }
      case 'moveProgram': {
        const p = [...programOf(s)], i = p.findIndex((x) => x.id === action.id), j = i + action.dir;
        if (i < 0 || j < 0 || j >= p.length) break;
        const cur = p[progIdxOf(s)];
        [p[i], p[j]] = [p[j], p[i]];
        s.program = p; s.progIdx = p.indexOf(cur);
        break;
      }
      case 'resetProgram': s.program = null; s.progIdx = 0; if (!(s.slides || []).some((x) => x.id === 'S_about')) s.slides = [...defaultSlides(), ...(s.slides || [])]; break;
      // 進行表の場面へ移る(配信画面もその場面に)
      case 'progGo': {
        const p = programOf(s), i = Math.max(0, Math.min(p.length - 1, action.idx | 0));
        s.progIdx = i; s.introIdx = 0;
        s.scene = sceneForItem(s, p[i]);
        break;
      }
      case 'introGo': s.introIdx = Math.max(0, Math.min(s.leaders.length - 1, action.idx | 0)); s.scene = 'intro'; break;
      case 'waitShow': s.waitIdx = Math.max(0, action.idx | 0); break; // 待ち時間画面の何枚目を出すか
      case 'confirmNoms': s.confirmedKey = confirmKey(s); break; // 公開前の確認をした
      case 'drawLottery': { // 重複の抽選(結果はここで決める。演出は画面側)
        const c = conflicts(s).find((x) => x.playerId === action.playerId);
        if (!c) throw new Error('この選手の重複はありません');
        const winner = c.leaders[Math.floor(rng() * c.leaders.length)];
        s.lottery = { id: uid('R'), playerId: c.playerId, leaders: c.leaders, winner, done: false };
        s.lotteries.push({ id: s.lottery.id, round: s.round, playerId: c.playerId, leaders: c.leaders, winner, at: Date.now() });
        s.lotteryLog = [...(s.lotteryLog || []), { id: s.lottery.id, round: s.round, playerId: c.playerId, leaders: c.leaders, winner, at: Date.now() }];
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
        s.round += 1; s.noms = {}; s.lottery = null; s.spot = null; s.spotStand = false; s.waitIdx = 0;
        s.scene = optionsOf(s).flowWait ? 'wait' : 'board'; // 巡のはじめは待ち時間画面(設定で外せる)
        break;
      case 'setScene': s.scene = action.scene; break;
      // 音(BGM・効果音)の設定。「戻す」の対象外
      case 'setAudio': s.audio = Object.assign({}, DEFAULT_AUDIO, s.audio, action.patch); break;
      // ドラフトを最初から(名簿・画像・音・設定はそのまま。抽選の記録には「リセット」を残す)
      case 'resetDraft':
        s.round = 1; s.noms = {}; s.picks = []; s.lotteries = []; s.lottery = null; s.spot = null; s.spotStand = false; s.timer = { endsAt: null, left: null }; s.waitIdx = 0;
        s.progIdx = 0; s.introIdx = 0; s.scene = sceneForItem(s, programOf(s)[0]);
        s.lotteryLog = [...(s.lotteryLog || []), { reset: true, at: Date.now() }];
        break;
      // 設定(進め方・抽選演出・タイマー・待ち時間の画像)。「戻す」の対象外
      case 'setOption': s.options = Object.assign({}, DEFAULT_OPTIONS, s.options, action.patch); break;
      // 制限時間: start(残りがあれば続きから) / stop(一時停止) / reset
      case 'timer': {
        const sec = optionsOf(s).timerSec, t = s.timer || {}, now = action.now || Date.now();
        if (action.cmd === 'start') s.timer = { endsAt: now + (t.left ?? sec) * 1000, left: null };
        else if (action.cmd === 'stop') s.timer = { endsAt: null, left: t.endsAt ? Math.max(0, Math.round((t.endsAt - now) / 1000)) : t.left };
        else s.timer = { endsAt: null, left: null };
        break;
      }
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
  // 書式: 種類,名前,色,画像ファイル,ひとこと  (種類 = リーダー / 選手)。旧書式(チーム名の列あり・ひとことなし)も読める
  function rosterToCSV(s) {
    const lines = ['種類,名前,色,画像ファイル,ひとこと'];
    for (const l of s.leaders) lines.push(['リーダー', l.name, l.color, l.icon, ''].map(csvCell).join(','));
    for (const p of s.players) lines.push(['選手', p.name, '', p.icon, p.note || ''].map(csvCell).join(','));
    return lines.join('\r\n') + '\r\n';
  }
  function rosterFromCSV(text) {
    const rows = parseCSV(text.replace(/^﻿/, ''));
    const leaders = [], players = [];
    let old = false; // 旧書式: 種類,名前,チーム名,色,画像ファイル
    for (const r0 of rows) {
      const kind = r0[0];
      if (kind === '種類') { old = r0.includes('チーム名'); continue; }
      const r = old ? [r0[0], r0[1], r0[3], r0[4], ''] : r0;
      if (/^リーダー|^leader$/i.test(kind)) leaders.push({ name: r[1], color: /^#[0-9a-f]{6}$/i.test(r[2] || '') ? r[2] : '', icon: r[3] || '' });
      else if (/^選手|^player$/i.test(kind)) players.push({ name: r[1], icon: r[3] || '', note: r[4] || '' });
    }
    return { leaders, players };
  }

  return { initialState, apply, conflicts, allRevealed, pendingLeaders, roundComplete, draftComplete, pickOf, teamOf, leaderById, playerById, pickedIds, rosterToCSV, rosterFromCSV, parseCSV, LEADER_COLORS, DEFAULT_AUDIO, DEFAULT_OPTIONS, MAX_ROUNDS, MAX_LEADERS, optionsOf, roundMode, turnOrder, currentTurn, draftStarted, confirmKey, waitImagesOf, PROGRAM_TYPES, programOf, progIdxOf, progItem, slideById, teamLabel, sceneForItem, defaultSlides };
}));
