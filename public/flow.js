// 「次にやること」の決め方(管理画面とスマホ操作画面で共用)
// 状態から「いま押すべき1つのボタン」と、その説明・ほかに押せるボタンを返す。
// 番組の進行表(オープニング → 資料 → リーダー紹介 → ドラフト → … )を上から順に進め、ドラフトの場面では下の draftStep で巡を進める
(function (root) {
  const C = root.DraftCore;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  const STEPS = ['指名を入力', '一斉公開', '抽選・再指名', 'チーム表', '次の巡へ'];

  /* ---------- 番組(進行表)の1つの場面 ---------- */
  function nextStep(S, opts = {}) {
    if (!S.leaders.length) return { step: -1, text: 'まず「登録」でリーダーと選手を登録してください', main: { key: 'roster', label: '登録へ' } };
    const prog = C.programOf(S), i = C.progIdxOf(S), item = prog[i];
    const next = prog[i + 1], prev = prog[i - 1];
    const goNext = next ? { key: 'progNext', label: `次へ（${esc(next.label)}）` } : null;
    const goPrev = prev ? { key: 'progPrev', label: `前の場面へ（${esc(prev.label)}）` } : null;
    const info = { idx: i, total: prog.length, label: item ? item.label : '' };
    if (!item || item.type === 'draft') {
      const d = draftStep(S, opts);
      // ドラフトが終わって最後のチーム表まで見せたら、進行表の次の場面へ
      if (C.draftComplete(S) && (!S.lottery || S.lottery.done) && S.scene !== 'roulette' && goNext && (S.scene === 'teams' || !C.optionsOf(S).flowTeams || next.type === 'final')) {
        return { ...d, step: 5, text: `全${S.rounds}巡の指名が確定しました`, main: goNext, sub: [], info };
      }
      return { ...d, info };
    }
    const sub = [];
    // 手で別の画面に切り替えていたら、この場面に戻すボタン
    if (S.scene !== C.sceneForItem(S, item)) sub.push({ key: 'progShow', label: `「${esc(item.label)}」を映す` });
    if (item.type === 'intro') {
      const n = S.leaders.length, k = Math.min(S.introIdx || 0, n - 1), l = S.leaders[k];
      const nl = S.leaders[k + 1];
      if (k > 0) sub.push({ key: 'introPrev', label: '前の人へ' });
      else if (goPrev) sub.push(goPrev);
      return {
        step: -2, info,
        text: `リーダー紹介: <b>${esc(C.teamLabel(S, l))}</b>（${k + 1} / ${n}）`,
        main: nl ? { key: 'introNext', label: `次へ（${esc(nl.name)}）` } : goNext || { label: 'おわり', off: true },
        sub,
      };
    }
    if (goPrev) sub.push(goPrev);
    return {
      step: -2, info,
      text: `「<b>${esc(item.label)}</b>」を映しています`,
      main: goNext || { label: 'おつかれさまでした', off: true },
      sub,
    };
  }

  /* ---------- ドラフト(巡の中の流れ) ----------
   * 指名入力 → ピックアップで公開(立ち絵 → カード裏 → めくる …) → 抽選 → 再指名 … → チーム表 → 次の巡 */
  function draftStep(S, { demo = false } = {}) {
    const o = C.optionsOf(S);
    const pend = C.pendingLeaders(S), confs = C.conflicts(S);
    const waiting = pend.filter((l) => !(S.noms[l.id] && S.noms[l.id].playerId));
    const toReveal = pend.filter((l) => S.noms[l.id] && S.noms[l.id].playerId && !S.noms[l.id].revealed);
    // この巡で一度でも公開したか(してあれば、いまの入力は再指名)
    const renom = S.picks.some((p) => p.round === S.round) || S.lotteries.some((x) => x.round === S.round);
    const L = S.lottery, name = (id) => esc(C.playerById(S, id)?.name), lname = (id) => esc(C.leaderById(S, id)?.name);
    const sub = [];
    if (demo && waiting.length) sub.push({ key: 'auto', label: 'おまかせ指名' });
    // ピックアップで1人を出す最初のボタン(設定で、カードの前に立ち絵)
    const spotIn = (id, label) => ({ key: o.flowStand ? 'spotStand' : 'spotShow', arg: id, label });

    if (L && !L.done) return { step: 2, text: `<b>${name(L.playerId)}</b> の抽選を配信画面で演出中です`, main: { label: '演出中…', off: true } };
    if (L && L.done && S.scene === 'roulette') {
      const res = `<b>${name(L.playerId)}</b> は <b>${lname(L.winner)}</b> が交渉権確定`;
      // 重複が残っていれば、ボードに戻らず続けて次の抽選へ(再指名は全部の抽選のあと)
      if (confs.length) return { step: 2, text: `${res}。続けて <b>${name(confs[0].playerId)}</b> の重複を抽選します`, main: { key: 'draw', arg: confs[0].playerId, label: '次の抽選へ' }, sub: [{ key: 'board', label: '指名ボードに戻す' }] };
      return { step: 2, text: `${res}${waiting.length ? '。外れたリーダーの再指名に進みます' : ''}`, main: { key: 'board', label: '指名ボードに戻す' } };
    }
    // ピックアップ公開中: (立ち絵 →) カード裏 → めくる → 次の人 … → 全員出たら「一覧を表示」
    if (S.spot) {
      const cur = S.noms[S.spot] || {};
      const rest = [{ key: 'reveal', label: '残りを一斉公開' }];
      const team = esc(C.teamLabel(S, C.leaderById(S, S.spot)));
      if (S.spotStand && !cur.revealed) return { step: renom ? 2 : 1, text: `<b>${team}</b> の立ち絵を出しています`, main: { key: 'spotShow', arg: S.spot, label: 'カードを出す' }, sub: rest };
      if (!cur.revealed) return { step: renom ? 2 : 1, text: `<b>${team}</b> のカードを出しています。読み上げたら、めくってください`, main: { key: 'spotFlip', arg: S.spot, label: 'めくる' }, sub: rest };
      if (toReveal.length) return { step: renom ? 2 : 1, text: `ピックアップで公開しています（あと${toReveal.length}人）`, main: spotIn(toReveal[0].id, `次へ（${lname(toReveal[0].id)}）`), sub: rest };
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
      const go = { key: 'nextRound', label: `第${S.round + 1}巡へ進む` };
      // 巡の終わりのチーム表は設定で外せる
      if (!o.flowTeams) return { step: 4, text: `第${S.round}巡の指名がすべて確定しました。次は第${S.round + 1}巡です`, main: go, sub: [{ key: 'teams', label: 'チーム表を映す' }] };
      return S.scene === 'teams'
        ? { step: 4, text: `第${S.round}巡のチーム表を映しています。次は第${S.round + 1}巡です`, main: go }
        : { step: 3, text: `第${S.round}巡の指名がすべて確定しました`, main: { key: 'teams', label: 'チーム表を映す' } };
    }
    // 順番指名の巡: いまの番の人が指名 → 公開(公開した時点で確定)
    const turn = C.currentTurn(S);
    if (turn) {
      const n = S.noms[turn.id] || {};
      if (!n.playerId) {
        if (S.scene !== 'board') sub.push({ key: 'board', label: '指名ボードを映す' });
        return { step: 0, text: `順番指名: <b>${lname(turn.id)}</b> の番です。指名を下で入力してください（残り${pend.length}人）`, main: { label: '公開', off: true }, sub };
      }
      return { step: 1, text: `順番指名: <b>${lname(turn.id)}</b> の指名を公開します`, main: { key: 'revealOne', arg: turn.id, label: '公開' } };
    }
    const label = renom ? '再指名を公開' : '一斉公開';
    if (waiting.length) {
      if (S.scene !== 'board') sub.push({ key: 'board', label: '指名ボードを映す' });
      return { step: renom ? 2 : 0, text: `${renom ? '外れたリーダーの再指名' : '各リーダーの指名'}を下で入力してください（あと${waiting.length}人）`, main: { label: 'ピックアップで公開', off: true }, sub };
    }
    if (toReveal.length) {
      const spot = spotIn(toReveal[0].id, 'ピックアップで公開');
      const partial = toReveal.length < pend.length;
      // 公開の前に、誰が誰を指名したかを読み合わせる(配信には出ない)
      if (!partial && S.confirmedKey !== C.confirmKey(S)) {
        const list = toReveal.map((l) => `<li class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-[var(--lc)]" style="--lc:${esc(l.color)}" aria-hidden="true"></span><span class="text-[var(--text-muted)]">${lname(l.id)}</span><span aria-hidden="true">→</span><b>${name(S.noms[l.id].playerId)}</b></li>`).join('');
        return { step: renom ? 2 : 1, text: `公開する前に、指名に間違いがないか確認してください<ul class="mt-2 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-6 gap-y-1 text-base">${list}</ul>`, main: { key: 'confirm', label: '確認した' } };
      }
      return partial
        ? { step: renom ? 2 : 1, text: `1人ずつ公開しています（あと${toReveal.length}人）`, main: spot, sub: [{ key: 'reveal', label: '残りを一斉公開' }] }
        : { step: renom ? 2 : 1, text: `${renom ? '再指名' : '全員の指名'}がそろいました。1人ずつ配信画面で公開します`, main: spot, sub: [{ key: 'reveal', label }] };
    }
    return { step: 0, text: '' };
  }

  /* ---------- ボタン → サーバーへ送る操作 ----------
   * 管理画面とスマホで共通。null は画面の側で処理するもの(登録へ・おまかせ指名) */
  function actionFor(key, arg, S) {
    const i = C.progIdxOf(S);
    switch (key) {
      case 'confirm': return { type: 'confirmNoms' };
      case 'reveal': return { type: 'reveal' };
      case 'revealOne': return { type: 'reveal', leaderId: arg };
      case 'spotStand': return { type: 'spotStand', leaderId: arg };
      case 'spotShow': return { type: 'spotShow', leaderId: arg };
      case 'spotFlip': return { type: 'reveal', leaderId: arg, spot: true };
      case 'spotEnd': return { type: 'spotEnd' };
      case 'draw': return { type: 'drawLottery', playerId: arg };
      case 'board': case 'teams': return { type: 'setScene', scene: key };
      case 'nextRound': return { type: 'nextRound' };
      case 'progNext': return { type: 'progGo', idx: i + 1 };
      case 'progPrev': return { type: 'progGo', idx: i - 1 };
      case 'progShow': return { type: 'progGo', idx: i };
      case 'introNext': return { type: 'introGo', idx: (S.introIdx || 0) + 1 };
      case 'introPrev': return { type: 'introGo', idx: (S.introIdx || 0) - 1 };
      default: return null;
    }
  }

  root.DraftFlow = { STEPS, nextStep, actionFor };
}(typeof self !== 'undefined' ? self : this));
