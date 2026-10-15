// node test/core.test.js
const assert = require('assert');
const C = require('../public/core.js');

let s = C.initialState();
for (let i = 0; i < 6; i++) s = C.apply(s, { type: 'addLeader', name: `L${i}` });
s = C.apply(s, { type: 'addPlayers', players: Array.from({ length: 20 }, (_, i) => ({ name: `P${i}` })) });
const L = s.leaders.map((l) => l.id), P = s.players.map((p) => p.id);
assert.strictEqual(new Set(s.leaders.map((l) => l.color)).size, 6, '色は重ならない');

// 1巡目: L0 と L5 が P0 で重複、ほかは単独
const want = [0, 1, 2, 3, 4, 0];
L.forEach((id, i) => { s = C.apply(s, { type: 'nominate', leaderId: id, playerId: P[want[i]] }); });
s = C.apply(s, { type: 'reveal' });
assert.strictEqual(s.picks.length, 4, '単独指名4人は確定');
assert.deepStrictEqual(C.conflicts(s).map((c) => c.leaders.length), [2]);
assert.strictEqual(C.apply(s, { type: 'nominate', leaderId: L[0], playerId: P[9] }).noms[L[0]].playerId, P[0], '公開後の指名は変わらない');

// 抽選: rng=0.9 → 2人目(L5)が当たり
s = C.apply(s, { type: 'drawLottery', playerId: P[0] }, () => 0.9);
assert.strictEqual(s.lottery.winner, L[5]);
assert.strictEqual(s.scene, 'roulette');
assert.ok(C.pickOf(s, L[5], 1));
assert.strictEqual(s.noms[L[0]].playerId, null, '外れた L0 は再指名');
s = C.apply(s, { type: 'lotteryDone', id: s.lottery.id });
assert.throws(() => C.apply(s, { type: 'nominate', leaderId: L[0], playerId: P[1] }), /確定/, '確定済みの選手は指名できない');

// L0 再指名 → 公開 → 単独なので確定 → 巡が完了
s = C.apply(s, { type: 'nominate', leaderId: L[0], playerId: P[7] });
s = C.apply(s, { type: 'reveal' });
assert.ok(C.roundComplete(s));
assert.throws(() => C.apply(s, { type: 'drawLottery', playerId: P[0] }));
s = C.apply(s, { type: 'nextRound' });
assert.strictEqual(s.round, 2);
assert.deepStrictEqual(s.noms, {});

// 抽選の公平性: rng を均等に振ると各リーダーが同じ回数当たる
let t = C.initialState();
for (let i = 0; i < 3; i++) t = C.apply(t, { type: 'addLeader', name: `L${i}` });
t = C.apply(t, { type: 'addPlayers', players: [{ name: 'X' }] });
for (const l of t.leaders) t = C.apply(t, { type: 'nominate', leaderId: l.id, playerId: t.players[0].id });
t = C.apply(t, { type: 'reveal' });
const hits = {};
for (let k = 0; k < 3000; k++) { const u = C.apply(t, { type: 'drawLottery', playerId: t.players[0].id }, () => (k + 0.5) / 3000); hits[u.lottery.winner] = (hits[u.lottery.winner] || 0) + 1; }
assert.deepStrictEqual(Object.values(hits), [1000, 1000, 1000]);

// CSV 往復
const csv = C.rosterToCSV(s);
const back = C.rosterFromCSV(csv);
assert.strictEqual(back.leaders.length, 6); assert.strictEqual(back.players.length, 20);
assert.deepStrictEqual(C.rosterFromCSV('種類,名前,色,画像ファイル\n選手,"a,b"\nリーダー,X,#123456,x.png').leaders[0], { name: 'X', short: '', color: '#123456', icon: 'x.png' });
// 旧書式(チーム名の列あり)も読める
assert.deepStrictEqual(C.rosterFromCSV('種類,名前,チーム名,色,画像ファイル\nリーダー,X,チームX,#123456,x.png\n選手,Y,,,y.png'), { leaders: [{ name: 'X', short: '', color: '#123456', icon: 'x.png' }], players: [{ name: 'Y', icon: 'y.png', note: '' }] });

