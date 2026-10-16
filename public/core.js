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
      leaders: [],          // { id, name(フルネーム), short(略称), color, icon, stand(立ち絵), standScale/standX/standY(立ち絵の大きさと位置), intro(紹介文), introMemo(紹介のメモ。自分用) }  ※チーム名はドラフト後に決まるので持たない
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
      scene: 'logo',        // 配信画面: 'logo' | 'slide' | 'intro' | 'round'(巡の見出し) | 'wait' | 'board' | 'roulette' | 'teams' | 'blank'(新しく始めるときは進行表の最初=オープニング)
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
      { id: 'S_draft', kind: 'text', rules: true, title: 'ドラフト指名について', lines: ['各チーム、巡の数だけ指名する', '指名が重複したときは抽選になる', '交渉権を得られなかったチームのみ、もう一度指名する', '全チームが確定してから、次の巡へ進む'], image: '' },
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
  // 名前の帯など: 「チーム」＋略称(なければフルネーム)。リーダー紹介だけはフルネーム
  const shortName = (l) => (l ? (l.short || '').trim() || l.name : '');
  const teamLabel = (s, l) => (optionsOf(s).teamPrefix || '') + shortName(l);
  // 巡のはじめの画面: 待ち時間の画像があれば待ち時間、なければ指名ボード
  const roundStartScene = (s) => (optionsOf(s).flowWait && waitImagesOf(s).length ? 'wait' : 'board');
  // 巡のはじめにタイマーを動かす(設定で止められる)
  function startRoundTimer(s, now) {
    const o = optionsOf(s);
    s.timer = o.timerAuto ? { endsAt: now + o.timerSec * 1000, left: null } : { endsAt: null, left: null };
  }
  // ドラフト説明の文を、いまの進め方から作る
  function ruleLines(s) {
    const o = optionsOf(s), n = s.rounds, all = Array.from({ length: n }, (_, i) => i + 1);
    const bid = all.filter((r) => roundMode(s, r) === 'bid'), ord = all.filter((r) => roundMode(s, r) === 'order');
    const rs = (list) => {
      const run = list.every((r, i) => !i || r === list[i - 1] + 1);
      return list.length === 1 ? `第${list[0]}巡` : run ? `第${list[0]}〜${list[list.length - 1]}巡` : `第${list.join('・')}巡`;
    };
    const lines = [`各チーム${n}人を、${n}巡に分けて指名します`];
    if (bid.length) {
      lines.push(`${ord.length ? rs(bid) + 'は' : '毎巡、'}全チームが同時に指名します`);
      lines.push('指名が重複したら、抽選で交渉権を決めます');
      lines.push('交渉権を得られなかったチームは、もう一度指名します');
    }
    if (ord.length) {
      lines.push(`${bid.length ? rs(ord) + 'は' : '毎巡、'}1チームずつ順番に指名します`);
      if (o.orderStyle === 'snake' && ord.length > 1) lines.push('順番に指名する巡は、巡ごとに順番が逆になります');
    }
    lines.push('全チームの指名が確定してから、次の巡へ進みます');
    if (o.timerSec) { const m = Math.floor(o.timerSec / 60), sec = o.timerSec % 60; lines.push(`指名の制限時間は${m ? m + '分' : ''}${sec ? sec + '秒' : ''}です`); }
    return lines;
  }
  const draftFresh = (s) => s.round === 1 && !s.picks.length && !Object.values(s.noms).some((n) => n.playerId);
  // 進行表の場面に入ったときに出す配信画面
  function sceneForItem(s, g) {
    if (!g) return s.scene;
    if (g.type === 'draft') {
      return draftFresh(s) ? (optionsOf(s).flowRound ? 'round' : roundStartScene(s)) : 'board';
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
  // timerAuto: 巡のはじめにタイマーを自動で動かす
  // 場面の切り替え(進行表の場面が変わるときだけ): transition = none | fadeBlack | fadeWhite | slide | wipe | video
  //   transSec: 切り替えの長さ(秒) / transVideo: 動画のファイル名 / transCut: 動画の何秒目で場面を入れ替えるか(0 = 動画の長さの半分)
  // 見た目: bgImage(全画面の背景) / logoImage(大会ロゴ) / titleMode(大会名を 'text' 文字 | 'logo' ロゴ画像で出す。'' は前の版の扱い = ロゴがあればロゴ) / teamPrefix(名前の帯の「チーム」)
  // flowRound: 巡のはじめに「第◯巡」の見出し(次へでタイマー開始) / fadeSec: 配信画面の切り替えのフェード(秒。0 でなし)
  // 各巡の流れ: flowWait(巡のはじめに待ち時間画面) / flowTeams(巡の終わりにチーム表) / flowStand(ピックアップの前に立ち絵)
  const DEFAULT_OPTIONS = { roundModes: [], orderStyle: 'snake', lotteryStyle: 'full', timerSec: 300, timerShow: true, timerAuto: true, waitImages: {}, waitImage: '',
    bgImage: '', logoImage: '', titleMode: '', teamPrefix: 'チーム', transition: 'none', transSec: 0.6, transVideo: '', transCut: 0, flowWait: true, flowTeams: true, flowStand: true, flowRound: true, fadeSec: 0.3 };
  // 見出しにロゴ画像を出すか
  const useLogo = (s) => { const o = optionsOf(s); return !!o.logoImage && o.titleMode !== 'text'; };
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
        s.leaders.push({ id: uid('L'), name: action.name || `リーダー${s.leaders.length + 1}`, short: '', color: action.color || LEADER_COLORS.find((c) => !used.has(c)) || '#888888', icon: action.icon || '' });
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
        if (action.leaders) s.leaders = action.leaders.map((l, i) => ({ id: uid('L'), name: l.name, short: l.short || '', color: l.color || LEADER_COLORS[i % LEADER_COLORS.length], icon: l.icon || '', stand: l.stand || '', intro: l.intro || '', introMemo: l.introMemo || '' }));
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
        // ドラフトのはじめに入ったら、タイマーを動かす(もう動かしていれば何もしない)
        const t = s.timer || {};
        if (p[i].type === 'draft' && draftFresh(s) && !t.endsAt && t.left == null && s.scene !== 'round') startRoundTimer(s, action.now || Date.now());
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
        if (optionsOf(s).flowRound) { s.scene = 'round'; s.timer = { endsAt: null, left: null }; } // 見出しから「始める」でタイマー開始
        else { s.scene = roundStartScene(s); startRoundTimer(s, action.now || Date.now()); }
        break;
      case 'setScene': s.scene = action.scene; break;
      // 巡の見出しから、指名を始める(待ち時間の画面か指名ボードへ。タイマー開始)
      case 'roundStart': s.scene = roundStartScene(s); startRoundTimer(s, action.now || Date.now()); break;
      // 番組の CSV 読み込み(大会・進め方・見た目・進行表)。ドラフトの途中でも名簿と結果はそのまま
      case 'replaceShow': {
        if (action.title != null) s.title = String(action.title).slice(0, 40);
        if (action.rounds != null) { if (draftStarted(s) && action.rounds !== s.rounds) throw new Error('ドラフトの途中は巡の数を変えられません'); s.rounds = Math.max(1, Math.min(MAX_ROUNDS, action.rounds | 0)); }
        if (action.options) s.options = Object.assign({}, DEFAULT_OPTIONS, s.options, action.options);
        if (action.program) {
          s.slides = action.slides || [];
          s.program = action.program;
          s.progIdx = Math.min(progIdxOf(s), s.program.length - 1);
        }
        break;
      }
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
  // 書式: 種類,名前,略称,色,画像ファイル,ひとこと  (種類 = リーダー / 選手)。見出しの列名で読むので、列の順番が違っても読める
  const CSV_COLS = ['種類', '名前', '略称', '色', '画像ファイル', 'ひとこと', '立ち絵', '紹介文', '紹介のメモ'];
  function rosterToCSV(s) {
    const lines = [CSV_COLS.join(',')];
    for (const l of s.leaders) lines.push(['リーダー', l.name, l.short || '', l.color, l.icon, '', l.stand || '', l.intro || '', l.introMemo || ''].map(csvCell).join(','));
    for (const p of s.players) lines.push(['選手', p.name, '', '', p.icon, p.note || ''].map(csvCell).join(','));
    return lines.join('\r\n') + '\r\n';
  }
  function rosterFromCSV(text) {
    const rows = parseCSV(text.replace(/^﻿/, ''));
    const leaders = [], players = [];
    let col = Object.fromEntries(CSV_COLS.map((c, i) => [c, i]));
    for (const r of rows) {
      const kind = r[0], get = (c) => (col[c] == null ? '' : r[col[c]] || '');
      if (kind === '種類') { col = Object.fromEntries(r.map((c, i) => [c, i])); continue; }
      const color = /^#[0-9a-f]{6}$/i.test(get('色')) ? get('色') : '';
      if (/^リーダー|^leader$/i.test(kind)) leaders.push({ name: get('名前'), short: get('略称'), color, icon: get('画像ファイル'), stand: get('立ち絵'), intro: get('紹介文'), introMemo: get('紹介のメモ') });
      else if (/^選手|^player$/i.test(kind)) players.push({ name: get('名前'), icon: get('画像ファイル'), note: get('ひとこと') });
    }
    return { leaders, players };
  }

  // ---------- 番組の CSV(大会・進め方・見た目・進行表) ----------
  // 書式: 種類,項目,値,値,…  種類 = 大会 / 進め方 / 見た目 / 進行表。進行表の行は上から順に場面になる
  // 進行表の項目 = 場面の種類(ロゴ・文字の資料・ドラフト説明・画像の資料・リーダー紹介・ドラフト・最終チーム表・何も出さない)、値 = 場面の名前 …
  const yes = (v) => /^(する|出す|はい|true|1|on)$/i.test(String(v || '').trim());
  const TRANSITIONS = { none: 'なし', fadeBlack: 'フェード（黒）', fadeWhite: 'フェード（白）', slide: 'スライド', wipe: 'ワイプ', video: '動画' };
  const SCENE_CSV = { logo: 'ロゴ', intro: 'リーダー紹介', draft: 'ドラフト', final: '最終チーム表', blank: '何も出さない' };
  function showToCSV(s) {
    const o = optionsOf(s), rows = [['種類', '項目', '値']];
    rows.push(['大会', '大会名', s.title], ['大会', '表示', useLogo(s) ? 'ロゴ画像' : '文字'], ['大会', 'ロゴ画像', o.logoImage], ['大会', '巡の数', s.rounds]);
    rows.push(['進め方', '指名のしかた', ...Array.from({ length: s.rounds }, (_, i) => (roundMode(s, i + 1) === 'order' ? '順番指名' : '一斉入札'))]);
    rows.push(['進め方', '順番指名の順番', o.orderStyle === 'waiver' ? 'ウェーバー' : 'スネーク']);
    rows.push(['進め方', '抽選の演出', o.lotteryStyle === 'short' ? '短い' : '通常']);
    rows.push(['進め方', '制限時間（秒）', o.timerSec]);
    rows.push(['進め方', 'タイマーを自動でスタート', o.timerAuto ? 'する' : 'しない'], ['進め方', 'タイマーを配信画面に出す', o.timerShow ? 'する' : 'しない']);
    rows.push(['進め方', '巡のはじめの見出し', o.flowRound ? '出す' : '出さない'], ['進め方', '待ち時間の画面', o.flowWait ? '出す' : '出さない'], ['進め方', 'ピックアップ前の立ち絵', o.flowStand ? '出す' : '出さない'], ['進め方', '巡の終わりのチーム表', o.flowTeams ? '出す' : '出さない']);
    for (let r = 1; r <= s.rounds; r++) rows.push(['進め方', `待ち時間の画像（第${r}巡）`, ...((o.waitImages || {})[r] || [])]);
    rows.push(['見た目', '背景', o.bgImage], ['見た目', '名前の前につける文字', o.teamPrefix]);
    rows.push(['見た目', '場面の切り替え', TRANSITIONS[o.transition] || 'なし'], ['見た目', '切り替えの長さ（秒）', o.transSec], ['見た目', '切り替えの動画', o.transVideo], ['見た目', '動画で入れ替える秒数', o.transCut || '自動'], ['見た目', 'フェード（秒）', o.fadeSec]);
    for (const g of programOf(s)) {
      if (g.type !== 'slide') rows.push(['進行表', SCENE_CSV[g.type], g.label]);
      else {
        const sl = slideById(s, g.slideId) || { kind: 'text', title: '', lines: [] };
        if (sl.kind === 'image') rows.push(['進行表', '画像の資料', g.label, sl.image || '', sl.fit === 'full' ? '画面いっぱい' : '枠つき']);
        else rows.push(['進行表', sl.rules || sl.id === 'S_draft' ? 'ドラフト説明' : '文字の資料', g.label, sl.title, ...(sl.lines || [])]);
      }
      if (g.memo) rows.push(['進行表', 'メモ', g.memo]); // 自分用のメモ(すぐ上の場面のもの)
    }
    return rows.map((r) => r.map((v) => csvCell(v ?? '')).join(',')).join('\r\n') + '\r\n';
  }
  // 読み込んだ内容を replaceShow で渡す形にする。書いていない項目は今のまま
  function showFromCSV(text) {
    const out = { options: {}, program: null, slides: [] };
    const prog = [];
    for (const r of parseCSV(text.replace(/^\uFEFF/, ''))) {
      const [kind, key, ...v] = r, v0 = v[0] ?? '';
      if (kind === '大会') {
        if (key === '大会名') out.title = v0; else if (key === '巡の数') out.rounds = +v0 || 3;
        else if (key === '表示') out.options.titleMode = /ロゴ|画像/.test(v0) ? 'logo' : 'text';
        else if (key === 'ロゴ画像') out.options.logoImage = v0;
      }
      else if (kind === '進め方') {
        const O = out.options;
        if (key === '指名のしかた') O.roundModes = v.filter((x) => x !== '').map((x) => (/順番/.test(x) ? 'order' : 'bid'));
        else if (key === '順番指名の順番') O.orderStyle = /ウェーバー/.test(v0) ? 'waiver' : 'snake';
        else if (key === '抽選の演出') O.lotteryStyle = /短/.test(v0) ? 'short' : 'full';
        else if (/^制限時間/.test(key)) O.timerSec = Math.max(10, Math.min(3600, +v0 || 300));
        else if (key === 'タイマーを自動でスタート') O.timerAuto = yes(v0);
        else if (key === 'タイマーを配信画面に出す') O.timerShow = yes(v0);
        else if (key === '待ち時間の画面') O.flowWait = yes(v0);
        else if (key === '巡のはじめの見出し') O.flowRound = yes(v0);
        else if (key === 'ピックアップ前の立ち絵') O.flowStand = yes(v0);
        else if (key === '巡の終わりのチーム表') O.flowTeams = yes(v0);
        else { const m = /待ち時間の画像.*?(\d+)/.exec(key); if (m) (O.waitImages = O.waitImages || {})[+m[1]] = v.filter(Boolean); }
      } else if (kind === '見た目') {
        if (key === '背景') out.options.bgImage = v0; else if (key === '大会ロゴ') out.options.logoImage = v0; else if (key === '名前の前につける文字') out.options.teamPrefix = v0;
        else if (key === '場面の切り替え') out.options.transition = Object.keys(TRANSITIONS).find((k) => TRANSITIONS[k] === v0) || 'none';
        else if (/^切り替えの長さ/.test(key)) out.options.transSec = Math.max(0.2, Math.min(3, +v0 || 0.6));
        else if (key === '切り替えの動画') out.options.transVideo = v0;
        else if (key === '動画で入れ替える秒数') out.options.transCut = Math.max(0, +v0 || 0);
        else if (/^フェード/.test(key)) out.options.fadeSec = Math.max(0, Math.min(2, +v0 || 0));
      } else if (kind === '進行表') {
        if (key === 'メモ') { if (prog.length) prog[prog.length - 1].memo = v.join(','); continue; }
        const type = Object.keys(SCENE_CSV).find((t) => SCENE_CSV[t] === key);
        if (type) { if (type !== 'draft' || !prog.some((g) => g.type === 'draft')) prog.push({ id: uid('G'), type, label: v0 || key }); }
        else if (key === '文字の資料' || key === 'ドラフト説明' || key === '画像の資料') {
          const id = uid('S'), image = key === '画像の資料';
          out.slides.push(image ? { id, kind: 'image', title: v0, lines: [], image: v[1] || '', fit: /いっぱい/.test(v[2] || '') ? 'full' : 'card' } : { id, kind: 'text', title: v[1] || v0, lines: v.slice(2).filter((x) => x !== ''), image: '', rules: key === 'ドラフト説明' });
          prog.push({ id: uid('G'), type: 'slide', slideId: id, label: v0 || key });
        }
      }
    }
    if (prog.length) {
      if (!prog.some((g) => g.type === 'draft')) prog.push({ id: uid('G'), type: 'draft', label: 'ドラフト' }); // ドラフトの場面は必ず1つ
      out.program = prog;
    }
    return out;
  }
  // 保存データの読み込み時: 範囲外の値を直す(前の版のデータなど)
  function normalize(s) {
    if (!(s.rounds >= 1 && s.rounds <= MAX_ROUNDS)) s.rounds = 3;
    if (s.round > s.rounds) s.round = s.rounds;
    return s;
  }

  return { TRANSITIONS, initialState, apply, showToCSV, showFromCSV, normalize, useLogo, conflicts, allRevealed, pendingLeaders, roundComplete, draftComplete, pickOf, teamOf, leaderById, playerById, pickedIds, rosterToCSV, rosterFromCSV, parseCSV, LEADER_COLORS, DEFAULT_AUDIO, DEFAULT_OPTIONS, MAX_ROUNDS, MAX_LEADERS, optionsOf, roundMode, turnOrder, currentTurn, draftStarted, confirmKey, waitImagesOf, PROGRAM_TYPES, programOf, progIdxOf, progItem, slideById, teamLabel, shortName, sceneForItem, defaultSlides, ruleLines };
}));