// 1人ずつ公開: 全員公開するまでは確定しない(後から重複が出ることがあるため)
{
  let t = C.initialState();
  for (let i = 0; i < 3; i++) t = C.apply(t, { type: 'addLeader', name: `L${i}` });
  t = C.apply(t, { type: 'addPlayers', players: [{ name: 'a' }, { name: 'b' }] });
  const [l0, l1, l2] = t.leaders.map((l) => l.id), [pa, pb] = t.players.map((p) => p.id);
  t = C.apply(t, { type: 'nominate', leaderId: l0, playerId: pa });
  t = C.apply(t, { type: 'nominate', leaderId: l1, playerId: pb });
  t = C.apply(t, { type: 'nominate', leaderId: l2, playerId: pa });
  t = C.apply(t, { type: 'reveal', leaderId: l0 });
  t = C.apply(t, { type: 'reveal', leaderId: l1 });
  assert.strictEqual(t.picks.length, 0);
  assert.strictEqual(C.allRevealed(t), false);
  t = C.apply(t, { type: 'reveal', leaderId: l2 });
  assert.deepStrictEqual(t.picks.map((p) => p.leaderId), [l1]);
  assert.deepStrictEqual(C.conflicts(t), [{ playerId: pa, leaders: [l0, l2] }]);
  // 音の設定
  t = C.apply(t, { type: 'setAudio', patch: { bgmVol: 30 } });
  assert.deepStrictEqual(t.audio, { ...C.DEFAULT_AUDIO, bgmVol: 30 });
}

// 重複が2件: 全部抽選し終わるまで再指名できない(プロ野球のドラフトと同じ)
{
  let t = C.initialState();
  for (let i = 0; i < 4; i++) t = C.apply(t, { type: 'addLeader', name: `L${i}` });
  t = C.apply(t, { type: 'addPlayers', players: ['a', 'b', 'c', 'd'].map((name) => ({ name })) });
  const L = t.leaders.map((l) => l.id), [pa, pb, pc] = t.players.map((p) => p.id);
  for (const [l, p] of [[0, pa], [1, pa], [2, pb], [3, pb]]) t = C.apply(t, { type: 'nominate', leaderId: L[l], playerId: p });
  t = C.apply(t, { type: 'reveal' });
  assert.strictEqual(C.conflicts(t).length, 2);
  t = C.apply(t, { type: 'drawLottery', playerId: pa }, () => 0);
  assert.throws(() => C.apply(t, { type: 'nominate', leaderId: L[1], playerId: pc }), /演出/);
  t = C.apply(t, { type: 'lotteryDone', id: t.lottery.id });
  assert.throws(() => C.apply(t, { type: 'nominate', leaderId: L[1], playerId: pc }), /すべて抽選/);
  t = C.apply(t, { type: 'drawLottery', playerId: pb }, () => 0);
  t = C.apply(t, { type: 'lotteryDone', id: t.lottery.id });
  t = C.apply(t, { type: 'nominate', leaderId: L[1], playerId: pc });
  assert.strictEqual(t.noms[L[1]].playerId, pc);
}

// ピックアップ公開: 1人ずつ spot に出る。全員出るまで確定しない。spotEnd で一覧へ
{
  let t = C.initialState();
  for (let i = 0; i < 3; i++) t = C.apply(t, { type: 'addLeader', name: `L${i}` });
  t = C.apply(t, { type: 'addPlayers', players: ['a', 'b', 'c'].map((name) => ({ name })) });
  const L = t.leaders.map((l) => l.id), P = t.players.map((p) => p.id);
  for (let i = 0; i < 3; i++) t = C.apply(t, { type: 'nominate', leaderId: L[i], playerId: P[i] });
  t = C.apply(t, { type: 'spotShow', leaderId: L[0] });
  assert.strictEqual(t.spot, L[0]);
  assert.strictEqual(t.noms[L[0]].revealed, false, '出しただけではめくらない');
  t = C.apply(t, { type: 'reveal', leaderId: L[0], spot: true });
  assert.strictEqual(t.spot, L[0]);
  assert.strictEqual(t.picks.length, 0);
  t = C.apply(t, { type: 'reveal', leaderId: L[1], spot: true });
  t = C.apply(t, { type: 'reveal', leaderId: L[2], spot: true });
  assert.strictEqual(t.spot, L[2]);
  assert.strictEqual(t.picks.length, 3);
  t = C.apply(t, { type: 'spotEnd' });
  assert.strictEqual(t.spot, null);
}

// 欠場・削除の制限・ひとこと
{
  let t = C.initialState();
  for (let i = 0; i < 2; i++) t = C.apply(t, { type: 'addLeader', name: `L${i}` });
  t = C.apply(t, { type: 'addPlayers', players: [{ name: 'a', note: '初段' }, { name: 'b' }] });
  const L = t.leaders.map((l) => l.id), P = t.players.map((p) => p.id);
  assert.strictEqual(t.players[0].note, '初段');
  assert.ok(C.rosterToCSV(t).includes('選手,a,,,,初段'));
  t = C.apply(t, { type: 'nominate', leaderId: L[0], playerId: P[0] });
  assert.throws(() => C.apply(t, { type: 'removePlayer', id: P[1] }), /欠場/);
  assert.throws(() => C.apply(t, { type: 'removeLeader', id: L[1] }), /削除できません/);
  t = C.apply(t, { type: 'updatePlayer', id: P[1], patch: { absent: true } });
  assert.throws(() => C.apply(t, { type: 'nominate', leaderId: L[1], playerId: P[1] }), /欠場/);
}

// 順番指名(スネーク): 1巡目は一斉入札、2・3巡目は順番指名。2巡目は登録順、3巡目は逆順
{
  let t = C.initialState();
  for (let i = 0; i < 3; i++) t = C.apply(t, { type: 'addLeader', name: `L${i}` });
  t = C.apply(t, { type: 'addPlayers', players: Array.from({ length: 9 }, (_, i) => ({ name: `p${i}` })) });
  t = C.apply(t, { type: 'setOption', patch: { roundModes: ['bid', 'order', 'order'], orderStyle: 'snake' } });
  const L = t.leaders.map((l) => l.id), P = t.players.map((p) => p.id);
  for (let i = 0; i < 3; i++) t = C.apply(t, { type: 'nominate', leaderId: L[i], playerId: P[i] });
  t = C.apply(t, { type: 'reveal' });
  t = C.apply(t, { type: 'nextRound' });
  assert.strictEqual(C.currentTurn(t).id, L[0]);
  assert.throws(() => C.apply(t, { type: 'nominate', leaderId: L[1], playerId: P[3] }), /番です/);
  t = C.apply(t, { type: 'nominate', leaderId: L[0], playerId: P[3] });
  t = C.apply(t, { type: 'reveal', leaderId: L[0] });
  assert.ok(C.pickOf(t, L[0], 2), '順番指名は公開で確定');
  assert.strictEqual(C.currentTurn(t).id, L[1]);
  for (const [i, p] of [[1, 4], [2, 5]]) { t = C.apply(t, { type: 'nominate', leaderId: L[i], playerId: P[p] }); t = C.apply(t, { type: 'reveal', leaderId: L[i] }); }
  t = C.apply(t, { type: 'nextRound' });
  assert.deepStrictEqual(C.turnOrder(t).map((l) => l.id), [L[2], L[1], L[0]], 'スネークで逆順');
}

// 抽選の記録・リセット・タイマー
{
  let t = C.initialState();
  for (let i = 0; i < 2; i++) t = C.apply(t, { type: 'addLeader', name: `L${i}` });
  t = C.apply(t, { type: 'addPlayers', players: [{ name: 'a' }] });
  const L = t.leaders.map((l) => l.id), P = t.players.map((p) => p.id);
  for (const id of L) t = C.apply(t, { type: 'nominate', leaderId: id, playerId: P[0] });
  t = C.apply(t, { type: 'reveal' });
  t = C.apply(t, { type: 'drawLottery', playerId: P[0] }, () => 0);
  assert.strictEqual(t.lotteryLog.length, 1);
  t = C.apply(t, { type: 'resetDraft' });
  assert.strictEqual(t.picks.length, 0);
  assert.strictEqual(t.players.length, 1, '名簿は残る');
  assert.ok(t.lotteryLog[1].reset);
  t = C.apply(t, { type: 'setOption', patch: { timerSec: 60 } });
  t = C.apply(t, { type: 'timer', cmd: 'start', now: 1000 });
  assert.strictEqual(t.timer.endsAt, 61000);
  t = C.apply(t, { type: 'timer', cmd: 'stop', now: 31000 });
  assert.strictEqual(t.timer.left, 30);
  t = C.apply(t, { type: 'timer', cmd: 'start', now: 40000 });
  assert.strictEqual(t.timer.endsAt, 70000, '止めた所から続き');
}

console.log('core OK');

// 略称: 帯は「チーム＋略称」、略称が無ければフルネーム。CSV の略称列も往復できる
{
  let s = C.apply(C.initialState(), { type: 'replaceRoster', leaders: [{ name: '飛鳥 りく', short: '飛鳥' }, { name: '角田 みお' }], players: [] });
  assert.strictEqual(C.teamLabel(s, s.leaders[0]), 'チーム飛鳥');
  assert.strictEqual(C.teamLabel(s, s.leaders[1]), 'チーム角田 みお');
  assert.strictEqual(C.rosterFromCSV(C.rosterToCSV(s)).leaders[0].short, '飛鳥');
}
// 巡のはじめ: 待ち時間の画像が無ければ待ち時間の画面は飛ばす / タイマーは自動でスタート(設定で止められる)
{
  let s = C.apply(C.initialState(), { type: 'replaceRoster', leaders: [{ name: 'A' }, { name: 'B' }], players: [{ name: 'p1' }, { name: 'p2' }, { name: 'p3' }, { name: 'p4' }] });
  s = C.apply(s, { type: 'progGo', idx: 4, now: 1000 });
  assert.strictEqual(s.scene, 'board');
  assert.strictEqual(s.timer.endsAt, 1000 + 300 * 1000);
  const [a, b] = s.leaders, [p1, p2] = s.players;
  s = C.apply(s, { type: 'nominate', leaderId: a.id, playerId: p1.id });
  s = C.apply(s, { type: 'nominate', leaderId: b.id, playerId: p2.id });
  s = C.apply(s, { type: 'reveal' });
  s = C.apply(s, { type: 'setOption', patch: { timerAuto: false, waitImages: { 2: ['q.png'] } } });
  s = C.apply(s, { type: 'nextRound' });
  assert.strictEqual(s.scene, 'wait');
  assert.strictEqual(s.timer.endsAt, null);
}
console.log('略称・巡のはじめ ok');
// 番組の CSV: 書き出し → 読み込みで同じ番組になる
{
  let s = C.apply(C.initialState(), { type: 'setOption', patch: { roundModes: ['bid', 'order', 'order'], orderStyle: 'waiver', timerSec: 240, flowStand: false, waitImages: { 2: ['a.png', 'b.png'] }, teamPrefix: '' } });
  s = C.apply(s, { type: 'addSlide', kind: 'image', toProgram: true, at: 1 });
  const csv = C.showToCSV(s);
  let t = C.apply(C.initialState(), { type: 'replaceShow', ...C.showFromCSV(csv) });
  assert.strictEqual(C.showToCSV(t), csv);
  assert.deepStrictEqual(C.optionsOf(t).waitImages, { 1: [], 2: ['a.png', 'b.png'], 3: [] });
  assert.strictEqual(C.slideById(t, C.programOf(t).find((g) => g.label === 'ドラフト説明').slideId).rules, true);
  // ドラフトの場面がない CSV でも、ドラフトは必ず残る
  const r = C.showFromCSV('種類,項目,値\n進行表,ロゴ,オープニング\n');
  assert.deepStrictEqual(r.program.map((g) => g.type), ['logo', 'draft']);
  assert.strictEqual(C.normalize({ rounds: 10, round: 1 }).rounds, 3);
}
console.log('番組の CSV ok');
